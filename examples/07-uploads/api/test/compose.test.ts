import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { MAX_NOTES_PER_OWNER } from "@aih/example-06-auth/api/src/contract.ts";
import {
  createLocalAuthenticator,
  signLocalToken,
} from "@aih/example-06-auth/api/src/local-auth.ts";

import { composeApp } from "../src/compose.ts";
import { errorSchema, MAX_UPLOAD_PERMITS_PER_OWNER_PER_DAY } from "../src/contract.ts";
import { InMemoryObjectStore } from "../src/memory-object-store.ts";

const secret = "test-secret-that-is-at-least-32-chars";

// The Lambda handler and the dev server both start from composeApp. A bound that is
// not wired in there is a bound the deployed API does not have.
async function setup() {
  const app = composeApp(
    { ALLOWED_ORIGIN: "http://localhost:5173", NOTES_STORE: "memory" },
    createLocalAuthenticator(secret),
    new InMemoryObjectStore({ baseUrl: "http://store.test", secret, now: () => new Date() }),
  );
  const token = await signLocalToken(secret, "alice");
  const post = (path: string, body: unknown) =>
    app(
      new Request(`http://api.test${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return { post };
}

describe("composeApp", () => {
  it("limits the notes one user may hold", async () => {
    const { post } = await setup();
    for (let count = 0; count < MAX_NOTES_PER_OWNER; count++) {
      expect((await post("/notes", { title: "n", body: "" })).status).toBe(201);
    }
    const refused = await post("/notes", { title: "n", body: "" });
    expect(refused.status).toBe(409);
    expect(v.parse(errorSchema, await refused.json()).error.code).toBe("quota_exceeded");
  });

  it("limits the upload permits one user may ask for in a day", async () => {
    const { post } = await setup();
    const note = (await (await post("/notes", { title: "n", body: "" })).json()) as { id: string };
    const ask = () => post(`/notes/${note.id}/attachments`, { contentType: "image/png" });
    for (let count = 0; count < MAX_UPLOAD_PERMITS_PER_OWNER_PER_DAY; count++) {
      expect((await ask()).status).toBe(201);
    }
    const refused = await ask();
    expect(refused.status).toBe(429);
    expect(v.parse(errorSchema, await refused.json()).error.code).toBe("upload_quota_exceeded");
  });
});
