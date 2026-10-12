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

別のターミナルから、6 回呼んでみてください。

```bash
curl -s -i http://localhost:8794/items
```

1 回目は `x-cache: miss` で、300 ミリ秒ほどかかります。2 回目からは `x-cache: hit` で、すぐ返ります。`ratelimit-remaining` が 4、3、2 と減っていき、6 回目は 429 と `retry-after` が返ります。

誰の 5 回なのかは、呼び出し元のアドレスで決めています。

<<< @/examples/14-kv-cache/src/caller.ts{address}

AWS では、API Gateway が見た送信元の IP アドレスです。イベントの `requestContext` に入っていて、呼ぶ側がヘッダーで書き換えることはできません。手元の開発サーバーでは、socket の相手のアドレスになります。`x-forwarded-for` のようなヘッダーは読みません。呼ぶ側が好きな値を書けるからです。

<<< @/examples/14-kv-cache/src/caller.ts{subject}

IPv6 は、先頭の 64 bit でまとめています。1 つのネットワークが、それだけの数のアドレスを 1 人に配るからです。アドレスが取れなかったリクエストは、全員まとめて 1 つの枠で数えます。設定を間違えたときに、緩むのではなく厳しくなるように、です。

`x-client-id` のようなヘッダーで名乗ってもらう方式にしなかったのは、防御にならないからです。別の名前を名乗れば上限は別に数えられ、名乗るたびに store の item が 1 つ増えます。認証の前に付ける rate limit は、呼ぶ側が選べないもので数えます。

IP アドレスにも限界はあります。会社や学校の出口が 1 つなら、中の全員で 5 回を分け合います。逆に、アドレスをたくさん持っている相手は、そのぶんだけ枠をもらえます。利用者を見分けたいなら、[06章](/ja/chapters/06-auth.md)の検証済みの token から ID を取ってください。IP アドレスで数えるのは、認証の手前の、大まかな歯止めです。

アプリの中では、rate limit が cache より先に走ります。

<<< @/examples/14-kv-cache/src/app.ts{limit}

`catch` の中を見てください。数える store が落ちたとき、通すのか、断るのか。これは技術ではなく、プロダクトの判断です。一覧の API なら、通したほうがいい（store の障害で API まで止めたくない）。ログインの試行なら、断ったほうがいい（守りが外れた状態で通したくない）。だから `RATE_ON_ERROR` という設定にして、`catch` の奥に埋めていません。

この章の stack は `allow` にしています。代償も書いておきます。store が落ちているあいだ、アプリの上限は効きません。同じ相手が何回でも通ります。そのとき残っている歯止めは、手前に置いた stage の throttling（API 全体で 1 秒に 10 件）だけです。それでは足りない API なら、`deny` にしてください。

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
