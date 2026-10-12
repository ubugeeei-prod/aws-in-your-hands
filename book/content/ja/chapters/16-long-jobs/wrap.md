---
title: "16 Workflow: 費用、注意点、片付け"
---

# 16 Workflow: 費用、注意点、片付け

## 料金

<!-- section: 16.cost -->

金額は USD、東京リージョン、従量課金、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

この章で新しく出てくる単価は、Standard ワークフローの状態遷移（state transition）です。1 回あたり USD 0.000025 で、1,000 回で 2.5 セントになります。毎月 4,000 回までは無料で、料金ページによると、この無料枠に期限はありません。再試行も redrive も、状態遷移として数えられます。

テーブルに 1 KB のノートが 10,000 件あり、1 日 1 回エクスポートする月を考えます。

| 構成 | 定価 | 無料枠を引いた後 |
| --- | --- | --- |
| ノートが 1 件もない（置いてあるだけ） | 0.00 | 0.00 |
| この章の既定（1 回の呼び出しで全ページ） | 0.03 | 0.02 |
| 1 ページごとにワークフローに戻る | 0.18 | 0.07 |
| durable function 版 | 0.03 | 0.02 |
| 比較: 1 時間のステップを、毎日 Fargate のタスクで | 0.52 | 0.52 |

どの金額も小さく、この規模のエクスポートはほとんど無料で動きます。注目してほしいのは、2 行目と 3 行目の差です。

仕事も出力も同じなのに、定価が 6 倍違います。違うのは状態遷移の数だけです。既定の構成は 1 回の実行で 6 回、月に 180 回です。1 ページごとに戻る構成は 1 回の実行で 204 回、月に 6,120 回で、無料枠の 4,000 回を超えます。チェックポイントの粒度は、料金を決める設定でもあるわけです。ノートが 100 倍になれば、3 行目の状態遷移も 100 倍になり、その前に 25,000 イベントの履歴の上限に当たります。

状態遷移の数は、料金ページの例の数え方に合わせた見積もりです。料金ページの例は、ステートが 2 つのワークフローを 4 回と数えていて、開始と終了も 1 回ずつ数に入れています。実際の請求では確かめていません。

### 待つことの値段

長い処理には、人の承認を待つ、外のサービスの完了を待つ、明日まで待つ、といった待ち時間が付きものです。待っている間に何が課金されるかは、道具ごとに違います。

- Standard ワークフローは、状態遷移の数だけに課金されます。`Wait` ステートで 1 日待っても 1 か月待っても、待つ前と後の遷移の数は同じです
- Express ワークフローは、実行の時間とメモリに課金されるので、待てばそのぶんかかります。そもそも 5 分までしか動きません
- Lambda の関数の中で `setTimeout` を使って待つと、待っている間も関数は動いていて、待った秒数がそのまま請求されます
- durable function の wait では、関数が中断されるので、待っている間の実行時間は課金されません。かかるのは、保存しているチェックポイントの量に応じた保持の料金です
- Fargate のタスクの中で待つと、タスクが動いている間は、何もしていなくても vCPU とメモリに課金されます

待つ仕事は、待っている間に計算資源を持たない道具に置くのが原則です。

durable function の単価は、東京で、operation 1 個あたり USD 0.0000106、書いたデータ 1 GB あたり 0.33、保持 1 GB・月あたり 0.20 です。料金ページに、無料枠の記載は見つけられませんでした。表の 4 行目は、1 回の実行を operation 7 個と数えています。

