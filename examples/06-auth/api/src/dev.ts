import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { composeApp } from "./compose.ts";
import { createLocalAuthenticator, signLocalToken } from "./local-auth.ts";

// #region dev
// The local entry point. It differs from lambda.ts in exactly one way: who
// vouches for the caller. Here it is a development token signed with
// LOCAL_AUTH_SECRET; in AWS it is API Gateway.
const secret = z
  .string()
  .min(32, "LOCAL_AUTH_SECRET must be set (see .env.example)")
  .parse(process.env["LOCAL_AUTH_SECRET"]);
const origin = process.env["ALLOWED_ORIGIN"] ?? "http://localhost:5173";
const port = Number(process.env["PORT"] ?? 8787);

const api = composeApp(process.env, createLocalAuthenticator(secret));

// Stands in for the sign-in page: POST /local/token {"user":"alice"} returns a
// token for that user, no questions asked. It lives in this file only, so it
// cannot be reached in a deployment.
const server = new Hono();
server.use("/local/*", cors({ origin, allowMethods: ["POST"], allowHeaders: ["content-type"] }));
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
  console.log(`notes API listening on http://localhost:${info.port} with LOCAL sign-in (POST /local/token)`);
});
// #endregion dev
