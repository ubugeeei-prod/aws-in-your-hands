import type { AlarmReading, AlarmState } from "../src/shift/decide.ts";
import type { AliasTarget } from "../src/shift/plan.ts";
import {
  type AlarmPort,
  type AliasPort,
  type AliasView,
  type Clock,
  RevisionConflictError,
} from "../src/shift/run.ts";

/** A clock that only moves when someone sleeps. */
export class FakeClock implements Clock {
  #now = 0;
  /** Called after each sleep with the new time in seconds: the place where a test makes things happen. */
  onTick: (seconds: number) => void = () => {};
  now = () => this.#now;
  sleep = async (milliseconds: number) => {
    this.#now += milliseconds;
    this.onTick(this.#now / 1000);
  };
}

/** An alias as Lambda keeps one: a version, weights, and a revision that changes on every write. */
export class FakeAlias implements AliasPort {
  #target: AliasTarget;
  #revision = 1;
  /** Every state the alias has been in, oldest first. */
  readonly history: AliasTarget[];
  /** Runs before a write is applied, or after ("lost"): throw from it to fail that write. */
  failNextWrite: "before" | "after" | undefined;
  failReads = 0;

  constructor(version: string, weights: Record<string, number> = {}) {
    this.#target = { version, weights };
    this.history = [this.#target];
  }

  get current(): AliasTarget {
    return this.#target;
  }

  /** Someone else, with their own console or script. */
  changedByAnother(target: AliasTarget): void {
    this.#set(target);
  }

  #set(target: AliasTarget): void {
    this.#target = { version: target.version, weights: { ...target.weights } };
    this.#revision += 1;
    this.history.push(this.#target);
  }

  #view = (): AliasView => ({ ...this.#target, revisionId: `r${this.#revision}` });

  read = async (): Promise<AliasView> => {
    if (this.failReads > 0) {
      this.failReads -= 1;
      throw new Error("ServiceException");
    }
    return this.#view();
  };

  write = async (target: AliasTarget, revisionId: string): Promise<AliasView> => {
    const failure = this.failNextWrite;
    this.failNextWrite = undefined;
    if (failure === "before") {
      throw new Error("ServiceException");
    }
    if (revisionId !== `r${this.#revision}`) {
      throw new RevisionConflictError();
    }
    this.#set(target);
    if (failure === "after") {
      // Applied, and the answer never arrived.
      throw new Error("socket hang up");
    }
    return this.#view();
  };
}

export class FakeAlarms implements AlarmPort {
  state: AlarmState = "OK";
  unreadable = false;
  read = async (): Promise<AlarmReading[]> => {
    if (this.unreadable) {
      throw new Error("ThrottlingException");
    }
    return [{ name: "api-5xx", state: this.state }];
  };
}

/** A small deterministic generator, so that "random" routing is the same on every run. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}
