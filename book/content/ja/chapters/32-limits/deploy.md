---
title: "32 Limits: デプロイ"
---

# 32 Limits: デプロイ

## デプロイして確かめる

<!-- section: 32.deploy -->

ここからは AWS にデプロイして、上限を実物で確かめる手順です。ただし、このページの手順は、まだ実際の AWS で通せていません。

```bash
vp run limits:infra:diff
vp run limits:infra:deploy
```

渡せる値は 5 つあります。

<<< @/examples/32-limits/infra/bin/app.ts{context}

何も渡さなければ、予約済み同時実行数は付かず、予算は月 5 USD で通知先が無く、アラームはどこにも通知しません。全部を付けると、次のようになります。

```bash
vp run limits:infra:deploy -c reservedConcurrency=5 -c budgetEmail=you@example.com -c alarmTopicArn=<19章のスタックの AlarmTopicArn>
```

`reservedConcurrency` を付けたデプロイが同時実行数のエラーで断られたら、アカウントのクォータを見ます。

```bash
vp run limits:quotas --service lambda
```

同時実行数のクォータが 100 に 5 を足した数より小さければ、5 は予約できません。外してデプロイし、歯止めはステージのスロットリングに任せます。

メールアドレスは、テンプレートと cdkd の state に入ります。共有のアドレスを使うか、省略してください。

デプロイできたら、スタックの出力の `ApiUrl` に数件のリクエストを送り、API が動いていることを確かめます。そのうえで見ておきたいのは、次の 3 つです。

- ステージの設定。`aws apigatewayv2 get-stage` でステージを読み、`DefaultRouteSettings` と、`RouteSettings` の `POST /notes` が入っているかを見ます
- 429 の中身。`curl -i` を 1 秒のうちに 30 回ほど続けて送り、429 のヘッダーとボディを見ます。`Retry-After` が付いていれば、[しくみと実装](/ja/chapters/32-limits/build.md)のクライアントはそれに従います
- 関数の設定。`-c reservedConcurrency=5` を付けたなら、コンソールの関数の画面で、同時実行数が 5 と表示されることを見ます

`curl` を 30 回送る程度は、ふだんの動作確認の範囲です。流量を上げていく試験は、[手元で動かす](/ja/chapters/32-limits/local.md)の最後に書いた理由で、この章の手順には入れていません。

cdkd については、固定している版（0.296.28）のソースを読みました。このスタックが使うリソースの種類には、予算（`AWS::Budgets::Budget`）も含めて、すべて専用の実装があります。予約済み同時実行数、ステージの `DefaultRouteSettings` と `RouteSettings` を扱うコードも、導入済みのパッケージにあります。動かして確かめてはいません。

ドリフトの検査は、これまでの章と同じです。

```bash
vp run limits:infra:drift
```

上限の設定は、障害の最中にコンソールで変えられがちです。関数を止めるために予約済み同時実行数を 0 にした、流量を通すためにステージの値を上げた、という変更は、落ち着いたあとでソースに戻すか、ドリフトとして見つける必要があります。

## 費用をタグで分ける

<!-- section: 32.allocation -->

1 つのアカウントにいくつもスタックがあると、請求はサービスごとの合計でしか見えません。Lambda にいくらかかったかはわかっても、どのアプリの Lambda なのかはわかりません。内訳を分ける道具がタグです。

<<< @/examples/32-limits/src/cost.ts{tags}

<<< @/examples/32-limits/infra/lib/limits-stack.ts{tags}

`Tags.of(this).add` は、スタックの中の、タグを付けられるすべてのリソースに同じタグを付けます。テストでは、テーブル、関数、ロググループ、API、ステージにタグが入っていることを確かめています。

タグを付けただけでは、請求には何も起きません。タグのキーを、コスト配分タグ（cost allocation tag）として有効にする必要があります。この操作はテンプレートではできず、手作業です。

1. Billing and Cost Management のコンソールで **Cost allocation tags** を開く
2. `project` のキーを選び、**Activate** を押す

ドキュメントによると、リソースにタグを付けてから、キーがこの画面に現れるまでに最大 24 時間かかり、有効にしてから反映されるまでに、さらに最大 24 時間かかります。練習用のスタックをその日のうちに消すと、タグ別の費用は一度も見られません。また、この画面を操作できるのは、Organizations の管理アカウントか、組織に入っていない単独のアカウントだけです。

待たなければならないので、タグは最初のリソースを作る前に決めておきます。あとから「先月のこのアプリの費用」を知りたくなっても、タグが有効でなかった期間のぶんは分けられません。さかのぼって反映する backfill のページがドキュメントにありますが、この章では読んでいません。

### タグごとに集計する

有効になったら、Cost Explorer でタグごとに費用を見られます。ここでは、API を呼ぶスクリプトで集計します。

```bash
vp run limits:cost:print
```

```text
aws ce get-cost-and-usage --time-period Start=2026-10-01,End=2026-10-12 --granularity MONTHLY --metrics UnblendedCost --group-by Type=TAG,Key=project Type=DIMENSION,Key=SERVICE --region us-east-1
```

<<< @/examples/32-limits/src/cost.ts{args}

期間の終わりは「その日を含まない」決まりです。今日のぶんはまだ数えている途中なので、今月の 1 日から昨日までを取ります。

<<< @/examples/32-limits/src/cost.ts{period}

`:print` の付かないタスクは、実際に API を呼びます。

```bash
vp run limits:cost
```

**このタスクは、実行するたびに 0.01 USD かかります。** Cost Explorer の API は、リクエスト 1 件ごとの課金です。結果が 1 ページに収まらないときに次のページを取ると、もう 1 件ぶんかかるので、スクリプトは 1 ページ目で止めて、そのことを表示します。この章では実行していません。

応答は、スキーマで確かめてから読みます。

<<< @/examples/32-limits/src/cost.ts{response}

金額は文字列で返ってきます。表示するまで、文字列のまま持ちます。

<<< @/examples/32-limits/src/cost.ts{breakdown}

タグで集計した結果のキーは、`project$aih-notes` のように、キーと値を `$` でつないだ形です。値が無いものは `project$` になります。タグの付いていないリソースと、タグが届かない料金がここに入ります。スクリプトはこれを「タグなし」として分け、タグのある合計と並べて表示します。

タグなしの合計は 0 になりません。このスタックのどの料金がタグを運ぶかは、請求で確かめられていませんが、税のようにリソースに結び付かない行は、タグを持ちようがありません。最初は、タグなしの額が全体のどれくらいかを見て、大きければ、タグの付いていないリソースを探します。

### タグで絞った予算

01章で作った予算は、アカウント全体の金額を見ていました。同じ仕組みを、タグで絞って使えます。

<<< @/examples/32-limits/infra/lib/limits-stack.ts{budget}

この予算が数えるのは、`project` が `aih-notes` の費用だけです。通知は、実績が 80% を超えたときと、月末の予測が 100% を超えたときの 2 回です。予算の監視と通知には、料金がかかりません。

予算について、3 つ断っておきます。1 つ目は、予算は知らせるだけで、何も止めないことです。支出を止めるのは、[前のページ](/ja/chapters/32-limits/build.md)の歯止めのほうです。2 つ目は、タグが有効になるまで、この予算は何も数えないことです。3 つ目は、`FilterExpression` に書くタグのキーの形を、確かめられていないことです。CDK の型に従って `project` と書きましたが、請求のレポートでは利用者が定義したタグに `user:` という接頭辞が付きます。予算のフィルターでどちらを書くのかは、ドキュメントからは読み取れませんでした。デプロイしたら、コンソールで予算のフィルターを開いて確かめてください。
