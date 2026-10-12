import { afterEach, describe, expect, it } from "vite-plus/test";

import { errorSchema, noteListSchema, noteSchema } from "@aih/example-04-http-api/src/contract.ts";

import { formats, type RecordFormat, SharedRecords } from "../src/compat.ts";
import { composeServer } from "../src/compose.ts";
import { type RunningServer, startServer } from "../src/serve.ts";

const running: RunningServer[] = [];
afterEach(
  async () => void (await Promise.all(running.splice(0).map((server) => server.shutdown()))),
);

/** One task: a real HTTP server running one build, on the records every task shares. */
async function task(records: SharedRecords, version: string, format: RecordFormat) {
  const { fetch: handle } = composeServer(
    { ALLOWED_ORIGIN: "http://localhost:5173", LOG_LEVEL: "error", APP_VERSION: version },
    records.repository(format),
  );
  const server = await startServer({
    fetch: handle,
    port: 0,
    keepAliveTimeoutMs: 1_000,
    maxConnections: 16,
    shutdownDeadlineMs: 1_000,
  });
  running.push(server);
  const url = `http://127.0.0.1:${server.port}`;
  return {
    server,
    get: (path: string) => fetch(`${url}${path}`),
    create: (title: string) =>
      fetch(`${url}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      }),
  };
}

// #region rollout
describe("two versions on the same records, as during a rolling update", () => {
  it("lets each version read what the other wrote", async () => {
    const records = new SharedRecords();
    const v1 = await task(records, "v1", formats.v1);
    const v2 = await task(records, "v2", formats.v2);

    // The load balancer alternates between the old task and the new one.
    const old = noteSchema.parse(await (await v1.create("written by v1")).json());
    const fresh = noteSchema.parse(await (await v2.create("written by v2")).json());

    const seenByV1 = await v1.get("/notes");
    const seenByV2 = await v2.get("/notes");
    expect([seenByV1.status, seenByV1.headers.get("x-app-version")]).toEqual([200, "v1"]);
    expect([seenByV2.status, seenByV2.headers.get("x-app-version")]).toEqual([200, "v2"]);
    const titles = ["written by v2", "written by v1"];
    expect(
      noteListSchema
        .parse(await seenByV1.json())
        .notes.map((note) => note.title)
        .toSorted(),
    ).toEqual(titles.toSorted());
    // A list carries summaries, so the new field shows where v2 returns the whole note.
    expect(await (await v2.get(`/notes/${old.id}`)).json()).toEqual({ ...old, pinned: false });

    // What v2 stored has the new field; what v1 stored does not, and v2 filled it in on read.
    expect(records.raw(fresh.id)).toMatchObject({ pinned: false });
    expect(records.raw(old.id)).not.toHaveProperty("pinned");
  });

  it("survives a rollback: the old version reads what the new one left behind", async () => {
    const records = new SharedRecords();
    const v1 = await task(records, "v1", formats.v1);
    const v2 = await task(records, "v2", formats.v2);
    await v2.create("written by v2 before the rollback");

    // The circuit breaker gives up on v2 and stops its task. v1 is all that is left.
    await v2.server.shutdown();

    const list = await v1.get("/notes");
    expect(list.status).toBe(200);
    expect(noteListSchema.parse(await list.json()).notes).toHaveLength(1);
  });

  it("breaks when the new version requires a field the old one never wrote", async () => {
    const records = new SharedRecords();
    const v1 = await task(records, "v1", formats.v1);
    const v2 = await task(records, "v2", formats.v2Required);
    await v1.create("written by v1");

    // The health check sees nothing wrong, so neither the load balancer nor the circuit breaker steps in.
    expect((await v2.get("/health")).status).toBe(200);

    const list = await v2.get("/notes");
    expect(list.status).toBe(500);
    expect(errorSchema.parse(await list.json()).error.code).toBe("internal");
    // Half of the requests fail: the ones that reach the new task.
    expect((await v1.get("/notes")).status).toBe(200);
  });

  it("breaks when the old version rejects a field it does not know, and a rollback does not help", async () => {
    const records = new SharedRecords();
    const v1 = await task(records, "v1", formats.v1Strict);
    const v2 = await task(records, "v2", formats.v2);
    await v2.create("written by v2");

    expect((await v1.get("/notes")).status).toBe(500);

    // Rolling back removes the new code. The record it wrote stays.
    await v2.server.shutdown();
    expect((await v1.get("/notes")).status).toBe(500);
  });
});
// #endregion rollout
