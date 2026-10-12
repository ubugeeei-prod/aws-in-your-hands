import { FirehoseClient } from "@aws-sdk/client-firehose";
import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { toLine } from "../src/record.ts";
import { sampleRecords } from "../src/sample.ts";
import { firehoseSink } from "../src/sink.ts";

const bodySchema = v.object({
  DeliveryStreamName: v.string(),
  Record: v.object({ Data: v.string() }),
});

type Outcome = "accept" | "accept-then-lose-the-answer" | "hang";

/**
 * The real SDK client, with the network replaced: every request it would send
 * is kept, and answered as the test says. Nothing here reaches AWS.
 */
function fakeFirehose(outcomes: Outcome[]) {
  const received: { stream: string; line: string }[] = [];
  const client = new FirehoseClient({
    region: "ap-northeast-1",
    credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "not-a-real-secret" },
    requestHandler: {
      handle: async (request: { body?: unknown }, options?: { abortSignal?: AbortSignal }) => {
        const outcome = outcomes.shift() ?? "accept";
        if (outcome === "hang") {
          return new Promise<never>((_resolve, reject) => {
            options?.abortSignal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("Request aborted"), { name: "AbortError" })),
            );
          });
        }
        const body = v.parse(bodySchema, JSON.parse(String(request.body)));
        received.push({
          stream: body.DeliveryStreamName,
          line: Buffer.from(body.Record.Data, "base64").toString("utf8"),
        });
        if (outcome === "accept-then-lose-the-answer") {
          // Firehose has the record. The producer only sees a broken connection.
          throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
        }
        return {
          response: {
            statusCode: 200,
            headers: { "content-type": "application/x-amz-json-1.1" },
            body: new TextEncoder().encode(JSON.stringify({ RecordId: "record-1" })),
          },
        };
      },
    },
  });
  return { client, received };
}

const [record] = sampleRecords(1, "2026-10-12");
const line = toLine(record ?? (undefined as never));

describe("the Firehose sink", () => {
  it("sends the line as it is, newline included, to the named stream", async () => {
    const { client, received } = fakeFirehose(["accept"]);
    await firehoseSink(client, "requests-stream")(line);
    expect(received).toEqual([{ stream: "requests-stream", line }]);
  });

  it("writes the record twice when the first answer is lost: the SDK retries", async () => {
    const { client, received } = fakeFirehose(["accept-then-lose-the-answer", "accept"]);
    await firehoseSink(client, "requests-stream")(line);

    expect(received).toHaveLength(2);
    expect(received[1]).toEqual(received[0]);
    // Both copies carry the same event_id, which is what lets a query count them once.
    expect(JSON.parse(received[0]?.line ?? "")).toMatchObject({ event_id: record?.event_id });
  });

  it("gives up after half a second instead of holding the request", async () => {
    const { client, received } = fakeFirehose(["hang", "hang", "hang"]);
    const started = Date.now();
    await expect(firehoseSink(client, "requests-stream")(line)).rejects.toThrow();

    expect(Date.now() - started).toBeLessThan(2000);
    expect(received).toEqual([]);
  });
});
