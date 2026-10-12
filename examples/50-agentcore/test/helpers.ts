import type { LogEntry } from "@aih/example-04-http-api/src/log.ts";
import type { Authenticate } from "@aih/example-06-auth/api/src/identity.ts";
import { assistantEvents } from "@aih/example-36-bedrock/src/client.ts";
import type { AssistantEvent } from "@aih/example-36-bedrock/src/contract.ts";
import { seededNotes } from "@aih/example-36-bedrock/src/local-notes.ts";
import { modelProfiles } from "@aih/example-36-bedrock/src/models.ts";
import { type TranscriptName, transcripts } from "@aih/example-36-bedrock/src/transcripts.ts";

import { createAgent } from "../src/agent.ts";
import { SESSION_HEADER } from "../src/contract.ts";
import { replayingModel } from "../src/local-model.ts";
import { InMemoryMemoryStore, type MemoryStore } from "../src/memory-store.ts";
import { newSessionId } from "../src/session-id.ts";

export const ALICE = "local-alice";
export const BOB = "local-bob";
/** In Bob's note, and nowhere in Alice's. */
export const BOBS_SECRET = "720";

/** A session made for Alice, and one made for Bob. */
export const SESSION_A = newSessionId(ALICE, "11111111-1111-4111-8111-111111111111");
export const SESSION_B = newSessionId(BOB, "22222222-2222-4222-8222-222222222222");

const NOVA = "jp.amazon.nova-2-lite-v1:0";

/** Stands in for "a token that was verified": the token is the name. Tests of identity.ts cover the real reading. */
export const byName: Authenticate = ({ authorization }) => {
  const name = /^Bearer (local-[a-z]+)$/.exec(authorization ?? "")?.[1];
  return Promise.resolve(name === undefined ? undefined : { sub: name });
};

/**
 * One process of the agent. `store` outlives it: passing the same store to a second call is
 * what a session's microVM being replaced looks like from the agent's side.
 */
export async function startAgent(
  names: readonly [TranscriptName, ...TranscriptName[]],
  store: MemoryStore = new InMemoryMemoryStore(),
) {
  const [first, ...rest] = names;
  const model = replayingModel([transcripts[first], ...rest.map((name) => transcripts[name])]);
  const logs: LogEntry[] = [];
  let requests = 0;
  const agent = createAgent({
    authenticate: byName,
    notes: await seededNotes(),
    store,
    log: (entry) => logs.push(entry),
    newRequestId: () => `req-${(requests += 1)}`,
    assistant: {
      gateway: model,
      request: {
        modelId: NOVA,
        profile: modelProfiles[NOVA],
        maxOutputTokens: 600,
        promptCache: false,
      },
      limits: { maxTurns: 4, maxToolCallsPerTurn: 4, maxToolErrors: 2, maxTotalTokens: 20_000 },
      retry: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2_000 },
      timeoutMs: 60_000,
      sleep: () => Promise.resolve(),
      random: () => 0.999,
      timeoutSignal: () => new AbortController().signal,
    },
  });
  return { agent, model, store, logs };
}

export function invocation(
  who: string | undefined,
  sessionId: string | undefined,
  body: unknown = { prompt: "金曜までに何が残っている？" },
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (who !== undefined) {
    headers.set("authorization", `Bearer ${who}`);
  }
  if (sessionId !== undefined) {
    headers.set(SESSION_HEADER, sessionId);
  }
  return new Request("http://agent.test/invocations", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** Every event of a streamed answer, read to its end. */
export async function eventsOf(response: Response): Promise<AssistantEvent[]> {
  if (response.body === null) {
    throw new Error("the response has no body");
  }
  const all: AssistantEvent[] = [];
  for await (const event of assistantEvents(response.body)) {
    all.push(event);
  }
  return all;
}

export const textOf = (events: AssistantEvent[]): string =>
  events.map((event) => (event.type === "delta" ? event.text : "")).join("");
