// The KeyValueStore API is global and signs with SigV4A. This import registers the signer the SDK looks for.

import "@aws-sdk/signature-v4a";
import {
  type CloudFrontKeyValueStoreClient,
  ConflictException,
  DescribeKeyValueStoreCommand,
  InternalServerException,
  ListKeysCommand,
  UpdateKeysCommand,
} from "@aws-sdk/client-cloudfront-keyvaluestore";
import * as v from "valibot";

import { LIMITS } from "./config.ts";
import type { Batch } from "./plan.ts";
import { KvsConflictError, type KvsPort, KvsUnavailableError, type Snapshot } from "./sync.ts";

const etag = v.pipe(v.string(), v.minLength(1));
const describeSchema = v.object({ ETag: etag, Status: v.optional(v.string()) });
const listSchema = v.object({
  Items: v.optional(v.array(v.object({ Key: v.string(), Value: v.string() })), []),
  NextToken: v.optional(v.string()),
});
const updateSchema = v.object({ ETag: etag });

// #region errors
function translate(error: unknown): unknown {
  // The API reference lists ConflictException but not which error a stale If-Match gets.
  // Anything not recognized here is rethrown, so an unknown answer stops the sync instead of retrying it.
  if (error instanceof v.ValiError) {
    return error;
  }
  if (error instanceof ConflictException) {
    return new KvsConflictError(error.message, { cause: error });
  }
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
    ?.httpStatusCode;
  // No status at all means the request died on the way: the write may have landed.
  if (error instanceof InternalServerException || status === undefined || status >= 500) {
    return new KvsUnavailableError(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
  return error;
}
// #endregion errors

// #region adapter
export function createKvsStore(
  client: Pick<CloudFrontKeyValueStoreClient, "send">,
  kvsArn: string,
): KvsPort {
  return {
    async read(): Promise<Snapshot> {
      try {
        // ETag first. Pairs listed after it can only be newer, and a newer store rejects this ETag.
        // The other order could pair a new ETag with old pairs and overwrite a change unseen.
        const store = v.parse(
          describeSchema,
          await client.send(new DescribeKeyValueStoreCommand({ KvsARN: kvsArn })),
        );
        if (store.Status !== undefined && store.Status !== "READY") {
          throw new KvsUnavailableError(`the store is ${store.Status}, not READY`);
        }
        const entries = new Map<string, string>();
        let token: string | undefined;
        do {
          const page = v.parse(
            listSchema,
            await client.send(
              new ListKeysCommand({
                KvsARN: kvsArn,
                MaxResults: LIMITS.keysPerUpdate,
                NextToken: token,
              }),
            ),
          );
          for (const item of page.Items) {
            entries.set(item.Key, item.Value);
          }
          token = page.NextToken;
        } while (token !== undefined);
        return { etag: store.ETag, entries };
      } catch (error) {
        throw error instanceof KvsUnavailableError ? error : translate(error);
      }
    },

    async update(etag: string, batch: Batch): Promise<string> {
      try {
        const response = await client.send(
          new UpdateKeysCommand({
            KvsARN: kvsArn,
            IfMatch: etag,
            Puts: batch.puts.map((pair) => ({ Key: pair.key, Value: pair.value })),
            Deletes: batch.deletes.map((key) => ({ Key: key })),
          }),
        );
        return v.parse(updateSchema, response).ETag;
      } catch (error) {
        throw translate(error);
      }
    },
  };
}
// #endregion adapter
