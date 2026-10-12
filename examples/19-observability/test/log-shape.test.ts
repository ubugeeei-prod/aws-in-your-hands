import { describe, expect, it } from "vite-plus/test";

import { brokenList, harness, requestIdOf } from "./harness.ts";

// No tracer is registered in this file: these are the lines of a process
// without any OpenTelemetry SDK, as in chapter 05.

async function mixedTraffic() {
  const h = harness({ repository: brokenList("table unavailable") });
  const created = (await (
    await h.send("POST", "/notes", { title: "private title", body: "private body" })
  ).json()) as {
    id: string;
  };
  await h.send("GET", `/notes/${created.id}`);
  await h.send("GET", "/notes/missing");
  await h.send("POST", "/notes", { title: "" });
  await h.send("PUT", `/notes/${created.id}`, { title: "edited", body: "", expectedVersion: 7 });
  await h.send("GET", "/notes");
  return h;
}

describe("log lines written by the notes API", () => {
  it("has only the fields the schema lists", async () => {
    const h = await mixedTraffic();
    // parseLogLines throws on an unknown field.
    const lines = h.lines();
    expect(lines.filter((line) => line.message === "request").map((line) => line.status)).toEqual([
      201, 200, 404, 400, 409, 500,
    ]);
    expect(lines.filter((line) => line.message === "unhandled error")).toHaveLength(1);
  });

  it("gives the 500 and its stack trace the same request ID as the response", async () => {
    const h = harness({ repository: brokenList("table unavailable") });
    const response = await h.send("GET", "/notes");
    const id = response.headers.get("x-request-id");

    expect(id).toBe(requestIdOf(1));
    expect(h.lines().map((line) => [line.message, line.requestId, line.level])).toEqual([
      ["unhandled error", id, "error"],
      ["request", id, "error"],
    ]);
  });

  it("keeps note text, query strings and credentials out of the log", async () => {
    const h = harness();
    await h.send(
      "POST",
      "/notes?access_token=query-secret",
      { title: "private title", body: "private body" },
      { authorization: "Bearer header-secret", cookie: "session=cookie-secret" },
    );
    const written = h.raw.join("\n");

    for (const secret of [
      "private title",
      "private body",
      "query-secret",
      "header-secret",
      "cookie-secret",
    ]) {
      expect(written).not.toContain(secret);
    }
    expect(h.lines()[0]).toMatchObject({ path: "/notes", status: 201 });
  });

  it("has no trace fields when no tracer is running", async () => {
    const h = harness();
    await h.send("GET", "/health");
    expect(Object.keys(h.lines()[0] ?? {}).toSorted()).toEqual([
      "durationMs",
      "level",
      "message",
      "method",
      "path",
      "requestId",
      "status",
    ]);
  });

  it("writes a request line of 167 bytes for a note path", async () => {
    const h = harness();
    await h.send("GET", "/notes/n-0000000000000-0001");
    // The pricing scenarios assume this size; see src/cost-inputs.ts.
    expect(Buffer.byteLength(h.raw[0] ?? "", "utf8")).toBe(167);
  });
});
