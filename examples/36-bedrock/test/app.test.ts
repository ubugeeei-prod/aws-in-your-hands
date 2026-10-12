import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import type { Authenticate } from "@aih/example-06-auth/api/src/identity.ts";

import { createApp } from "../src/app.ts";
import { InMemoryUsageLedger, utcDay } from "../src/budget.ts";
import { assistantEventSchema, errorSchema } from "../src/contract.ts";
import { parseEnv } from "../src/env.ts";
import { seededNotes } from "../src/local-notes.ts";
import { inferenceLineSchema } from "../src/log-shape.ts";
import { modelProfiles } from "../src/models.ts";
import { createScriptedModel } from "../src/scripted-model.ts";
import { createExtractor } from "../src/structured.ts";
import { type TranscriptName, transcripts } from "../src/transcripts.ts";
import { ALICE, BOB, never, NOVA, requestOptions, setup } from "./helpers.ts";

const NOW = Date.parse("2026-10-13T03:00:00Z");
const DAY = utcDay(NOW);

// Stands in for the entry point's check: a token names its owner, anything else is nobody.
const authenticate: Authenticate = ({ authorization }) =>
  Promise.resolve(
    authorization === "Bearer alice"
      ? { sub: ALICE }
      : authorization === "Bearer bob"
        ? { sub: BOB }
        : undefined,
  );

async function build(transcript: TranscriptName, env: Record<string, string> = {}) {
  const { assistant, model } = setup(transcript);
  const structured = createScriptedModel(transcripts["structured-tool-valid"]);
  const ledger = new InMemoryUsageLedger();
  const lines: unknown[] = [];
  const app = createApp({
    env: parseEnv({ AI_BACKEND: "scripted", BEDROCK_MODEL_ID: NOVA, ...env }),
    authenticate,
    notes: await seededNotes(),
    ledger,
    assistant,
    extract: createExtractor({
      gateway: structured,
      request: requestOptions(),
      timeoutMs: 60_000,
      timeoutSignal: () => never,
    }),
    prices: modelProfiles[NOVA].usdPerMillionTokens,
    log: (entry) => lines.push(entry),
    newRequestId: () => "req-1",
    now: () => NOW,
  });
  return { app, model, structured, ledger, lines };
}

const ask = (question: unknown, token = "alice") =>
  new Request("http://api.test/assistant", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ question }),
  });

async function eventsOf(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((frame) => frame !== "")
    .map((frame) => v.parse(assistantEventSchema, JSON.parse(frame.split("\ndata: ")[1] ?? "")));
}

describe("the assistant API", () => {
  it("answers nobody: without a verified caller there is no owner to read notes for", async () => {
    const { app, model } = await build("tool-then-answer");
    const response = await app(
      new Request("http://api.test/assistant", { method: "POST", body: '{"question":"q"}' }),
    );
    expect(response.status).toBe(401);
    expect(v.parse(errorSchema, await response.json()).error.code).toBe("unauthorized");
    expect(model.requests).toHaveLength(0);
  });

  it("takes the owner from the entry point's event, not from the request", async () => {
    const { app } = await build("answer-direct");
    const fromEvent: Authenticate = ({ event }) =>
      Promise.resolve(event === "signed-by-alice" ? { sub: ALICE } : undefined);
    const { assistant } = setup("answer-direct");
    const withEvent = createApp({
      env: parseEnv({ AI_BACKEND: "scripted", BEDROCK_MODEL_ID: NOVA }),
      authenticate: fromEvent,
      notes: await seededNotes(),
      ledger: new InMemoryUsageLedger(),
      assistant,
      extract: () => Promise.reject(new Error("unused")),
      prices: modelProfiles[NOVA].usdPerMillionTokens,
      log: () => undefined,
      newRequestId: () => "req-2",
      now: () => NOW,
    });
    const me = new Request("http://api.test/me", { headers: { "x-owner": BOB } });
    expect((await withEvent(me, { event: "signed-by-alice" })).status).toBe(200);
    expect(await (await withEvent(me, { event: "signed-by-alice" })).json()).toEqual({
      sub: ALICE,
    });
    expect((await withEvent(me)).status).toBe(401);
    expect((await app(me)).status).toBe(401);
  });

  it("streams tool events, the answer, and one `done`, each fitting the contract", async () => {
    const { app } = await build("tool-then-answer");
    const response = await app(ask("残っている作業は？"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-request-id")).toBe("req-1");
    const events = await eventsOf(response);
    expect(events.filter((event) => event.type === "tool")).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "done", complete: true, turns: 3 });
  });

  it("refuses a question that is empty or too long, before anything is set aside", async () => {
    const { app, model, ledger } = await build("answer-direct");
    for (const question of ["", "   ", "あ".repeat(501), 7]) {
      expect((await app(ask(question))).status, String(question).slice(0, 5)).toBe(400);
    }
    expect(model.requests).toHaveLength(0);
    expect(await ledger.spent(ALICE, DAY)).toBe(0);
  });
});

