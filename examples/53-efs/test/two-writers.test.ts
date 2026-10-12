// Every test here uses real files in a temporary directory on this machine's file system.
// Two "writers" are two open files, or two repositories, in one process: the kernel treats
// them as it would two processes. What a local file system does not share with NFS is
// written next to the test that depends on it.

import { randomUUID } from "node:crypto";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { Note } from "@aih/example-04-http-api/src/contract.ts";
import {
  type FileOps,
  FileNoteRepository,
  replaceFile,
} from "@aih/example-23-ec2/src/file-notes.ts";
import { nodeFiles } from "@aih/example-23-ec2/src/node-files.ts";

import { nodeDir } from "../src/node-dir.ts";
import { type DirOps, DirectoryNoteRepository, layout } from "../src/note-files.ts";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aih-efs-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const note = (id: string, title = id, body = ""): Note => ({
  id,
  title,
  body,
  createdAt: "2026-10-13T00:00:00.000Z",
});
const serialized = (value: Note): string => `${JSON.stringify(value)}\n`;
const mount = (ops: DirOps = nodeDir) =>
  DirectoryNoteRepository.open(ops, root, { newToken: randomUUID, maxNotes: 1000 });

/** A gate a test opens when it wants the paused writer to go on. */
function gate() {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => (open = resolve));
  let arrive = (): void => undefined;
  const arrived = new Promise<void>((resolve) => (arrive = resolve));
  return { open, arrived, wait: () => (arrive(), opened) };
}

// #region torn
describe("writing a note file in place", () => {
  it("shows a reader half a note between two writes", async () => {
    const path = join(root, "a.json");
    const old = serialized(note("a", "old", "x".repeat(2000)));
    const next = serialized(note("a", "new", "y".repeat(2000)));
    await writeFile(path, old);

    // What `writeFile(path, next)` does, one step at a time: truncate, then write in pieces.
    const writer = await open(path, "w");
    expect(await readFile(path, "utf8")).toBe("");
    await writer.write(next.slice(0, 1000));

    const seen = await readFile(path, "utf8");
    expect(seen).toBe(next.slice(0, 1000));
    expect(() => JSON.parse(seen)).toThrow();

    await writer.write(next.slice(1000));
    await writer.close();
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ title: "new" });
  });
});
// #endregion torn

// #region whole
describe("writing beside the note and renaming into place", () => {
  it("shows a reader the old note or the new one at every step, never a mixture", async () => {
    const reader = await mount();
    await (await mount()).put(note("a", "old"));

    // Before each step the writer takes, a second repository reads the note.
    const seen: (string | undefined)[] = [];
    const look = async () => void seen.push((await reader.get("a"))?.title);
    const watched: DirOps = {
      ...nodeDir,
      writeDurably: async (path, content) => (await look(), nodeDir.writeDurably(path, content)),
      rename: async (from, to) => (await look(), nodeDir.rename(from, to)),
      syncDirectory: async (path) => (await look(), nodeDir.syncDirectory(path)),
    };
    await (await mount(watched)).put(note("a", "new"));
    await look();

    expect(seen).toEqual(["old", "old", "new", "new"]);
  });

  it("keeps one whole note when two writers replace the same note at once", async () => {
    const first = note("a", "one", "1".repeat(5000));
    const second = note("a", "two", "2".repeat(9000));
    // Writer one has written its temporary file and stops just before the rename.
    const paused = gate();
    const slow: DirOps = {
      ...nodeDir,
      rename: async (from, to) => (await paused.wait(), nodeDir.rename(from, to)),
    };
    const one = (await mount(slow)).put(first);
    await paused.arrived;

    await (await mount()).put(second);
    expect(await (await mount()).get("a")).toEqual(second);

    paused.open();
    await one;
    // Last rename wins. The loser's note is gone as a whole, not mixed in.
    expect(await (await mount()).get("a")).toEqual(first);
    expect(await nodeDir.list(layout(root).incoming)).toEqual([]);
  });

  it("holds under real concurrency: eight writers, one reader, no partial file ever seen", async () => {
    const reader = await mount();
    let writing = true;
    let reads = 0;
    const reading = (async () => {
      while (writing) {
        // Throws if any file in notes/ is not a whole note.
        await reader.list();
        await reader.get("shared");
        reads += 1;
      }
    })();

    await Promise.all(
      Array.from({ length: 8 }, async (_, writer) => {
        const repository = await mount();
        for (let count = 0; count < 20; count++) {
          await repository.put(note(`w${writer}-${count}`, "own", "o".repeat(3000)));
          await repository.put(note("shared", `w${writer}`, String(writer).repeat(3000 + writer)));
        }
      }),
    );
    writing = false;
    await reading;

    expect(reads).toBeGreaterThan(0);
    expect(await reader.list()).toHaveLength(8 * 20 + 1);
    const shared = await reader.get("shared");
    expect(shared?.body).toBe(shared?.title.slice(1).repeat(shared.body.length));
  });
});
// #endregion whole

