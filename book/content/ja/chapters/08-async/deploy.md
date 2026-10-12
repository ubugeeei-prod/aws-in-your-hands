---
title: "08 Queue: デプロイ"
---

# 08 Queue: デプロイ

## AWS にのせる準備

<!-- section: 08.infra -->

### queue と、その入口

<<< @/examples/08-async/infra/lib/async-stack.ts{queues}

<<< @/examples/08-async/infra/lib/async-stack.ts{queue-policy}

queue policy は、queue に付ける権限の文書です。この queue にメッセージを入れてよいのは、S3 だけ。それも、この bucket のことで、このアカウントの中から来たものだけです。`aws:SourceArn` と `aws:SourceAccount` の 2 つの条件は、公式ドキュメントの例と同じです。条件がないと、S3 というサービスを経由すれば、他人の bucket からでもこの queue にメッセージを入れられることになります。

DLQ のほうには、`Allow` が 1 つもありません。どの queue がこの DLQ を使えるかは、redrive allow policy という別の設定で決まります。既定は「すべての queue に許す」で、この章は既定のままです。

### bucket の名前を決める理由

<<< @/examples/08-async/infra/lib/async-stack.ts{bucket-name}

<<< @/examples/08-async/infra/lib/async-stack.ts{notification}

ここは、少しややこしいところです。

S3 は、通知の設定を受け取った時点で、送り先の queue に本当に送れるかを確かめます。なので、queue policy は bucket より先に存在していなければいけません。ところが queue policy には、bucket の ARN が書いてあります。bucket の名前を自動で付けていると、ARN は bucket ができるまで決まりません。bucket は policy を待ち、policy は bucket を待つ。CloudFormation のドキュメントも、この循環に名前を挙げて注意しています。

CDK の `bucket.addEventNotification` は、これを custom resource で解決します。bucket と policy を両方作った後で、通知の設定だけを別の Lambda 関数に書かせるやり方です。この章は、それを使いません。関数が 1 つ増えて、その関数には bucket の設定を書き換える権限が要り、通知の設定が template から見えなくなるからです。

かわりに、bucket の名前を決め打ちにしました。名前が決まっていれば、ARN は bucket を参照せずに書けます。循環は起きません。

手放したものもあります。bucket の名前は、世界中の AWS アカウントで重複できません。アカウント ID を含めているので、ぶつかる可能性は低いですが、ゼロではありません。そして、名前を決めた bucket は、作り直しが必要な変更（リージョンの移動など）がやりにくくなります。

別の選択肢は、S3 の通知を EventBridge に送って、EventBridge の rule から queue に入れることです。bucket の側は「EventBridge に送る」と書くだけなので、循環がありません。イベントの形と、途中に挟まるサービスが変わります。この章では試していません。

通知するのは、`u/` で始まる key の、作成と削除だけです。

### worker と、その呼ばれ方

<<< @/examples/08-async/infra/lib/async-stack.ts{worker}

worker の role は、API の関数の role とは別です。queue から読む 3 つの操作、`u/` の object を読むことと tag を外すこと、table の 3 つの操作。object を消す権限はありません。消すのは掃除の仕事です。

queue を読みにいくのは、あなたのコードではなく Lambda です。そのとき使われるのが、この関数の role です。AWS が用意している管理ポリシー（`AWSLambdaSQSQueueExecutionRole`）も同じ 3 つの操作を許しますが、対象が「すべての queue」になります。ここでは、対象を 1 つの queue にしています。

<<< @/examples/08-async/src/worker-lambda.ts{handler}

<<< @/examples/08-async/src/env.ts{env}

<<< @/examples/08-async/infra/lib/async-stack.ts{mapping}

event source mapping は、「Lambda がこの queue を読んで、この関数に渡す」という設定です。決めることが 3 つあります。

`batchSize` は 10。1 回の呼び出しで渡されるメッセージの最大数です。

`maxConcurrency` は 2。この queue のために同時に動く worker の数の上限です。設定できる最小の値です。何も設定しないと、Lambda はメッセージが溜まっているかぎり worker を増やします。ドキュメントによると、5 つから始めて、1 分ごとに最大 300 ずつ、1,250 まで。worker が増えれば、worker が書き込む先（DynamoDB）や読む先（S3）へのリクエストも同じだけ増えます。

