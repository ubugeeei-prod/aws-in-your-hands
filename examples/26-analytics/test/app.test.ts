import { describe, expect, it } from "vite-plus/test";

import { eventIdOf, harness } from "./harness.ts";

const idOf = async (response: Response) => ((await response.json()) as { id: string }).id;

describe("what a request is recorded as", () => {
  it("records one line per answered request, with the action only when it happened", async () => {
    const h = harness();
    const id = await idOf(await h.send("POST", "/notes", { title: "first" }));
    await h.send("GET", `/notes/${id}`);
    await h.send("PUT", `/notes/${id}`, { title: "second", body: "", expectedVersion: 1 });
    await h.send("PUT", `/notes/${id}`, { title: "stale", body: "", expectedVersion: 1 });
    await h.send("GET", "/notes/missing");
    await h.send("DELETE", `/notes/${id}`);
    await h.send("DELETE", `/notes/${id}`);

    expect(
      h.records().map((r) => [r.method, r.route, r.status, r.action, r.note_id === id]),
    ).toEqual([
      ["POST", "/notes", 201, "note_created", true],
      ["GET", "/notes/:id", 200, null, false],
      ["PUT", "/notes/:id", 200, "note_updated", true],
      ["PUT", "/notes/:id", 409, "update_conflicted", true],
      ["GET", "/notes/:id", 404, null, false],
      ["DELETE", "/notes/:id", 204, "note_deleted", true],
      ["DELETE", "/notes/:id", 404, null, false],
    ]);
  });

  it("carries the request ID the caller was given, and the time the answer took", async () => {
    const h = harness();
    const response = await h.send("GET", "/health");
    const [record] = h.records();

    expect(record).toMatchObject({
      event_id: eventIdOf(1),
      request_id: response.headers.get("x-request-id"),
      at: "2026-10-12T09:00:00.014Z",
      duration_ms: 7,
    });
  });

  it("keeps the note's text, the path and the query string out of the bucket", async () => {
    const h = harness();
    await h.send("POST", "/notes", { title: "salary-review", body: "confidential-body" });
    await h.send("GET", "/admin/secret-path?token=secret-token");
    await h.send("GET", "/notes?cursor=secret-cursor");
    h.delivery.flush();

    const stored = h
      .records()
      .map((record) => JSON.stringify(record))
      .join("\n");
    for (const secret of [
      "salary-review",
      "confidential-body",
      "secret-path",
      "secret-token",
      "secret-cursor",
    ]) {
      expect(stored).not.toContain(secret);
    }
    expect(h.records().map((record) => record.route)).toEqual(["/notes", "other", "/notes"]);
  });

  it("leaves the answer's body for the caller after reading the new note's ID", async () => {
    const h = harness();
    const response = await h.send("POST", "/notes", { title: "first" });
    expect(await response.json()).toMatchObject({ title: "first", version: 1 });
  });
});

describe("when the record cannot be written", () => {
  it("answers the caller exactly as before, and says in the log what was lost", async () => {
    const h = harness({ sink: () => () => Promise.reject(new Error("stream unavailable")) });
    const response = await h.send("POST", "/notes", { title: "first" });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ title: "first" });
    expect(h.records()).toEqual([]);
    const dropped = h.logged
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line["message"] === "analytics record dropped");
    expect(dropped).toEqual([
      {
        level: "warn",
        message: "analytics record dropped",
        requestId: response.headers.get("x-request-id"),
        error: "stream unavailable",
      },
    ]);
  });

  it("does the same when the sink throws before returning a promise", async () => {
    const h = harness({
      sink: () => () => {
        throw new Error("no credentials");
      },
    });
    expect((await h.send("GET", "/health")).status).toBe(200);
  });

  it("writes nothing to the notes when only the record fails", async () => {
    let fail = true;
    const h = harness({
      sink: (inner) => (line) => (fail ? Promise.reject(new Error("down")) : inner(line)),
    });
    await h.send("POST", "/notes", { title: "kept" });
    fail = false;
    const list = (await (await h.send("GET", "/notes")).json()) as { notes: unknown[] };

    // The note exists although nothing recorded its creation: the lake is not the source of truth.
    expect(list.notes).toHaveLength(1);
    expect(h.records().map((record) => record.action)).toEqual([null]);
  });
});
