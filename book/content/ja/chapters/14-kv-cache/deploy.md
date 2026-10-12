---
title: "14 Cache: デプロイ"
---

# 14 Cache: デプロイ

## AWS にのせる準備

<!-- section: 14.infra -->

stack は、既定では DynamoDB の table と、Lambda と、HTTP API だけを作ります。

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{table}

`timeToLiveAttribute` が、TTL の設定です。table の設定は「どの属性を見るか」だけで、いつ消すかは item ごとに書きます。

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{role}

許しているのは、store が呼ぶ 4 つの操作だけです。`Query` も `Scan` もありません。

この API は、URL を知っていれば誰でも呼べます。なので、上限を 2 つ、最初から付けてあります。

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{bounds}

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{throttle}

1 つ目は、HTTP API の stage の throttling です。API 全体で 1 秒に 10 件、burst は 20 件まで。超えたぶんには API Gateway が 429 を返し、Lambda も DynamoDB も呼ばれません。アプリの rate limit は「1 つのアドレスあたり」を公平に配るもの。こちらは「全員の合計」に蓋をするものです。

2 つ目は、table の上限です。on-demand の table には、もともと天井がありません。`maxWriteRequestUnits` と `maxReadRequestUnits` を付けると、1 秒あたりの単位がそこを超えたぶんを、DynamoDB が throttle します。値は、throttling が通す量の少し上にしました。1 秒に通るのは多くて 30 件（burst の 20 件と、その 1 秒に補充される 10 件）。書き込みは 1 件につき 1 単位で、cache の詰め直しに 3 単位。なので書き込みは 40、読み取りは滑る窓の 2 回ぶんを見て 60 です。ふだんは当たらず、throttling が外れたときにだけ効く、2 枚目の蓋だと思ってください。当たると数える store が失敗するので、API は `RATE_ON_ERROR` のとおりに振る舞います。

Valkey は、明示したときだけ作ります。

<<< @/examples/14-kv-cache/infra/bin/app.ts{context}

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{valkey}

順に見ていきます。

`connectionType: "public"` と `userGroupId` は、必ず一緒に見てください。`default.iam-user-group` は、ElastiCache がアカウントに用意している、IAM 認証の利用者だけの group です。public な cache に、パスワードの利用者がいる group を付ける、という事故を、テストで防いでいます。

`cacheUsageLimits` は、保存量と ECPU の上限です。これを超えると、ElastiCache は key を追い出し、リクエストを絞ります。性能を落としてでも、請求を青天井にしないための設定です。

`elasticache:Connect` の許可は、cache と利用者の 2 つの ARN に対してだけ。`*` はありません。

cdkd との関係も確かめました。固定した版（0.296.28）は、table、関数、role、log group、HTTP API には専用の実装を持っています。`AWS::ElastiCache::ServerlessCache` には専用の実装がなく、Cloud Control API 経由で扱われます。また、この種類は cdkd の「状態を持つリソース」の一覧に入っているので、作り直しを伴う変更（接続の種類の変更など）には `--force-stateful-recreation` が要ります。テストが、stack が使うリソースの種類を一覧で固定しています。

上限の 2 つについては、同じ版のソースで、stage の実装が `DefaultRouteSettings` を、table の実装が `OnDemandThroughput` を、そのまま AWS の API に渡していることを読みました。読んだだけです。実際に反映されるかどうかは、デプロイして確かめるまでわかりません。

## デプロイして確かめる

<!-- section: 14.deploy -->

```bash
vp run kv:infra:diff
vp run kv:infra:deploy
vp run kv:smoke
```

`kv:smoke` は、`GET /items` を続けて呼び、何回目で 429 になるかと、`x-cache` の移り変わりを表示します。DynamoDB 版なら、どの実行環境が応答しても、6 回目で断られるはずです。数えているのは送信元のアドレスなので、1 分以内にもう一度流すと、前の回のぶんが残っていて、もっと早く断られます。

Valkey 版を試すなら、同じタスクに context を付けます。

```bash
vp run kv:infra:deploy -c store=valkey
vp run kv:smoke
vp run kv:infra:destroy -c store=valkey
```

繰り返しになりますが、cache は作った瞬間から消すまで課金されます。3 行目まで、続けて実行してください。

うまくつながらないときは、ログを見ます。

```bash
vp run kv:logs
```

`valkey connection error`、`cache store failed`、`rate limiter failed` のどれかが出ているはずです。cache が落ちていても API は 200 を返し続けるので、応答だけを見ていると気づけません。`x-cache` がずっと `miss` のままなら、cache に届いていない合図です。

drift の検査は、02章と同じです。

```bash
vp run kv:infra:drift
```

正直に言うと、この節のコマンドは、どれも実際の AWS では動かしていません。とくに Valkey 版は、未確認の点が多くあります。CloudFormation がこの設定の組み合わせを受け付けるか、自作の token が通るか、iovalkey が public endpoint の cluster 構成を読めるか。章末の検証メモに、内訳と再開の手順をまとめました。
