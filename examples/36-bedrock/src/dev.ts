import { setTimeout as sleep } from "node:timers/promises";

import * as v from "valibot";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";
import {
  createLocalAuthenticator,
  signLocalToken,
} from "@aih/example-06-auth/api/src/local-auth.ts";

import { createBedrockGateway } from "./bedrock.ts";
import { InMemoryUsageLedger } from "./budget.ts";
import { composeApp } from "./compose.ts";
import { parseEnv } from "./env.ts";
import type { ModelGateway } from "./gateway.ts";
import { seededNotes } from "./local-notes.ts";
import { createScriptedModel } from "./scripted-model.ts";
import { transcriptNames, transcripts } from "./transcripts.ts";

// #region dev
const env = parseEnv(process.env);
const port = Number(process.env["PORT"] ?? 8836);
const secretMessage = "LOCAL_AUTH_SECRET must be set (see .env.example)";
const secret = v.parse(
  v.pipe(v.string(secretMessage), v.minLength(32, secretMessage)),
  process.env["LOCAL_AUTH_SECRET"],
);

let gateway: ModelGateway;
if (env.AI_BACKEND === "bedrock") {
  // This server runs here. The model does not: every question is a billed call to Bedrock.
  gateway = createBedrockGateway(env.AWS_REGION);
  console.log(`inference: REMOTE and BILLED. Bedrock ${env.BEDROCK_MODEL_ID} in ${env.AWS_REGION}`);
} else {
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
  let playing = createScriptedModel(transcripts[name], pause);
  gateway = {
    converseStream(request, signal) {
      // A request with one message opens a conversation: the transcript starts over.
      if (request.messages.length === 1) {
        // The extraction route asks in a different form, and gets the transcript made for it.
        const structured =
          request.outputConfig !== undefined || request.toolConfig?.toolChoice !== undefined;
        playing = createScriptedModel(
          transcripts[structured ? "structured-tool-valid" : name],
          pause,
        );
      }
      return playing.converseStream(request, signal);
    },
  };
  console.log(`inference: none. Playing fixtures/transcripts/${name}.json. No AWS call, no charge`);
}

const app = composeApp(env, {
  gateway,
  // Chapter 06's local sign-in: a token signed with LOCAL_AUTH_SECRET says who is asking.
  authenticate: createLocalAuthenticator(secret),
  notes: await seededNotes(),
  ledger: new InMemoryUsageLedger(),
});

// Loopback only: with AI_BACKEND=bedrock, anyone who can reach this port spends your money.
nodeServer((request) => app(request)).listen(port, "127.0.0.1", async () => {
  console.log(`assistant API on http://localhost:${port}`);
  console.log(`token for local-alice:\n${await signLocalToken(secret, "local-alice")}`);
});
// #endregion dev
