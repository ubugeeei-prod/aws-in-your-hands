import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { createApp } from "../src/app.ts";
import {
  errorSchema,
  notificationStatusSchema,
  shareNotificationResultSchema,
} from "../src/contract.ts";
import type { Mailer } from "../src/mailer.ts";
import { input, setup as setupNotify } from "./setup.ts";

function setup(mailer?: Mailer) {
  const context = setupNotify(mailer === undefined ? {} : { mailer });
  let requestId = 0;
  let clock = 0;
  const app = createApp({
    stage: "test",
    mode: "local",
    notify: context.deps,
    log: (entry) => context.logs.push(entry),
    newRequestId: () => `req-${++requestId}`,
    now: () => (clock += 5),
  });
  const post = (body: unknown) =>
    app(
      new Request("http://api.test/share-notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  const get = (path: string) => app(new Request(`http://api.test${path}`));
  return { ...context, app, post, get };
}

describe("share notification API", () => {
  it("answers 202 for the first request and 200 duplicate for the second, with one mail", async () => {
    const { post, outbox } = setup();
    const first = await post(input);
    const second = await post(input);

    expect(first.status).toBe(202);
    expect(v.parse(shareNotificationResultSchema, await first.json())).toEqual({
      status: "accepted",
      notificationId: "share-1",
      messageId: "local-1",
    });
    expect(second.status).toBe(200);
    expect(v.parse(shareNotificationResultSchema, await second.json())).toEqual({
      status: "duplicate",
      notificationId: "share-1",
      state: "sent",
    });
    expect(outbox.sent).toHaveLength(1);
  });

  it("rejects a title carrying a second header and names the field", async () => {
    const { post, outbox } = setup();
    const response = await post({ ...input, noteTitle: "Trip plan\r\nBcc: attacker@example.com" });
    const body = v.parse(errorSchema, await response.json());

    expect(response.status).toBe(400);
    expect(body.error.issues?.map((issue) => issue.path)).toEqual(["noteTitle"]);
    expect(outbox.sent).toHaveLength(0);
  });

  it("rejects a recipient list where one address is expected", async () => {
    const { post, outbox } = setup();
    const response = await post({ ...input, to: "recipient@example.com,attacker@example.com" });
    expect(response.status).toBe(400);
    expect(outbox.sent).toHaveLength(0);
  });

  it("does not let the caller choose where the link points", async () => {
    const { post, outbox } = setup();
    await post({
      ...input,
      noteUrl: "https://attacker.example.com",
      appOrigin: "https://attacker.example.com",
    });
    expect(outbox.sent[0]?.text).toContain("https://notes.example.com/notes/note-1");
    expect(outbox.sent[0]?.text).not.toContain("attacker");
  });

  it("answers 409 when the ID is reused for another mail", async () => {
    const { post } = setup();
    await post(input);
    const response = await post({ ...input, noteTitle: "Another note" });
    expect(response.status).toBe(409);
    expect(v.parse(errorSchema, await response.json()).error.code).toBe("idempotency_conflict");
  });

  it("tells a refused send from an unanswered one", async () => {
    const refused = setup({
      send: () => Promise.resolve({ kind: "rejected", reason: "MessageRejected" }),
    });
    const refusedResponse = await refused.post(input);
    expect(refusedResponse.status).toBe(502);
    expect(v.parse(errorSchema, await refusedResponse.json()).error.code).toBe("send_rejected");

    const silent = setup({ send: () => Promise.reject(new Error("socket hang up")) });
    const silentResponse = await silent.post(input);
    const text = await silentResponse.text();
    expect(silentResponse.status).toBe(502);
    expect(v.parse(errorSchema, JSON.parse(text)).error.code).toBe("send_unknown");
    expect(text).not.toContain("socket hang up");
  });

  it("answers 200 suppressed without sending", async () => {
    const { post, store, outbox } = setup();
    await store.suppress({
      address: input.to,
      reason: "complaint",
      suppressedAt: "2026-10-10T00:00:00.000Z",
      feedbackId: "f",
    });
    const response = await post(input);
    expect(response.status).toBe(200);
    expect(v.parse(shareNotificationResultSchema, await response.json())).toMatchObject({
      status: "suppressed",
      reason: "complaint",
    });
    expect(outbox.sent).toHaveLength(0);
  });

  it("shows the state of a notification, without the fingerprint", async () => {
    const { get, post } = setup();
    await post(input);
    const response = await get("/share-notifications/share-1");
    const body: unknown = await response.json();

    expect(v.parse(notificationStatusSchema, body)).toMatchObject({
      state: "sent",
      messageId: "local-1",
    });
    expect(body).not.toHaveProperty("fingerprint");
    expect((await get("/share-notifications/unknown")).status).toBe(404);
  });

  it("puts the same request ID in the response header, the error body, and the log", async () => {
    const { get, logs } = setup();
    const response = await get("/nope");
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(v.parse(errorSchema, await response.json()).error.requestId).toBe("req-1");
    expect(logs).toContainEqual(expect.objectContaining({ requestId: "req-1", status: 404 }));
  });

  it("refuses a body over 16 KiB and a body that is not JSON", async () => {
    const { post } = setup();
    expect((await post({ ...input, noteTitle: "x".repeat(20_000) })).status).toBe(413);
    expect((await post("{not json")).status).toBe(400);
  });
});
