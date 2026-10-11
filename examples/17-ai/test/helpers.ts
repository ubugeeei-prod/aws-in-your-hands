import type { SummaryEvent } from "../src/contract.ts";
import { createFixtureGateway, type Fixture } from "../src/fixture-gateway.ts";
import { createSummarizer, type ModelGateway, type SummarizeDeps } from "../src/summarize.ts";

export const NOTE = { title: "release", body: "Finish the payment tests before Friday." };

/** A summarizer with nothing left to chance: no real timer, no real randomness. */
export function setupSummarizer(gateway: ModelGateway, overrides: Partial<SummarizeDeps> = {}) {
  const sleeps: number[] = [];
  const timeout = new AbortController();
  const summarize = createSummarizer({
    gateway,
    modelId: "jp.amazon.nova-2-lite-v1:0",
    maxOutputTokens: 400,
    timeoutMs: 30_000,
    retry: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2_000 },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    // The top of the jitter range, so the waits are the documented ceilings.
    random: () => 0.999,
    timeoutSignal: () => timeout.signal,
    ...overrides,
  });
  return { summarize, sleeps, expire: () => timeout.abort() };
}

export function fromFixture(fixture: Fixture, overrides: Partial<SummarizeDeps> = {}) {
  const gateway = createFixtureGateway(fixture);
  return { gateway, ...setupSummarizer(gateway, overrides) };
}

export async function drain(events: AsyncIterable<SummaryEvent>): Promise<SummaryEvent[]> {
  const all: SummaryEvent[] = [];
  for await (const event of events) {
    all.push(event);
  }
  return all;
}

export const textOf = (events: SummaryEvent[]): string =>
  events.map((event) => (event.type === "delta" ? event.text : "")).join("");

/** Rejects when the signal aborts, as a request to the model does. */
export function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
