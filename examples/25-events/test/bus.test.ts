import { describe, expect, it } from "vite-plus/test";

import { SOURCE } from "../src/contract.ts";
import { UnsupportedPatternError } from "../src/pattern.ts";
import { RULES } from "../src/routes.ts";
import { createTimelineConsumer, InMemoryTimelineStore } from "../src/timeline.ts";
import { inspectionWritten, noteInserted, noteModified, noteRemoved, OWNER } from "./fixtures.ts";
import { setup } from "./harness.ts";

describe("one fact, several consumers", () => {
  it("reaches every consumer whose rule matches, and the producer names none of them", async () => {
    const { bus, publish, timeline, counted, notices } = setup();
    publish(noteInserted("n1"));
    publish(inspectionWritten("rejected"));
    expect(bus.take().map((delivery) => delivery.rule)).toEqual([
      "timeline",
      "counter",
      "naive-counter",
      "rejections",
    ]);

    publish(noteInserted("n2"));
    publish(inspectionWritten("rejected"));
    await bus.drain();
    expect(await timeline.get(OWNER, "n2")).toMatchObject({ lastEvent: "NoteCreated" });
    expect(await counted.get(OWNER)).toBe(1);
    expect(notices).toHaveLength(1);
  });

  it("an event no rule matches is accepted and goes nowhere", async () => {
    const { bus } = setup();
    bus.put({ source: "someone.else", detailType: "NoteCreated", detail: { version: 1 } });
    bus.put({ source: SOURCE, detailType: "AttachmentInspected", detail: { version: 1 } });
    expect(bus.take()).toEqual([]);
  });

  it("a rule cannot be added with a pattern the matcher does not implement", () => {
    const { bus } = setup();
    expect(() => bus.addRule("x", { source: [{ wildcard: "aih.*" }] }, () => {})).toThrow(
      UnsupportedPatternError,
    );
  });
});

describe("at least once", () => {
  it("the same delivery twice: the timeline and the counter do not move, the naive counter does", async () => {
    const { bus, publish, timeline, counted, naive } = setup();
    publish(noteInserted("n1"));
    const deliveries = bus.take();
    for (const delivery of [...deliveries, ...deliveries]) {
      await bus.deliver(delivery);
    }
    expect(await timeline.get(OWNER, "n1")).toMatchObject({ rank: 1, lastEvent: "NoteCreated" });
    expect(await counted.get(OWNER)).toBe(1);
    expect(await naive.get(OWNER)).toBe(2);
  });

  it("the same change published twice, as two bus events: still counted once", async () => {
    const { bus, publish, counted, naive } = setup();
    // The pipe read the same stream record twice. The bus gives each a new ID of its own.
    const [first] = publish(noteInserted("n1"));
    const [second] = publish(noteInserted("n1"));
    expect(first?.id).not.toBe(second?.id);
    await bus.drain();
    expect(await counted.get(OWNER)).toBe(1);
    expect(await naive.get(OWNER)).toBe(2);
  });
});

describe("no promised order", () => {
  it("an update that overtakes the creation: the timeline ends on the newer one", async () => {
    const { bus, publish, timeline } = setup();
    publish(noteInserted("n1"));
    publish(noteModified("n1", 1, 2));
    publish(noteModified("n1", 2, 3));
    const waiting = bus.take().filter((delivery) => delivery.rule === "timeline");
    for (const delivery of waiting.toReversed()) {
      await bus.deliver(delivery);
    }
    expect(await timeline.get(OWNER, "n1")).toMatchObject({ rank: 3, lastEvent: "NoteUpdated" });
  });

  it("a deletion that arrives first is not undone by the creation that follows", async () => {
    const { bus, publish, timeline, counted, naive } = setup();
    publish(noteInserted("n1"));
    publish(noteRemoved("n1"));
    for (const delivery of bus.take().toReversed()) {
      await bus.deliver(delivery);
    }
    expect(await timeline.get(OWNER, "n1")).toMatchObject({ lastEvent: "NoteDeleted" });
    // Adding and subtracting commute, so even the naive count needs no order.
    expect(await counted.get(OWNER)).toBe(0);
    expect(await naive.get(OWNER)).toBe(0);
  });
});

