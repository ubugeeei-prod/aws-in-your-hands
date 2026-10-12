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

Valkey は、明示したときだけ作ります。

<<< @/examples/14-kv-cache/infra/bin/app.ts{context}

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{valkey}

順に見ていきます。

`connectionType: "public"` と `userGroupId` は、必ず一緒に見てください。`default.iam-user-group` は、ElastiCache がアカウントに用意している、IAM 認証の利用者だけの group です。public な cache に、パスワードの利用者がいる group を付ける、という事故を、テストで防いでいます。

`cacheUsageLimits` は、保存量と ECPU の上限です。これを超えると、ElastiCache は key を追い出し、リクエストを絞ります。性能を落としてでも、請求を青天井にしないための設定です。

`elasticache:Connect` の許可は、cache と利用者の 2 つの ARN に対してだけ。`*` はありません。

cdkd との関係も確かめました。固定した版（0.296.28）は、table、関数、role、log group、HTTP API には専用の実装を持っています。`AWS::ElastiCache::ServerlessCache` には専用の実装がなく、Cloud Control API 経由で扱われます。また、この種類は cdkd の「状態を持つリソース」の一覧に入っているので、作り直しを伴う変更（接続の種類の変更など）には `--force-stateful-recreation` が要ります。テストが、stack が使うリソースの種類を一覧で固定しています。

## デプロイして確かめる

<!-- section: 14.deploy -->

```bash
vp run kv:infra:diff
vp run kv:infra:deploy
vp run kv:smoke
```

`kv:smoke` は、新しい利用者 ID で `GET /items` を続けて呼び、何回目で 429 になるかと、`x-cache` の移り変わりを表示します。DynamoDB 版なら、どの実行環境が応答しても、6 回目で断られるはずです。

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
