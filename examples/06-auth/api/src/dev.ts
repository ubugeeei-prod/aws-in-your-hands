import * as v from "valibot";

import { readJson } from "@aih/example-04-http-api/src/http/body.ts";
import { cors } from "@aih/example-04-http-api/src/http/cors.ts";
import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";
import { route, router } from "@aih/example-04-http-api/src/http/router.ts";

import { composeApp } from "./compose.ts";
import { createLocalAuthenticator, signLocalToken } from "./local-auth.ts";

// #region dev
// Same app as lambda.ts. Only who vouches for the caller differs: here, a
// token signed with LOCAL_AUTH_SECRET.
const secretMessage = "LOCAL_AUTH_SECRET must be set (see .env.example)";
const secret = v.parse(
  v.pipe(v.string(secretMessage), v.minLength(32, secretMessage)),
  process.env["LOCAL_AUTH_SECRET"],
);
const origin = process.env["ALLOWED_ORIGIN"] ?? "http://localhost:5173";
const port = Number(process.env["PORT"] ?? 8787);

const api = composeApp(process.env, createLocalAuthenticator(secret));

const userSchema = v.object({ user: v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,32}$/)) });

// Stands in for the sign-in page: any user name gets a token, no password.
// It lives in this file only, so a deployment cannot reach it.
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
    () => Response.json({ error: "No such route." }, { status: 404 }),
  ),
);

// No event here, so the app is called with the request alone.
nodeServer((request) =>
  new URL(request.url).pathname.startsWith("/local/") ? local(request, undefined) : api(request),
).listen(port, () => {
  console.log(
    `notes API listening on http://localhost:${port} with LOCAL sign-in (POST /local/token)`,
  );
});
// #endregion dev
