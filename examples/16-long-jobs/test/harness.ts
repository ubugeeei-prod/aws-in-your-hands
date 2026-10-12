import { MemoryExportStore } from "../src/export-store.ts";
import { manifestKey, manifestSchema, partsPrefix } from "../src/job.ts";
import { type ExportedNote, exportedNoteSchema, MemoryNoteSource } from "../src/note-source.ts";
import type { Budget, Deps } from "../src/steps.ts";

/**
 * Lets a test decide what the next call of one method does: fail, or wait
 * until the test says go. That is how the order of events is fixed.
 */
function controllable<T extends object>(target: T) {
  const failing = new Map<PropertyKey, { skip: number; times: number }>();
  const holding = new Map<PropertyKey, { gate: Promise<void>; arrived: () => void }>();
  const proxy = new Proxy(target, {
    get(inner, property) {
      const value: unknown = Reflect.get(inner, property, inner);
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) => {
        const call = () => (value as (...rest: unknown[]) => unknown).apply(inner, args);
        const plan = failing.get(property);
        if (plan !== undefined && plan.skip > 0) {
          plan.skip -= 1;
        } else if (plan !== undefined && plan.times > 0) {
          plan.times -= 1;
          return Promise.reject(new Error(`injected failure in ${String(property)}`));
        }
        const held = holding.get(property);
        if (held !== undefined) {
          holding.delete(property);
          held.arrived();
          return held.gate.then(call);
        }
        return call();
      };
    },
  });
  return {
    proxy,
    /** Lets `skip` calls through, then fails the next `times`. */
    failAfter: (method: keyof T, skip: number, times = 1) =>
      void failing.set(method, { skip, times }),
    /** The next call waits. `reached` resolves once that call is made; `release` lets it continue. */
    holdNext: (method: keyof T): { reached: Promise<void>; release: () => void } => {
      let release = () => {};
      let arrived = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const reached = new Promise<void>((resolve) => (arrived = resolve));
      holding.set(method, { gate, arrived });
      return { reached, release };
    },
  };
}

export const note = (owner: string, number: number): ExportedNote => ({
  owner,
  id: `n${String(number).padStart(4, "0")}`,
  title: `note ${number}`,
  body: "",
  version: 1,
  createdAt: "2026-10-12T00:00:00.000Z",
  updatedAt: "2026-10-12T00:00:00.000Z",
});

export const everyPage = (pageSize: number): Budget => ({ pageSize, mayContinue: () => true });

export function setup(count: number) {
  const source = new MemoryNoteSource();
  for (let number = 1; number <= count; number++) {
    source.put(note("alice", number));
  }
  const memory = new MemoryExportStore();
  const store = controllable(memory);
  const notes = controllable(source);
  const deps: Deps = { source: notes.proxy, store: store.proxy };
  return {
    deps,
    source,
    memory,
    failStoreAfter: store.failAfter,
    holdStore: store.holdNext,
    failSourceAfter: notes.failAfter,
    /** Part keys as they are in the bucket, manifest or not. */
    parts: () => memory.list(partsPrefix(ID)),
    /** The export the way a reader sees it: the manifest, then the parts it names. undefined without a manifest. */
    read(): ExportedNote[] | undefined {
      const manifest = memory.read(manifestKey(ID));
      if (manifest === undefined) {
        return undefined;
      }
      return manifestSchema
        .parse(JSON.parse(manifest))
        .parts.flatMap((key) => (memory.read(key) ?? "").trimEnd().split("\n"))
        .map((line) => exportedNoteSchema.parse(JSON.parse(line)));
    },
  };
}

export const ID = "2026-10-12T030000Z";
export const START = { exportId: "2026-10-12T03:00:00Z" };
export const ids = (notes: ExportedNote[] | undefined): string[] =>
  (notes ?? []).map((item) => item.id);
export const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) => note("alice", from + index).id);
