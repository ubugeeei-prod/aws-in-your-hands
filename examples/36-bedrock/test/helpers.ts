import type { AssistantEvent } from "../src/contract.ts";
import { seededNotes } from "../src/local-notes.ts";
import { type AssistantDeps, createAssistant, type Limits } from "../src/loop.ts";
import { modelProfiles } from "../src/models.ts";
import type { RequestOptions } from "../src/prompt.ts";
import { createScriptedModel } from "../src/scripted-model.ts";
import { createNoteTools } from "../src/tools.ts";
import { type TranscriptName, transcripts } from "../src/transcripts.ts";

export const ALICE = "local-alice";
export const BOB = "local-bob";
/** In Bob's note, and nowhere in Alice's. */
export const BOBS_SECRET = "720";

export const NOVA = "jp.amazon.nova-2-lite-v1:0";
export const HAIKU = "jp.anthropic.claude-haiku-4-5-20251001-v1:0";

export const LIMITS: Limits = {
  maxTurns: 4,
  maxToolCallsPerTurn: 4,
  maxToolErrors: 2,
  maxTotalTokens: 20_000,
};

export const requestOptions = (overrides: Partial<RequestOptions> = {}): RequestOptions => ({
  modelId: NOVA,
  profile: modelProfiles[NOVA],
  maxOutputTokens: 600,
  promptCache: false,
  ...overrides,
});

/** An assistant with nothing left to chance: no real timer, no real randomness, a scripted model. */
export function setup(name: TranscriptName, overrides: Partial<AssistantDeps> = {}) {
  const model = createScriptedModel(transcripts[name]);
  const sleeps: number[] = [];
  const timeout = new AbortController();
  const assistant = createAssistant({
    gateway: model,
    request: requestOptions(),
    limits: LIMITS,
    retry: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2_000 },
    timeoutMs: 60_000,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    // The top of the jitter range, so the waits are the documented ceilings.
    random: () => 0.999,
    timeoutSignal: () => timeout.signal,
    ...overrides,
  });
  return { assistant, model, sleeps, expire: () => timeout.abort() };
}

export const toolsFor = async (owner: string) => createNoteTools(await seededNotes(), owner);

export async function drain(events: AsyncIterable<AssistantEvent>): Promise<AssistantEvent[]> {
  const all: AssistantEvent[] = [];
  for await (const event of events) {
    all.push(event);
  }
  return all;
}

export const textOf = (events: AssistantEvent[]): string =>
  events.map((event) => (event.type === "delta" ? event.text : "")).join("");

export const never = new AbortController().signal;
