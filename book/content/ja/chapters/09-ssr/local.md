---
title: "09 SSR: 手元で動かす"
---

# 09 SSR: 手元で動かす

[しくみと実装](/ja/chapters/09-ssr/build.md)で書いたキャッシュの判定、BFF、ストリーミングを、AWS を使わずに手元で動かして確かめます。

## 手元で動かす

<!-- section: 09.local -->

`examples/09-ssr/.env.example` を、同じディレクトリに `.env` という名前でコピーします。

<<< @/examples/09-ssr/.env.example

```bash
vp run dev:ssr
```

<http://localhost:3000> で Nuxt の開発サーバーが立ち上がります。別のターミナルから、レスポンスのヘッダーを見ます。

```bash
curl -s -o /dev/null -D - http://localhost:3000/
curl -s -o /dev/null -D - http://localhost:3000/me
curl -s -o /dev/null -D - -H 'cookie: theme=dark' http://localhost:3000/
```

1 つ目は `cache-control: public, max-age=0, s-maxage=60` で、2 つ目と 3 つ目は `private, no-store` です。3 つ目は公開ページへのリクエストですが、cookie が付いているので共有を許しません。

ブラウザで `/me` を開くと、名前を入れるフォームが出ます。サインインすると `/me` に名前が出ます。開発者ツールで cookie を見ると、`HttpOnly` が付き、`Path` が `/me` になっています。

`/feed` は、1 行ずつ間をおいて届きます。

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

`test:unit` は、判定の関数、共有キャッシュ越しの漏れの再現、セッションの期限、アセットを置く計画、CDK のスタックをテストします。`typecheck` は `core/`、`server/`、`infra/`、`scripts/` を TypeScript で検査し、`typecheck:ssr` と `lint:ssr` は `app/` の `.vue` を Vize で検査します。この章の `tsconfig.json` だけは、モジュールの解決を `Bundler` にしています。他のサンプルと同じ `NodeNext` では、`nitropack/runtime` の型定義から `defineNitroPlugin` を解決できなかったためです。

この章にだけある検査が、もう 1 つあります。

```bash
vp run ssr:check:output
```

`nuxt build` を実行し、できあがった `.output/server/index.mjs` を、function URL と同じ形の event で呼ぶ検査です。AWS もネットワークも使いません。

<<< @/examples/09-ssr/scripts/check-output.ts{replay}

Alice としてサインインし、その cookie で `/me` を開き、続けて cookie なしで同じパスを開きます。このとき、[「漏れを、決まった順序で再現する」](/ja/chapters/09-ssr/build.md)で使った雑な共有キャッシュをあいだに挟みます。本物の Nuxt アプリが返すヘッダーのもとで、Alice のページが次の人に届かないことを確かめる検査です。404 のレスポンスに `public` を付けていた間違いを見つけたのも、この検査でした。

手元で再現しないものは、次の 3 つです。

- CloudFront。キャッシュポリシー、ビヘイビアの振り分け、OAC の署名、`Set-Cookie` の除去は、テンプレートのアサーションで設定を確かめているだけです。CloudFront がその設定どおりに動くことは、デプロイしないとわかりません
- function URL と Lambda のランタイム。`ssr:check:output` は event の形をまねていますが、Lambda そのものではありません
- 複数の実行環境。手元の開発サーバーは 1 プロセスなので、メモリに置いたセッションでもサインインが動きます
