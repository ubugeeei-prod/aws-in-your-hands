import { randomUUID } from "node:crypto";

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
import { parseMeetingsEnv } from "./env.ts";
import { FakeMeetings } from "./fake-meetings.ts";

const secretMessage = "LOCAL_AUTH_SECRET must be set (see .env.example)";
const secret = v.parse(
  v.pipe(v.string(secretMessage), v.minLength(32, secretMessage)),
  process.env["LOCAL_AUTH_SECRET"],
);
const origin = process.env["ALLOWED_ORIGIN"] ?? "http://localhost:5173";
const port = Number(process.env["PORT"] ?? 8787);
if (parseMeetingsEnv(process.env).MEETINGS !== "fake") {
  throw new Error("The development server never calls Chime. Set MEETINGS=fake.");
}

const userSchema = v.object({ user: v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,32}$/)) });

// #region dev
// The same app as lambda.ts, with two stand-ins: chapter 06's local sign-in, and a model of
// the meetings API. Rooms, membership and seats behave as deployed. No audio or video exists.
const api = composeApp(process.env, createLocalAuthenticator(secret), new FakeMeetings(randomUUID));

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

nodeServer((request) =>
  new URL(request.url).pathname.startsWith("/local/") ? local(request, undefined) : api(request),
).listen(port, () => {
  console.log(
    `notes API with rooms on http://localhost:${port}: LOCAL sign-in, FAKE meetings (no Chime call, no media)`,
  );
});
// #endregion dev
