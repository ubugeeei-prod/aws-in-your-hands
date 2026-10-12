import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import type { LogEntry } from "@aih/example-04-http-api/src/log.ts";
import { sseData } from "@aih/example-17-ai/src/client.ts";

import { createAnswerer } from "../src/answer.ts";
import { createApp, toHits } from "../src/app.ts";
import {
  answerEventSchema,
  errorSchema,
  healthSchema,
  MAX_QUERY_CHARS,
  searchResponseSchema,
} from "../src/contract.ts";
import { localParts } from "../src/local.ts";
import { OWNER_HEADER, ownerFromTrustedHeader } from "../src/owner.ts";
import { createSearch } from "../src/search.ts";

async function setup() {
  const parts = await localParts();
  const search = createSearch(parts);
  const logs: LogEntry[] = [];
  let requestId = 0;
  let clock = 0;
  const app = createApp({
    stage: "test",
    backend: "local",
    ownerOf: ownerFromTrustedHeader,
    search,
    answer: createAnswerer({
      search,
      gateway: parts.gateway,
      modelId: "fixture",
      maxOutputTokens: 400,
      timeoutMs: 30_000,
      retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
      sleep: async () => {},
      random: () => 0,
      timeoutSignal: () => new AbortController().signal,
    }),
    log: (entry) => logs.push(entry),
    newRequestId: () => `req-${++requestId}`,
    now: () => (clock += 5),
  });
  const post = (path: string, body: unknown, owner?: string) =>
    app(
      new Request(`http://api.test${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(owner === undefined ? {} : { [OWNER_HEADER]: owner }),
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  return { app, post, logs };
}

describe("POST /search", () => {
  it("answers with the caller's notes, one hit per note, in the documented shape", async () => {
    const { post, logs } = await setup();
    const response = await post("/search", { query: "決済" }, "alice");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-1");
    const body = v.parse(searchResponseSchema, await response.json());
    expect(body.hits.map((hit) => hit.noteId).toSorted()).toEqual(["0000000a1", "0000000a2"]);
    expect(body.hits[0]?.snippet.startsWith(body.hits[0]?.title ?? "x")).toBe(false);
    expect(logs.at(-1)).toMatchObject({ message: "search", hits: 2, meaning: "used" });
  });

  it("searches the notes of the owner in the header, whatever the body claims", async () => {
    const { post } = await setup();
    const response = await post("/search", { query: "決済", owner: "bob" }, "alice");
    const body = v.parse(searchResponseSchema, await response.json());
    expect(body.hits.every((hit) => hit.noteId.startsWith("0000000a"))).toBe(true);

    const bobs = v.parse(
      searchResponseSchema,
      await (await post("/search", { query: "決済" }, "bob")).json(),
    );
    expect(bobs.hits.map((hit) => hit.noteId)).toEqual(["0000000b1"]);
  });

  it("refuses a request that does not say who is asking", async () => {
    const { post } = await setup();
    for (const owner of [undefined, "", "a b", "x".repeat(129)]) {
      const response = await post("/search", { query: "決済" }, owner);
      expect(response.status).toBe(401);
      expect(v.parse(errorSchema, await response.json()).error.code).toBe("unauthenticated");
    }
  });

  it("bounds the query and the number of hits", async () => {
    const { post } = await setup();
    const tooLong = await post("/search", { query: "x".repeat(MAX_QUERY_CHARS + 1) }, "alice");
    expect(tooLong.status).toBe(400);
    expect((await post("/search", { query: "決済", limit: 11 }, "alice")).status).toBe(400);
    expect((await post("/search", { query: "   " }, "alice")).status).toBe(400);
    expect((await post("/search", "{", "alice")).status).toBe(400);
    expect((await post("/search", { query: "x".repeat(20_000) }, "alice")).status).toBe(413);

    const one = await post("/search", { query: "決済", limit: 1 }, "alice");
    expect(v.parse(searchResponseSchema, await one.json()).hits).toHaveLength(1);
  });
});

describe("POST /answers", () => {
  it("streams sources, text and citations as server-sent events", async () => {
    const { post, logs } = await setup();
    const response = await post("/answers", { question: "リリースまでに何を終える?" }, "alice");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const events = [];
    for await (const data of sseData(response.body as ReadableStream<Uint8Array>)) {
      events.push(v.parse(answerEventSchema, JSON.parse(data)));
    }
    expect(events.map((event) => event.type)).toEqual([
      "sources",
      "delta",
      "delta",
      "delta",
      "done",
    ]);
    const sources = events[0]?.type === "sources" ? events[0].sources : [];
    expect(sources.every((source) => source.noteId.startsWith("0000000a"))).toBe(true);
    expect(logs.at(-1)).toMatchObject({
      message: "answer",
      outcome: "complete",
      citations: [1],
      unknownCitations: [7],
    });
  });

  it("refuses a request that does not say who is asking", async () => {
    const { post } = await setup();
    expect((await post("/answers", { question: "決済" })).status).toBe(401);
  });
});

describe("the rest of the app", () => {
  it("reports its backend", async () => {
    const { app } = await setup();
    const response = await app(new Request("http://api.test/health"));
    expect(v.parse(healthSchema, await response.json())).toEqual({
      status: "ok",
      stage: "test",
      backend: "local",
    });
  });

  it("answers unknown routes in the usual error shape", async () => {
    const { app } = await setup();
    const response = await app(new Request("http://api.test/notes"));
    expect(response.status).toBe(404);
    expect(v.parse(errorSchema, await response.json()).error.code).toBe("not_found");
  });
});

describe("toHits", () => {
  it("keeps the best passage of each note and every way the note matched", () => {
    const passage = (noteId: string, n: number, matched: ("words" | "meaning")[]) => ({
      noteId,
      title: "T",
      passage: n,
      text: `T\n\npassage ${n}`,
      score: 1 / (n + 1),
      matched,
    });
    const hits = toHits(
      [passage("a", 0, ["meaning"]), passage("b", 0, ["words"]), passage("a", 1, ["words"])],
      5,
    );
    expect(hits).toEqual([
      { noteId: "a", title: "T", snippet: "passage 0", score: 1, matched: ["meaning", "words"] },
      { noteId: "b", title: "T", snippet: "passage 0", score: 1, matched: ["words"] },
    ]);
  });
});