`reportBatchItemFailures` は、さっきの partial batch response を有効にします。ドキュメントは、これを指定して初めて、関数が一部の成功を返せるようになると説明しています。付け忘れたら、worker が返した一覧は使われないはずです。

関数の同時実行数を抑える方法には、もう 1 つ、関数に付ける reserved concurrency があります。ドキュメントは、この 2 つは別の設定だと念を押しています。reserved concurrency のほうが小さいと、Lambda は queue から受け取ったメッセージを関数に渡せず、throttle されます。そのメッセージは、処理されていないのに、受け取られた回数が 1 つ増えて queue に戻ります。

### 掃除と schedule

<<< @/examples/08-async/infra/lib/async-stack.ts{housekeeping}

掃除の role は、3 つ目の role です。object の一覧と削除、tag を外すこと、table の読み取りと削除。queue には触れません。

timeout は 15 分。Lambda の上限です。この関数は、bucket の object を 1 つずつ順に見るので、枚数が増えると時間がかかります。

<<< @/examples/08-async/infra/lib/async-stack.ts{schedule}

EventBridge Scheduler は、決めた時刻や間隔で、AWS の API を 1 つ呼んでくれるサービスです。呼ぶときに使う権限が、schedule の実行 role です。関数の実行 role とは別物で、「Scheduler が、あなたの代わりに関数を呼ぶ」ための role です。

この role にできるのは、掃除の関数を呼ぶことだけです。そして、この role を使えるのは、このアカウントの default の schedule group に属する schedule だけ。公式ドキュメントは、条件に書く ARN を個々の schedule ではなく schedule group にするように、と指定しています。

`retryPolicy` は、Scheduler が関数を呼ぶこと自体に失敗したときの再試行です。3 回まで、15 分以内。それでだめなら、その回はあきらめます。次の回が 1 時間後に来るからです。

### テストが見ていること

テストは、template に対して次を確かめます。synth は、ファイルの先頭で 1 回だけです。

- queue policy の `Allow` が 1 つだけで、principal が S3、action が `sqs:SendMessage`、条件が bucket の ARN とアカウントである
- queue policy が bucket のリソースを参照していない。bucket は queue policy の後に作られる
- 通知の設定が template に直接書かれていて、`Custom::` で始まるリソースが 1 つもない
- visibility timeout が worker の timeout の 6 倍で、DLQ の保持期間が元の queue より長い
- event source mapping が、batch 10、同時実行 2、`ReportBatchItemFailures` である
- worker と掃除の role の action が、上に書いたものちょうどで、`*` がない
- schedule の role を使えるのが Scheduler だけで、できるのが掃除の関数の呼び出しだけである

使っているリソースの種類は、07章の 19 種類に 5 種類を足した 24 種類です。足した 5 つ（`AWS::SQS::Queue`、`AWS::SQS::QueuePolicy`、`AWS::Lambda::EventSourceMapping`、`AWS::Lambda::EventInvokeConfig`、`AWS::Scheduler::Schedule`）は、固定した版の cdkd がどれも専用の実装を持っていることを、`v0.296.28` のタグのソースで確かめました。`AWS::S3::Bucket` の実装が `BucketName` と `NotificationConfiguration` を扱うことも、同じソースで確かめています。

## デプロイして確かめる

<!-- section: 08.deploy -->

ここから先は、実行していません。手順とタスクを用意したところまでです。

```bash
vp run async:infra:diff
vp run async:infra:deploy
vp run async:smoke
```

`async:smoke` は、あなたの認証情報で bucket に小さな PNG を直接置いて、worker の記録が table に現れるのを待ちます。続けて、同じ key を画像でないもので置き換えて、記録が「だめ」に変わり、sequencer が大きくなることを確かめます。最後に object を消して、記録が消えるのを待ちます。S3、SQS、Lambda、DynamoDB を 1 周する確認です。待つのは、それぞれ最大 90 秒です。

ブラウザからも使うなら、07章と同じ手順です。

```bash
vp run async:user:create you@example.com
vp run async:publish
vp run async:smoke:web
```

サインインして得た access token を環境変数 `AIH_ACCESS_TOKEN` に入れて `async:smoke` を実行すると、form でのアップロードも確かめます。完了した後に同じ form をもう一度送って、pending の tag が外れるのを待ちます。この章の「まだ」のうち、いちばん大事なもの（POST のイベントに sequencer が入るか）は、ここでわかります。

