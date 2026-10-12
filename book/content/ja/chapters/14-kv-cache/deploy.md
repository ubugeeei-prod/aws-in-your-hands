---
title: "14 Cache: デプロイ"
---

# 14 Cache: デプロイ

## AWS にのせる準備

<!-- section: 14.infra -->

手元で動かした API を、AWS にのせます。スタックは、既定では DynamoDB のテーブルと、Lambda と、HTTP API だけを作ります。

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{table}

`timeToLiveAttribute` が TTL の設定です。テーブルの側で決めるのは「どの属性を見るか」だけで、いつ消すかは項目ごとに書きます。

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{role}

ロールに許しているのは、ストアが呼ぶ 4 つの操作だけで、`Query` も `Scan` もありません。

この API は、URL を知っていれば誰でも呼べます。そのため、上限を 2 つ、最初から付けてあります。

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{bounds}

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{throttle}

1 つ目は、HTTP API のステージのスロットリングです。API 全体で 1 秒に 10 件、バーストは 20 件までを受け付けます。超えたぶんには API Gateway が 429 を返し、Lambda も DynamoDB も呼ばれません。アプリのレート制限が 1 つのアドレスあたりの回数を公平に配るのに対し、ステージのスロットリングは全員の合計を抑えます。

2 つ目は、テーブルの上限です。オンデマンドのテーブルには、もともと上限がありません。`maxWriteRequestUnits` と `maxReadRequestUnits` を付けると、1 秒あたりの単位がその値を超えたぶんを、DynamoDB がスロットリングします。値は、ステージのスロットリングが通す量の少し上にしました。1 秒に通るのは多くて 30 件（バーストの 20 件と、その 1 秒に補充される 10 件）です。書き込みはリクエスト 1 件につき 1 単位で、キャッシュの詰め直しに 3 単位かかるので、書き込みの上限は 40 にしました。読み取りの上限は、滑る窓の 2 回ぶんを見込んで 60 です。ふだんは当たらず、ステージのスロットリングが外れたときにだけ効く、2 つ目の歯止めにあたります。上限に当たると、数えるストアが失敗するので、API は `RATE_ON_ERROR` の設定どおりに振る舞います（[手元で動かす](/ja/chapters/14-kv-cache/local.md)）。

Valkey は、明示したときだけ作ります。

<<< @/examples/14-kv-cache/infra/bin/app.ts{context}

<<< @/examples/14-kv-cache/infra/lib/kv-cache-stack.ts{valkey}

設定を上から順に見ていきます。

`connectionType: "public"` と `userGroupId` は、必ず組にして確かめてください。`default.iam-user-group` は、ElastiCache がアカウントに用意している、IAM 認証のユーザーだけが入ったグループです。パブリックなキャッシュに、パスワードで認証するユーザーのいるグループを付けてしまう事故を、テストで防いでいます。

`cacheUsageLimits` は、保存量と ECPU の上限です。この上限を超えると、ElastiCache はキーを追い出し、リクエストを絞ります。性能が落ちるかわりに、請求に上限ができます。

`elasticache:Connect` は、キャッシュとユーザーの 2 つの ARN に対してだけ許していて、`*` はありません。

cdkd がこれらのリソースをどう扱うかも確かめました。固定した版（0.296.28）は、テーブル、関数、ロール、ロググループ、HTTP API には専用の実装を持っています。`AWS::ElastiCache::ServerlessCache` には専用の実装がなく、Cloud Control API 経由で扱われます。また、この種類は cdkd の「状態を持つリソース」の一覧に入っているので、作り直しを伴う変更（接続の種類の変更など）には `--force-stateful-recreation` が要ります。スタックが使うリソースの種類は、テストが一覧で固定しています。

2 つの上限については、同じ版のソースで、ステージの実装が `DefaultRouteSettings` を、テーブルの実装が `OnDemandThroughput` を、そのまま AWS の API に渡していることを読みました。確かめたのはソースを読んだところまでで、実際に反映されるかどうかは、デプロイして確かめるまでわかりません。

## デプロイして確かめる

<!-- section: 14.deploy -->

```bash
vp run kv:infra:diff
vp run kv:infra:deploy
vp run kv:smoke
```

`kv:smoke` は、`GET /items` を続けて呼び、何回目で 429 になるかと、`x-cache` の移り変わりを表示します。DynamoDB 版なら、どの実行環境が応答しても、6 回目で断られるはずです。数えているのは送信元のアドレスなので、1 分以内にもう一度流すと、前の回のぶんが残っていて、もっと早く断られます。

Valkey 版を試すなら、同じタスクにコンテキストを付けます。

```bash
vp run kv:infra:deploy -c store=valkey
vp run kv:smoke
vp run kv:infra:destroy -c store=valkey
```

キャッシュは、作った瞬間から消すまで課金されます。3 行目の `destroy` まで、続けて実行してください。

うまくつながらないときは、ログを見ます。

```bash
vp run kv:logs
```

`valkey connection error`、`cache store failed`、`rate limiter failed` のどれかが出ているはずです。キャッシュが落ちていても API は 200 を返し続けるので、応答だけを見ていても気づけません。`x-cache` がずっと `miss` のままなら、キャッシュに届いていないと考えてください。

ドリフトは、02章と同じやり方で検査します。

```bash
vp run kv:infra:drift
```

この節のコマンドは、どれも実際の AWS では動かしていません。とくに Valkey 版には、未確認の点が多くあります。CloudFormation がこの設定の組み合わせを受け付けるか、自作のトークンが通るか、iovalkey がパブリックエンドポイントでクラスターの構成を読めるか、といった点です。内訳と再開の手順は、[最後のページ](/ja/chapters/14-kv-cache/wrap.md)の「この章の検証メモ」にまとめました。
