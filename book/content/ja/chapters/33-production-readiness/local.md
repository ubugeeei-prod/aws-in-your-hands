---
title: "33 Production Readiness: 手元で動かす"
---

# 33 Production Readiness: 手元で動かす

この章のものは、すべて手元で動きます。AWS のアカウントも認証情報も要りません。このページでは、[前のページ](/ja/chapters/33-production-readiness/build.md)で作った検査を、この章の 2 つのスタックと、本のすべてのスタックに当てます。最後に、この検査が見えないものを並べます。

## 手元で動かす

<!-- section: 33.local -->

```bash
vp test run examples/33-production-readiness
vp run ready:review
vp run ready:infra:synth
vp run ready:gate
```

1 行目はテストです。ルールごとの通る例と落ちる例、例外の扱い、判定、2 つのスタックの合成と検査が入っています。テストは `cdk.out` を読みません。ルールのテストはテストの中で組み立てた小さなテンプレートを使い、スタックのテストはテストの中で合成します。ほかの章の synth が済んでいなくても通ります。

フィクスチャは 2 つあります。`test/fixtures/ready.template.json` はすべてのルールを通り、`unready.template.json` はすべてのルールに 1 件以上の指摘が出ます。2 つは同じ種類のリソースを持っています。通るほうのテンプレートにバケットがなければ、「公開されたバケットはない」という結果は、見るものがなかっただけかもしれないからです。この条件もテストにしてあります。

`ready:review` は、[概要のページ](/ja/chapters/33-production-readiness.md)の 32 項目を表示します。`vp run ready:review data` のように分野の名前を付けると、その分野だけになります。

`ready:infra:synth` は、この章の 2 つのスタックを `examples/33-production-readiness/cdk.out` に書き出します。`ready:gate` は、その 2 つに検査を当てます。

```text
note AihReadyPractice
       iam-wildcard       HandlerRoleDefaultPolicy0112C0A8: wildcard-resource: xray:PutTraceSegments on Resource "*"
       iam-wildcard       HandlerRoleDefaultPolicy0112C0A8: wildcard-resource: xray:PutTelemetryRecords on Resource "*"
       table-pitr         Notes5BB3582F: point-in-time recovery is not enabled
       stateful-delete    Notes5BB3582F: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       stateful-delete    HandlerLogs6FD01908: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       alarm-recipient    MonitoringServerErrorRate85F1112A: notifies MonitoringAlarms66989066, which has no subscription in this template
       alarm-recipient    MonitoringSlowResponses120B683C: notifies MonitoringAlarms66989066, which has no subscription in this template
ok   AihReadyProduction [gate] (2 waived with a reason)

findings by rule (chapter that does the work):
    0  bucket-public      ch.07  Objects meant for signed-in users can be read by anyone who has the URL.
    2  iam-wildcard       ch.21  A hole in one function reaches every resource the wildcard covers.
    0  function-url-auth  ch.09  The function answers requests that never passed the CDN, the WAF or sign-in.
    0  api-throttle       ch.04  One client can spend the account's whole request quota, and the bill with it.
    1  table-pitr         ch.22  A bad write or delete cannot be undone: there is no earlier state to restore.
    2  stateful-delete    ch.22  Destroying the stack, or an update that replaces the resource, deletes the data.
    0  log-retention      ch.19  Logs pile up for ever, or live in a log group nobody set a retention on.
    0  function-alarm     ch.19  The function fails for hours and the first report comes from a user.
    2  alarm-recipient    ch.19  The alarm goes to ALARM and no one is told.
    0  queue-dlq          ch.08  A message that always fails is retried until it expires, then is gone.

2 templates, 7 findings, 2 waived
gate passed: AihReadyProduction
```

行の頭の印は 3 種類です。`ok` は指摘なし、`note` は指摘があるが通過を求めていないスタック、`FAIL` は通過を求めたのに指摘があるスタックです。通過を求めるスタックは、`--gate <スタック名>` で指定します。

<<< @/examples/33-production-readiness/src/report.ts{verdict}

タスクが失敗するのは、通過を求めたスタックに指摘か使われていない例外があるとき、通過を求めたスタックのテンプレートが見つからなかったとき、読めないファイルがあったとき、テンプレートを 1 つも読めなかったときです。`AihReadyProduction` のテンプレートがなければ、`ready:gate` は「通った」ではなく失敗になります。

