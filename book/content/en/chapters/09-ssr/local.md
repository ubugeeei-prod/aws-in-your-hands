---
title: "09 SSR: Run It Locally"
---

# 09 SSR: Run It Locally

This page runs the cache decision, the BFF, and streaming from [Design and Build](/en/chapters/09-ssr/build.md) on your machine, without AWS.

## Running it locally

<!-- section: 09.local -->

Copy `examples/09-ssr/.env.example` to `.env` in the same directory.

<<< @/examples/09-ssr/.env.example

```bash
vp run dev:ssr
```

Nuxt's dev server starts at <http://localhost:3000>. From another terminal, look at the response headers.

```bash
curl -s -o /dev/null -D - http://localhost:3000/
curl -s -o /dev/null -D - http://localhost:3000/me
curl -s -o /dev/null -D - -H 'cookie: theme=dark' http://localhost:3000/
```

The first shows `cache-control: public, max-age=0, s-maxage=60`, and the second and third show `private, no-store`. The third request is for a public page, but it carries a cookie, so sharing is not allowed.

Open `/me` in a browser and you get a form that asks for a name. After you sign in, `/me` shows the name. In the developer tools, the cookie is marked `HttpOnly` and its `Path` is `/me`.

`/feed` arrives one line at a time, with a pause between lines.

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

`test:unit` tests the decision function, the leak reproduced through the shared cache, session expiry, the plan for publishing assets, and the CDK stack. `typecheck` checks `core/`, `server/`, `infra/`, and `scripts/` with TypeScript, and `typecheck:ssr` and `lint:ssr` check the `.vue` files in `app/` with Vize. This chapter's `tsconfig.json` is the only one that sets module resolution to `Bundler`. Under `NodeNext`, which the other examples use, `defineNitroPlugin` could not be resolved from the type definitions of `nitropack/runtime`.

This chapter has one more check of its own.

```bash
vp run ssr:check:output
```

It runs `nuxt build` and then calls the resulting `.output/server/index.mjs` with an event shaped like the one a function URL sends. It uses neither AWS nor the network.

<<< @/examples/09-ssr/scripts/check-output.ts{replay}

The check signs in as Alice, opens `/me` with her cookie, and then opens the same path with no cookie. The sloppy shared cache from ["Reproducing the leak, in a fixed order"](/en/chapters/09-ssr/build.md) sits in between. It confirms that, with the headers the real Nuxt app returns, Alice's page does not reach the next person. This is also the check that found `public` on the 404 response.

Three things are not reproduced locally.

- CloudFront. The cache policies, the routing between behaviors, the OAC signature, and the removal of `Set-Cookie` are checked only as settings, through assertions on the template. You cannot tell that CloudFront behaves as configured without deploying
- The function URL and the Lambda runtime. `ssr:check:output` imitates the shape of the event, but it is not Lambda
- More than one execution environment. The local dev server is a single process, so sign-in works even though sessions are kept in memory