schedule は、作られるとすぐに 1 回目を起動します。開始日を指定していない rate の schedule は、そう動くとドキュメントにあります。

drift の検査は、これまでと同じです。

```bash
vp run async:infra:drift
```

## 溜まったとき、落ちたとき

<!-- section: 08.operate -->

### queue が伸びる

アップロードが急に増えて、worker が追いつかなくなったら、どうなるでしょう。

何も失敗しません。メッセージが queue に溜まるだけです。worker は同時に 2 つまでしか動かないので、DynamoDB や S3 へのリクエストが急に増えることもありません。遅れは、「検査の結果が出るのが遅くなる」という形で現れます。これが backpressure です。queue は、流量の差を待ち行列の長さとして引き受けてくれます。

ただし、引き受けられるのは保持期間までです。この章の queue は、メッセージを 4 日保持します。4 日たっても処理されなかったメッセージは、消えます。DLQ にも行きません。見るべき数字は、queue の長さよりも、いちばん古いメッセージの年齢（CloudWatch の `ApproximateAgeOfOldestMessage`）です。アラームの組み立て方は [19章](/ja/chapters/19-observability.md)にあります。

では、queue に入ってくる量のほうは、何が絞っているのでしょう。

この queue に送れるのは S3 だけで、それも、この bucket の `u/` の下で起きたことだけです。そこに object を置けるのは、許可証を持った人。許可証は 07章の API が出すもので、API には 1 秒 10 リクエストの throttle があり、1 人が受け取れるのは 1 日 100 枚までです。作成で 1 件、削除や lifecycle の失効でもう 1 件。ふつうに使われているかぎり、1 人が 1 日に起こせるイベントは数百件で、worker が追いつけない量にはなりません。

絞れていない道が 1 つあります。07章で話したとおり、許可証は 5 分間、何度でも使えます。同じ form を送り直すたびに、S3 は object を置き換えて、作成のイベントをもう 1 件送ります。これは API を通らないので、throttle も、1 日 100 枚の上限も効きません。サインインした利用者が同じ form を送り続けると、queue は伸びます。

そのとき、守られるものと、守られないものがあります。

- **worker は増えません。** 同時に 2 つまで。1 件 200 ミリ秒という「お金の話」の仮定なら、さばけるのは 1 秒に 10 件ほど、1 日で約 86 万件です
- **DynamoDB へのリクエストも増えません。** worker が 2 つなら、書き込みも読み取りも、それに比例した量までです。それに、table には 07章と同じ request unit の上限があります
- **追いつけなかったぶんは、4 日で消えます。** 上の仮定なら、4 日でさばけるのは約 346 万件。それより多く溜まったメッセージは、処理されないまま消えます。その画像は、検査されていません
- **料金は、届いたイベントの数に比例します。** queue に入れること自体は、止まりません

queue は、流量の差を引き受けてくれますが、流量そのものを絞ってはくれません。絞るのは、入口の仕事です。

### DLQ を見る

```bash
vp run async:queue
vp run async:logs
```

`async:queue` は、2 つの queue に溜まっているおよその件数と、DLQ の先頭 10 件までの中身を表示します。メッセージは動かしません。visibility timeout を 0 にして受け取っているので、見た後もそのまま見えています（受信回数だけは増えます）。

DLQ にメッセージがあったら、まず worker のログで、その key の `message failed` の行を探してください。理由が書いてあります。

- 理由が一時的なもの（DynamoDB や S3 の一時的なエラー、デプロイ直後の権限の反映待ち）で、もう直っている
- 理由がコードや設定の誤りで、まだ直っていない
- メッセージそのものが読めない

戻してよいのは、1 つ目だけです。2 つ目は、直してから。3 つ目は、戻しても同じことが起きるだけです。

```bash
vp run async:queue --redrive
```

DLQ のメッセージを、元の queue に戻します（redrive）。公式ドキュメントによると、戻されたメッセージは新しいメッセージとして扱われて、新しい ID が付き、保持期間も数え直されます。redrive の途中でメッセージを選んだり書き換えたりはできません。全部が戻ります。

戻したメッセージが、すでに処理済みのイベントだったとしても、何も起きません。そのために、ここまでやってきました。
