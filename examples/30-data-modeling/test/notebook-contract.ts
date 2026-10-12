import { describe, expect, it } from "vite-plus/test";

import { createNotebook } from "../src/notebook.ts";
import { InvalidPageTokenError } from "../src/page-token.ts";
import type { Table } from "../src/table.ts";
import { at, attachment, change, eventually, freshOwner, note } from "./support.ts";

export function describeNotebookContract(name: string, open: () => Promise<Table>) {
  const setup = async (maxNotes?: number) => {
    const table = await open();
    return {
      table,
      owner: freshOwner(),
      notebook: createNotebook({ table, ...(maxNotes === undefined ? {} : { maxNotes }) }),
    };
  };

  describe(`Notebook contract: ${name}`, () => {
    describe("a note and what belongs to it", () => {
      it("come back together, the attachments oldest first", async () => {
        const { notebook, owner } = await setup();
        await notebook.create(owner, note("n1", { body: "text", tags: ["trip"] }));
        await notebook.attach(owner, attachment("n1", "a2"));
        await notebook.attach(owner, attachment("n1", "a1"));

        const found = await notebook.getWithAttachments(owner, "n1");
        expect(found?.note).toMatchObject({ id: "n1", body: "text", tags: ["trip"] });
        expect(found?.attachments.map((item) => item.id)).toEqual(["a1", "a2"]);
      });

      it("do not include a note whose ID merely starts the same way", async () => {
        const { notebook, owner } = await setup();
        await notebook.create(owner, note("n1"));
        await notebook.create(owner, note("n1x"));
        await notebook.attach(owner, attachment("n1x", "a1"));

        expect((await notebook.getWithAttachments(owner, "n1"))?.attachments).toEqual([]);
        expect(await notebook.getWithAttachments(owner, "n")).toBeUndefined();
      });

      it("are separate for each owner", async () => {
        const { notebook, owner } = await setup();
        await notebook.create(owner, note("n1"));
        expect(await notebook.getWithAttachments(freshOwner(), "n1")).toBeUndefined();
      });
    });

    describe("create", () => {
      it("never replaces a note", async () => {
        const { notebook, owner } = await setup();
        expect(await notebook.create(owner, note("n1", { title: "first" }))).toBe("created");
        expect(await notebook.create(owner, note("n1", { title: "second" }))).toBe(
          "already_exists",
        );
        expect((await notebook.getWithAttachments(owner, "n1"))?.note.title).toBe("first");
        expect(await notebook.count(owner)).toBe(1);
      });

      it("leaves nothing behind when the slug is taken", async () => {
        const { notebook, owner } = await setup();
        await notebook.create(owner, note("n1", { slug: "plans" }));
        expect(await notebook.create(owner, note("n2", { slug: "plans", tags: ["trip"] }))).toBe(
          "slug_taken",
        );
        // Not the note, not its tag, not a place in the count.
        expect(await notebook.getWithAttachments(owner, "n2")).toBeUndefined();
        expect((await notebook.listByTag(owner, "trip", { limit: 10 })).entries).toEqual([]);
        expect(await notebook.count(owner)).toBe(1);
        expect((await notebook.findBySlug(owner, "plans"))?.id).toBe("n1");
      });

      it("lets two owners use the same slug", async () => {
        const { notebook, owner } = await setup();
        expect(await notebook.create(owner, note("n1", { slug: "plans" }))).toBe("created");
        expect(await notebook.create(freshOwner(), note("n1", { slug: "plans" }))).toBe("created");
      });

      it("gives one of two simultaneous creates the slug", async () => {
        const { notebook, owner } = await setup();
        const results = await Promise.all([
          notebook.create(owner, note("n1", { slug: "plans" })),
          notebook.create(owner, note("n2", { slug: "plans" })),
        ]);
        expect(results.toSorted()).toEqual(["created", "slug_taken"]);
        expect(await notebook.count(owner)).toBe(1);
      });

      it("stops at the owner's limit, and the count is exact", async () => {
        const { notebook, owner } = await setup(3);
        const results: string[] = [];
        // One after another: simultaneous transactions on one counter cancel each other.
        for (const id of ["n1", "n2", "n3", "n4", "n5"]) {
          results.push(await notebook.create(owner, note(id)));
        }
        expect(results).toEqual([
          "created",
          "created",
          "created",
          "quota_exceeded",
          "quota_exceeded",
        ]);
        expect(await notebook.count(owner)).toBe(3);
        expect(await notebook.getWithAttachments(owner, "n4")).toBeUndefined();
      });
    });

    describe("update", () => {
      it("moves the version by one and refuses a stale one with what is stored", async () => {
        const { notebook, owner } = await setup();
        await notebook.create(owner, note("n1"));
        const first = await notebook.update(owner, "n1", change(1, { title: "A" }));
        expect(first).toMatchObject({ status: "updated", note: { version: 2, title: "A" } });
        const second = await notebook.update(owner, "n1", change(1, { title: "B" }));
        expect(second).toMatchObject({ status: "conflict", current: { version: 2, title: "A" } });
        expect(await notebook.update(owner, "missing", change(1))).toEqual({ status: "not_found" });
      });

      it("lets exactly one of two simultaneous updates through", async () => {
        const { notebook, owner } = await setup();
        await notebook.create(owner, note("n1", { tags: ["trip"] }));
        const results = await Promise.all([
          notebook.update(owner, "n1", change(1, { title: "A", tags: ["trip", "a"] })),
          notebook.update(owner, "n1", change(1, { title: "B", tags: ["trip", "b"] })),
        ]);
        expect(results.map((result) => result.status).toSorted()).toEqual(["conflict", "updated"]);
        const stored = (await notebook.getWithAttachments(owner, "n1"))?.note;
        expect(stored?.version).toBe(2);
        // The loser's tag was not written either.
        const loser = stored?.title === "A" ? "b" : "a";
        expect((await notebook.listByTag(owner, loser, { limit: 10 })).entries).toEqual([]);
      });

      it("keeps the tag lists in step with the note's tags and title", async () => {
        const { notebook, owner } = await setup();
        await notebook.create(owner, note("n1", { title: "old", tags: ["trip", "food"] }));
        await notebook.update(owner, "n1", change(1, { title: "new", tags: ["trip", "work"] }));

        const titles = async (tag: string) =>
          (await notebook.listByTag(owner, tag, { limit: 10 })).entries.map((entry) => entry.title);
        expect(await titles("trip")).toEqual(["new"]);
        expect(await titles("work")).toEqual(["new"]);
        expect(await titles("food")).toEqual([]);
      });

      it("frees the old slug and refuses one that is taken", async () => {
        const { notebook, owner } = await setup();
        await notebook.create(owner, note("n1", { slug: "plans" }));
        await notebook.create(owner, note("n2", { slug: "diary" }));

        expect(await notebook.update(owner, "n1", change(1, { slug: "diary" }))).toEqual({
          status: "slug_taken",
        });
        // Refused as a whole: the note is still at version 1.
        expect((await notebook.findBySlug(owner, "plans"))?.version).toBe(1);

        await notebook.update(owner, "n1", change(1, { slug: "ideas" }));
        expect(await notebook.findBySlug(owner, "plans")).toBeUndefined();
        expect((await notebook.findBySlug(owner, "ideas"))?.id).toBe("n1");
        expect(await notebook.create(owner, note("n3", { slug: "plans" }))).toBe("created");
      });
    });

    describe("remove", () => {
      it("takes the tags, the slug, the attachments and the place in the count with it", async () => {
        const { notebook, owner } = await setup();
        await notebook.create(owner, note("n1", { tags: ["trip"], slug: "plans" }));
        await notebook.attach(owner, attachment("n1", "a1"));
        await notebook.create(owner, note("n2", { tags: ["trip"] }));

        expect(await notebook.remove(owner, "n1")).toBe(true);
        expect(await notebook.remove(owner, "n1")).toBe(false);

        expect(await notebook.getWithAttachments(owner, "n1")).toBeUndefined();
        expect(
          (await notebook.listByTag(owner, "trip", { limit: 10 })).entries.map((e) => e.noteId),
        ).toEqual(["n2"]);
        expect(await notebook.findBySlug(owner, "plans")).toBeUndefined();
        expect(await notebook.count(owner)).toBe(1);
        // A new note with the same ID does not inherit the old attachment.
        await notebook.create(owner, note("n1"));
        expect((await notebook.getWithAttachments(owner, "n1"))?.attachments).toEqual([]);
      });
    });

    describe("attach", () => {
      it("needs the note to exist, before and after a delete", async () => {
        const { notebook, owner } = await setup();
        expect(await notebook.attach(owner, attachment("n1", "a1"))).toBe("note_missing");
        await notebook.create(owner, note("n1"));
        expect(await notebook.attach(owner, attachment("n1", "a1"))).toBe("created");
        expect(await notebook.attach(owner, attachment("n1", "a1"))).toBe("already_exists");
        await notebook.remove(owner, "n1");
        expect(await notebook.attach(owner, attachment("n1", "a2"))).toBe("note_missing");
      });
    });

    describe("lists", () => {
      const seed = async (count: number) => {
        const context = await setup();
        for (let index = 1; index <= count; index++) {
          await context.notebook.create(
            context.owner,
            note(`n${index}`, { updatedAt: at(index), tags: ["trip"], body: "not in a list" }),
          );
        }
        return context;
      };

      it("the recent list follows the last update, not creation, and carries no body", async () => {
        const { notebook, owner } = await seed(3);
        await notebook.update(owner, "n1", change(1, { title: "edited", minute: 50 }));
        const page = await eventually(
          () => notebook.listRecent(owner, { limit: 10 }),
          (result) => result.notes[0]?.id === "n1",
        );
        expect(page.notes.map((item) => item.id)).toEqual(["n1", "n3", "n2"]);
        expect(page.notes[0]).toMatchObject({ title: "edited", version: 2 });
        expect(page.notes[0]).not.toHaveProperty("body");
        expect(page.nextToken).toBeNull();
      });

      it("pages reach every note exactly once", async () => {
        const { notebook, owner } = await seed(5);
        await eventually(
          () => notebook.listRecent(owner, { limit: 10 }),
          (result) => result.notes.length === 5,
        );
        for (const list of [
          (token?: string) =>
            notebook.listRecent(owner, { limit: 2, token }).then((page) => ({
              ids: page.notes.map((item) => item.id),
              nextToken: page.nextToken,
            })),
          (token?: string) =>
            notebook.listByTag(owner, "trip", { limit: 2, token }).then((page) => ({
              ids: page.entries.map((item) => item.noteId),
              nextToken: page.nextToken,
            })),
        ]) {
          const seen: string[] = [];
          let token: string | undefined;
          do {
            const page = await list(token);
            seen.push(...page.ids);
            token = page.nextToken ?? undefined;
          } while (token !== undefined);
          expect(seen).toEqual(["n5", "n4", "n3", "n2", "n1"]);
        }
      });

      it("a token works only for the list that issued it", async () => {
        const { notebook, owner } = await seed(3);
        const recent = await eventually(
          () => notebook.listRecent(owner, { limit: 1 }),
          (result) => result.nextToken !== null,
        );
        const tagged = await notebook.listByTag(owner, "trip", { limit: 1 });
        const [recentToken, tagToken] = [recent.nextToken ?? "", tagged.nextToken ?? ""];

        await expect(
          notebook.listByTag(owner, "trip", { limit: 1, token: recentToken }),
        ).rejects.toThrow(InvalidPageTokenError);
        await expect(notebook.listRecent(owner, { limit: 1, token: tagToken })).rejects.toThrow(
          InvalidPageTokenError,
        );
        await expect(
          notebook.listByTag(owner, "food", { limit: 1, token: tagToken }),
        ).rejects.toThrow(InvalidPageTokenError);
        await expect(
          notebook.listRecent(owner, { limit: 1, token: "bm90IGpzb24" }),
        ).rejects.toThrow(InvalidPageTokenError);
      });

      it("a token taken from one owner shows another owner only their own notes", async () => {
        const { notebook, owner } = await seed(3);
        const other = freshOwner();
        await notebook.create(other, note("n0", { updatedAt: at(0) }));
        const first = await eventually(
          () => notebook.listRecent(owner, { limit: 1 }),
          (result) => result.nextToken !== null,
        );
        await eventually(
          () => notebook.listRecent(other, { limit: 1 }),
          (result) => result.notes.length === 1,
        );

        const page = await notebook.listRecent(other, { limit: 10, token: first.nextToken ?? "" });
        expect(page.notes.map((item) => item.id)).toEqual(["n0"]);
      });

      it("refuses a page larger than the limit", async () => {
        const { notebook, owner } = await setup();
        await expect(notebook.listRecent(owner, { limit: 21 })).rejects.toThrow();
        await expect(notebook.listByTag(owner, "trip", { limit: 0 })).rejects.toThrow();
      });
    });
  });
}
