import { setTimeout as sleep } from "node:timers/promises";

import { parseEnv } from "./env.ts";
import { runCommand } from "./ops.ts";
import { iamToken, openRds } from "./rds.ts";
import { MIGRATOR_ROLE } from "./roles.ts";

// #region handler
const env = parseEnv(process.env);

const open = (user: string, password: () => Promise<string>) =>
  openRds({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user,
    password,
    onPoolError: (error) => console.error(`idle connection lost: ${error.message}`),
  });

// The event is never logged: a bootstrap command carries the master password.
export const handler = (event: unknown): Promise<unknown> =>
  runCommand(event, {
    database: env.DB_NAME,
    asMaster: ({ username, password }) => open(username, () => Promise.resolve(password)),
    asMigrator: () =>
      open(
        MIGRATOR_ROLE,
        iamToken({
          host: env.DB_HOST,
          port: env.DB_PORT,
          user: MIGRATOR_ROLE,
          region: env.AWS_REGION,
        }),
      ),
    now: () => new Date(),
    sleep: (ms) => sleep(ms),
    log: console.log,
  });
// #endregion handler
