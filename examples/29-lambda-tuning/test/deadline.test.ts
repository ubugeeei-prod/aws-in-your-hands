import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { clientConfig, composeTunedApp } from "../src/compose.ts";
import { budgetMs, obeyDeadline, withDeadline } from "../src/deadline.ts";
import { SDK } from "../src/timeouts.ts";

const ENV = {
  ALLOWED_ORIGIN: "https://app.example",
  NOTES_STORE: "dynamodb",
  TABLE_NAME: "notes",
};

type Sender = Pick<DynamoDBDocumentClient, "send">;
type Options = { abortSignal?: AbortSignal } | undefined;

/** A table that never answers. Like the SDK, a call ends only when its signal fires. */
function silentTable(): { client: Sender; signals: (AbortSignal | undefined)[] } {
  const signals: (AbortSignal | undefined)[] = [];
  const send = (_command: unknown, options: Options) =>
    new Promise((_resolve, reject) => {
      signals.push(options?.abortSignal);
      options?.abortSignal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
      });
    });
  return { client: { send: send as Sender["send"] }, signals };
}

const pending = Symbol("pending");
const settled = <T>(promise: Promise<T>) =>
  Promise.race([promise, new Promise<typeof pending>((resolve) => setImmediate(resolve, pending))]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a table that does not answer", () => {
  it("leaves the request hanging when nothing sets a deadline", async () => {
    const table = silentTable();
    const app = composeTunedApp(ENV, () => table.client);

    const response = Promise.resolve(app(new Request("https://api.test/notes/n1")));

    expect(await settled(response)).toBe(pending);
    expect(table.signals).toEqual([undefined]);
  });

  it("gets an error answer in the usual shape once the deadline passes", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    const table = silentTable();
    const app = composeTunedApp(ENV, () => table.client);
    const deadline = new AbortController();

    const response = withDeadline(deadline.signal, async () =>
      app(new Request("https://api.test/notes/n1", { headers: { origin: ENV.ALLOWED_ORIGIN } })),
    );
    expect(await settled(response)).toBe(pending);
    deadline.abort();

    const answer = await response;
    expect(answer.status).toBe(500);
    const requestId = answer.headers.get("x-request-id");
    expect(requestId).not.toBeNull();
    // A browser would hide the error from the page without this header.
    expect(answer.headers.get("access-control-allow-origin")).toBe(ENV.ALLOWED_ORIGIN);
    expect(await answer.json()).toMatchObject({ error: { code: "internal", requestId } });

    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logged.map((entry) => entry["message"])).toEqual(["unhandled error", "request"]);
    expect(String(logged[0]?.["error"])).toContain("AbortError");
    expect(logged[1]).toMatchObject({ requestId, status: 500, path: "/notes/n1" });
  });

  it("ends one request without touching another that is still within its time", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const table = silentTable();
    const app = composeTunedApp(ENV, () => table.client);
    const first = new AbortController();
    const second = new AbortController();

    const a = withDeadline(first.signal, async () => app(new Request("https://api.test/notes/a")));
    const b = withDeadline(second.signal, async () => app(new Request("https://api.test/notes/b")));
    await settled(a);
    first.abort();

    expect((await a).status).toBe(500);
    expect(await settled(b)).toBe(pending);
    expect(table.signals).toEqual([first.signal, second.signal]);
    second.abort();
    await b;
  });
});

describe("the client wrapper", () => {
  it("passes other options through and adds nothing outside a deadline", async () => {
    const seen: unknown[] = [];
    const client = obeyDeadline({
      send: ((_command: unknown, options: unknown) => {
        seen.push(options);
        return Promise.resolve({});
      }) as Sender["send"],
    });
    const signal = new AbortController().signal;
    const command = {} as Parameters<Sender["send"]>[0];

    await client.send(command);
    await withDeadline(signal, () => client.send(command, { requestTimeout: 5 }));

    expect(seen).toEqual([undefined, { requestTimeout: 5, abortSignal: signal }]);
  });
});

describe("the time the handler gives itself", () => {
  it("is what Lambda has left, less the time to answer", () => {
    expect(budgetMs(10_000, 1000)).toBe(9000);
    expect(budgetMs(800, 1000)).toBe(0);
  });
});

describe("the SDK client's settings", () => {
  it("turn the timeouts on and make a late response an error", () => {
    const config = clientConfig({
      ALLOWED_ORIGIN: ENV.ALLOWED_ORIGIN,
      LOG_LEVEL: "info",
      STAGE: "test",
      NOTES_STORE: "dynamodb",
      TABLE_NAME: "notes",
    });
    expect(config).toEqual({
      maxAttempts: SDK.maxAttempts,
      requestHandler: {
        connectionTimeout: SDK.connectionTimeoutMs,
        requestTimeout: SDK.requestTimeoutMs,
        throwOnRequestTimeout: true,
      },
    });
  });

  it("still point at DynamoDB Local when chapter 05's variable is set", () => {
    const config = clientConfig({
      ALLOWED_ORIGIN: ENV.ALLOWED_ORIGIN,
      LOG_LEVEL: "info",
      STAGE: "test",
      NOTES_STORE: "dynamodb",
      TABLE_NAME: "notes",
      DYNAMODB_ENDPOINT: "http://localhost:8000",
    });
    expect(config).toMatchObject({ endpoint: "http://localhost:8000", maxAttempts: 2 });
  });
});
