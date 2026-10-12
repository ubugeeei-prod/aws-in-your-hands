import { describe, expect, it } from "vite-plus/test";

import { createApp } from "@aih/example-04-http-api/src/app.ts";
import {
  MAX_LISTED_NOTES,
  noteListSchema,
  type Note,
} from "@aih/example-04-http-api/src/contract.ts";
import { createNoteService } from "@aih/example-04-http-api/src/notes.ts";

import { type FileOps, FileNoteRepository } from "../src/file-notes.ts";

const PATH = "/var/lib/notes/notes.json";

type Step = "write" | "rename" | "sync";

/** A disk in memory that can lose power at a chosen step of the next replacement. */
function disk(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  let failAt: Step | undefined;
  let writing = 0;
  let mostAtOnce = 0;
  const lose = (step: Step): void => {
    if (failAt === step) {
      failAt = undefined;
      throw new Error(`power lost during ${step}`);
    }
  };
  const ops: FileOps = {
    read: async (path) => files.get(path),
    async writeDurably(path, content) {
      writing += 1;
      mostAtOnce = Math.max(mostAtOnce, writing);
      await Promise.resolve();
      writing -= 1;
      if (failAt === "write") {
        // Half the bytes made it. This is what a torn write looks like.
        files.set(path, content.slice(0, Math.floor(content.length / 2)));
      }
      lose("write");
      files.set(path, content);
    },
    async rename(from, to) {
      lose("rename");
      files.set(to, files.get(from) ?? "");
      files.delete(from);
    },
    async syncDirectory() {
      lose("sync");
    },
  };
  return {
    ops,
    files,
    failNext: (step: Step) => void (failAt = step),
    mostAtOnce: () => mostAtOnce,
    /** A new process over the same disk: what a restart, or a new instance with the old volume, sees. */
    restart: () => FileNoteRepository.open(ops, PATH),
  };
}

const note = (id: string): Note => ({
  id,
  title: id,
  body: "",
  createdAt: `2026-10-12T00:00:0${id.length}.000Z`,
});
const ids = async (repository: FileNoteRepository) =>
  (await repository.list()).map((item) => item.id).toSorted();

describe("FileNoteRepository", () => {
  it("lets a restarted process read every note that was acknowledged", async () => {
    const d = disk();
    const first = await d.restart();
    await first.put(note("a"));
    await first.put(note("bb"));
    await first.delete("a");

    expect(await ids(await d.restart())).toEqual(["bb"]);
  });

  // The invariant of the chapter, attacked at each step of one write.
  it.each<[Step, string[]]>([
    ["write", ["a"]],
    ["rename", ["a"]],
    // The rename happened, the caller was told it failed: the note exists without an acknowledgement.
    ["sync", ["a", "bb"]],
  ])("power lost during %s: the file is whole, and memory agrees with it", async (step, onDisk) => {
    const d = disk();
    const repository = await d.restart();
    await repository.put(note("a"));

    d.failNext(step);
    await expect(repository.put(note("bb"))).rejects.toThrow(`power lost during ${step}`);

    expect(await ids(await d.restart())).toEqual(onDisk);
    expect(await ids(repository)).toEqual(onDisk);
    // The next write is not poisoned by the failed one.
    await repository.put(note("ccc"));
    expect(await ids(await d.restart())).toEqual([...onDisk, "ccc"].toSorted());
  });

  it("ignores a half-written file left behind by a crash", async () => {
    const d = disk({ [`${PATH}.next`]: '{"version":1,"notes":[{"id":"torn' });
    const repository = await d.restart();
    expect(await ids(repository)).toEqual([]);
    await repository.put(note("a"));
    expect(await ids(await d.restart())).toEqual(["a"]);
  });

  it.each([
    ["not JSON", "{{{"],
    ["another shape", '{"notes":"none"}'],
    ["a note that breaks the contract", '{"version":1,"notes":[{"id":"","title":"x"}]}'],
  ])("refuses to start over a file that is %s, and leaves it untouched", async (_, content) => {
    const d = disk({ [PATH]: content });
    await expect(d.restart()).rejects.toThrow("refusing to start over it");
    expect(d.files.get(PATH)).toBe(content);
  });

  it("writes one at a time and loses none when ten requests arrive together", async () => {
    const d = disk();
    const repository = await d.restart();
    await Promise.all(Array.from({ length: 10 }, (_, index) => repository.put(note(`n${index}`))));

    expect(d.mostAtOnce()).toBe(1);
    expect(await ids(await d.restart())).toHaveLength(10);
  });

  it("holds a shutdown until the accepted writes are on disk", async () => {
    const d = disk();
    const repository = await d.restart();
    const pending = repository.put(note("a"));
    await repository.idle();

    expect(JSON.parse(d.files.get(PATH) ?? "null")).toMatchObject({ notes: [{ id: "a" }] });
    await pending;
  });
});

describe("the chapter 04 API on top of the file", () => {
  async function api(d: ReturnType<typeof disk>) {
    let id = 0;
    return createApp({
      env: { ALLOWED_ORIGIN: "http://localhost:5173", LOG_LEVEL: "error", STAGE: "test" },
      notes: createNoteService({
        repository: await d.restart(),
        now: () => new Date(Date.UTC(2026, 9, 12, 0, 0, (id += 1))),
        newId: () => `note-${id}`,
      }),
      log: () => undefined,
      newRequestId: () => "req",
      now: () => 0,
    });
  }
  const create = (app: Awaited<ReturnType<typeof api>>, title: string) =>
    app.request("/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
  const titles = async (app: Awaited<ReturnType<typeof api>>) =>
    noteListSchema
      .parse(await (await app.request("/notes")).json())
      .notes.map((item) => item.title);

  it("lists what chapter 04 lists: the newest 20, without their bodies", async () => {
    const app = await api(disk());
    for (let count = 0; count <= MAX_LISTED_NOTES; count++) {
      await create(app, `note ${count}`);
    }
    const text = await (await app.request("/notes")).text();
    // Strict: a body or a 21st note would fail the parse.
    expect(noteListSchema.parse(JSON.parse(text)).notes).toHaveLength(MAX_LISTED_NOTES);
    expect(text).not.toContain('"body"');
  });

  it("answers 201 only for notes that survive a restart", async () => {
    const d = disk();
    const before = await api(d);
    expect((await create(before, "kept")).status).toBe(201);

    d.failNext("rename");
    expect((await create(before, "lost")).status).toBe(500);

    expect(await titles(await api(d))).toEqual(["kept"]);
  });
});
