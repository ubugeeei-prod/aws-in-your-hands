import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  DatabaseErrorException,
  ExecuteStatementCommand,
  type Field,
  RDSDataClient,
  RDSDataServiceException,
  RollbackTransactionCommand,
  type SqlParameter,
} from "@aws-sdk/client-rds-data";

import type { Queryable } from "@aih/example-13-sql/src/db.ts";

import { ConnectionLostError } from "./failure.ts";
import type { Transactional } from "./once.ts";

// #region client
/**
 * The SDK would otherwise send a call again when no answer came back. Inside a
 * transaction that could run one statement twice, where no idempotency key can
 * see it. Every retry is left to the caller, which starts the transaction over.
 */
export function createDataApiClient(region: string): RDSDataClient {
  return new RDSDataClient({ region, maxAttempts: 1 });
}
// #endregion client

// #region parameters
/** `$1`, `$2` of node-postgres become the named parameters `:p1`, `:p2`. */
export function toNamedSql(text: string): string {
  return text.replaceAll(/\$(\d+)/g, ":p$1");
}

export function toSqlParameters(params: readonly unknown[]): SqlParameter[] {
  return params.map((value, index): SqlParameter => {
    const name = `p${index + 1}`;
    if (value === null) {
      return { name, value: { isNull: true } };
    }
    if (typeof value === "string") {
      return { name, value: { stringValue: value } };
    }
    if (typeof value === "boolean") {
      return { name, value: { booleanValue: value } };
    }
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return { name, value: { longValue: value } };
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return { name, value: { doubleValue: value } };
    }
    // Dates, arrays and objects have no single right encoding here. The SQL
    // casts a string instead (`CAST($1 AS timestamptz)`), which every driver accepts.
    throw new TypeError(`Parameter $${index + 1} must be a string, a number, a boolean or null.`);
  });
}
// #endregion parameters

// #region rows
function valueOf(field: Field, column: string): unknown {
  if (field.isNull === true) {
    return null;
  }
  for (const value of [field.stringValue, field.longValue, field.doubleValue, field.booleanValue]) {
    if (value !== undefined) {
      return value;
    }
  }
  throw new TypeError(`Column ${column} came back as a type this adapter does not read.`);
}

/** Rows as objects keyed by column label, the shape node-postgres returns. */
export function toRows(
  records: Field[][] | undefined,
  columns: { label?: string | undefined }[] | undefined,
): Record<string, unknown>[] {
  return (records ?? []).map((record) =>
    Object.fromEntries(
      record.map((field, index) => {
        const label = columns?.[index]?.label;
        if (label === undefined) {
          throw new TypeError(`Column ${index + 1} has no label in the result metadata.`);
        }
        return [label, valueOf(field, label)];
      }),
    ),
  );
}
// #endregion rows

// #region errors
// DatabaseErrorException is the database refusing a statement: the SQL ran and
// was answered. Its SQLSTATE is not a member of the exception, so a conflict
// cannot be told from any other SQL error and is not retried on this path.
// Everything else the service throws (the instance resuming from a pause, no
// writer during a failover, a transaction ID that no longer exists) and every
// error that is not the service's at all (no answer, a broken socket) leaves
// the outcome of the attempt unknown.
export function translate(error: unknown): unknown {
  if (error instanceof DatabaseErrorException) {
    return error;
  }
  if (error instanceof RDSDataServiceException && error.$fault === "client") {
    const lost = ["DatabaseResumingException", "TransactionNotFoundException"];
    if (!lost.includes(error.name)) {
      // Access denied, a bad secret, the Data API not enabled: retrying cannot help.
      return error;
    }
  }
  return new ConnectionLostError("The Data API call ended without an outcome.", error);
}
// #endregion errors

export type DataApiTarget = {
  /** The DB cluster's ARN. */
  resourceArn: string;
  /** The secret holding the database user's name and password. */
  secretArn: string;
  database: string;
};

/** The one method of RDSDataClient this adapter uses. */
export type DataApiSender = Pick<RDSDataClient, "send">;

// #region adapter
export function dataApi(client: DataApiSender, target: DataApiTarget): Transactional {
  const call = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      throw translate(error);
    }
  };

  return {
    async transaction(body) {
      const { transactionId } = await call(() => client.send(new BeginTransactionCommand(target)));
      if (transactionId === undefined) {
        throw new ConnectionLostError("BeginTransaction returned no transaction ID.");
      }
      const tx: Queryable = {
        async query(text, params = []) {
          const response = await call(() =>
            client.send(
              new ExecuteStatementCommand({
                ...target,
                transactionId,
                sql: toNamedSql(text),
                parameters: toSqlParameters(params),
                includeResultMetadata: true,
              }),
            ),
          );
          return { rows: toRows(response.records, response.columnMetadata) };
        },
      };
      try {
        const result = await body(tx);
        await call(() => client.send(new CommitTransactionCommand({ ...target, transactionId })));
        return result;
      } catch (error) {
        // Best effort. An abandoned transaction is rolled back by the service
        // three minutes after the last call that used its ID.
        const { resourceArn, secretArn } = target;
        await client
          .send(new RollbackTransactionCommand({ resourceArn, secretArn, transactionId }))
          .catch(() => undefined);
        throw error;
      }
    },
  };
}
// #endregion adapter
