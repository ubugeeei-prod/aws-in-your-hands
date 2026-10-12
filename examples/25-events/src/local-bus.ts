import type { BusEvent } from "./contract.ts";
import { compile, type Matcher } from "./pattern.ts";

// A model of an event bus for tests and the demo: rules, one target per
// rule, retries, a dead-letter list, an archive, and replay. It delivers
// nothing by itself. The caller decides which delivery happens next, and
// may make the same one happen twice.

// #region types
export type Entry = { source: string; detailType: string; detail: unknown };
export type Target = (event: BusEvent) => void | Promise<void>;
export type Delivery = { rule: string; event: BusEvent; attempt: number };
export type DeadLetter = { rule: string; event: BusEvent; attempts: number; error: string };

type Rule = { name: string; match: Matcher; target: Target; maxAttempts: number };
// #endregion types

export class LocalBus {
  readonly #now: () => Date;
  readonly #nextId: () => string;
  readonly #rules: Rule[] = [];
  #archive: { match: Matcher; events: BusEvent[] } | undefined;
  #pending: Delivery[] = [];
  readonly deadLetters: DeadLetter[] = [];

  constructor(deps: { now: () => Date; nextId: () => string }) {
    this.#now = deps.now;
    this.#nextId = deps.nextId;
  }

  // #region rules
  /** Throws UnsupportedPatternError if the pattern uses what src/pattern.ts does not implement. */
  addRule(name: string, pattern: unknown, target: Target, options = { maxAttempts: 3 }): void {
    this.#rules.push({ name, match: compile(pattern), target, maxAttempts: options.maxAttempts });
  }

  enableArchive(pattern: unknown): void {
    this.#archive = { match: compile(pattern), events: [] };
  }
  // #endregion rules

  // #region put
  /** Accepts one event and lines up a delivery for every rule it matches. */
  put(entry: Entry): BusEvent {
    const event: BusEvent = {
      id: this.#nextId(),
      source: entry.source,
      "detail-type": entry.detailType,
      time: this.#now().toISOString(),
      detail: entry.detail,
    };
    if (this.#archive?.match(event) === true) {
      this.#archive.events.push(event);
    }
    this.#route(event, this.#rules);
    return event;
  }

  #route(event: BusEvent, rules: Rule[]): void {
    for (const rule of rules) {
      if (rule.match(event)) {
        this.#pending.push({ rule: rule.name, event, attempt: 1 });
      }
    }
  }
  // #endregion put

  // #region deliver
  /** Hands over everything waiting. The caller delivers it in whatever order it likes. */
  take(): Delivery[] {
    const taken = this.#pending;
    this.#pending = [];
    return taken;
  }

  /**
   * One attempt. A target that throws gets the event again, as a new waiting
   * delivery, until its attempts are used up. Then the event is set aside.
   * Calling this twice with the same delivery is a duplicate.
   */
  async deliver(delivery: Delivery): Promise<"delivered" | "retrying" | "dead-lettered"> {
    const rule = this.#rules.find((candidate) => candidate.name === delivery.rule);
    if (rule === undefined) {
      throw new Error(`no rule named ${delivery.rule}`);
    }
    try {
      await rule.target(delivery.event);
      return "delivered";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (delivery.attempt < rule.maxAttempts) {
        this.#pending.push({ ...delivery, attempt: delivery.attempt + 1 });
        return "retrying";
      }
      this.deadLetters.push({
        rule: rule.name,
        event: delivery.event,
        attempts: delivery.attempt,
        error: message,
      });
      return "dead-lettered";
    }
  }

  /** Delivers in arrival order until nothing is waiting, retries included. */
  async drain(): Promise<void> {
    while (this.#pending.length > 0) {
      for (const delivery of this.take()) {
        await this.deliver(delivery);
      }
    }
  }
  // #endregion deliver

  // #region replay
  /**
   * Lines up the archived events of a time window again, for all rules or
   * the named ones. A replayed event carries `replay-name` and is not
   * archived a second time. Returns how many events were replayed.
   */
  replay(options: { name: string; from: Date; to: Date; rules?: string[] }): number {
    const rules =
      options.rules === undefined
        ? this.#rules
        : this.#rules.filter((rule) => options.rules?.includes(rule.name));
    const chosen = (this.#archive?.events ?? []).filter((event) => {
      const time = Date.parse(event.time);
      return time >= options.from.getTime() && time <= options.to.getTime();
    });
    for (const event of chosen) {
      this.#route({ ...event, "replay-name": options.name }, rules);
    }
    return chosen.length;
  }
  // #endregion replay
}
