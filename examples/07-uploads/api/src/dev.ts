import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod";

import {
  createLocalAuthenticator,
  signLocalToken,
} from "@aih/example-06-auth/api/src/local-auth.ts";

import { composeApp } from "./compose.ts";
import { MAX_UPLOAD_BYTES } from "./contract.ts";
import { parseUploadsEnv } from "./env.ts";
import { createLocalStoreHandler, LOCAL_STORE_PATH } from "./local-store-http.ts";
import { InMemoryObjectStore } from "./memory-object-store.ts";

const secret = z
  .string()
  .min(32, "LOCAL_AUTH_SECRET must be set (see .env.example)")
  .parse(process.env["LOCAL_AUTH_SECRET"]);
const origin = process.env["ALLOWED_ORIGIN"] ?? "http://localhost:5173";
const port = Number(process.env["PORT"] ?? 8787);
if (parseUploadsEnv(process.env).UPLOADS_STORE !== "memory") {
  throw new Error("The development server keeps uploads in memory. Set UPLOADS_STORE=memory.");
}

// #region dev
// Stands in for the bucket. Images live in this process and vanish on restart.
const objects = new InMemoryObjectStore({
  baseUrl: `http://localhost:${port}`,
  secret,
  now: () => new Date(),
});
const store = createLocalStoreHandler(objects);
const api = composeApp(process.env, createLocalAuthenticator(secret), objects);

const server = new Hono();
server.use("/local/*", cors({ origin, allowMethods: ["POST"], allowHeaders: ["content-type"] }));
// A little above the limit, so that an oversized image reaches the store's own check.
server.post(LOCAL_STORE_PATH, bodyLimit({ maxSize: MAX_UPLOAD_BYTES + 64 * 1024 }), (c) =>
  store(c.req.raw),
);
server.get(`${LOCAL_STORE_PATH}/*`, (c) => store(c.req.raw));
// #endregion dev

// The local sign-in of chapter 06: any user name gets a token, no password.
server.post("/local/token", async (c) => {
  const body = z
    .object({ user: z.string().regex(/^[a-z0-9-]{1,32}$/) })
    .safeParse(await c.req.json().catch(() => undefined));
  if (!body.success) {
    return c.json({ error: "user must be 1-32 characters of a-z, 0-9, or -" }, 400);
  }
  return c.json({
    accessToken: await signLocalToken(secret, `local-${body.data.user}`),
    sub: `local-${body.data.user}`,
  });
});
server.route("/", api);

serve({ fetch: server.fetch, port }, (info) => {
  console.log(
    `notes API listening on http://localhost:${info.port} with LOCAL sign-in and in-memory uploads`,
  );
});
