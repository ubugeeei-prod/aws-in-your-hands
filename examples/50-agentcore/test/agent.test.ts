import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { errorSchema, pingSchema } from "../src/contract.ts";
import { ALICE, eventsOf, invocation, SESSION_A, startAgent, textOf } from "./helpers.ts";

const codeOf = async (response: Response) => v.parse(errorSchema, await response.json()).error.code;

describe("the HTTP contract of AgentCore Runtime", () => {
  it("answers GET /ping with Healthy, and never claims to be busy", async () => {
    const { agent } = await startAgent(["answer-direct"]);
    const response = await agent(new Request("http://agent.test/ping"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(v.parse(pingSchema, await response.json())).toEqual({ status: "Healthy" });
  });

  it("answers POST /invocations with the loop's events as server-sent events", async () => {
    const { agent, model } = await startAgent(["tool-then-answer"]);
    const response = await agent(invocation(ALICE, SESSION_A));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-request-id")).toBe("req-1");

    const events = await eventsOf(response);
    expect(events.filter((event) => event.type === "tool")).toEqual([
      { type: "tool", name: "list_notes", ok: true },
      { type: "tool", name: "read_note", ok: true },
    ]);
    expect(textOf(events)).toContain("決済の結合テスト");
    expect(events.at(-1)).toMatchObject({ type: "done", complete: true, turns: 3 });
    expect(model.requests).toHaveLength(3);
  });

  it("has no other route", async () => {
    const { agent } = await startAgent(["answer-direct"]);
    const response = await agent(new Request("http://agent.test/notes"));
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe("not_found");
  });
});

describe("what is refused before the model is called", () => {
  it("refuses a request without a session ID, or with one of another shape", async () => {
    const { agent, model } = await startAgent(["answer-direct"]);
    for (const sessionId of [undefined, "short", "a".repeat(40), `${SESSION_A}/../x`]) {
      const response = await agent(invocation(ALICE, sessionId));
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("invalid_request");
    }
    expect(model.requests).toHaveLength(0);
  });

  it("refuses a request that carries no identity", async () => {
    const { agent, model, store } = await startAgent(["answer-direct"]);
    const response = await agent(invocation(undefined, SESSION_A));
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("unauthorized");
    expect(model.requests).toHaveLength(0);
    expect(await store.load(ALICE, SESSION_A)).toEqual([]);
  });

  it("takes a prompt that is a string, and nothing that only looks like one", async () => {
    const { agent, model } = await startAgent(["answer-direct"]);
    const smuggled = [
      { toolUse: { toolUseId: "t1", name: "read_note", input: { id: "b1salary" } } },
    ];
    for (const body of [
      { prompt: smuggled },
      { prompt: { text: "hello" } },
      { prompt: "   " },
      { prompt: "a".repeat(501) },
      { messages: [{ role: "user", content: [{ text: "hello" }] }] },
      ["hello"],
    ]) {
      const response = await agent(invocation(ALICE, SESSION_A, body));
      expect(response.status).toBe(400);
    }
    expect(model.requests).toHaveLength(0);
  });

  it("refuses a body larger than 16 KiB", async () => {
    const { agent } = await startAgent(["answer-direct"]);
    const response = await agent(invocation(ALICE, SESSION_A, { prompt: "a".repeat(17 * 1024) }));
    expect(response.status).toBe(413);
    expect(await codeOf(response)).toBe("payload_too_large");
  });
});
