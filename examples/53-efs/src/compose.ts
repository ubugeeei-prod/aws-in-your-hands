import { randomUUID } from "node:crypto";

import * as v from "valibot";

import { createApp } from "@aih/example-04-http-api/src/app.ts";
import { parseEnv } from "@aih/example-04-http-api/src/env.ts";
import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import { createLogger } from "@aih/example-04-http-api/src/log.ts";
import { createNoteService } from "@aih/example-04-http-api/src/notes.ts";

import { nodeDir } from "./node-dir.ts";
import { DirectoryNoteRepository } from "./note-files.ts";

// #region env
// An absolute path: a relative one would depend on where the process happened to start.
const notesDirSchema = v.pipe(v.string(), v.regex(/^\/[^\0]*$/, "Must be an absolute path."));

export function parseNotesDir(source: Record<string, string | undefined>): string {
  const result = v.safeParse(notesDirSchema, source["NOTES_DIR"]);
  if (!result.success) {
    throw new Error(`Invalid environment:\n  NOTES_DIR: ${result.issues[0].message}`);
  }
  return result.output.replace(/\/+$/, "") || "/";
}
// #endregion env

// #region compose
/** The chapter 04 app over a directory. Run it in as many processes as you like. */
export async function composeApp(source: Record<string, string | undefined>): Promise<Fetch> {
  const env = parseEnv(source);
  const repository = await DirectoryNoteRepository.open(nodeDir, parseNotesDir(source), {
    newToken: randomUUID,
  });
  return createApp({
    env,
    log: createLogger(env.LOG_LEVEL),
    notes: createNoteService({ repository, now: () => new Date(), newId: randomUUID }),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
// #endregion compose