スタックを消すと、ステートマシンも、関数も、スケジュールも消えて、この章のぶんの料金は止まります。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| デプロイで、ステートマシンの作成が、ロールを引き受けられないというエラーで失敗する | ロールの信頼ポリシーの条件（`aws:SourceArn`）が、ステートマシンの ARN の形と合っていますか。このページの末尾にある検証メモの「まだ確かめていないこと」も見てください |
| 実行が `ExportPages` で失敗して、エラーが `States.Runtime` や `States.DataLimitExceeded` | `States.ALL` は、この 2 つを再試行しません。関数が 256 KiB を超える値を返していませんか |
| `ExportPages` のログに 403 があり、3 回再試行して失敗する | ロールに `s3:PutObject` と `s3:GetObject` がありますか。412 の後の `HeadObject` は `s3:GetObject` で許可されます |
| 実行が成功したのに、ノートの件数がテーブルと合わない | エクスポートの途中で書かれた、または消されたノートは、入ることも入らないこともあります。`Scan` は、ある瞬間の写しではありません |
| 実行が `ExportDiscarded` で終わる | パートが、マニフェストを書く前に消えています。誰かがバケットを手で掃除したか、7 日より長くかかったか、同じエクスポートの別の実行が `Discard` まで行ったか、のどれかです |
| `export:start` が `ExecutionAlreadyExists` を返す | 同じ ID で、もう起動しています。`--id` を変えてください。名前は、実行が終わってから 90 日間は再利用できません |
| redrive しても、すぐにまた失敗する | 原因は直しましたか。`Discarded` まで行った実行は、redrive しても `Fail` ステートに入り直すだけです |
| 実行がいつまでも `RUNNING` のまま | `Task` に `TimeoutSeconds` はありますか。この章の定義は、全体でも 6 時間で打ち切ります |
| durable function が、チェックポイントの権限がないというエラーで失敗する | ロールの対象は `function:<名前>:*` ですか。`:*` のない関数の ARN は、実行の ARN に一致しません |
| durable function を呼ぶと、修飾子が要るというエラーになる | エイリアスかバージョンを付けて呼んでいますか。`export:durable:start` はエイリアスの ARN を使います |

## 本番にするなら

- 失敗に気づけるようにします。この章のワークフローは、失敗しても誰にも知らせません。Step Functions は、実行の状態が変わると EventBridge にイベントを送ります。このイベントを通知につなぐか、失敗した実行の数にアラームを付けます（[19章](/ja/chapters/19-observability.md)）
- エクスポートを渡す経路を作ります。マニフェストとパートを読んで、利用者に渡す API です。持ち主ごとに分けるなら、パートを持ち主のプレフィックスに書き分けるか、渡すときに絞ります。この章のエクスポートは、全員のノートが 1 つのファイルに混ざっています
- 整合性を決めます。「始めた時点の全ノート」が要るなら、`Scan` では足りません。DynamoDB には、テーブルを S3 に書き出す機能（export to S3）があり、point-in-time recovery を有効にしたテーブルの、ある時点の状態を取り出せます。この章では試していません
- `Finish` と `Discard` の間の穴を閉じます。同じエクスポートの実行が重ならないように、名前を付けて起動します。あるいは、`Discard` を、パートを消す処理から、捨てた印を書く処理に変えます
- ステートマシンのログを残します。この章は、実行の履歴を Step Functions に任せていて、履歴は 90 日で消えます。CloudWatch Logs に送る設定（`LoggingConfiguration`）がありますが、この章では付けていません
- 履歴の上限を見ます。`export:status` が表示するイベント数を、上限の 25,000 と比べます。近づくようなら、1 回の呼び出しで進む量を増やすか、実行を分けます
- バケットとテーブルを消えないようにします。どちらも `RemovalPolicy.DESTROY` です。本物のノートが入るテーブルは `RETAIN` にします
- durable function を使うなら、バージョンの運用を決めます。動いている実行がある間は、ステップの名前や順番を変えません。変えるなら、新しいバージョンとして出して、古い実行が終わるのを待ちます

## 片付け

<!-- section: 16.cleanup -->

```bash
vp run export:empty --yes
vp run export:infra:destroy
```

固定した版の cdkd は中身のあるバケットを消さないので、バケットを先に空にします。`export:empty` は、`--yes` を付けなければ、オブジェクトを数えるだけです。

`export:infra:destroy` で、ステートマシン、3 つの関数、スケジュール、バケット、テーブルが消えます。動いている途中の実行があっても、ステートマシンごと消えます。`-c durable=true` でデプロイしたなら、消すときにも同じ指定を付けてください。

