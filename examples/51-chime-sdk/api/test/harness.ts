import { InMemoryNoteRepository } from "@aih/example-05-dynamodb/src/memory-repository.ts";
import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";
import {
  createLocalAuthenticator,
  signLocalToken,
} from "@aih/example-06-auth/api/src/local-auth.ts";

import { createApp } from "../src/app.ts";
import { createRoomsClient, RoomsError } from "../src/client.ts";
import { FakeMeetings } from "../src/fake-meetings.ts";
import { MeetingsError } from "../src/meetings.ts";
import { InMemoryRoomStore } from "../src/room-store.ts";
import { createRoomService } from "../src/rooms.ts";

const secret = "test-secret-that-is-at-least-32-chars";

/**
 * Puts a test in charge of the order of events: `before` runs something just ahead of the
 * next call of one method, and `failNext` makes that call throw instead.
 */
function scripted<T extends object>(target: T) {
  const hooks = new Map<PropertyKey, (() => Promise<unknown>)[]>();
  const failing = new Set<PropertyKey>();
  const proxy = new Proxy(target, {
    get(inner, property) {
      const value: unknown = Reflect.get(inner, property, inner);
      if (typeof value !== "function") {
        return value;
      }
      return async (...args: unknown[]) => {
        await hooks.get(property)?.shift()?.();
        if (failing.delete(property)) {
          throw new MeetingsError(String(property), new Error("injected failure"));
        }
        return (value as (...rest: unknown[]) => unknown).apply(inner, args);
      };
    },
  });
  return {
    proxy,
    before: (method: keyof T, run: () => Promise<unknown>) =>
      void hooks.set(method, [...(hooks.get(method) ?? []), run]),
    failNext: (method: keyof T) => void failing.add(method),
  };
}

export async function setup() {
  let ids = 0;
  const newId = () => `id-${String(++ids).padStart(4, "0")}`;
  const logs: Record<string, unknown>[] = [];

  const chime = new FakeMeetings(newId);
  const meetings = scripted(chime);
  const realStore = new InMemoryRoomStore();
  const store = scripted(realStore);

  const app = createApp({
    env: {
      ALLOWED_ORIGIN: "http://localhost:5173",
      LOG_LEVEL: "debug",
      STAGE: "test",
      NOTES_STORE: "memory",
    },
    notes: createNoteService({
      repository: new InMemoryNoteRepository(),
      now: () => new Date(Date.UTC(2026, 9, 13)),
      randomSuffix: newId,
    }),
    rooms: createRoomService({ store: store.proxy, meetings: meetings.proxy, newId }),
    authenticate: createLocalAuthenticator(secret),
    log: (entry) => void logs.push(entry),
    newRequestId: () => "req-1",
    now: () => 0,
  });

  // No socket: a Request goes straight into the app, and a Response comes back.
  const as = async (sub: string | undefined) => {
    const token = sub === undefined ? undefined : await signLocalToken(secret, sub);
    const responses: Response[] = [];
    const viaApp: typeof fetch = async (input, init) => {
      const response = await app(new Request(input, init));
      responses.push(response.clone());
      return response;
    };
    return {
      ...createRoomsClient("http://api.test", () => token, viaApp),
      /** Every response this caller has been sent so far. */
      responses,
      received: async () =>
        (await Promise.all(responses.map((response) => response.clone().text()))).join("\n"),
    };
  };

  return {
    app,
    chime,
    meetings,
    store,
    realStore,
    logs,
    alice: await as("alice"),
    bob: await as("bob"),
    carol: await as("carol"),
    anonymous: await as(undefined),
  };
}

export const rejection = async (promise: Promise<unknown>) => {
  const error = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof RoomsError)) {
    throw new Error("expected the request to be rejected", { cause: error });
  }
  return { status: error.status, code: error.code };
};
