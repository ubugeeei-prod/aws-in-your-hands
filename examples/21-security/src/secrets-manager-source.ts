import {
  GetSecretValueCommand,
  ListSecretVersionIdsCommand,
  PutSecretValueCommand,
  type SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import * as v from "valibot";

import type { RotationApi } from "./rotation.ts";
import {
  parseSecretString,
  SecretAccessDenied,
  type SecretSource,
  type Stage,
} from "./secret-source.ts";

type Sender = Pick<SecretsManagerClient, "send">;

const present = v.pipe(v.string(), v.minLength(1));
const valueSchema = v.object({ VersionId: present, SecretString: present });
const versionsSchema = v.array(
  v.object({
    VersionId: v.string(),
    VersionStages: v.optional(v.array(v.string()), []),
    CreatedDate: v.date(),
  }),
);

const named = (error: unknown, name: string): boolean =>
  error instanceof Error && error.name === name;

// #region adapter
/** Reads one secret by staging label. The value never leaves this function except as the return value. */
export function createSecretsManagerSource(client: Sender, secretId: string): SecretSource {
  return {
    async read(stage: Stage) {
      try {
        const response = await client.send(
          new GetSecretValueCommand({ SecretId: secretId, VersionStage: stage }),
        );
        const value = v.safeParse(valueSchema, response);
        if (!value.success) {
          throw new Error(`GetSecretValue(${stage}) returned no VersionId or SecretString`);
        }
        return {
          versionId: value.output.VersionId,
          key: parseSecretString(value.output.SecretString),
        };
      } catch (error) {
        // A secret that was never rotated has no version labeled AWSPREVIOUS.
        if (stage === "AWSPREVIOUS" && named(error, "ResourceNotFoundException")) {
          return null;
        }
        if (named(error, "AccessDeniedException")) {
          throw new SecretAccessDenied(
            `not allowed to read the ${stage} version of the signing secret`,
            {
              cause: error,
            },
          );
        }
        throw error;
      }
    },
  };
}
// #endregion adapter

// #region rotation-adapter
export function createRotationApi(client: Sender, secretId: string): RotationApi {
  return {
    async versions() {
      const response = await client.send(new ListSecretVersionIdsCommand({ SecretId: secretId }));
      return v.parse(versionsSchema, response.Versions ?? []).map((version) => ({
        versionId: version.VersionId,
        stages: version.VersionStages,
        createdAt: version.CreatedDate,
      }));
    },
    async put(versionId, key) {
      // No VersionStages: Secrets Manager moves AWSCURRENT here and AWSPREVIOUS to the old current.
      await client.send(
        new PutSecretValueCommand({
          SecretId: secretId,
          ClientRequestToken: versionId,
          SecretString: JSON.stringify({ key }),
        }),
      );
    },
  };
}
// #endregion rotation-adapter
