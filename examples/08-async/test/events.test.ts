import { describe, expect, it } from "vite-plus/test";

import { parseNotification } from "../src/events.ts";
import { isLater, normalizeSequencer } from "../src/sequencer.ts";

// The example message from the S3 user guide, with its fields in place.
const created = {
  Records: [
    {
      eventVersion: "2.6",
      eventSource: "aws:s3",
      eventName: "ObjectCreated:Put",
      s3: {
        bucket: { name: "amzn-s3-demo-bucket" },
        object: {
          key: "u/alice/n1/red+flower%2B1",
          size: 1024,
          eTag: "d41d8cd98f00b204e9800998ecf8427e",
          sequencer: "0055AED6DCD90281E5",
        },
      },
    },
  ],
};

describe("parseNotification", () => {
  it("reads a create event, decoding the key and normalizing the sequencer", () => {
    expect(parseNotification(JSON.stringify(created))).toEqual({
      kind: "events",
      events: [
        {
          type: "created",
          key: "u/alice/n1/red flower+1",
          eTag: "d41d8cd98f00b204e9800998ecf8427e",
          sequencer: "000000000000000055AED6DCD90281E5",
        },
      ],
    });
  });

  it("tells the test event apart from a notification", () => {
    const test = {
      Service: "Amazon S3",
      Event: "s3:TestEvent",
      Time: "2014-10-13T15:57:02.089Z",
      Bucket: "b",
    };
    expect(parseNotification(JSON.stringify(test))).toEqual({ kind: "test" });
  });

  it("reads deletes, with or without a sequencer", () => {
    const removed = (eventName: string, sequencer?: string) =>
      parseNotification(
        JSON.stringify({ Records: [{ eventName, s3: { object: { key: "u/a/n/x", sequencer } } }] }),
      );
    expect(removed("ObjectRemoved:Delete", "1F")).toMatchObject({
      events: [{ type: "removed", sequencer: normalizeSequencer("1F") }],
    });
    expect(removed("LifecycleExpiration:Delete")).toMatchObject({
      events: [{ type: "removed", sequencer: undefined }],
    });
  });

  it("refuses what S3 would not send, so that it reaches the dead-letter queue", () => {
    expect(() => parseNotification("not json")).toThrow();
    expect(() => parseNotification(JSON.stringify({ Records: [] }))).toThrow();
    expect(() => parseNotification(JSON.stringify({ hello: "world" }))).toThrow();
    // v.object takes an array where it expects an object. The required fields are what stop these.
    expect(() => parseNotification("[]")).toThrow();
    expect(() => parseNotification(JSON.stringify({ Records: [[]] }))).toThrow();
    expect(() =>
      parseNotification(JSON.stringify({ Records: [{ eventName: "ObjectCreated:Put", s3: [] }] })),
    ).toThrow();
    expect(() =>
      parseNotification(
        JSON.stringify({ Records: [{ eventName: "ObjectRemoved:Delete", s3: { object: [] } }] }),
      ),
    ).toThrow();
    // null is not "left out".
    expect(() =>
      parseNotification(
        JSON.stringify({
          Records: [
            { eventName: "ObjectRemoved:Delete", s3: { object: { key: "k", sequencer: null } } },
          ],
        }),
      ),
    ).toThrow();
    // A create that cannot be ordered is not guessed at.
    const unordered = {
      Records: [{ eventName: "ObjectCreated:Post", s3: { object: { key: "u/a/n/x", eTag: "e" } } }],
    };
    expect(() => parseNotification(JSON.stringify(unordered))).toThrow("no sequencer");
  });
});

describe("sequencers", () => {
  it("compares values of different lengths by padding on the left", () => {
    // As plain strings "9" sorts after "10"; as hexadecimal numbers it is smaller.
    expect(isLater("10", "9")).toBe(true);
    expect(isLater("0055AED6DCD90281E5", "55AED6DCD90281E4")).toBe(true);
    expect(isLater("00ab", "AB")).toBe(false);
  });

  it("refuses a value it could not order", () => {
    expect(() => normalizeSequencer("xyz")).toThrow();
    expect(() => normalizeSequencer("A".repeat(33))).toThrow();
  });
});
