import { describe, expect, it } from "vite-plus/test";

import { composeApp } from "../src/compose.ts";
import { errorSchema, MAX_NOTES_PER_OWNER } from "../src/contract.ts";
import { createLocalAuthenticator, signLocalToken } from "../src/local-auth.ts";

const secret = "test-secret-that-is-at-least-32-chars";

describe("composeApp", () => {
  it("gives the repository the per-user limit, as every entry point gets it from here", async () => {
    // The Lambda handler and the dev server both start from composeApp. Without the limit
    // passed there, chapter 05's repository counts nothing.
    const app = composeApp(
      { ALLOWED_ORIGIN: "http://localhost:5173", NOTES_STORE: "memory" },
      createLocalAuthenticator(secret),
    );
    const create = async (user: string) =>
      app.request("/notes", {
        method: "POST",
        headers: {
          authorization: `Bearer ${await signLocalToken(secret, user)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "n", body: "" }),
      });

    for (let count = 0; count < MAX_NOTES_PER_OWNER; count++) {
      expect((await create("alice")).status).toBe(201);
    }
    const refused = await create("alice");
    expect(refused.status).toBe(409);
    expect(errorSchema.parse(await refused.json()).error.code).toBe("quota_exceeded");
    expect((await create("bob")).status).toBe(201);
  });
});
