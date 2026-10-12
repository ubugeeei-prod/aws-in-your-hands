import type { LogEntry } from "@aih/example-05-dynamodb/src/log.ts";
import { createNotesClient } from "@aih/example-06-auth/api/src/client.ts";
import { signLocalToken } from "@aih/example-06-auth/api/src/local-auth.ts";
import { createAttachmentsClient, sendUpload } from "@aih/example-07-uploads/api/src/client.ts";
import { createLocalStoreHandler } from "@aih/example-07-uploads/api/src/local-store-http.ts";

import { createLocal } from "../src/local.ts";
import { PNG_3X2 } from "./fixtures.ts";

const secret = "test-secret-that-is-at-least-32-chars";
const STORE = "http://store.test";
export const VISIBILITY_MS = 180_000;
export const MAX_RECEIVES = 3;

/**
 * Lets a test decide what the next call of one method does: fail, or wait
 * until the test says go. That is how the order of events is fixed.
 */
function controllable<T extends object>(target: T) {
  const failing = new Map<PropertyKey, number>();
  const holding = new Map<PropertyKey, Promise<void>>();
  const proxy = new Proxy(target, {
    get(inner, property) {
      const value: unknown = Reflect.get(inner, property, inner);
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) => {
        const call = () => (value as (...rest: unknown[]) => unknown).apply(inner, args);
        const left = failing.get(property) ?? 0;
        if (left > 0) {
          failing.set(property, left - 1);
          throw new Error(`injected failure in ${String(property)}`);
        }
        const gate = holding.get(property);
        if (gate !== undefined) {
          holding.delete(property);
          return gate.then(call);
        }
        return call();
      };
    },
  });
  return {
    proxy,
    failNext: (method: PropertyKey, times = 1) => void failing.set(method, times),
    /** The next call waits. Returns the function that lets it continue. */
    holdNext: (method: PropertyKey): (() => void) => {
      let release = () => {};
      holding.set(method, new Promise<void>((resolve) => (release = resolve)));
      return release;
    },
  };
}

type StoreName = "bucket" | "inspections" | "attachments";

export async function setup(options: { duplicate?: boolean } = {}) {
  let clock = Date.UTC(2026, 9, 12);
  let counter = 0;
  const logs: LogEntry[] = [];
  const controls = new Map<StoreName, ReturnType<typeof controllable>>();

  const local = createLocal({
    env: {
      ALLOWED_ORIGIN: "http://localhost:5173",
      LOG_LEVEL: "debug",
      STAGE: "test",
      NOTES_STORE: "memory",
    },
    secret,
    baseUrl: STORE,
    now: () => new Date(clock),
    randomSuffix: () => String(++counter).padStart(4, "0"),
    newId: () => `id-${++counter}`,
    log: (entry) => void logs.push(entry),
    queue: {
      visibilityTimeoutMs: VISIBILITY_MS,
      maxReceiveCount: MAX_RECEIVES,
      duplicate: options.duplicate ?? false,
    },
    wrap: (name, target) => {
      const control = controllable(target);
      controls.set(name, control);
      return control.proxy;
    },
  });

  const store = createLocalStoreHandler(local.bucket);
  const network: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    return request.url.startsWith(STORE) ? store(request) : local.app(request);
  };
  const token = await signLocalToken(secret, "alice");
  const notes = createNotesClient("http://api.test", () => token, network);
  const attachments = createAttachmentsClient("http://api.test", () => token, network);
  const control = (name: StoreName) => {
    const found = controls.get(name);
    if (found === undefined) {
      throw new Error(`no store named ${name}`);
    }
    return found;
  };

  return {
    ...local,
    logs,
    notes,
    attachments,
    advance: (ms: number) => void (clock += ms),
    failNext: (name: StoreName, method: string, times = 1) => control(name).failNext(method, times),
    holdNext: (name: StoreName, method: string) => control(name).holdNext(method),
    /** What the worker logged for each event, in order. */
    outcomes: () =>
      logs.filter((entry) => entry.message === "event handled").map((entry) => entry["status"]),
    /** Permit, then the browser's POST. Not finished: the object is still pending. */
    async upload(
      bytes: Uint8Array = PNG_3X2,
      contentType: "image/png" | "image/gif" = "image/png",
    ) {
      const note = await notes.create({ title: "trip", body: "" });
      const permit = await attachments.requestUpload(note.id, { contentType });
      const send = (body: Uint8Array) =>
        sendUpload(permit, new Blob([new Uint8Array(body)], { type: contentType }), network);
      await send(bytes);
      return {
        note,
        permit,
        key: `u/alice/${note.id}/${permit.attachmentId}`,
        attachmentId: permit.attachmentId,
        send,
      };
    },
  };
}

export type Context = Awaited<ReturnType<typeof setup>>;