describe("the budget, enforced before the call", () => {
  it("charges the day what the model reported, not what was set aside", async () => {
    const { app, ledger } = await build("tool-then-answer");
    await (await app(ask("残っている作業は？"))).text();
    // 1240 in, 91 out at Nova 2 Lite's list prices.
    expect(await ledger.spent(ALICE, DAY)).toBe(793);
    expect(await ledger.spent(BOB, DAY)).toBe(0);
  });

  it("answers 429 without calling the model once the day cannot take a request's worst case", async () => {
    // The worst case of one request is 66,220. A budget of 70,000 takes one, not two at once.
    const { app, model, ledger } = await build("answer-direct", {
      DAILY_BUDGET_MICRO_USD: "70000",
    });
    await ledger.reserve(ALICE, DAY, 10_000, 70_000);
    const response = await app(ask("こんにちは"));
    expect(response.status).toBe(429);
    expect(v.parse(errorSchema, await response.json()).error).toMatchObject({
      code: "budget_exceeded",
      retryable: false,
    });
    expect(model.requests).toHaveLength(0);
    // Bob's day is his own.
    expect((await app(ask("こんにちは", "bob"))).status).toBe(200);
  });

  it("keeps a failed request's reservation from leaking: it settles to what was reported", async () => {
    const { app, ledger } = await build("always-throttled");
    const events = await eventsOf(await app(ask("こんにちは")));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "throttled" });
    expect(await ledger.spent(ALICE, DAY)).toBe(0);
  });
});

describe("the log line", () => {
  it("carries the usage and the cost, and none of the words", async () => {
    const { app, lines } = await build("tool-then-answer");
    await (await app(ask("残っている作業は？"))).text();
    expect(lines).toHaveLength(1);
    const line = v.parse(inferenceLineSchema, lines[0]);
    expect(line).toMatchObject({
      level: "info",
      message: "assistant",
      owner: ALICE,
      modelId: NOVA,
      outcome: "complete",
      turns: 3,
      toolCalls: 2,
      toolErrors: 0,
      usage: { inputTokens: 1240, outputTokens: 91 },
      costMicroUsd: 793,
    });
    const text = JSON.stringify(lines);
    expect(text).not.toContain("残っている");
    expect(text).not.toContain("負荷試験");
  });

  it("says how a request that did not finish ended", async () => {
    const { app, lines } = await build("runaway-tools");
    await (await app(ask("全部見て"))).text();
    expect(v.parse(inferenceLineSchema, lines[0])).toMatchObject({
      level: "warn",
      outcome: "turn_limit",
      turns: 4,
    });
  });
});

describe("action items", () => {
  it("returns validated JSON for the caller's own note", async () => {
    const { app, lines } = await build("answer-direct");
    const response = await app(
      new Request("http://api.test/notes/n1release/action-items", {
        method: "POST",
        headers: { authorization: "Bearer alice" },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: unknown[]; attempts: number };
    expect(body.items).toHaveLength(3);
    expect(body.attempts).toBe(1);
    expect(v.parse(inferenceLineSchema, lines[0])).toMatchObject({
      message: "action_items",
      outcome: "complete",
    });
  });

  it("does not find another owner's note, and so never sends it to the model", async () => {
    const { app, structured } = await build("answer-direct");
    const response = await app(
      new Request("http://api.test/notes/b1salary/action-items", {
        method: "POST",
        headers: { authorization: "Bearer alice" },
      }),
    );
    expect(response.status).toBe(404);
    expect(structured.requests).toHaveLength(0);
  });
});
