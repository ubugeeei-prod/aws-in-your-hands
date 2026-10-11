import { describe, expect, it } from "vite-plus/test";
import type { Note } from "../src/contract.ts";
import { InvalidCursorError, type NoteRepository } from "../src/repository.ts";

const note = (id: string, overrides: Partial<Note> = {}): Note => ({
  id,
  title: `note ${id}`,
  body: "",
  version: 1,
  createdAt: "2026-10-11T00:00:00.000Z",
  updatedAt: "2026-10-11T00:00:00.000Z",
  ...overrides,
});

const change = (expectedVersion: number, title = "changed") => ({
  title,
  body: "new body",
  expectedVersion,
  updatedAt: "2026-10-11T01:00:00.000Z",
});

/**
 * The rules every NoteRepository must follow, written once and run against
 * each implementation. `fresh` returns an empty repository and an owner name
 * no other test uses.
 */
export function describeRepositoryContract(
  name: string,
  fresh: () => Promise<{ repository: NoteRepository; owner: string }>,
) {
  describe(`NoteRepository contract: ${name}`, () => {
    it("stores a note and reads it back unchanged", async () => {
      const { repository, owner } = await fresh();
      expect(await repository.create(owner, note("a1"))).toBe("created");
      expect(await repository.get(owner, "a1")).toEqual(note("a1"));
    });

    it("never overwrites an existing note on create", async () => {
      const { repository, owner } = await fresh();
      await repository.create(owner, note("a1", { title: "original" }));
      expect(await repository.create(owner, note("a1", { title: "intruder" }))).toBe("already_exists");
      expect((await repository.get(owner, "a1"))?.title).toBe("original");
    });

    it("moves the version by exactly one on a successful update", async () => {
      const { repository, owner } = await fresh();
      await repository.create(owner, note("a1"));
      const result = await repository.update(owner, "a1", change(1));
      expect(result).toMatchObject({ status: "updated", note: { version: 2, title: "changed", body: "new body" } });
      expect(await repository.get(owner, "a1")).toMatchObject({ version: 2, createdAt: "2026-10-11T00:00:00.000Z" });
    });

    it("refuses an update based on a stale version and leaves the note as it was", async () => {
      const { repository, owner } = await fresh();
      await repository.create(owner, note("a1"));
      await repository.update(owner, "a1", change(1, "first writer"));

      const stale = await repository.update(owner, "a1", change(1, "second writer"));
      expect(stale).toMatchObject({ status: "conflict", current: { version: 2, title: "first writer" } });
      expect(await repository.get(owner, "a1")).toMatchObject({ version: 2, title: "first writer" });
    });

    it("lets exactly one of two writers holding the same version win", async () => {
      const { repository, owner } = await fresh();
      await repository.create(owner, note("a1"));
      const results = await Promise.all([
        repository.update(owner, "a1", change(1, "writer A")),
        repository.update(owner, "a1", change(1, "writer B")),
      ]);
      expect(results.map((result) => result.status).toSorted()).toEqual(["conflict", "updated"]);
      expect((await repository.get(owner, "a1"))?.version).toBe(2);
    });

    it("reports a missing note as not found, not as a conflict", async () => {
      const { repository, owner } = await fresh();
      expect(await repository.update(owner, "nope", change(1))).toEqual({ status: "not_found" });
    });

    it("lists newest first and pages through every note exactly once", async () => {
      const { repository, owner } = await fresh();
      for (const id of ["a1", "a2", "a3", "a4", "a5"]) {
        await repository.create(owner, note(id));
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await repository.list(owner, { limit: 2, cursor });
        seen.push(...result.notes.map((item) => item.id));
        if (result.nextCursor === null) {
          break;
        }
        cursor = result.nextCursor;
      }
      expect(seen).toEqual(["a5", "a4", "a3", "a2", "a1"]);
    });

    it("keeps one owner's notes out of another owner's list and reads", async () => {
      const { repository, owner } = await fresh();
      await repository.create(owner, note("a1"));
      expect(await repository.get(`${owner}-other`, "a1")).toBeUndefined();
      expect((await repository.list(`${owner}-other`, { limit: 10 })).notes).toEqual([]);
    });

    it("rejects a cursor it did not issue", async () => {
      const { repository, owner } = await fresh();
      await expect(repository.list(owner, { limit: 2, cursor: "not a cursor!" })).rejects.toBeInstanceOf(
        InvalidCursorError,
      );
    });

    it("deletes once; a second delete reports nothing to delete", async () => {
      const { repository, owner } = await fresh();
      await repository.create(owner, note("a1"));
      expect(await repository.delete(owner, "a1")).toBe(true);
      expect(await repository.delete(owner, "a1")).toBe(false);
    });
  });
}
