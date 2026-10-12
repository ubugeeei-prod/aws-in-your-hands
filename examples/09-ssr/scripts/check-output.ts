// vp run ssr:check:output  (and ssr:check:output:stream)
//   node scripts/check-output.ts [outputDir]
//
// Runs the built Lambda handler in this process and checks the headers the
// real application sends. No AWS, no network.

import { resolve } from "node:path";

import * as v from "valibot";

import { NO_STORE, SHARED } from "../core/cache-control.ts";
import { noteListSchema } from "../core/notes.ts";
import { SESSION_COOKIE } from "../core/session.ts";
import { createSharedCache } from "../test/support/shared-cache.ts";
import { type Invocation, loadHandler, readBuildInfo } from "./lambda-harness.ts";

const outputDir = resolve(process.argv[2] ?? ".output");
// The practice sign-in is what makes a personal page to test with.
process.env["AIH_SSR_SIGN_IN"] = "dev";

const problems: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === "" ? "" : `: ${detail}`}`);
  if (!ok) {
    problems.push(name);
  }
};
const cacheControl = (response: Invocation): string =>
  response.headers["cache-control"] ?? "(none)";
const SECRET_SHAPED = /[A-Za-z0-9_-]{43}/;

try {
  const build = readBuildInfo(outputDir);
  console.log(
    `output: ${outputDir}\nnitro ${build.nitro}, handler: ${build.streaming ? "streaming" : "buffered"}`,
  );
  const invoke = await loadHandler(outputDir);
  const get = (path: string, headers: Record<string, string> = {}) =>
    invoke({ method: "GET", path, headers });

  // #region public
  const home = await get("/");
  check(
    "the list page is rendered on the server",
    home.status === 200 && home.body.includes("What a shared cache keeps"),
  );
  check(
    "an anonymous public page may be shared",
    cacheControl(home) === SHARED,
    cacheControl(home),
  );
  check(
    "a public page sets no cookie",
    home.cookies.length === 0 && home.headers["set-cookie"] === undefined,
  );

  const note = await get("/notes/tokens-stay-on-the-server");
  check(
    "a note page may be shared",
    note.status === 200 && cacheControl(note) === SHARED,
    cacheControl(note),
  );
  const api = await get("/api/notes");
  check(
    "the public API matches its schema and may be shared",
    v.safeParse(noteListSchema, JSON.parse(api.body)).success && cacheControl(api) === SHARED,
    cacheControl(api),
  );

  console.log(
    "info asking for a note that does not exist; Nuxt logs the 404 below as a request error",
  );
  const missing = await get("/notes/no-such-note");
  check(
    "a missing note is a 404 that is not shared",
    missing.status === 404 && cacheControl(missing) === NO_STORE,
    `${missing.status} ${cacheControl(missing)}`,
  );
  // #endregion public

  // #region credentials
  const withCookie = await get("/", { cookie: "theme=dark" });
  check(
    "any cookie on the request stops sharing",
    cacheControl(withCookie) === NO_STORE,
    cacheControl(withCookie),
  );
  const withAuthorization = await get("/", { authorization: "Bearer anything" });
  check(
    "an Authorization header stops sharing",
    cacheControl(withAuthorization) === NO_STORE,
    cacheControl(withAuthorization),
  );
  // #endregion credentials

  // #region sign-in
  const form = { "content-type": "application/x-www-form-urlencoded", host: "ssr.example" };
  const crossSite = await invoke({
    method: "POST",
    path: "/me/sign-in",
    headers: { ...form, origin: "https://evil.example" },
    body: "name=Mallory",
  });
  check(
    "a cross-site sign-in post is refused",
    crossSite.status === 403 && crossSite.cookies.length === 0,
    String(crossSite.status),
  );

  const signIn = await invoke({
    method: "POST",
    path: "/me/sign-in",
    headers: { ...form, origin: "https://ssr.example" },
    body: "name=Alice",
  });
  const setCookie = signIn.cookies[0] ?? "";
  check(
    "sign-in redirects and is not shared",
    signIn.status === 303 && cacheControl(signIn) === NO_STORE,
    `${signIn.status} ${cacheControl(signIn)}`,
  );
  check(
    "the session cookie is HttpOnly, SameSite=Lax, and scoped to /me",
    /HttpOnly/i.test(setCookie) &&
      /SameSite=Lax/i.test(setCookie) &&
      /Path=\/me(;|$)/i.test(setCookie),
    setCookie.replace(/=[^;]+/, "=<redacted>"),
  );
  const aliceCookie = setCookie.split(";")[0] ?? "";
  check(
    "the cookie carries the session id and nothing else",
    new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}$`).test(aliceCookie),
  );

  const mine = await get("/me", { cookie: aliceCookie });
  check(
    "the personal page is rendered for its reader",
    mine.status === 200 && mine.body.includes("Alice"),
  );
  check("the personal page is not shared", cacheControl(mine) === NO_STORE, cacheControl(mine));
  check("neither token nor session id is in the HTML", !SECRET_SHAPED.test(mine.body));
  const viewer = await get("/me/api/viewer", { cookie: aliceCookie });
  check(
    "the viewer API returns the profile without a token",
    viewer.body.includes("Alice") && !SECRET_SHAPED.test(viewer.body),
  );
  // #endregion sign-in

  // #region replay
  // Alice first, then somebody without a cookie, through a cache that stores all it is allowed to.
  const cache = createSharedCache(invoke, () => 0);
  for (const path of ["/me", "/me/api/viewer", "/"]) {
    await cache.fetch({ method: "GET", path, headers: { cookie: aliceCookie } });
    const next = await cache.fetch({ method: "GET", path, headers: {} });
    check(
      `the next reader of ${path} does not get Alice's copy`,
      !next.body.includes("Alice"),
      `served from ${next.from}`,
    );
  }
  check(
    "only pages rendered without credentials were stored",
    cache.storedPaths().join(",") === "/",
    cache.storedPaths().join(","),
  );
  // #endregion replay

  // #region streaming
  const feed = await get("/feed");
  const lines = feed.body.trimEnd().split("\n").length;
  console.log(
    `info /feed: ${lines} lines in ${feed.writesAt.length} write(s) at ${feed.writesAt.map((ms) => Math.round(ms)).join(", ")} ms`,
  );
  console.log(`info /: HTML in ${home.writesAt.length} write(s)`);
  if (build.streaming) {
    const spread = (feed.writesAt.at(-1) ?? 0) - (feed.writesAt[0] ?? 0);
    check(
      "the streaming handler writes the feed line by line",
      feed.writesAt.length >= lines && spread > 200,
      `${feed.writesAt.length} writes over ${Math.round(spread)} ms`,
    );
  } else {
    check(
      "the buffered handler returns the feed whole",
      feed.status === 200 && lines === 3 && feed.writesAt.length === 1,
    );
  }
  // #endregion streaming
} catch (error) {
  console.error(error);
  problems.push("the check itself failed");
}

if (problems.length > 0) {
  console.error(
    `${problems.length} problem(s). Is .output current? Run the matching build task first.`,
  );
  process.exit(1);
}
console.log("the built handler keeps personal responses out of a shared cache");
