---
title: "09 SSR: Run It Locally"
---

# 09 SSR: Run It Locally

## Run it locally

<!-- section: 09.local -->

Copy `examples/09-ssr/.env.example` to `.env` in the same directory.

<<< @/examples/09-ssr/.env.example

```bash
vp run dev:ssr
```

Nuxt's dev server comes up at <http://localhost:3000>. From another terminal, have a look at the headers.

```bash
curl -s -o /dev/null -D - http://localhost:3000/
curl -s -o /dev/null -D - http://localhost:3000/me
curl -s -o /dev/null -D - -H 'cookie: theme=dark' http://localhost:3000/
```

The first shows `cache-control: public, max-age=0, s-maxage=60`. The second and third show `private, no-store`. The third is a public page, but it carries a cookie, so it isn't shared.

Open `/me` in a browser and you get a form asking for a name. Sign in and `/me` shows the name; look at the cookie in the developer tools and it is `HttpOnly` with `Path` set to `/me`.

`/feed` arrives bit by bit.

```bash
curl -sN http://localhost:3000/feed
```

### Tests

```bash
vp run test:unit
vp run typecheck
vp run typecheck:ssr
vp run lint:ssr
```

`test:unit` covers the decision function, the leak replayed through the shared cache, session expiry, the publish plan, and the CDK stack. `typecheck` checks `core/`, `server/`, `infra/`, and `scripts/` with TypeScript; `typecheck:ssr` and `lint:ssr` check the `.vue` files in `app/` with Vize. This chapter's `tsconfig.json` is the only one that resolves modules as `Bundler`: under `NodeNext`, which the other examples use, `defineNitroPlugin` could not be resolved from the type definitions of `nitropack/runtime`.

There's one more check, particular to this chapter.

```bash
vp run ssr:check:output
```

It runs `nuxt build`, then calls the resulting `.output/server/index.mjs` with an event shaped like a function URL's. No AWS, no network.

<<< @/examples/09-ssr/scripts/check-output.ts{replay}

It signs in as Alice, opens `/me` with her cookie, then opens the same path with no cookie, with that sloppy shared cache in between. Using the headers the real Nuxt app returns, it confirms that Alice's page doesn't reach the next person. This is also the check that found the wrong header on the 404.

Let's be clear about what isn't reproduced locally.

- CloudFront. The cache policies, the routing between behaviors, the OAC signature, and the removal of `Set-Cookie` are only looked at as settings, through assertions on the template. That CloudFront behaves accordingly can't be seen without deploying
- The function URL and the Lambda runtime. `ssr:check:output` imitates the shape of the event, but it isn't Lambda
- More than one execution environment. The local dev server is one process, which is why sign-in happens to work
