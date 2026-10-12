import { SOURCE } from "./contract.ts";
import { createCounter, createNaiveCounter, InMemoryCounterStore } from "./counter.ts";
import { LocalBus } from "./local-bus.ts";
import { ARCHIVE_PATTERN, RULES } from "./routes.ts";
import { enrich } from "./shape.ts";
import { createTimelineConsumer, InMemoryTimelineStore } from "./timeline.ts";

// #region local
/**
 * The deployed wiring, in memory: the stack's three rules, each feeding a
 * consumer. A fourth rule feeds the naive counter, which is never deployed,
 * so the two can be compared on the same events.
 */
export function createLocal(start = Date.UTC(2026, 9, 12)) {
  let clock = start;
  let ids = 0;
  const bus = new LocalBus({
    now: () => new Date(clock),
    nextId: () => `bus-event-${(ids += 1)}`,
  });
  const timeline = new InMemoryTimelineStore();
  const counted = new InMemoryCounterStore();
  const naive = new InMemoryCounterStore();
  const notices: unknown[] = [];

  const toTimeline = createTimelineConsumer(timeline);
  const toCounter = createCounter(counted);
  const toNaive = createNaiveCounter(naive);

  bus.enableArchive(ARCHIVE_PATTERN);
  bus.addRule("timeline", RULES.timeline, async (event) => void (await toTimeline(event.detail)));
  bus.addRule("counter", RULES.counter, async (event) => void (await toCounter(event.detail)));
  bus.addRule("naive-counter", RULES.counter, (event) => toNaive(event.detail));
  bus.addRule("rejections", RULES.rejections, (event) => void notices.push(event.detail));

  return {
    bus,
    timeline,
    counted,
    naive,
    notices,
    /** Moves the clock, in minutes. Events are stamped with it. */
    advance: (minutes: number) => void (clock += minutes * 60_000),
    /** What the pipe does with a stream record: shape it, publish what comes out. */
    publish: (record: unknown) =>
      enrich([record]).map((detail) =>
        bus.put({ source: SOURCE, detailType: detail.type, detail }),
      ),
  };
}
// #endregion local
