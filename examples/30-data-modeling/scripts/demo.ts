// vp run modeling:demo
//
// Every access pattern of the chapter against the in-memory model, with what
// each one sent and what it cost in item writes. No AWS, no emulator, nothing on disk.

import { INDEX, INDEX_PK, INDEX_PROJECTION, INDEX_SK } from "../src/keys.ts";
import { MemoryTable } from "../src/memory-table.ts";
import type { Attachment, TaggedNote } from "../src/model.ts";
import { createNotebook } from "../src/notebook.ts";
import { type Change, project } from "../src/projector.ts";
import type { Table } from "../src/table.ts";

const model = new MemoryTable({
  name: INDEX,
  pk: INDEX_PK,
  sk: INDEX_SK,
  include: INDEX_PROJECTION,
});
const requests: string[] = [];

// The same table, with every request written down as it goes by.
const traced: Table = {
  get: (key) => {
    requests.push(`GetItem ${key.sk}`);
    return model.get(key);
  },
  query: (input) => {
    const range =
      input.sk === undefined
        ? ""
        : "beginsWith" in input.sk
          ? ` begins_with ${input.sk.beginsWith}`
          : ` between ${input.sk.between.join(" and ")}`;
    requests.push(`Query ${input.index ?? "table"}${range}`);
    return model.query(input);
  },
  write: (write) => {
    requests.push(`${write.kind} ${write.kind === "put" ? write.item.sk : write.key.sk}`);
    return model.write(write);
  },
  transact: (writes) => {
    requests.push(`TransactWriteItems of ${writes.length}`);
    return model.transact(writes);
  },
  scan: (input) => model.scan(input),
};

const OWNER = "demo";
const notebook = createNotebook({ table: traced });
const time = (minute: number): string => new Date(Date.UTC(2026, 9, 13, 9, minute)).toISOString();
const note = (id: string, minute: number, extra: Partial<TaggedNote>): TaggedNote => ({
  id,
  title: id,
  body: "",
  version: 1,
  createdAt: time(minute),
  updatedAt: time(minute),
  tags: [],
  ...extra,
});
const image = (noteId: string, id: string): Attachment => ({
  id,
  noteId,
  contentType: "image/png",
  size: 2048,
  createdAt: time(5),
});

// #region step
async function step<T>(title: string, run: () => Promise<T>, show: (value: T) => string) {
  requests.length = 0;
  const before = { ...model.usage };
  const value = await run();
  const plain = model.usage.writes - before.writes;
  const transactional = model.usage.transactionalWrites - before.transactionalWrites;
  const index = model.usage.indexWrites - before.indexWrites;
  console.log(`\n${title}`);
  console.log(`  sent    ${requests.join(", ")}`);
  // A transaction prepares and commits: each of its items is billed as two writes.
  console.log(`  writes  table ${plain + 2 * transactional}, index ${index}`);
  console.log(`  result  ${show(value)}`);
}
// #endregion step

await step(
  "create a note with two tags and a slug",
  () => notebook.create(OWNER, note("kyoto", 0, { tags: ["trip", "food"], slug: "kyoto-2026" })),
  String,
);
await notebook.create(OWNER, note("ramen", 1, { tags: ["food"] }));
await step("attach an image", () => notebook.attach(OWNER, image("kyoto", "a1")), String);
await step(
  "read the note with its attachments",
  () => notebook.getWithAttachments(OWNER, "kyoto"),
  (found) => `${found?.note.title}, ${found?.attachments.length} attachment`,
);
await step(
  "edit the body",
  () =>
    notebook.update(OWNER, "kyoto", {
      title: "kyoto",
      body: "Fushimi Inari at dawn",
      tags: ["trip", "food"],
      slug: "kyoto-2026",
      expectedVersion: 1,
      updatedAt: time(10),
    }),
  (result) => result.status,
);
await step(
  "rename it",
  () =>
    notebook.update(OWNER, "kyoto", {
      title: "Kyoto in autumn",
      body: "Fushimi Inari at dawn",
      tags: ["trip", "food"],
      slug: "kyoto-2026",
      expectedVersion: 2,
      updatedAt: time(20),
    }),
  (result) => result.status,
);
await step(
  "list by tag",
  () => notebook.listByTag(OWNER, "food", { limit: 20 }),
  (page) => page.entries.map((entry) => entry.title).join(" | "),
);
await step(
  "list the most recently updated",
  () => notebook.listRecent(OWNER, { limit: 20 }),
  (page) => page.notes.map((item) => item.title).join(" | "),
);

model.pauseIndex();
await notebook.create(OWNER, note("diary", 30, {}));
await step(
  "the same list, with the index held back and one more note created",
  () => notebook.listRecent(OWNER, { limit: 20 }),
  (page) => `${page.notes.map((item) => item.title).join(" | ")}   (no diary yet)`,
);
model.catchUp();

await step("count the notes", () => notebook.count(OWNER), String);
await step(
  "count a tag before the stream consumer has run",
  () => notebook.tagCount(OWNER, "food"),
  String,
);
const changes: Change[] = model.stream.map((record) => ({
  eventId: record.eventId,
  sequenceNumber: record.sequenceNumber,
  eventName: record.eventName,
  ...record.keys,
}));
await step(
  `feed the stream consumer ${changes.length} records, then the same ${changes.length} again`,
  async () => [
    await project(traced, changes, new Date(Date.UTC(2026, 9, 13, 10))),
    await project(traced, changes, new Date(Date.UTC(2026, 9, 13, 10))),
  ],
  ([first, second]) =>
    `first ${first?.applied} applied, second ${second?.applied} applied and ${second?.duplicates} recognized`,
);
await step("count the tag again", () => notebook.tagCount(OWNER, "food"), String);
