import { InMemoryNoteRepository } from "@aih/example-05-dynamodb/src/memory-repository.ts";
import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";
import { ApiError, createNotesClient } from "@aih/example-06-auth/api/src/client.ts";
import {
  createLocalAuthenticator,
  signLocalToken,
} from "@aih/example-06-auth/api/src/local-auth.ts";

import { createApp } from "../src/app.ts";
import { InMemoryAttachmentRepository } from "../src/attachment-repository.ts";
import { createAttachmentService } from "../src/attachments.ts";
import { createAttachmentsClient, UploadError } from "../src/client.ts";
import { createLocalStoreHandler } from "../src/local-store-http.ts";
import { InMemoryObjectStore } from "../src/memory-object-store.ts";
import { InMemoryPermitLedger } from "../src/permit-ledger.ts";
import { sweep } from "../src/sweep.ts";

const secret = "test-secret-that-is-at-least-32-chars";
export const STORE = "http://store.test";

/** Lets a test make the next call of one method fail, once. */
function faulty<T extends object>(target: T) {
  const failing = new Set<PropertyKey>();
  const proxy = new Proxy(target, {
    get(inner, property) {
      const value: unknown = Reflect.get(inner, property, inner);
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) => {
        if (failing.delete(property)) {
          throw new Error(`injected failure in ${String(property)}`);
        }
        return (value as (...rest: unknown[]) => unknown).apply(inner, args);
      };
    },
  });
  return { proxy, failNext: (method: keyof T) => void failing.add(method) };
}

export const png = (bytes = 3) => new Blob([new Uint8Array(bytes).fill(7)], { type: "image/png" });

export async function setup() {
  let clock = Date.UTC(2026, 9, 11);
  let suffix = 0;
  const now = () => new Date(clock);
  const logs: Record<string, unknown>[] = [];
  const log = (entry: Record<string, unknown>) => void logs.push(entry);
  const randomSuffix = () => String(++suffix).padStart(4, "0");

  const noteRepository = new InMemoryNoteRepository();
  const records = faulty(new InMemoryAttachmentRepository());
  const realObjects = new InMemoryObjectStore({ baseUrl: STORE, secret, now });
  const objects = faulty(realObjects);
  // Each note and attachment gets its own millisecond, as IDs sort by time.
  const notes = createNoteService({
    repository: noteRepository,
    now: () => new Date(++clock),
    randomSuffix,
  });

  const app = createApp({
    env: {
      ALLOWED_ORIGIN: "http://localhost:5173",
      LOG_LEVEL: "debug",
      STAGE: "test",
      NOTES_STORE: "memory",
    },
    notes,
    attachments: createAttachmentService({
      notes,
      attachments: records.proxy,
      objects: objects.proxy,
      permits: new InMemoryPermitLedger(),
      now: () => new Date(++clock),
      randomSuffix,
      log,
    }),
    authenticate: createLocalAuthenticator(secret),
    log,
    newRequestId: () => "req-1",
    now: () => clock,
  });

  const store = createLocalStoreHandler(realObjects);
  const network: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    return request.url.startsWith(STORE) ? store(request) : app.fetch(request);
  };
  const tokens = {
    alice: await signLocalToken(secret, "alice"),
    bob: await signLocalToken(secret, "bob"),
  };
  const as = (token: string) => ({
    token,
    notes: createNotesClient("http://api.test", () => token, network),
    attachments: createAttachmentsClient("http://api.test", () => token, network),
  });

  return {
    app,
    logs,
    network,
    alice: as(tokens.alice),
    bob: as(tokens.bob),
    objects: realObjects,
    failNextObjectCall: objects.failNext,
    failNextRecordCall: records.failNext,
    advance: (ms: number) => void (clock += ms),
    sweep: (options: { dryRun: boolean } = { dryRun: false }) =>
      sweep(
        { objects: realObjects, attachments: records.proxy, notes: noteRepository, now },
        options,
      ),
  };
}

export const rejection = async (promise: Promise<unknown>) => {
  const error = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof ApiError) && !(error instanceof UploadError)) {
    throw new Error("expected the request to be rejected");
  }
  return error;
};
