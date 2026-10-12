# Brief: no framework, and Valibot

The book no longer uses Hono or Zod. An application is a function from a `Request` to a
`Response` (the WinterTC minimum common API), and input is checked with Valibot 1.5.0.
Chapter 04 is done and is the reference: read `examples/04-http-api/src/` and its tests first.

## Why

A framework hid the parts a reader new to AWS most needs to see: how a Lambda event becomes a
request, how a route is chosen, how a body is bounded. The book now shows them. Keep that
purpose in mind: do not rebuild a framework, and do not hide a step behind a helper of your own.

## The kit (owned by chapter 04; do not edit, do not copy)

Import by path, as chapters already import each other:
`@aih/example-04-http-api/src/http/<file>.ts`. Your package already depends on it.

| File | Exports |
| --- | --- |
| `router.ts` | `Fetch` = `(request) => Response \| Promise<Response>` (a whole app). `Handler<Context>` = `(request, context) => …` (a part). `route(method, path, handle)` with `handle(request, context, params)`; `path` is a `URLPattern` pathname (`/notes/:id`). `router(routes, notFound)` |
| `cors.ts` | `cors({ origin, allowMethods, allowHeaders }, next)` |
| `body.ts` | `readJson(request, maxBytes)` → `{ ok: true, value } \| { ok: false, reason: "too_large" \| "invalid_json" }` |
| `api-gateway.ts` | `handleApiGateway(handler)`; the handler's context is `{ event }` (HTTP API payload 2.0). `toRequest(event)`, `toResult(response)` |
| `node-server.ts` | `nodeServer(fetch)` → a `node:http` `Server`, not listening. Call `.listen(port, cb)`; `.close()` stops it. Streams are piped as written |

If the kit lacks something your chapter needs (another CORS option, a different event type,
response streaming on Lambda), write it **in your own chapter's `src/`**, small and visible, and
say so in your report. Do not change chapter 04's files.

## How an app is shaped

See `examples/04-http-api/src/app.ts`. In short:

- `createApp(deps)` returns `Fetch` (or `Handler<{ event }>`-compatible if it needs the event).
  It is a function: tests call `app(new Request("http://api.test/notes"))`. There is no
  `app.request`, `app.fetch`, `c.json`, `c.get`, `c.set`.
- Per-request values (request ID, identity) go in a `context` object passed to the routes.
- What Hono middleware did is now ordinary code around the router, in the order it runs:
  make the context, call, catch, set headers, log.
- Answers are `Response.json(body, { status })` and `new Response(null, { status: 204 })`.
- Query: `new URL(request.url).searchParams`. Headers: `request.headers.get(name)`.
- Typed clients are plain `fetch` calls checked against the schema (`src/client.ts`). No `hc`.
- Keep every behaviour the tests pin: status codes, error shapes, limits, header values.
  Port the tests; do not delete or weaken one to make it pass. If Hono did something implicitly
  that a test relied on, implement it explicitly.

## Zod → Valibot

`import * as v from "valibot";` (a namespace, like the CDK modules).

