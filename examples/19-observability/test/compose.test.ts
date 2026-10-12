import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import {
  MAX_NOTES_PER_OWNER,
  MAX_PAGE_SIZE,
  noteListSchema,
} from "@aih/example-05-dynamodb/src/contract.ts";

import { composeObservedApp } from "../src/compose.ts";

describe("the composed app", () => {
  it("refuses the note after the last one the shared owner may hold", async () => {
    const app = composeObservedApp({
      ALLOWED_ORIGIN: "http://localhost:5173",
      NOTES_STORE: "memory",
      LOG_LEVEL: "error",
    });
    const create = () =>
      app(
        new Request("http://api.test/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "one more" }),
        }),
      );

    for (let held = 0; held < MAX_NOTES_PER_OWNER; held += 1) {
      expect((await create()).status).toBe(201);
    }
    const refused = await create();
    // 409, not 5xx: a full store must not page whoever is on call.
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "quota_exceeded" } });

    // Chapter 05's list contract holds here too: one page of summaries, no bodies.
    const text = await (await app(new Request("http://api.test/notes"))).text();
    expect(v.parse(noteListSchema, JSON.parse(text)).notes).toHaveLength(MAX_PAGE_SIZE);
    expect(text).not.toContain('"body"');
    expect(
      (await app(new Request(`http://api.test/notes?limit=${MAX_PAGE_SIZE + 1}`))).status,
    ).toBe(400);
  });
});
