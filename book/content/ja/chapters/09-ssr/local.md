---
title: "09 SSR: 手元で動かす"
---

# 09 SSR: 手元で動かす

## 手元で動かす

<!-- section: 09.local -->

`examples/09-ssr/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/09-ssr/.env.example

```bash
vp run dev:ssr
```

<http://localhost:3000> で Nuxt の開発サーバーが立ち上がります。別のターミナルから、ヘッダーを見てみましょう。

```bash
curl -s -o /dev/null -D - http://localhost:3000/
curl -s -o /dev/null -D - http://localhost:3000/me
curl -s -o /dev/null -D - -H 'cookie: theme=dark' http://localhost:3000/
```

1 つ目は `cache-control: public, max-age=0, s-maxage=60`。2 つ目と 3 つ目は `private, no-store` です。3 つ目は公開ページですが、cookie が付いているので共有しません。

ブラウザで `/me` を開くと、名前を入れる form が出ます。サインインすると `/me` に名前が出て、開発者ツールで cookie を見ると、`HttpOnly` で `Path` が `/me` になっています。

`/feed` は、少しずつ届きます。

```bash
curl -sN http://localhost:3000/feed
```

### テスト

```bash
vp run test:unit
vp run typecheck
vp run typecheck:ssr
vp run lint:ssr
```

`test:unit` が見ているのは、判定の関数、共有 cache 越しの漏れの再現、session の期限、publish の計画、そして CDK の stack です。`typecheck` は `core/`、`server/`、`infra/`、`scripts/` を TypeScript で、`typecheck:ssr` と `lint:ssr` は `app/` の `.vue` を Vize で検査します。この章の `tsconfig.json` だけ、module の解決を `Bundler` にしています。他のサンプルと同じ `NodeNext` では、`nitropack/runtime` の型定義から `defineNitroPlugin` を解決できなかったためです。

もう 1 つ、この章だけの検査があります。

```bash
vp run ssr:check:output
```

`nuxt build` を実行して、できあがった `.output/server/index.mjs` を、function URL と同じ形の event で呼びます。AWS もネットワークも使いません。

<<< @/examples/09-ssr/scripts/check-output.ts{replay}

Alice としてサインインし、その cookie で `/me` を開き、続けて cookie なしで同じ path を開く。さっきの雑な共有 cache を挟んで、です。本物の Nuxt アプリが返すヘッダーで、Alice のページが次の人に届かないことを確かめています。404 のヘッダーの間違いを見つけたのも、この検査でした。

手元で再現しないものも、はっきりさせておきます。

- CloudFront。cache policy、behavior の振り分け、OAC の署名、`Set-Cookie` の除去は、template の assertion で設定を見ているだけです。CloudFront がそのとおりに動くことは、デプロイしないと見えません
- function URL と Lambda の runtime。`ssr:check:output` は event の形をまねていますが、Lambda そのものではありません
- 複数の実行環境。手元の開発サーバーは 1 プロセスなので、サインインがたまたま動きます
