import * as v from "valibot";

import { type Failure, type SummaryEvent, summaryEventSchema, type Usage } from "./contract.ts";

// #region sse
/** Yields the `data` of each server-sent event. An event counts only once its blank line arrived. */
export async function* sseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  // stream: true keeps a character that was split across two chunks intact.
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end === -1) {
        break;
      }
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""));
      if (data.length > 0) {
        yield data.join("\n");
      }
    }
  }
}
// #endregion sse

const interrupted: SummaryEvent = { type: "error", code: "interrupted", retryable: true };

// #region events
/**
 * The events of one summary, checked against the contract. Always ends with
 * `done` or `error`: when the server sent neither, the client supplies the error.
 */
export async function* summaryEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SummaryEvent, void, void> {
  try {
    for await (const data of sseData(body)) {
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        yield { type: "error", code: "bad_output", retryable: false };
        return;
      }
      const event = v.safeParse(summaryEventSchema, json);
      if (!event.success) {
        yield { type: "error", code: "bad_output", retryable: false };
        return;
      }
      yield event.output;
      if (event.output.type !== "delta") {
        return;
      }
    }
  } catch {
    // The connection failed while reading.
  }
  yield interrupted;
}
// #endregion events

// #region collect
export type SummaryResult =
  | { status: "complete"; text: string; usage: Usage | null }
  // `partial` may be shown as unfinished. It must not be stored as the summary.
  | {
      status: "incomplete";
      partial: string;
      reason: Failure["code"] | "stopped_early";
      retryable: boolean;
    };

export async function collectSummary(
  events: AsyncIterable<SummaryEvent>,
  onDelta: (text: string) => void = () => {},
): Promise<SummaryResult> {
  let text = "";
  for await (const event of events) {
    if (event.type === "delta") {
      text += event.text;
      onDelta(event.text);
    } else if (event.type === "done") {
      return event.complete
        ? { status: "complete", text, usage: event.usage }
        : { status: "incomplete", partial: text, reason: "stopped_early", retryable: false };
    } else {
      return {
        status: "incomplete",
        partial: text,
        reason: event.code,
        retryable: event.retryable,
      };
    }
  }
  return { status: "incomplete", partial: text, reason: "interrupted", retryable: true };
}
// #endregion collect
