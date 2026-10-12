import { gunzipSync } from "node:zlib";

import { createApp } from "@aih/example-05-dynamodb/src/app.ts";
import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";
import { InMemoryNoteRepository } from "@aih/example-05-dynamodb/src/memory-repository.ts";
import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";

import { createMeasuredApp } from "../src/app.ts";
import { LocalDelivery } from "../src/lake.ts";
import { parseLines, type RequestRecord } from "../src/record.ts";
import type { Sink } from "../src/sink.ts";

export const eventIdOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** The chapter 05 app in memory, measured, with a clock the test moves. */
export function harness(options: { startAt?: string; sink?: (inner: Sink) => Sink } = {}) {
  const delivery = new LocalDelivery();
  const logged: string[] = [];
  let clock = Date.parse(options.startAt ?? "2026-10-12T09:00:00.000Z");
  let requests = 0;
  let events = 0;
  let suffix = 0;
  const log = createLogger("debug", (line) => logged.push(line));
  // Arrival is stamped by the receiving side, as Firehose stamps it.
  const accept: Sink = (line) => {
    delivery.put(line, new Date(clock));
    return Promise.resolve();
  };

  const app = createMeasuredApp({
    app: createApp({
      env: {
        ALLOWED_ORIGIN: "http://localhost:5173",
        LOG_LEVEL: "debug",
        STAGE: "test",
        NOTES_STORE: "memory",
      },
      notes: createNoteService({
        repository: new InMemoryNoteRepository(),
        now: () => new Date(clock),
        randomSuffix: () => String(++suffix).padStart(10, "0"),
      }),
      log,
      newRequestId: () => `request-${String(++requests)}`,
      now: () => clock,
    }),
    sink: options.sink?.(accept) ?? accept,
    log,
    newEventId: () => eventIdOf(++events),
    // Every reading of the clock moves it, so durations are known in advance.
    now: () => (clock += 7),
  });

  const send = (method: string, path: string, body?: unknown) =>
    app(
      new Request(`http://api.test${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      }),
    );

  return {
    send,
    delivery,
    logged,
    /** Moves the clock to a moment, as the next request's start. */
    at: (moment: string) => {
      clock = Date.parse(moment);
    },
    /** Everything delivered so far, after flushing what is still buffered. */
    records: (): RequestRecord[] => {
      delivery.flush();
      return delivery.objects.flatMap((object) =>
        parseLines(gunzipSync(object.bytes).toString("utf8")),
      );
    },
  };
}
