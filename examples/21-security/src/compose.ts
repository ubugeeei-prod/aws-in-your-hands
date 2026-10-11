import { randomBytes, randomUUID } from "node:crypto";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { type App, createApp } from "./app.ts";
import { parseEnv } from "./env.ts";
import { createKeyring } from "./keyring.ts";
import { createLogger } from "./log.ts";
import { MemorySecretStore, type SecretSource } from "./secret-source.ts";
import { createSecretsManagerSource } from "./secrets-manager-source.ts";

// #region compose
export function composeApp(source: Record<string, string | undefined>): App {
  const env = parseEnv(source);
  const log = createLogger(env.LOG_LEVEL);

  const secrets: SecretSource =
    env.SECRET_SOURCE === "secretsmanager"
      ? // maxAttempts 2: one quick retry, then answer 503 well inside the function timeout.
        createSecretsManagerSource(new SecretsManagerClient({ maxAttempts: 2 }), env.SECRET_ID)
      : new MemorySecretStore({
          versionId: randomUUID(),
          key: randomBytes(48).toString("base64url"),
          createdAt: new Date(),
        });

  return createApp({
    stage: env.STAGE,
    tokenTtlSeconds: env.TOKEN_TTL_SECONDS,
    now: () => Math.floor(Date.now() / 1000),
    log,
    keyring: createKeyring({
      source: secrets,
      now: Date.now,
      ttlMs: env.KEY_CACHE_SECONDS * 1000,
      minRefreshMs: env.KEY_REFRESH_MIN_SECONDS * 1000,
      onError: (error) =>
        log({ level: "warn", message: "signing keys not refreshed", error: error instanceof Error ? error.name : "?" }),
    }),
  });
}
// #endregion compose
