import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { createApp } from "@aih/example-04-http-api/src/app.ts";
import { errorSchema, noteListSchema, type Note } from "@aih/example-04-http-api/src/contract.ts";
import { createNoteService, NoteLimitError } from "@aih/example-04-http-api/src/notes.ts";

import { parseNotesDir } from "../src/compose.ts";
import { type DirOps, DirectoryNoteRepository, layout } from "../src/note-files.ts";

const ROOT = "/mnt/notes";
const paths = layout(ROOT);

type Step = "write" | "rename" | "sync";

/** A file system in memory, shared by every repository opened on it, that can fail at a chosen step. */
function share(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  let failAt: Step | undefined;
  let tokens = 0;
  const fail = (step: Step): void => {
    if (failAt === step) {
      failAt = undefined;
      throw new Error(`connection lost during ${step}`);
    }
  };
  const ops: DirOps = {
    read: async (path) => files.get(path),
    async writeDurably(path, content) {
      if (failAt === "write") {
        // Half the bytes arrived before the writer died.
        files.set(path, content.slice(0, Math.floor(content.length / 2)));
      }
      fail("write");
      files.set(path, content);
    },
    async rename(from, to) {
      fail("rename");
      files.set(to, files.get(from) ?? "");
      files.delete(from);
    },
    async syncDirectory() {
      fail("sync");
    },
    async ensureDirectory() {},
    list: async (directory) =>
      [...files.keys()]
        .filter((path) => path.startsWith(`${directory}/`))
        .map((path) => path.slice(directory.length + 1)),
    remove: async (path) => files.delete(path),
  };
  return {
    ops,
    files,
    failNext: (step: Step) => void (failAt = step),
    /** Another process, or another execution environment, with the same directory mounted. */
    mount: (maxNotes?: number) =>
      DirectoryNoteRepository.open(ops, ROOT, {
        newToken: () => `t${(tokens += 1)}`,
        ...(maxNotes === undefined ? {} : { maxNotes }),
      }),
  };
}

const note = (id: string, title = id): Note => ({
  id,
  title,
  body: "",
  createdAt: `2026-10-13T00:00:0${id.length}.000Z`,
});
const ids = async (repository: DirectoryNoteRepository) =>
  (await repository.list()).map((item) => item.id).toSorted();

describe("DirectoryNoteRepository", () => {
  it("lets every process that mounts the directory read what another wrote", async () => {
    const s = share();
    const [first, second] = [await s.mount(), await s.mount()];
    await first.put(note("a"));
    await second.put(note("bb"));
    await first.delete("a");

    expect(await ids(second)).toEqual(["bb"]);
    expect(await second.get("a")).toBeUndefined();
    expect(await ids(await s.mount())).toEqual(["bb"]);
  });

  // The invariant of the chapter, attacked at each step of one write.
  it.each<[Step, string]>([
    ["write", "old"],
    ["rename", "old"],
    // The rename happened and the caller was told it failed: the new note is there, whole.
    ["sync", "new"],
  ])("writer lost during %s: a reader sees a whole note, the %s one", async (step, expected) => {
    const s = share();
    const [writer, reader] = [await s.mount(), await s.mount()];
    await writer.put(note("a", "old"));

    s.failNext(step);
    await expect(writer.put(note("a", "new"))).rejects.toThrow(`connection lost during ${step}`);

    expect((await reader.get("a"))?.title).toBe(expected);
    expect((await reader.list()).map((item) => item.title)).toEqual([expected]);
  });

  it("leaves no half-written file behind where a reader would find it", async () => {
    const s = share();
    const writer = await s.mount();
    s.failNext("write");
    await expect(writer.put(note("a"))).rejects.toThrow();

    expect(await ids(writer)).toEqual([]);
    expect([...s.files.keys()]).toEqual([]);
  });

  it("ignores what a crashed writer left in incoming/", async () => {
    // The writer died before it could clean up: the process was killed, not the call.
    const s = share({ [paths.temp("a", "dead")]: '{"id":"a","title":"to' });
    const reader = await s.mount();
    expect(await ids(reader)).toEqual([]);
    expect(await reader.get("a")).toBeUndefined();
  });

  it("gives two writers of the same note different temporary files", async () => {
    const s = share();
    const written: string[] = [];
    const writeDurably = s.ops.writeDurably;
    s.ops.writeDurably = (path, content) => {
      written.push(path);
      return writeDurably(path, content);
    };
    const [first, second] = [await s.mount(), await s.mount()];
    await Promise.all([first.put(note("a", "one")), second.put(note("a", "two"))]);

    expect(new Set(written).size).toBe(2);
    expect(["one", "two"]).toContain((await first.get("a"))?.title);
  });

  it("refuses to hide a file that is not a whole note", async () => {
    const s = share({ [`${paths.notes}/a.json`]: '{"id":"a","title":"to' });
    const reader = await s.mount();
    await expect(reader.get("a")).rejects.toThrow("is not a whole note");
    await expect(reader.list()).rejects.toThrow("is not a whole note");
  });

  it("skips a note that another process deleted between the listing and the read", async () => {
    const s = share();
    const repository = await s.mount();
    await repository.put(note("a"));
    await repository.put(note("bb"));
    const read = s.ops.read;
    s.ops.read = async (path) => {
      s.files.delete(`${paths.notes}/a.json`);
      return read(path);
    };
    expect(await ids(repository)).toEqual(["bb"]);
  });

  it.each(["../secret", "a/b", "..", "", "a.json", "a\0", "x".repeat(65)])(
    "never turns the ID %j into a path",
    async (id) => {
      const s = share({ [`${ROOT}/secret.json`]: JSON.stringify(note("secret")) });
      const repository = await s.mount();
      expect(paths.note(id)).toBeUndefined();
      expect(await repository.get(id)).toBeUndefined();
      expect(await repository.delete(id)).toBe(false);
      await expect(repository.put({ ...note("a"), id })).rejects.toThrow("cannot be used");
      expect([...s.files.keys()]).toEqual([`${ROOT}/secret.json`]);
    },
  );

  it("stops accepting new notes at the limit, and still replaces an existing one", async () => {
    const s = share();
    const repository = await s.mount(2);
    await repository.put(note("a"));
    await repository.put(note("bb"));

    await expect(repository.put(note("ccc"))).rejects.toBeInstanceOf(NoteLimitError);
    await repository.put(note("a", "again"));
    expect((await repository.get("a"))?.title).toBe("again");
  });
});

