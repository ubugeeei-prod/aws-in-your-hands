---
title: "14 Cache: 手元で動かす"
---

# 14 Cache: 手元で動かす

## 手元で動かす

<!-- section: 14.local -->

まずはメモリで。`examples/14-kv-cache/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/14-kv-cache/.env.example

```bash
vp run dev:kv
```

別のターミナルから、同じ利用者として 6 回呼んでみてください。

```bash
curl -s -i -H 'x-client-id: alice' http://localhost:8794/items
```

1 回目は `x-cache: miss` で、300 ミリ秒ほどかかります。2 回目からは `x-cache: hit` で、すぐ返ります。`ratelimit-remaining` が 4、3、2 と減っていき、6 回目は 429 と `retry-after` が返ります。`x-client-id` を付けないと 400 です。

この `x-client-id` は、呼ぶ側が自分で名乗っているだけです。別の名前を名乗れば、上限は別に数えられます。つまり、これは防御になっていません。本物の API では、[06章](/ja/chapters/06-auth.md)の検証済みの token から利用者の ID を取ります。認証の前に付ける rate limit なら、IP アドレスなど、呼ぶ側が自由に選べないものを使います。

アプリの中では、rate limit が cache より先に走ります。

<<< @/examples/14-kv-cache/src/app.ts{limit}

`catch` の中を見てください。数える store が落ちたとき、通すのか、断るのか。これは技術ではなく、プロダクトの判断です。一覧の API なら、通したほうがいい（store の障害で API まで止めたくない）。ログインの試行なら、断ったほうがいい（守りが外れた状態で通したくない）。だから `RATE_ON_ERROR` という設定にして、`catch` の奥に埋めていません。

どの store を使うかは、起動時に環境変数で決まります。

<<< @/examples/14-kv-cache/src/env.ts{env}

<<< @/examples/14-kv-cache/src/compose.ts{stores}

### Valkey と DynamoDB Local で動かす

本物のサーバーに対して動かすには、コンテナを 2 つ立てます。

```bash
vp run kv:local:start
vp run kv:local:migrate
vp run kv:test:local
```

`kv:local:start` は Docker の daemon が動いている必要があります。devShell に入っても Docker は付いてこないので、Docker Desktop などを別に起動しておいてください。立ち上がるのは `valkey/valkey:9.0.6-alpine`（ポート 6390）と `amazon/dynamodb-local:3.3.1`（ポート 8001）です。

`kv:test:local` は、さっきの contract test を、この 2 つに対して流します。どちらかが動いていなければ、skip ではなく失敗します。skip は、ぱっと見では成功に見えるので。

`.env` の `KV_STORE` を `valkey` か `dynamodb` に変えれば、`vp run dev:kv` もそちらを使います。

1 つ、正直に書いておきます。この章を書いたマシンには Docker の daemon が無く、`kv:local:start` は実行できていません。かわりに、Valkey 9.1.2 と DynamoDB Local 3.3.1 をコンテナではなくプロセスとして立てて、contract test の 22 件と `dev:kv` を通しました。テストとアプリは本物のサーバーで確かめてあり、コンテナを立てるタスクだけが未確認、という状態です。

手元で再現しないものも、書いておきます。

- **IAM と TLS。** 手元の Valkey は、パスワードも TLS もありません。token の署名と TLS 1.3 の接続は、ElastiCache でしか確かめられません
- **cluster mode。** 手元の Valkey は 1 台です。ElastiCache Serverless は cluster mode で、client の動きが変わります
- **TTL による削除。** 手元では、期限切れの item が消えるかどうかに頼っていません
- **実行環境が複数あること。** 開発サーバーはプロセスが 1 つなので、メモリの rate limit も正しく動いて見えます

最後のは、とくに気をつけてください。`KV_STORE=memory` は、手元では完璧に見えて、Lambda にのせた瞬間に上限が緩みます。
