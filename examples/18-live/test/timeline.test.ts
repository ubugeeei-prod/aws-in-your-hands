import { describe, expect, it } from "vite-plus/test";

import type { StreamStatus } from "../src/stream.ts";
import { believe, reconcile, type SeenEvent } from "../src/timeline.ts";

const a = "st-AAAAAAAAAAAAAAAAAAAAAAAA";
const b = "st-BBBBBBBBBBBBBBBBBBBBBBBB";

const event = (name: string, streamId: string): SeenEvent => ({
  eventId: `${streamId}/${name}`,
  name,
  streamId,
});
const liveOn = (streamId: string): StreamStatus => ({
  state: "live",
  streamId,
  health: "HEALTHY",
  startedAt: new Date("2026-10-11T10:00:00Z"),
  viewerCount: 0,
});

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

describe("what the events say", () => {
  const whole = ["Session Created", "Stream Start", "Stream End", "Session Ended"].map((name) =>
    event(name, a),
  );

  it("is the same in every one of the 24 delivery orders", () => {
    for (const order of permutations(whole)) {
      expect(believe(order).get(a), order.map((e) => e.name).join(" > ")).toBe("ended");
    }
  });

  it("is the same when every event is delivered twice", () => {
    expect(believe([...whole, ...whole]).get(a)).toBe("ended");
  });

  it("does not bring a stream back to life when its start arrives after its end", () => {
    expect(believe([event("Stream End", a), event("Stream Start", a)]).get(a)).toBe("ended");
  });

  it("keeps a session that never produced video apart from a live one", () => {
    expect(believe([event("Session Created", a)]).get(a)).toBe("starting");
  });

  it("tracks two streams on one channel separately", () => {
    const beliefs = believe([
      event("Stream Start", a),
      event("Stream End", a),
      event("Stream Start", b),
    ]);
    expect([beliefs.get(a), beliefs.get(b)]).toEqual(["ended", "live"]);
  });
});

describe("events against GetStream", () => {
  it("agrees when both say live on the same stream", () => {
    expect(reconcile(believe([event("Stream Start", a)]), liveOn(a))).toEqual({ agrees: true });
  });

  it("agrees when nothing was ever live", () => {
    expect(reconcile(believe([]), { state: "offline" })).toEqual({ agrees: true });
  });

  it("flags a lost end event: the events say live, the channel is offline", () => {
    expect(reconcile(believe([event("Stream Start", a)]), { state: "offline" })).toEqual({
      agrees: false,
      reason: "end event missing or late",
      streamId: a,
    });
  });

  it("flags a lost start event: the channel is live and no event said so", () => {
    expect(reconcile(believe([]), liveOn(a))).toMatchObject({
      agrees: false,
      reason: "start event missing or late",
    });
    expect(reconcile(believe([event("Session Created", a)]), liveOn(a))).toMatchObject({
      agrees: false,
    });
  });

  it("flags an older stream whose end never arrived", () => {
    const beliefs = believe([event("Stream Start", a), event("Stream Start", b)]);
    expect(reconcile(beliefs, liveOn(b))).toEqual({
      agrees: false,
      reason: "end event missing or late",
      streamId: a,
    });
  });
});
