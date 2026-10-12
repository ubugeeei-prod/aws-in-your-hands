---
title: "47 Step Functions: デプロイ"
---

# 47 Step Functions: デプロイ

[前のページ](/ja/chapters/47-step-functions/local.md)までで、定義とそのテストが揃いました。このページでは、定義を AWS に置くスタックと、置いたあとの確かめ方、定義を変えるときの扱い、動きを見えるようにする方法を説明します。デプロイからあとの手順は、実行していません。

## スタック

<!-- section: 47.infra -->

<<< @/examples/47-step-functions/infra/lib/step-functions-stack.ts{data}

テーブルは 05章と同じキーの形で、このスタック専用です。バケットは、アップロードを置く `inbox/` と、取り込んだ添付ファイルを置く `attachments/` を 1 つにまとめています。`inbox/` のオブジェクトは 1 日で消えます。キューは `WaitForScan` の依頼を入れる場所で、メッセージは 1 日で消えます。タスクのタイムアウトは 30 分なので、1 日たった依頼に返事をする相手は、もういません。

### ロールは、定義が呼ぶ API だけを持つ

<<< @/examples/47-step-functions/infra/lib/step-functions-stack.ts{trust}

<<< @/examples/47-step-functions/infra/lib/step-functions-stack.ts{saga}

16章では、ステートマシンのロールは関数を呼ぶ権限だけを持ち、テーブルやバケットへの権限は関数のロールにありました。関数を挟まないこの章では、ステートマシンのロールが、テーブル、バケット、キュー、トピックへの権限を直接持ちます。持たせるのは、定義の `Task` が呼ぶ API だけです。テーブルを読む権限はなく、`inbox/` に書く権限も、`attachments/` の外を消す権限もありません。

専用の統合については、Step Functions が定義から IAM のポリシーを生成するときの例が、統合ごとのページに載っています。SDK 経由の統合ではポリシーを生成できない、と書かれているので、必要なアクションは自分で調べて書きます。`aws-sdk:s3:copyObject` には、コピー元の `s3:GetObject` とコピー先の `s3:PutObject` を付けました。CopyObject の API リファレンスにある権限です。これで足りるかどうかは、デプロイして確かめていません。

定義は、テストが歩いたものと同じ関数から作ります。違うのは、渡す名前だけです。手元ではただの文字列を渡し、スタックではテーブル名やキューの URL を表す CDK のトークンを渡します。`toJsonString` が、トークンを含む JSON を `Fn::Join` に変えます。

<<< @/examples/47-step-functions/infra/lib/step-functions-stack.ts{express}

Express ワークフローは、実行の履歴を Step Functions に残しません。ログの設定がなければ、失敗した実行が何で失敗したかを、あとから知る方法がありません。そこで、ロググループを作り、`ERROR` のレベルで送ります。`includeExecutionData` を `false` にしているのは、入出力にノートのタイトルが含まれるからです。

ログを送るための権限だけは、リソースを `*` にしています。ドキュメントの例がそうなっていて、これらのアクションはリソースを指定できない、と説明されています。このスタックで `*` を使うのは、ここだけです。ログの配送は best effort で、すべての実行のログが届く保証はありません。届かないと困る記録は、ワークフローのステップとして DynamoDB などに書くよう、ドキュメントは勧めています。

### テストが見ていること

<<< @/examples/47-step-functions/infra/test/step-functions-stack.test.ts{deployed-definition}

<<< @/examples/47-step-functions/infra/test/step-functions-stack.test.ts{same-definition}

スタックのテストは、合成したテンプレートから定義を取り出し、リソースへの参照を論理 ID に置き換えて JSON に戻します。その JSON が、同じ名前を渡して関数から作った定義と一致することを確かめ、さらに、取り出した定義そのものを実行器で歩かせます。手元でテストした定義と、デプロイされる定義が、別のものになっていないことを確かめるためです。

<<< @/examples/47-step-functions/infra/test/step-functions-stack.test.ts{least-privilege}

権限のテストは、ロールが持つアクションの一覧と、定義が呼ぶ `Resource` の一覧を、両方とも固定しています。定義に `Task` を足してロールを直し忘れても、ロールに権限を足して定義で使っていなくても、どちらかのテストが落ちます。

テンプレートに出てくるリソースの種類は 11 個（`AWS::DynamoDB::Table`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Logs::LogGroup`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy`、`AWS::SNS::Topic`、`AWS::SNS::TopicPolicy`、`AWS::SQS::Queue`、`AWS::SQS::QueuePolicy`、`AWS::StepFunctions::StateMachine`）で、固定した版の cdkd はどれにも専用の実装を持っています。インストールしたパッケージの中身で確かめました。

```bash
vp run sfn:infra:synth
```

## デプロイして確かめる

<!-- section: 47.deploy -->

ここから先は実行していません。用意したのは、手順とタスクまでです。

```bash
vp run sfn:infra:diff
vp run sfn:infra:deploy
vp run sfn:start --note-id note-1
vp run sfn:status
```

`sfn:start` は、`inbox/` に小さなファイルを置いてから、取り込みを 1 つ起動します。`sfn:status` を見ると、実行は `RUNNING` で、最後に入ったステートが `WaitForScan` になっているはずです。スキャナーがいないので、誰かがトークンを返すまで、実行はここで待ちます。

```bash
vp run sfn:callback --verdict clean
vp run sfn:status
vp run sfn:digest --ids note-1,nope
```

