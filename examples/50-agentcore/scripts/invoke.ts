// AIH_ACCESS_TOKEN=... vp run agentcore:invoke
//   node scripts/invoke.ts
//
// Calls the deployed runtime: once without a token, which must be refused, then twice in one
// session with the token. It writes chapter 36's three fixture notes under the token's user.
// BILLED: two questions, a handful of model calls, and one session of the runtime.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";
import { assistantEvents, collectAnswer } from "@aih/example-36-bedrock/src/client.ts";
import { seededNotes } from "@aih/example-36-bedrock/src/local-notes.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { identityFromForwardedJwt } from "../src/identity.ts";
import { invocationRequest } from "../src/invoke-request.ts";
import { newSessionId } from "../src/session-id.ts";

const STACK = "AihAgentCore";
const QUESTIONS = [
  "金曜のリリースまでに残っている作業と担当を教えて",
  "いまの答えを一文にまとめて",
];

try {
  const accessToken = v.parse(
    v.pipe(
      v.string("AIH_ACCESS_TOKEN must hold an access token of the stack's user pool"),
      v.minLength(1),
    ),
    process.env["AIH_ACCESS_TOKEN"],
  );
  const { target } = await preflight({
    access: "mutate",
    action: "write three notes and ask the deployed agent two questions (billed)",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const runtime = {
    region: target.region,
    runtimeArn: requireOutput(outputs, "RuntimeArn"),
    qualifier: "DEFAULT",
  };
  // The same reading the agent does. Here it only says under whom to store the notes.
  const identity = identityFromForwardedJwt(
    `Bearer ${accessToken}`,
    {
      issuer: `https://cognito-idp.${target.region}.amazonaws.com/${requireOutput(outputs, "UserPoolId")}`,
      clientId: requireOutput(outputs, "UserPoolClientId"),
    },
    Math.floor(Date.now() / 1000),
  );
  if (identity === undefined) {
    throw new Error(
      "AIH_ACCESS_TOKEN is not a current access token of this stack's user pool and client",
    );
  }

  // A new session, made for this user: the agent refuses a session ID made for anyone else.
  const sessionId = newSessionId(identity.sub);
  const call = (prompt: string, token: string) => {
    const { url, init } = invocationRequest(runtime, { accessToken: token, sessionId, prompt });
    return fetch(url, init);
  };

  const stranger = await call("hello", "not-a-token");
  await stranger.body?.cancel();
  if (stranger.status !== 401 && stranger.status !== 403) {
    throw new Error(
      `a request with no valid token answered ${stranger.status}. Is the runtime open?`,
    );
  }
  console.log(`ok   a request without a valid token is refused (${stranger.status})`);

  const table = new DynamoDbNoteRepository(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region })),
    requireOutput(outputs, "NotesTableName"),
  );
  const { notes } = await (await seededNotes()).list("local-alice", { limit: 20 });
  for (const note of notes) {
    // "already_exists" on a second run is fine.
    await table.create(identity.sub, note);
  }
  console.log(`ok   ${notes.length} notes are stored under ${identity.sub}`);

  for (const question of QUESTIONS) {
    console.log(`\n> ${question}`);
    const response = await call(question, accessToken);
    if (!response.ok || response.body === null) {
      throw new Error(`the invocation answered ${response.status}: ${await response.text()}`);
    }
    const answer = await collectAnswer(assistantEvents(response.body), (event) => {
      if (event.type === "delta") {
        process.stdout.write(event.text);
      } else if (event.type === "tool") {
        process.stdout.write(`\n[tool ${event.name} ${event.ok ? "ok" : "refused"}]\n`);
      }
    });
    process.stdout.write("\n");
    if (answer.status !== "complete") {
      throw new Error(`the answer did not complete: ${JSON.stringify(answer)}`);
    }
  }
  console.log(`\nok   session ${sessionId}: two questions answered`);
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
