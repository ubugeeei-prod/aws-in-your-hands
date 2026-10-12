import { describe, expect, it } from "vite-plus/test";

import { createApp } from "../src/app.ts";
import { ApiError, createNotesClient } from "../src/client.ts";
import { MAX_LISTED_NOTES } from "../src/contract.ts";
import { createNoteService, InMemoryNoteRepository } from "../src/notes.ts";

// The client talks to the real application through its fetch handler. No
// socket is opened, and no hand-written mock of the API can fall out of date.
function setup() {
  let id = 0;
  const app = createApp({
    env: { ALLOWED_ORIGIN: "http://localhost:5173", LOG_LEVEL: "error", STAGE: "test" },
    notes: createNoteService({
      repository: new InMemoryNoteRepository(),
      now: () => new Date("2026-10-11T00:00:00Z"),
      newId: () => `note-${++id}`,
    }),
    log: () => {},
    newRequestId: () => "req-1",
    now: () => 0,
  });
  const viaApp: typeof fetch = async (input, init) => app.fetch(new Request(input, init));
  return createNotesClient("http://api.test", viaApp);
}

describe("typed client against the application", () => {
  it("round-trips a note", async () => {
    const client = setup();
    const created = await client.create({ title: "typed", body: "end to end" });
    expect(await client.get(created.id)).toEqual(created);
    // The list carries what a list view shows. The body came from `get`.
    const { body: _body, ...summary } = created;
    expect(await client.list()).toEqual([summary]);
    await client.remove(created.id);
    expect(await client.list()).toEqual([]);
  });

  it("turns an error response into an ApiError that carries the code and request ID", async () => {
    const client = setup();
    const error = await client.get("missing").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: "not_found", requestId: "req-1" });
  });

  it("reports health with the stage", async () => {
    expect(await setup().health()).toEqual({ status: "ok", stage: "test" });
  });
});

describe("typed client against a server that breaks the contract", () => {
  const respond =
    (status: number, body: string, contentType = "application/json"): typeof fetch =>
    async () =>
      new Response(body, { status, headers: { "content-type": contentType } });

  it("rejects a 200 whose body is not a note, instead of returning it as one", async () => {
    const client = createNotesClient("http://api.test", respond(200, JSON.stringify({ id: 42 })));
    await expect(client.get("x")).rejects.toMatchObject({ code: "unexpected_response" });
  });

  it("rejects a list that carries bodies, or more notes than a list may hold", async () => {
    const summary = { id: "a", title: "t", createdAt: "2026-10-11T00:00:00.000Z" };
    for (const notes of [
      [{ ...summary, body: "x".repeat(10_000) }],
      Array.from({ length: MAX_LISTED_NOTES + 1 }, () => summary),
    ]) {
      const client = createNotesClient("http://api.test", respond(200, JSON.stringify({ notes })));
      await expect(client.list()).rejects.toMatchObject({ code: "unexpected_response" });
    }
  });

  it("rejects an HTML error page from something in front of the API", async () => {
    const client = createNotesClient(
      "http://api.test",
      respond(502, "<html>Bad Gateway</html>", "text/html"),
    );
    await expect(client.list()).rejects.toMatchObject({ status: 502, code: "unexpected_response" });
  });
});
