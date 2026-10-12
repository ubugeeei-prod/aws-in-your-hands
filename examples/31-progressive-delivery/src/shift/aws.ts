import { type CloudWatchClient, DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import {
  GetAliasCommand,
  type LambdaClient,
  PublishVersionCommand,
  UpdateAliasCommand,
} from "@aws-sdk/client-lambda";
import * as v from "valibot";

import type { AlarmReading } from "./decide.ts";
import { type AlarmPort, type AliasPort, type AliasView, RevisionConflictError } from "./run.ts";

const aliasSchema = v.object({
  FunctionVersion: v.pipe(v.string(), v.regex(/^\d+$/, "The alias must name a published version.")),
  RevisionId: v.pipe(v.string(), v.minLength(1)),
  RoutingConfig: v.optional(
    v.object({
      AdditionalVersionWeights: v.optional(
        v.record(v.string(), v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
        {},
      ),
    }),
    {},
  ),
});

const toView = (response: unknown): AliasView => {
  const alias = v.parse(aliasSchema, response);
  return {
    version: alias.FunctionVersion,
    weights: alias.RoutingConfig.AdditionalVersionWeights,
    revisionId: alias.RevisionId,
  };
};

// #region alias
export function lambdaAlias(
  client: Pick<LambdaClient, "send">,
  functionName: string,
  aliasName: string,
): AliasPort {
  return {
    read: async () =>
      toView(
        await client.send(new GetAliasCommand({ FunctionName: functionName, Name: aliasName })),
      ),
    write: async (target, revisionId) => {
      try {
        return toView(
          await client.send(
            new UpdateAliasCommand({
              FunctionName: functionName,
              Name: aliasName,
              FunctionVersion: target.version,
              // An empty map is how the weights are removed. Leaving the field out keeps them.
              RoutingConfig: { AdditionalVersionWeights: target.weights },
              // Lambda refuses the write when the alias has changed since it was read.
              RevisionId: revisionId,
            }),
          ),
        );
      } catch (error) {
        if (error instanceof Error && error.name === "PreconditionFailedException") {
          throw new RevisionConflictError();
        }
        throw error;
      }
    },
  };
}
// #endregion alias

// #region publish
const versionSchema = v.object({ Version: v.pipe(v.string(), v.regex(/^\d+$/)) });

/**
 * Freezes the function's current code and configuration as a numbered version.
 * When nothing changed since the last one, Lambda answers with that one again.
 */
export async function publishVersion(
  client: Pick<LambdaClient, "send">,
  functionName: string,
  description: string,
): Promise<string> {
  const response = await client.send(
    new PublishVersionCommand({ FunctionName: functionName, Description: description }),
  );
  return v.parse(versionSchema, response).Version;
}
// #endregion publish

const alarmsSchema = v.object({
  MetricAlarms: v.optional(
    v.array(
      v.object({
        AlarmName: v.string(),
        StateValue: v.picklist(["OK", "ALARM", "INSUFFICIENT_DATA"]),
      }),
    ),
    [],
  ),
});

// #region alarms
export function cloudWatchAlarms(
  client: Pick<CloudWatchClient, "send">,
  names: string[],
): AlarmPort {
  return {
    read: async (): Promise<AlarmReading[]> => {
      const response = await client.send(
        new DescribeAlarmsCommand({ AlarmNames: names, AlarmTypes: ["MetricAlarm"] }),
      );
      const found = v.parse(alarmsSchema, response).MetricAlarms;
      // An alarm that was deleted would otherwise look like an alarm that is not firing.
      const missing = names.filter((name) => !found.some((alarm) => alarm.AlarmName === name));
      if (missing.length > 0) {
        throw new Error(`No such alarm: ${missing.join(", ")}`);
      }
      return found.map((alarm) => ({ name: alarm.AlarmName, state: alarm.StateValue }));
    },
  };
}
// #endregion alarms
