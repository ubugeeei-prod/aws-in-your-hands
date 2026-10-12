import { setTimeout as sleep } from "node:timers/promises";

import * as v from "valibot";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";
import {
  createLocalAuthenticator,
  signLocalToken,
} from "@aih/example-06-auth/api/src/local-auth.ts";
import { seededNotes } from "@aih/example-36-bedrock/src/local-notes.ts";
import { transcriptNames, transcripts } from "@aih/example-36-bedrock/src/transcripts.ts";

import { composeAgent } from "./compose.ts";
import { parseEnv } from "./env.ts";
import { replayingModel } from "./local-model.ts";
import { InMemoryMemoryStore } from "./memory-store.ts";
import { newSessionId } from "./session-id.ts";

// #region dev
const env = parseEnv({ PORT: "8850", ...process.env });
if (env.AI_BACKEND !== "scripted") {
  throw new Error("The local server plays transcripts only. Set AI_BACKEND=scripted.");
}
const secretMessage = "LOCAL_AUTH_SECRET must be set (see .env.example)";
const secret = v.parse(
  v.pipe(v.string(secretMessage), v.minLength(32, secretMessage)),
  process.env["LOCAL_AUTH_SECRET"],
);
const name = v.parse(
  v.optional(v.picklist(transcriptNames), "tool-then-answer"),
  process.env["AI_TRANSCRIPT"],
);
// 120 ms between events, so the stream is visible in curl.
const pause = (abort: AbortSignal) =>
  sleep(120, undefined, { signal: abort }).then(
    () => undefined,
    () => undefined,
  );

const agent = composeAgent(env, {
  gateway: replayingModel([transcripts[name]], pause),
  // No runtime stands in front of this process, so nothing has checked a token for it.
  // Chapter 06's local sign-in verifies the signature here.
  authenticate: createLocalAuthenticator(secret),
  notes: await seededNotes(),
  store: new InMemoryMemoryStore(),
});

// Loopback only. The deployed agent binds 0.0.0.0 because only the runtime can reach it.
nodeServer(agent).listen(env.PORT, "127.0.0.1", async () => {
  console.log(`agent on http://localhost:${env.PORT} (POST /invocations, GET /ping)`);
  console.log(`inference: none. Playing chapter 36's transcript ${name}. No AWS call, no charge`);
  for (const user of ["local-alice", "local-bob"]) {
    console.log(`${user}\n  token:   ${await signLocalToken(secret, user)}`);
    console.log(`  session: ${newSessionId(user)}`);
  }
});
// #endregion dev