// #region chapter-23
describe("chapter 23's repository, mounted by two processes", () => {
  it("loses an acknowledged note: each process overwrites the file with its own memory", async () => {
    const path = join(root, "notes.json");
    const one = await FileNoteRepository.open(nodeFiles, path);
    const two = await FileNoteRepository.open(nodeFiles, path);

    await one.put(note("a"));
    await two.put(note("b"));

    const restarted = await FileNoteRepository.open(nodeFiles, path);
    expect((await restarted.list()).map((item) => item.id)).toEqual(["b"]);
    // Neither file was ever torn. The rename did its job; the design assumed one writer.
    expect((await one.list()).map((item) => item.id)).toEqual(["a"]);
  });

  it("lets one writer rename the other's file: both write to the same `.next`", async () => {
    const path = join(root, "notes.json");
    const paused = gate();
    const slow: FileOps = {
      ...nodeFiles,
      rename: async (from, to) => (await paused.wait(), nodeFiles.rename(from, to)),
    };
    const one = replaceFile(slow, path, "written by one\n");
    await paused.arrived;

    // Two writes its own content over one's temporary file, and is itself about to rename.
    await nodeFiles.writeDurably(`${path}.next`, "written by two\n");
    paused.open();
    await one;

    // One was told "saved". The file holds what two wrote.
    expect(await readFile(path, "utf8")).toBe("written by two\n");
    await expect(nodeFiles.rename(`${path}.next`, path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
// #endregion chapter-23

// #region append
describe("appending lines to one file from two writers", () => {
  it("keeps every line on this machine, where the kernel moves to the end and writes in one step", async () => {
    const path = join(root, "log.ndjson");
    const [one, two] = [await open(path, "a"), await open(path, "a")];
    for (let count = 0; count < 50; count++) {
      await Promise.all([
        one.write(`${JSON.stringify({ writer: 1, count })}\n`),
        two.write(`${JSON.stringify({ writer: 2, count })}\n`),
      ]);
    }
    await Promise.all([one.close(), two.close()]);

    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(100);
    expect(() => lines.map((line) => JSON.parse(line))).not.toThrow();
  });

  // A model, not NFS. open(2) says appending from several processes may corrupt a file on NFS,
  // because the client has to simulate the append. This is one way a simulation can race:
  // each client asks for the size, then writes at that offset.
  it("tears a line when each writer finds the end for itself and then writes there", async () => {
    const path = join(root, "log.ndjson");
    await writeFile(path, "");
    const [one, two] = [await open(path, "r+"), await open(path, "r+")];
    const long = `${JSON.stringify({ writer: 1, text: "a long line" })}\n`;
    const short = `${JSON.stringify({ w: 2 })}\n`;

    const endForOne = (await one.stat()).size;
    const endForTwo = (await two.stat()).size;
    await one.write(long, endForOne);
    await two.write(short, endForTwo);
    await Promise.all([one.close(), two.close()]);

    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    // Two appends were acknowledged. One whole line survives, followed by the tail of the other.
    expect(lines[0]).toBe(short.trimEnd());
    expect(lines).toHaveLength(2);
    expect(() => JSON.parse(lines[1] ?? "")).toThrow();
  });

  it("needs no append at all with one file per writer", async () => {
    const lines = (writer: number) =>
      Array.from({ length: 50 }, (_, count) => `${JSON.stringify({ writer, count })}\n`);
    await Promise.all(
      [1, 2].map(async (writer) => {
        const file = await open(join(root, `log.${writer}.ndjson`), "a");
        for (const line of lines(writer)) {
          await file.write(line);
        }
        await file.close();
      }),
    );
    for (const writer of [1, 2]) {
      expect(await readFile(join(root, `log.${writer}.ndjson`), "utf8")).toBe(
        lines(writer).join(""),
      );
    }
  });
});
// #endregion append