練習用のスタックの 7 件が、19章が「本番にするなら」に回したものの中で、テンプレートに現れるぶんです。本番向けのスタックでは、5 件が設定で消え、X-Ray の 2 件が理由つきの例外になりました。`function-alarm` が 0 件なのは、19章のアラームが関数の前の API を見ているからです。

`ready:gate` は `check:all` に入れてあります。Aspect を外したり、例外を残したまま原因を直したりすると、`check:all` が落ちます。

## 本のすべてのスタックに当てた結果

<!-- section: 33.book-stacks -->

```bash
vp run ready:check
```

このタスクは `infra:synth` に依存していて、本のすべてのスタックを合成してから、全部の `cdk.out` を読みます。通過は求めません。練習用のスタックに指摘があるのは、わざとそうしてあるからです。

次の出力は、02章から 24章までのスタックと、本のサイトのスタックの、合わせて 27 個を読んだときのものです（2026-10-13）。25章以降のスタックと、この章の 2 つは含んでいません。25章以降はこの章と同じ時期に書かれていたので、手元で実行すると、スタックの数と件数はこれより増えます。

```text
note AihAsync
       table-pitr         Notes5BB3582F: point-in-time recovery is not enabled
       stateful-delete    Content88381566: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       stateful-delete    Uploads4F6EB0FD: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       stateful-delete    Users0A0EEA89: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       stateful-delete    Notes5BB3582F: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       stateful-delete    HandlerLogs6FD01908: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       stateful-delete    WorkerLogsC1193B08: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       stateful-delete    HousekeepingLogs276FB43B: DeletionPolicy is Delete; UpdateReplacePolicy is Delete
       function-alarm     Handler886CB40B: no alarm watches the function, an API in front of it, or a queue that feeds it
       function-alarm     Worker11F36D0F: no alarm watches the function, an API in front of it, or a queue that feeds it
       function-alarm     Housekeeping4D78E60A: no alarm watches the function, an API in front of it, or a queue that feeds it
```

08章のスタックを抜き出しました。全体の集計は次のとおりです。

```text
findings by rule (chapter that does the work):
    0  bucket-public      ch.07  Objects meant for signed-in users can be read by anyone who has the URL.
    0  iam-wildcard       ch.21  A hole in one function reaches every resource the wildcard covers.
    0  function-url-auth  ch.09  The function answers requests that never passed the CDN, the WAF or sign-in.
    0  api-throttle       ch.04  One client can spend the account's whole request quota, and the bill with it.
    8  table-pitr         ch.22  A bad write or delete cannot be undone: there is no earlier state to restore.
   49  stateful-delete    ch.22  Destroying the stack, or an update that replaces the resource, deletes the data.
    1  log-retention      ch.19  Logs pile up for ever, or live in a log group nobody set a retention on.
   21  function-alarm     ch.19  The function fails for hours and the first report comes from a user.
    2  alarm-recipient    ch.19  The alarm goes to ALARM and no one is told.
    0  queue-dlq          ch.08  A message that always fails is retried until it expires, then is gone.

27 templates, 81 findings, 7 waived
report only: no stack was asked to pass (--gate <stack>)
```

81 件のうち 49 件が `stateful-delete` です。この本のスタックは、片付けたときに何も残らないように、データを持つリソースをすべて `DESTROY` にしてきました。その方針がそのまま数字になっています。27 個のうち指摘のないスタックは 5 つで、ネットワークだけのスタック、ECR のリポジトリだけのスタック、CI のロール、web ACL、そして [24章](/ja/chapters/24-celld.md)のスタックです。24章のバケットは、最初から `Retain` で作られていました。

`function-alarm` の 21 件は、アラームを持つスタックが 19章の 1 つしかないことを表しています。関数は 22 個あり、アラームのどれかが見ているのは 19章の 1 個だけです。`table-pitr` の 8 件も同じで、9 つのテーブルのうち PITR が有効なのは 22章の 1 つです。どちらも、1 つの章で一度だけ扱い、ほかの章では省いてきたものです。

