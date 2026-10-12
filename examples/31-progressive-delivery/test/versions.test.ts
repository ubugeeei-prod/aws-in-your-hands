import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { createApp } from "@aih/example-04-http-api/src/app.ts";
import { noteSchema } from "@aih/example-04-http-api/src/contract.ts";
import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import { createNoteService } from "@aih/example-04-http-api/src/notes.ts";
import {
  formats,
  type RecordFormat,
  SharedRecords,
} from "@aih/example-12-containers/src/compat.ts";

import { seeded } from "./fakes.ts";

/** One version of the function: chapter 04's app on the shared records, through that version's format. */
function build(records: SharedRecords, format: RecordFormat, name: string): Fetch {
  let next = 0;
  return createApp({
    env: { ALLOWED_ORIGIN: "http://localhost:5173", LOG_LEVEL: "error", STAGE: "test" },
    log: () => {},
    notes: createNoteService({
      repository: records.repository(format),
      now: () => new Date("2026-10-12T00:00:00.000Z"),
      newId: () => `${name}-${(next += 1)}`,
    }),
    newRequestId: () => "request",
    now: () => 0,
  });
}

/** What a weighted alias does: one independent draw per request. */
function alias(
  oldVersion: Fetch,
  newVersion: Fetch,
  weight: () => number,
  random: () => number,
): Fetch {
  return (request) => (random() < weight() ? newVersion(request) : oldVersion(request));
}

const create = (title: string) =>
  new Request("http://api.test/notes", { method: "POST", body: JSON.stringify({ title }) });
const list = () => new Request("http://api.test/notes");

async function shiftAndRollBack(oldFormat: RecordFormat, newFormat: RecordFormat) {
  const records = new SharedRecords();
  let weight = 0.5;
  const app = alias(
    build(records, oldFormat, "old"),
    build(records, newFormat, "new"),
    () => weight,
    seeded(31),
  );
  const during: number[] = [];
  for (let request = 0; request < 20; request += 1) {
    during.push((await app(create(`note ${request}`))).status);
    during.push((await app(list())).status);
  }
  // The alarm fired. Every request goes to the old version again, over what both wrote.
  weight = 0;
  const after = (await app(list())).status;
  return { during, after, records };
}

// #region shared-data
describe("two versions behind one alias, on the same records", () => {
  it("works during the shift and after a rollback when each can read the other's records", async () => {
    const { during, after, records } = await shiftAndRollBack(formats.v1, formats.v2);
    expect(new Set(during)).toEqual(new Set([201, 200]));
    expect(after).toBe(200);
    // Both versions really wrote: the seeded draws are not all on one side.
    const written = during.filter((status) => status === 201).length;
    expect(written).toBe(20);
    const byNew = Array.from({ length: 20 }, (_, index) => records.raw(`new-${index + 1}`)).filter(
      (record) => record !== undefined,
    );
    expect(byNew.length).toBeGreaterThan(0);
    expect(byNew.length).toBeLessThan(20);
    expect(v.safeParse(noteSchema, byNew[0]).success).toBe(true);
  });

  it("fails on the new version alone when it insists on a field the old records lack", async () => {
    const { during, after } = await shiftAndRollBack(formats.v1, formats.v2Required);
    // The canary answers 500 on what the old version wrote. This is the case an alarm catches.
    expect(during).toContain(500);
    // And the rollback helps: the old version reads everything, including what the canary wrote.
    expect(after).toBe(200);
  });

  it("stays broken after the rollback when the old version cannot read what the new one wrote", async () => {
    const { after } = await shiftAndRollBack(formats.v1Strict, formats.v2);
    // Moving the alias back moved the code back. The records the canary wrote are still there.
    expect(after).toBe(500);
  });
});
// #endregion shared-data