`sfn:callback` は、スキャナーの役を人が務めるためのタスクです。キューからメッセージを 1 通受け取り、入っていたトークンで `SendTaskSuccess` を呼びます。実行は `Verdict`、`Publish`、`Notify` と進んで終わり、`sfn:digest` は `note-1` を `found`、`nope` を `missing` と表示するはずです。`sfn:digest` は Express ワークフローを `StartSyncExecution` で呼び、課金された時間とメモリも表示します。

`StartSyncExecution` は、実行が失敗しても HTTP 200 を返します。成功したかどうかは、応答の `status` で見ます。スクリプトはそこを確かめてから、出力を Valibot で読みます。

取り消しの道は、別のノート ID で確かめます。

```bash
vp run sfn:start --note-id note-2
vp run sfn:callback --verdict infected
vp run sfn:status
```

実行は `ImportRolledBack` で `FAILED` になり、テーブルにも `attachments/` にも `note-2` は残らないはずです。`--fail` はスキャンそのものの失敗を `SendTaskFailure` で知らせ、`--heartbeat` は `SendTaskHeartbeat` を送ります。何も返さずに 5 分待てば、ハートビートが途切れたときの動きと、再試行で届く 2 通目のメッセージが見られます。そのときのエラー名が `States.Timeout` と `States.HeartbeatTimeout` のどちらかも、ここでわかります。

通知のトピックには、購読者がいません。`Notify` は成功しますが、誰にも届きません。届くところまで見るなら、[15章](/ja/chapters/15-email.md)や 25章のやり方で、トピックに購読を足してください。

ドリフトの検査は、これまでの章と同じです。

```bash
vp run sfn:infra:drift
```

## 定義を変える: 版、エイリアス、redrive

<!-- section: 47.versions -->

ステートマシンの定義を更新しても、動いている実行は、始まったときの定義とロールのまま最後まで進みます。新しい定義が使われるのは、更新のあとに始まった実行からです。更新の直後に始めた実行は古い定義を使うことがある、とも書かれています。

これは、待ち時間の長いワークフローでは大事な性質です。スキャンを待っている取り込みが 100 件ある状態で `Verdict` の条件を変えても、その 100 件は古い条件で判定されます。新しい定義が古い実行に効くと思い込んで直すと、直したつもりの不具合が、古い実行で起き続けます。

redrive も同じです。失敗した実行を redrive すると、失敗したステートが、そのときの入力と、**その実行が始まったときの定義**でもう一度実行されます。定義の誤りが原因で失敗した実行は、定義を直しても redrive では直りません。新しい実行を始める必要があります。redrive で直せるのは、権限、相手のサービスの障害、スロットリングのように、定義の外に原因がある失敗です。この章の「補償処理が失敗したら redrive」は、その範囲に収まっています。

```bash
vp run sfn:status --redrive <execution ARN>
```

redrive できるのは、Standard ワークフローの、成功しなかった実行で、終わってから 14 日以内のものです。再試行の回数は 0 に戻り、redrive そのものも状態遷移として課金されます。Express にはありません。

どの定義で動いているかをはっきりさせたいときは、版（version）とエイリアスを使います。版は、ある時点の定義とロールの、変更できない写しで、番号が付きます。エイリアスは、1 つか 2 つの版を指す名前です。2 つを指すときは、起動のうち何割をどちらに送るかを決められます。起動する側がエイリアスの ARN で `StartExecution` を呼ぶようにしておけば、新しい定義を一部の実行にだけ先に使わせ、問題がなければ割合を上げる、という進め方ができます。考え方は [31章](/ja/chapters/31-progressive-delivery.md)の Lambda のエイリアスと同じです。

この章のスタックは、版もエイリアスも作っていません。固定した版の cdkd に、`AWS::StepFunctions::StateMachineVersion` と `AWS::StepFunctions::StateMachineAlias` の専用の実装が見当たらず、Cloud Control API 経由で作れるかどうかを確かめていないからです。

## 動きを見えるようにする

<!-- section: 47.observability -->

Standard ワークフローの実行は、Step Functions が履歴として持っています。どのステートに、どんな入力で入り、何回再試行して、どんな出力で出たかが、実行ごとに残り、終わってから 90 日間は API とコンソールで読めます。`sfn:status` は、この履歴の末尾から、最後に入ったステートを読んでいます。

履歴は、ノートのタイトルや本文も含みます。ステートの入出力がそのまま記録されるからです。履歴を読める権限（`states:GetExecutionHistory`）は、テーブルを読める権限と同じ重さで扱います。大きなデータや見せたくないデータは、16章と同じく、S3 に置いてキーだけを流します。

失敗に気づく方法は、種類ごとに違います。

- Standard は、実行の状態が変わるたびに、EventBridge の既定のバスにイベントを送ります。`FAILED` と `TIMED_OUT` を拾うルールを書いて通知につなげば、補償処理の途中で止まった取り込みに、人が気づけます。この章の不変条件は「止まった場所から redrive できる」ところまでしか保証しないので、止まったことを誰かに知らせる経路がなければ、公開前のノートが残り続けます。Express は、このイベントを送りません
- どちらの種類も、CloudWatch の `AWS/States` に `ExecutionsFailed`、`ExecutionsTimedOut`、`ExecutionThrottled` などのメトリクスを出します。[19章](/ja/chapters/19-observability.md)のアラームを付けられます
- Express は、ロググループに送った `ERROR` のログが、失敗の中身を伝える唯一の記録です。課金されたメモリと時間は、`ExpressExecutionBilledMemory` と `ExpressExecutionBilledDuration` のメトリクスでも見られます

このスタックは、EventBridge のルールもアラームも作っていません。例を小さく保つためです。本番で足すものとして、[次のページ](/ja/chapters/47-step-functions/wrap.md)に挙げました。