describe("the chapter 04 API on top of the directory", () => {
  // One clock for every instance, as wall time is: a later request gets a later timestamp.
  let seconds = 0;
  async function api(s: ReturnType<typeof share>, maxNotes?: number) {
    return createApp({
      env: { ALLOWED_ORIGIN: "http://localhost:5173", LOG_LEVEL: "error", STAGE: "test" },
      notes: createNoteService({
        repository: await s.mount(maxNotes),
        now: () => new Date(Date.UTC(2026, 9, 13, 0, 0, (seconds += 1))),
        newId: () => `note-${crypto.randomUUID()}`,
      }),
      log: () => undefined,
      newRequestId: () => "req",
      now: () => 0,
    });
  }
  type Api = Awaited<ReturnType<typeof api>>;
  const create = (app: Api, title: string) =>
    app(
      new Request("http://api.test/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      }),
    );
  const titles = async (app: Api) =>
    v
      .parse(noteListSchema, await (await app(new Request("http://api.test/notes"))).json())
      .notes.map((item) => item.title);

  it("shows a note created through one function instance to another at once", async () => {
    const s = share();
    const [one, two] = [await api(s), await api(s)];
    expect((await create(one, "from one")).status).toBe(201);
    expect((await create(two, "from two")).status).toBe(201);

    expect(await titles(one)).toEqual(["from two", "from one"]);
    expect(await titles(two)).toEqual(["from two", "from one"]);
  });

  it("answers 201 only for notes that the other instance can read", async () => {
    const s = share();
    const [one, two] = [await api(s), await api(s)];
    s.failNext("rename");
    expect((await create(one, "lost")).status).toBe(500);
    expect(await titles(two)).toEqual([]);
  });

  it("answers 404, not a file, for an ID that climbs out of the directory", async () => {
    const s = share({ [`${ROOT}/secret.json`]: JSON.stringify(note("secret")) });
    const app = await api(s);
    for (const method of ["GET", "DELETE"]) {
      const response = await app(new Request("http://api.test/notes/..%2Fsecret", { method }));
      expect(response.status).toBe(404);
    }
    expect(s.files.has(`${ROOT}/secret.json`)).toBe(true);
  });

  it("answers 409 when the directory is full", async () => {
    const app = await api(share(), 1);
    await create(app, "first");
    const response = await create(app, "second");
    expect(response.status).toBe(409);
    expect(v.parse(errorSchema, await response.json()).error.code).toBe("quota_exceeded");
  });
});

describe("parseNotesDir", () => {
  it("takes an absolute path and drops a trailing slash", () => {
    expect(parseNotesDir({ NOTES_DIR: "/mnt/notes/" })).toBe("/mnt/notes");
  });

  it.each([undefined, "", "notes", "./notes"])("refuses %j", (value) => {
    expect(() => parseNotesDir({ NOTES_DIR: value })).toThrow("NOTES_DIR");
  });
});
