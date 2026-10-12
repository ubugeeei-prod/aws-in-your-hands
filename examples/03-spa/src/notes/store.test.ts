import { describe, expect, it } from "vite-plus/test";

import { createLocalNoteStore, type KeyValueStorage } from "./store.ts";

function fakeStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & { dump: () => Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    dump: () => Object.fromEntries(data),
  };
}

function setup(initial?: Record<string, string>) {
  let tick = 0;
  let id = 0;
  const storage = fakeStorage(initial);
  const store = createLocalNoteStore({
    storage,
    now: () => new Date(Date.UTC(2026, 9, 11, 0, 0, tick++)),
    newId: () => `note-${++id}`,
  });
  return { storage, store };
}

describe("local note store", () => {
  it("lists the most recently saved note first", () => {
    const { store } = setup();
    store.save({ title: "first", body: "" });
    store.save({ title: "second", body: "" });
    expect(store.list().map((note) => note.title)).toEqual(["second", "first"]);
  });

  it("updates a note in place", () => {
    const { store } = setup();
    const created = store.save({ title: "draft", body: "" });
    store.save({ title: "final", body: "done" }, created.id);
    expect(store.list()).toHaveLength(1);
    expect(store.get(created.id)).toMatchObject({ title: "final", body: "done" });
  });

  it("refuses a note without a title", () => {
    const { store } = setup();
    expect(() => store.save({ title: "   ", body: "x" })).toThrow();
    expect(store.list()).toEqual([]);
  });

  it("drops stored entries that are not notes", () => {
    const valid = { id: "a", title: "kept", body: "", updatedAt: "2026-10-11T00:00:00.000Z" };
    const { store } = setup({
      "aih.notes.v1": JSON.stringify([valid, { id: 1, title: null }, "junk"]),
    });
    expect(store.list()).toEqual([valid]);
  });

  it("starts empty when storage is not JSON", () => {
    const { store } = setup({ "aih.notes.v1": "{not json" });
    expect(store.list()).toEqual([]);
  });

  it("removes a note", () => {
    const { store } = setup();
    const note = store.save({ title: "gone", body: "" });
    store.remove(note.id);
    expect(store.get(note.id)).toBeUndefined();
  });
});