残るのは、cdkd の bootstrap で作った保存場所（[02章](/ja/chapters/02-toolchain.md)）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** ステップのテスト（同じステップの 2 回目、応答が失われた後にテーブルが変わった場合、呼び出しの途中での書き込みの失敗、読み取りの失敗、止まっていたワーカーの遅れた書き込み、同じエクスポートの 2 つの実行の重なり、チェックポイントの大きさを変えても出力が同じこと、空のテーブル）。マニフェストと補償処理のテスト（欠けたパート、最後のページより前の `Finish`、2 回の `Finish`、途中で止まった `Discard` のやり直し、完成したエクスポートを消さないこと）。入力の検証（時刻からの ID、プレフィックスの外に出る ID、壊れた進捗）。ワークフローの定義を手元の実行器で動かすテスト（応答の喪失、再試行の打ち切りと再開、最初からのやり直し、`ExportCorrupt` が再試行されずに `Discard` へ進むこと、`Discard` の再試行、定義の中の行き先がすべて存在すること）。S3 と DynamoDB へのリクエストの形と、412、409、404、403 の扱い。durable function 版を、SDK の `LocalDurableTestRunner` で動かすテスト（ステップの区切り、失敗したステップのやり直し）。インフラのアサーション（既定と `-c durable=true`）。型検査と、両方の構成での synth。それから、条件を 2 か所わざと壊して、どちらもテストが 2 つ落ちることを確かめました。`export:local` を、既定、`--notes 450 --lose 2 --break 4`、`--notes 1000 --pages-per-call 20` の 3 通りで実行しました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`export:infra:diff`、`export:infra:deploy`、`export:seed`、`export:start`、`export:status`、`export:logs`、`export:infra:drift`、`export:empty`、`export:infra:destroy`、`export:durable:start` のどれもです。したがって、次のことは実物で確かめていません。cdkd が、`Fn::Join` で組み立てた `DefinitionString` からステートマシンを作れること。ステートマシンのロールの信頼ポリシーの条件が通ること。Scheduler が `<aws.scheduler.scheduled-time>` を置き換えた入力で `StartExecution` を呼ぶこと、そのとき実行に名前が付くかどうか。関数の ARN を `Resource` に書いた `Task` の入出力の形。Lambda の例外の `name` が `Catch` の `ExportCorrupt` に一致すること。S3 が `If-None-Match: *` に 412 を返し、固定した版の SDK がそれを status 412 の例外として投げること。`HeadObject` がメタデータのキーを小文字で返すこと。`Task` のタイムアウトの後も関数が動き続けるかどうか。状態遷移と履歴のイベントの実際の数。redrive の動き。`Scan` の読み取りユニットと、関数の実行時間（料金の例の 200 ミリ秒と 20 秒は仮定です）。durable function については、東京リージョンで使えること、cdkd で `DurableConfig` つきの関数とバージョン、エイリアスを作れること、ロールの権限が足りること、バンドルした SDK が Lambda の上で動くこと、`DurableExecutionName` が 2 重の起動を防ぐこと、1 回の呼び出しが関数のタイムアウトに当たったときの動き、durable operation の実際の数。ECS のタスクと AWS Batch は、説明だけで、コードがありません。Express ワークフローは、ドキュメントを読んだだけです。Cloudflare Workflows も、ドキュメントを読んだだけで、動かしていません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/16-long-jobs/infra/lib/long-jobs-stack.ts`、`src/workflow.ts` | - |
| 仕事を割る | `examples/16-long-jobs/src/job.ts`、`src/note-source.ts`、`src/dynamodb-note-source.ts`、`test/adapters.test.ts` | `test:unit` |
| ステップは 2 回走る | `examples/16-long-jobs/src/steps.ts`、`src/export-store.ts`、`src/s3-export-store.ts`、`test/steps.test.ts`、`test/harness.ts`、`test/adapters.test.ts` | `test:unit` |
| 最後の 1 個で、見えるようにする | `examples/16-long-jobs/src/steps.ts`、`src/job.ts`、`test/steps.test.ts` | `test:unit` |
| 順番は、ワークフローに任せる | `examples/16-long-jobs/src/workflow.ts`、`test/workflow.test.ts` | `test:unit` |
| チェックポイントの粒度 | `examples/16-long-jobs/src/steps.ts`、`src/export-pages-lambda.ts`、`src/env.ts`、`test/steps.test.ts` | `test:unit` |
| 手元で動かす | `examples/16-long-jobs/src/local-workflow.ts`、`src/local.ts`、`scripts/run-local.ts`、`test/workflow.test.ts` | `export:local`、`test:unit` |
| AWS にのせる準備 | `examples/16-long-jobs/infra/lib/long-jobs-stack.ts`、`infra/bin/app.ts`、`infra/test/long-jobs-stack.test.ts`、`src/finish-lambda.ts`、`src/discard-lambda.ts`、`cdk.json` | `export:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/16-long-jobs/scripts/seed.ts`、`scripts/start.ts`、`scripts/status.ts`、`scripts/logs.ts` | `export:infra:diff`、`export:infra:deploy`、`export:seed`、`export:start`、`export:status`、`export:logs`、`export:infra:drift` |
| 同じものを durable function で書く | `examples/16-long-jobs/src/durable-export.ts`、`src/durable-lambda.ts`、`test/durable.test.ts`、`scripts/durable-start.ts`、`infra/lib/long-jobs-stack.ts` | `test:unit`、`export:durable:start` |
| Lambda に入らないステップ | （コードなし） | - |
| 料金 | `data/pricing/` | `test:unit` |
| 片付け | `examples/16-long-jobs/scripts/empty.ts` | `export:empty`、`export:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-12）