describe("a target that fails", () => {
  it("gets the event again, and succeeds on a later attempt", async () => {
    const { bus } = setup();
    let failures = 2;
    const received: string[] = [];
    bus.addRule("flaky", { source: ["test"] }, (event) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("not now");
      }
      received.push(event.id);
    });
    const event = bus.put({ source: "test", detailType: "T", detail: {} });
    const [delivery] = bus.take();
    expect(delivery).toBeDefined();
    expect(await bus.deliver(delivery!)).toBe("retrying");
    await bus.drain();
    expect(received).toEqual([event.id]);
    expect(bus.deadLetters).toEqual([]);
  });

  it("is given up on after its attempts, and the event is set aside with the reason", async () => {
    const { bus, publish, timeline } = setup();
    const always = () => {
      throw new Error("always");
    };
    bus.addRule("broken", { source: [SOURCE] }, always, { maxAttempts: 3 });
    publish(noteInserted("n1"));
    await bus.drain();
    expect(bus.deadLetters).toMatchObject([{ rule: "broken", attempts: 3, error: "always" }]);
    // One consumer failing does not hold the others back.
    expect(await timeline.get(OWNER, "n1")).toBeDefined();
  });

  it("an event the consumer cannot read fails every attempt and ends up set aside", async () => {
    const { bus } = setup();
    bus.put({ source: SOURCE, detailType: "NoteCreated", detail: { version: 1, id: "x" } });
    await bus.drain();
    expect(bus.deadLetters.map((letter) => [letter.rule, letter.attempts])).toEqual([
      ["timeline", 3],
      ["counter", 3],
      ["naive-counter", 3],
    ]);
  });
});

describe("archive and replay", () => {
  async function aDayOfChanges() {
    const context = setup();
    context.publish(noteInserted("n1"));
    context.advance(10);
    context.publish(noteInserted("n2"));
    context.advance(10);
    context.publish(noteModified("n1", 1, 2));
    context.advance(10);
    context.publish(noteRemoved("n2"));
    await context.bus.drain();
    return context;
  }
  const window = { from: new Date(Date.UTC(2026, 9, 12)), to: new Date(Date.UTC(2026, 9, 13)) };

  it("a replay changes nothing for the idempotent consumers, and doubles the naive count", async () => {
    const { bus, timeline, counted, naive } = await aDayOfChanges();
    expect([await counted.get(OWNER), await naive.get(OWNER)]).toEqual([1, 1]);
    const before = [await timeline.get(OWNER, "n1"), await timeline.get(OWNER, "n2")];

    expect(bus.replay({ name: "fix-1", ...window })).toBe(4);
    await bus.drain();

    expect([await timeline.get(OWNER, "n1"), await timeline.get(OWNER, "n2")]).toEqual(before);
    expect(await counted.get(OWNER)).toBe(1);
    // +1 +1 -1 a second time, on top of the 1 that was right.
    expect(await naive.get(OWNER)).toBe(2);
  });

  it("a replay does not send a rejection notice a second time", async () => {
    const { bus, publish, notices } = setup();
    publish(inspectionWritten("rejected"));
    await bus.drain();
    expect(bus.replay({ name: "fix-6", ...window })).toBe(1);
    expect(bus.take()).toEqual([]);
    expect(notices).toHaveLength(1);
  });

  it("a replay delivered in another order ends in the same place", async () => {
    const { bus, timeline, counted } = await aDayOfChanges();
    bus.replay({ name: "fix-2", ...window });
    for (const delivery of bus.take().toReversed()) {
      await bus.deliver(delivery);
    }
    expect(await timeline.get(OWNER, "n1")).toMatchObject({ rank: 2, lastEvent: "NoteUpdated" });
    expect(await timeline.get(OWNER, "n2")).toMatchObject({ lastEvent: "NoteDeleted" });
    expect(await counted.get(OWNER)).toBe(1);
  });

  it("a replayed event is marked as one, and is not archived a second time", async () => {
    const { bus } = await aDayOfChanges();
    bus.replay({ name: "fix-3", ...window });
    const replayed = bus.take();
    expect(replayed.every((delivery) => delivery.event["replay-name"] === "fix-3")).toBe(true);
    await bus.drain();
    // Still four in the archive: a second replay brings back four, not eight.
    expect(bus.replay({ name: "fix-4", ...window })).toBe(4);
  });

  it("can be limited to one rule and to a window of time", async () => {
    const { bus } = await aDayOfChanges();
    const from = new Date(Date.UTC(2026, 9, 12, 0, 5));
    const to = new Date(Date.UTC(2026, 9, 12, 0, 25));
    expect(bus.replay({ name: "fix-5", from, to, rules: ["timeline"] })).toBe(2);
    expect(bus.take().map((delivery) => [delivery.rule, delivery.event["detail-type"]])).toEqual([
      ["timeline", "NoteCreated"],
      ["timeline", "NoteUpdated"],
    ]);
  });

  it("fills a consumer that was added afterwards, without touching the others", async () => {
    const { bus, timeline, naive } = await aDayOfChanges();
    const late = new InMemoryTimelineStore();
    const toLate = createTimelineConsumer(late);
    bus.addRule("late", RULES.timeline, async (event) => void (await toLate(event.detail)));
    bus.replay({ name: "backfill", ...window, rules: ["late"] });
    await bus.drain();
    expect(await late.get(OWNER, "n1")).toEqual(await timeline.get(OWNER, "n1"));
    expect(await late.get(OWNER, "n2")).toEqual(await timeline.get(OWNER, "n2"));
    // Not replayed to the naive counter, so it is still right.
    expect(await naive.get(OWNER)).toBe(1);
  });
});
