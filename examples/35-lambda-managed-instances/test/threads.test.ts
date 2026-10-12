import { once } from "node:events";
import { Worker } from "node:worker_threads";

import { afterAll, describe, expect, it } from "vite-plus/test";

type Answer = { status: number; body: { notes?: { title: string }[] } };

const start = () => new Worker(new URL("./fixtures/thread.ts", import.meta.url));

async function ask(worker: Worker, method: string, path: string, body?: string): Promise<Answer> {
  const answered = once(worker, "message");
  worker.postMessage({ method, path, body });
  const [answer] = (await answered) as [Answer];
  return answer;
}

// Node.js runs the function's initialization once per worker thread on Managed Instances.
// These are plain worker_threads on this machine, not Lambda's runtime.
describe("a Map in module scope, loaded by two worker threads", () => {
  const first = start();
  const second = start();
  afterAll(async () => {
    await Promise.all([first.terminate(), second.terminate()]);
  });

  it("is two Maps: a note written through one thread is not in the other", async () => {
    const created = await ask(first, "POST", "/notes", JSON.stringify({ title: "only here" }));
    expect(created.status).toBe(201);

    const here = await ask(first, "GET", "/notes");
    const there = await ask(second, "GET", "/notes");
    expect(here.body.notes?.map((note) => note.title)).toEqual(["only here"]);
    expect(there.body.notes).toEqual([]);
  });
});