0 件が並んでいる 4 つのルールにも意味があります。公開されたバケット、認証のない関数 URL、スロットリングのない API、デッドレターキューのないキューは、この本のどのスタックにもありません。これらは「本番にするなら」に回さず、最初から入れてきた設定です。誰でも呼べる入口を公開する章は、受け付ける量をその章の中で絞る、という [01章](/ja/chapters/01-account.md)の方針が、ここに表れています。`iam-wildcard` の 0 件は、21章が理由を書いた 7 件が例外として数えられているからで、出力の `7 waived` がそれです。

`log-retention` の 1 件は、[10章](/ja/chapters/10-edge.md)の Lambda@Edge の関数です。ロググループをスタックで作っていません。Lambda のドキュメントによると、関数は既定で、最初に呼ばれたときに `/aws/lambda/<関数名>` というロググループを自動で作ります。CloudWatch Logs のドキュメントによると、ログは既定では無期限に保存されます。

指摘が 81 件あるからといって、この本のスタックを 81 か所直すべきだ、ということにはなりません。練習用のスタックとしては、いまの形が正しい設定です。この出力は、同じスタックを本番に持っていくとしたら、どこから手を付けるかの一覧として読んでください。

## 検査が見えないもの

<!-- section: 33.blind-spots -->

テンプレートを読む検査が通ったときに言えるのは、「テンプレートに、こう書いてある」までです。言えないことを並べます。

**デプロイされているのが、このテンプレートかどうか。** 検査が読むのは手元の `cdk.out` です。アカウントにあるスタックが同じテンプレートから作られたのか、そのあと誰かがコンソールで変えたのかは、わかりません。これはドリフト検出（[02章](/ja/chapters/02-toolchain.md)と [20章](/ja/chapters/20-shipping.md)）の仕事です。

**テンプレートの外で決まる設定。** アカウント全体の S3 の公開ブロック、root ユーザーの MFA、Organizations の SCP、Service Quotas の値、CloudTrail の証跡、GuardDuty が有効かどうか。どれもスタックの外にあります。[21章](/ja/chapters/21-security.md)の `sec:posture` が読むのは、この種のものです。

**スタックの外にあるリソース。** [22章](/ja/chapters/22-recovery/deploy.md)で見たとおり、PITR で復元したテーブルは、スタックの外に、PITR が無効な状態でできます。コンソールで作ったバケットも同じです。テンプレートに無いものは、検査されません。

**デプロイのときに決まる値。** パラメーター、`Fn::If`、ほかのスタックからの import です。検査はこれらを「わからない」として指摘にしますが、実際の値が安全かどうかは判断していません。`Condition` 付きのリソースが実際に作られるかどうかも見ていません。

**設定が意図どおりに働くかどうか。** PITR が有効と書いてあることと、復元できることは別です。アラームに通知先があることと、深夜に人が起きることも別です。購読の確認メールのリンクを押したかどうかは、どこにも書いてありません。閾値が自分のサービスに合っているかどうかも、検査は見ていません。

**ルールが知らない経路。** `function-alarm` が辿るのは、HTTP API とキューだけです。`api-throttle` が見るのは HTTP API のステージの既定値だけで、ルートごとの設定や、REST API、ALB、CloudFront は見ていません。`bucket-public` は、条件付きのポリシーを評価しません。`queue-dlq` は、関数が読むキューだけを見ます。ルールが見ていない場所に問題があっても、出力は `ok` です。

**アプリのコード。** 他人のノートが読めないこと（[06章](/ja/chapters/06-auth.md)）、同じメッセージが 2 回届いても結果が 1 つであること（[08章](/ja/chapters/08-async.md)）は、テンプレートではなく、それぞれの章のテストが守っています。

デプロイした後の状態を継続して検査する仕組みは、AWS にあります。AWS Config の管理ルールの一覧には、この章のルールと名前の似たもの（`dynamodb-pitr-enabled`、`cw-loggroup-retention-period-check`、`s3-bucket-level-public-access-prohibited` など）が載っています。それぞれが何を評価するかは読んでおらず、有効にもしていません。Config は記録する設定 1 件ごとに料金がかかるので、入れる時期は 21章の 3 段の考え方で決めます。

テンプレートの検査は、いちばん安く、いちばん早く動く検査です。そのかわり、いちばん少ししか見えません。次のページでは、残りを分野ごとに見ていきます。
