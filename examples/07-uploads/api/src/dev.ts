import * as v from "valibot";

import { readJson } from "@aih/example-04-http-api/src/http/body.ts";
import { cors } from "@aih/example-04-http-api/src/http/cors.ts";
import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";
import { route, router } from "@aih/example-04-http-api/src/http/router.ts";
import {
  createLocalAuthenticator,
  signLocalToken,
} from "@aih/example-06-auth/api/src/local-auth.ts";

import { composeApp } from "./compose.ts";
import { parseUploadsEnv } from "./env.ts";
import { createLocalStoreHandler } from "./local-store-http.ts";
import { InMemoryObjectStore } from "./memory-object-store.ts";

const secretMessage = "LOCAL_AUTH_SECRET must be set (see .env.example)";
const secret = v.parse(
  v.pipe(v.string(secretMessage), v.minLength(32, secretMessage)),
  process.env["LOCAL_AUTH_SECRET"],
);
const origin = process.env["ALLOWED_ORIGIN"] ?? "http://localhost:5173";
const port = Number(process.env["PORT"] ?? 8787);
if (parseUploadsEnv(process.env).UPLOADS_STORE !== "memory") {
  throw new Error("The development server keeps uploads in memory. Set UPLOADS_STORE=memory.");
}

const userSchema = v.object({ user: v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,32}$/)) });

// #region dev
// Stands in for the bucket. Images live in this process and vanish on restart.
const objects = new InMemoryObjectStore({
  baseUrl: `http://localhost:${port}`,
  secret,
  now: () => new Date(),
});
const store = createLocalStoreHandler(objects);
const api = composeApp(process.env, createLocalAuthenticator(secret), objects);

// Everything under /local/ exists on this machine only: the sign-in of chapter 06,
// and, for any other path, the stand-in for the bucket.
const local = cors(
  { origin, allowMethods: ["POST"], allowHeaders: ["content-type"] },
  router<undefined>(
    [
      route("POST", "/local/token", async (request) => {
        const json = await readJson(request, 1024);
        const body = v.safeParse(userSchema, json.ok ? json.value : undefined);
        if (!body.success) {
          return Response.json(
            { error: "user must be 1-32 characters of a-z, 0-9, or -" },
            { status: 400 },
          );
        }
        const sub = `local-${body.output.user}`;
        return Response.json({ accessToken: await signLocalToken(secret, sub), sub });
      }),
    ],
    (request) => store(request),
  ),
);

nodeServer((request) =>
  new URL(request.url).pathname.startsWith("/local/") ? local(request, undefined) : api(request),
).listen(port, () => {
  console.log(
    `notes API listening on http://localhost:${port} with LOCAL sign-in and in-memory uploads`,
  );
});
// #endregion dev
