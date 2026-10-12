import * as v from "valibot";

import { type RequestRecord, requestRecordSchema } from "./record.ts";

// A small generator with a seed, so that sizes measured from the sample are the same on every run.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (random: () => number, length: number) =>
  Array.from({ length }, () => Math.floor(random() * 16).toString(16)).join("");

const uuid = (random: () => number) =>
  `${hex(random, 8)}-${hex(random, 4)}-4${hex(random, 3)}-8${hex(random, 3)}-${hex(random, 12)}`;

const KINDS = [
  { weight: 50, method: "GET", route: "/notes", status: 200, action: null },
  { weight: 25, method: "GET", route: "/notes/:id", status: 200, action: null },
  { weight: 8, method: "POST", route: "/notes", status: 201, action: "note_created" },
  { weight: 10, method: "PUT", route: "/notes/:id", status: 200, action: "note_updated" },
  { weight: 2, method: "PUT", route: "/notes/:id", status: 409, action: "update_conflicted" },
  { weight: 3, method: "DELETE", route: "/notes/:id", status: 204, action: "note_deleted" },
  { weight: 2, method: "GET", route: "/notes/:id", status: 404, action: null },
] as const;

/** `count` made-up request records, spread evenly over the UTC day `day`. Not real traffic. */
export function sampleRecords(count: number, day: string, seed = 26): RequestRecord[] {
  const random = mulberry32(seed);
  const start = Date.parse(`${day}T00:00:00.000Z`);
  return Array.from({ length: count }, (_unused, index) => {
    let pick = random() * 100;
    const kind = KINDS.find((each) => (pick -= each.weight) < 0) ?? KINDS[0];
    const at = new Date(start + Math.floor((index * 86_400_000) / count));
    return v.parse(requestRecordSchema, {
      v: 1,
      event_id: uuid(random),
      at: at.toISOString(),
      request_id: uuid(random),
      method: kind.method,
      route: kind.route,
      status: kind.status,
      duration_ms: 5 + Math.floor(random() * random() * 400),
      action: kind.action,
      // Shaped like chapter 05's note IDs: nine base-36 digits of time, ten of randomness.
      note_id:
        kind.action === null
          ? null
          : `${at.getTime().toString(36).padStart(9, "0")}${hex(random, 10)}`,
    });
  });
}