- Step Functions: [Choosing workflow type](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html)、[Handling errors](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)、[Task workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html)、[Invoke an AWS Lambda function](https://docs.aws.amazon.com/step-functions/latest/dg/connect-lambda.html)、[Handling error conditions（チュートリアル）](https://docs.aws.amazon.com/step-functions/latest/dg/tutorial-handling-error-conditions.html)、[ResultPath](https://docs.aws.amazon.com/step-functions/latest/dg/input-output-resultpath.html)、[Redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html)、[Service quotas](https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html)、[Best practices](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-best-practices.html)、[Creating an IAM role for your state machine](https://docs.aws.amazon.com/step-functions/latest/dg/procedure-create-iam-role.html)、[Run Amazon ECS or Fargate tasks](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html)、[Service integration patterns](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)、[EventBridge への連携](https://docs.aws.amazon.com/step-functions/latest/dg/eventbridge-integration.html)、[StartExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html)、[AWS::StepFunctions::StateMachine](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-stepfunctions-statemachine.html)
- Lambda durable functions: [Lambda durable functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html)、[Basic concepts](https://docs.aws.amazon.com/lambda/latest/dg/durable-basic-concepts.html)、[Idempotency](https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-idempotency.html)、[Invoking](https://docs.aws.amazon.com/lambda/latest/dg/durable-invoking.html)、[Security and permissions](https://docs.aws.amazon.com/lambda/latest/dg/durable-security.html)、[Infrastructure as Code](https://docs.aws.amazon.com/lambda/latest/dg/durable-getting-started-iac.html)、[Supported runtimes](https://docs.aws.amazon.com/lambda/latest/dg/durable-supported-runtimes.html)、[Durable execution SDK（metering）](https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-sdk.html)、[Durable functions or Step Functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-step-functions.html)、[Best practices](https://docs.aws.amazon.com/lambda/latest/dg/durable-best-practices.html)
- AWS Durable Execution SDK Developer Guide: [Key concepts](https://docs.aws.amazon.com/durable-execution/getting-started/key-concepts/)、[Idempotency and retries](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/)。[@aws/durable-execution-sdk-js 2.6.0](https://www.npmjs.com/package/@aws/durable-execution-sdk-js/v/2.6.0)（README と型定義）
- Lambda: [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)、[Node.js の context object](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-context.html)
- EventBridge Scheduler: [Adding context attributes](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-schedule-context-attributes.html)、[Using templated targets](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-templated.html)、[What is Amazon EventBridge Scheduler?](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html)
- S3 と DynamoDB: [Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)、[HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)、[Scanning tables in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html)、[DynamoDB data export to Amazon S3](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/S3DataExport.HowItWorks.html)
- AWS Batch: [What is AWS Batch?](https://docs.aws.amazon.com/batch/latest/userguide/what-is-batch.html)、[Fargate compute environments](https://docs.aws.amazon.com/batch/latest/userguide/fargate.html)
- 料金: [AWS Step Functions pricing](https://aws.amazon.com/step-functions/pricing/)、[AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)、AWS Price List bulk API: [Step Functions](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonStates/current/ap-northeast-1/index.json)、[Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)
- Cloudflare: [What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)、[Workflows](https://developers.cloudflare.com/workflows/)、[Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)、[Workflows: Limits](https://developers.cloudflare.com/workflows/reference/limits/)、[Workflows: Pricing](https://developers.cloudflare.com/workflows/reference/pricing/)
- [cdkd v0.296.28 の register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)（インストールしたパッケージの dist で確認）、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)

:::
