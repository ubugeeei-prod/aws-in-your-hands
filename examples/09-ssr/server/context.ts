import { randomBytes } from "node:crypto";

import { parseEnv } from "../core/env.ts";
import { createStaticNotes } from "../core/notes.ts";
import { createDevIdentity } from "../core/profile.ts";
import { seedNotes } from "../core/seed.ts";
import { createMemorySessions } from "../core/session.ts";

// #region context
// The one place that reads the clock, the random source, and the environment.
// It runs once per process: once per execution environment on Lambda.
const now = (): Date => new Date();
const newSecret = (): string => randomBytes(32).toString("base64url");

export const context = {
  env: parseEnv(process.env),
  now,
  newSecret,
  notes: createStaticNotes(seedNotes),
  sessions: createMemorySessions(),
  identity: createDevIdentity({ now, newToken: newSecret }),
  /** Pause between lines of /feed, so that streaming is visible to the eye. */
  feedPauseMs: 300,
};
// #endregion context