| Zod | Valibot |
| --- | --- |
| `z.object` / `z.strictObject` | `v.object` / `v.strictObject` (both drop or refuse unknown keys the same way Zod did) |
| `z.string().min(1).max(9)` | `v.pipe(v.string(), v.minLength(1), v.maxLength(9))` |
| `.trim()` | `v.trim()` inside the pipe, before the length checks |
| `z.number().int().min(0)` | `v.pipe(v.number(), v.integer(), v.minValue(0))` |
| `z.coerce.number()` | `v.pipe(v.string(), v.transform(Number), v.number())` (say what it accepts; `v.number()` refuses `NaN`) |
| `z.enum([...])` | `v.picklist([...])` |
| `z.literal`, `z.union`, `z.array`, `z.record`, `z.unknown` | same names |
| `z.discriminatedUnion("k", [...])` | `v.variant("k", [...])` |
| `.optional()` / `.nullable()` | `v.optional(x)` / `v.nullable(x)` |
| `.default(d)` | `v.optional(x, d)` |
| `.refine(fn, msg)` | `v.check(fn, msg)` in a pipe |
| `.transform(fn)` | `v.transform(fn)` in a pipe |
| `z.iso.datetime()` | `v.pipe(v.string(), v.isoTimestamp())` |
| `z.url()` / `z.email()` / `z.uuid()` | `v.pipe(v.string(), v.url())` etc. |
| `z.infer<typeof s>` | `v.InferOutput<typeof s>` (`v.InferInput` when the caller's side is meant) |
| `z.ZodType<T>` | `v.GenericSchema<unknown, T>` |
| `s.parse(x)` | `v.parse(s, x)` (throws `v.ValiError`) |
| `s.safeParse(x)` → `.data` / `.error.issues` | `v.safeParse(s, x)` → `.output` / `.issues` |
| `issue.path.join(".")` | `v.getDotPath(issue) ?? ""` |
| `.extend`, `.pick`, `.omit`, `.partial` | `v.object({ ...s.entries, … })`, `v.pick(s, [...])`, `v.omit`, `v.partial` |

The table is from memory of the two libraries, not a guarantee. The installed package is the
authority: check `node_modules/valibot/dist/index.d.mts` when a name or behaviour is in doubt,
and let the tests decide. Messages differ between the libraries; a test that pinned a Zod
message should pin what matters (the field, the code), not Valibot's wording.

## Prose

Each chapter's pages (`book/content/{ja,en}/chapters/NN-*.md` and `NN-*/`) must say what the
code now does. Search your pages for Hono, Zod, `hc`, `validator`, `c.json`, `app.request`,
"framework", フレームワーク, and every `<<<` region you renamed or removed. Rules as in
`docs/EDITORIAL.md` (plain です・ます, katakana terms, no AI-smell) and `docs/PROSE_BRIEF.md`.
Japanese is the source; English follows it. Figures that name "Hono app" get a truthful name.
Do not explain Valibot or the kit again in later chapters: chapter 04 does. A later chapter
says only what is different there.

## Rules

- Touch only what your task names. Other agents are editing other chapters in this same tree
  right now. Never run `git add`, `git commit`, `git stash`, `git checkout`, or `vp install`.
- Do not edit the root `vite.config.ts`, `pnpm-lock.yaml`, `data/*.json` (except your own
  `data/fragments/NN.json`), `docs/`, or `book/theme/`. If one needs a change, say so in the report.
- In your `package.json`: remove `hono`, `@hono/node-server`, and `zod` once nothing in the
  package imports them. `valibot` is already there. Do not run an install afterwards.
- Imports: namespaces for CDK modules and Valibot, sorted and grouped as the formatter does.
- Verify inside the devShell, from the repository root (nix needs the sandbox off):
  `nix develop -c sh -c 'vp test run examples/NN-slug && cd examples/NN-slug && ../../node_modules/.bin/tsc --noEmit -p .'`
  (a chapter with several tsconfig files: run each). Then `nix develop -c vp check --fix` on your
  own files only: `vp check --fix examples/NN-slug book/content/ja/chapters/NN-slug*`. After it,
  make sure every `#region` a page imports still exists.
- The shell is `ush`; many utilities are aliased. Use absolute paths (`/usr/bin/grep`,
  `/usr/bin/sed`) and avoid globs in command arguments.
- Nothing here touches AWS. Do not deploy, do not call AWS, do not invent results. If a
  behaviour could only be confirmed on AWS (API Gateway's event for a case, response
  streaming), say it is unverified in the page's validation note and in your report.

## Report

End with: what changed (files), what the tests and the type check said (numbers), every place
the kit was not enough and what you wrote instead, every behaviour that changed (even slightly),
and every shared file that needs an edit you could not make.
