---
title: "47 Step Functions: 費用、注意点、片付け"
---

# 47 Step Functions: 費用、注意点、片付け

## 料金

<!-- section: 47.cost -->

金額は USD、東京リージョン、従量課金、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

Standard ワークフローの単価は 16章と同じで、状態遷移 1 回あたり 0.000025、毎月 4,000 回まで無料です。この章で新しく出てくるのは Express ワークフローの単価で、リクエスト 1 回あたり 0.000001、実行時間 1 GB・秒あたり 0.00001667 です。時間の単価は、月に 360 万 GB・秒を超えると下がります。Express の無料枠は、料金ページに記載を見つけられませんでした。

| 構成 | 定価 | 無料枠を引いた後 |
| --- | --- | --- |
| デプロイしただけで、1 回も実行しない | 0.00 | 0.00 |
| 取り込みを月に 1,000 回（Standard、すべて成功） | 0.24 | 0.14 |
| 10 件の照会を月に 100,000 回（Express） | 0.20 | 0.20 |
| 同じ照会を Standard で動かしたとき | 32.57 | 32.47 |

取り込みは、1 回の実行を状態遷移 9 回と数えています。通るステートが 7 つ、開始と終了が 1 回ずつです。数え方は料金ページの例に合わせた見積もりで、実際の請求では確かめていません。金額のほとんどは状態遷移で、DynamoDB、S3、SQS、SNS のぶんは合わせて 0.02 に届きません。

取り消しの道を通っても、それだけでは状態遷移は増えません。スキャンが断った取り込みは、`Publish`、`Notify`、`Imported` の代わりに `RemoveAttachment`、`RemoveNote`、`RolledBack` を通るので、数は同じ 9 です。増えるのは再試行です。再試行は 1 回ごとに状態遷移として数えられるので、相手のサービスが落ちている間に 1,000 件の取り込みがそれぞれ 3 回ずつ再試行すれば、3,000 回ぶんが足されます。`Retry` の `MaxAttempts` は、料金の上限を決める設定でもあります。

照会の 2 行は、[概要のページ](/ja/chapters/47-step-functions.md)の計算を月の回数に広げたものです。実行時間の 300 ミリ秒は仮定です。Express の実際の課金は、`sfn:digest` が表示する値か、`ExpressExecutionBilledDuration` と `ExpressExecutionBilledMemory` のメトリクスで確かめられます。

Express のログは、CloudWatch Logs の vended logs の単価で課金されます。このスタックは `ERROR` だけを送るので、失敗がなければ何も送られません。レベルを `ALL` にすると、すべてのステートの出入りがログになり、回数の多いワークフローでは、ログの料金が実行の料金を上回ることがあります。vended logs の単価は、この章では調べていません。

スタックを消すと、この章のぶんの料金は止まります。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| デプロイで、ステートマシンの作成が、ロールを引き受けられないというエラーで失敗する | ロールの信頼ポリシーの条件（`aws:SourceArn`）が、ステートマシンの ARN の形と合っていますか。16章と同じ条件で、実機では確かめていません |
| 実行が最初のステートで `States.QueryEvaluationError` になる | 入力に、定義が読むフィールドが欠けています。`sfn:start` は起動の前にスキーマで確かめますが、コンソールや CLI から起動すると、確かめる人がいません |
| エラーにならないのに、キーが `attachments//` になる | catcher に `Output` がなく、次のステートにエラーの情報だけが渡っています。`&` は、値のない側を空文字列としてつなぎます |
| `sfn:start` が `ExecutionAlreadyExists` を返す | 同じ持ち主とノート ID の取り込みが、もう終わっています。名前は、実行が終わってから 90 日間は使い回せません |
| 実行が `NoteIdTaken` で終わる | 別の取り込みが、そのノート ID のアイテムを書いています。この実行は何も書いていないので、片付けるものはありません |
| 実行が `WaitForScan` で止まったまま | トークンを返す相手がいません。`sfn:callback` で返します。何も返さなければ、5 分でハートビートが途切れ、1 回の再試行のあと、補償処理へ進みます |
| `sfn:callback` が `TaskTimedOut` で失敗する | そのトークンのタスクは、もうタイムアウトしています。再試行で新しいトークンのメッセージが届いているはずです |
| 実行が `Publish`、`RemoveAttachment`、`RemoveNote` のどれかで `FAILED` になる | 設計どおりの止まり方です。原因（権限、相手のサービス）を直してから、`sfn:status --redrive` で続けます |
| redrive しても、すぐにまた失敗する | `ImportRolledBack` や `NoteIdTaken` で終わった実行は、redrive しても `Fail` ステートに入り直すだけです。定義を直した場合も、redrive は古い定義で動きます |
| 通知が 2 通届く | `Notify` の応答が失われて、再試行されました。メッセージの属性 `saga` が同じなら、同じ取り込みの通知です |
| `sfn:digest` が `FAILED` と表示するが、理由がわからない | ロググループに `ERROR` のログがありますか。ログが 1 件も出ないときは、アカウントの CloudWatch Logs のリソースポリシーが、リージョンごとの上限（10 個）に達していないかを見ます |
| 照会が、取り込んだはずのノートを `missing` と答える | そのノートの `phase` は `ready` ですか。`Publish` の前で止まった取り込みのノートは、`pending` のままです |

## 本番にするなら

- 止まった取り込みを、人に知らせます。この章の不変条件は、補償処理の途中で止まった実行を「続けられる」ところまでしか守りません。EventBridge のルールで `FAILED` と `TIMED_OUT` を拾って通知するか、`ExecutionsFailed` にアラームを付けます。知らせがなければ、公開前のノートと添付ファイルが、誰にも気づかれずに残ります
- 起動の入口を API にします。この章は、スクリプトが `owner` を引数で受け取っています。本物の入口では、持ち主は[06章](/ja/chapters/06-auth.md)のトークンから取り、`upload` がその持ち主の `inbox/` の下にあることを確かめます
- スキャナーを置きます。08章のワーカーと同じ形で、キューを読み、長くかかるなら `SendTaskHeartbeat` を送り、終わったら結果を返します。同じファイルの依頼が 2 通届くことと、返事が `TaskTimedOut` で断られることを、ふつうの出来事として扱います
- 05章のノートの上限との関係を決めます。取り込みは、05章のリポジトリを通らずにアイテムを書くので、持ち主ごとの件数を数えていません。同じテーブルに書くなら、件数を増やすステップと、その補償処理が要ります
- Standard の履歴を、90 日より長く残すかどうかを決めます。残すなら、Standard にも `LoggingConfiguration` を付けて CloudWatch Logs に送ります。入出力にノートの中身が入ることを忘れずに
- 定義を変えるときの手順を決めます。動いている実行は古い定義のままです。待ち時間の長いワークフローでは、版とエイリアスを使い、古い実行が終わるまで古い版を消しません
- テーブルとバケットを、スタックと一緒に消えないようにします。どちらも `RemovalPolicy.DESTROY` です
- 照会を、この形のまま本番に出すかどうかを考え直します。照会は Express を見せるための小さな例です。10 件読むだけなら、Lambda の関数 1 つのほうが、部品も料金の計算も単純です。Express が合うのは、いくつかのサービスを順に呼ぶ短い処理を、コードなしでつなぎたいときです

## 片付け

<!-- section: 47.cleanup -->

```bash
vp run sfn:empty --yes
vp run sfn:infra:destroy
```

固定した版の cdkd は中身のあるバケットを消さないので、バケットを先に空にします。`sfn:empty` は、`--yes` を付けなければ、オブジェクトを数えるだけです。

`sfn:infra:destroy` で、2 つのステートマシン、テーブル、バケット、キュー、トピック、ロググループ、2 つのロールが消えます。動いている途中の実行があっても、ステートマシンごと消えます。スキャンを待っていた取り込みは、補償処理を実行しないまま消えるので、先に `sfn:status` で `RUNNING` の実行がないことを見ておきます。

残るのは、cdkd の bootstrap で作った保存場所（[02章](/ja/chapters/02-toolchain.md)）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** テスト 66 件。実行器のテスト（retrier ごとの再試行の数え方と待ち時間をドキュメントの例と突き合わせたもの、`MaxDelaySeconds`、`FULL` のジッター、`MaxAttempts: 0`、`States.TaskFailed` と `States.ALL` の一致の範囲、値のない式、catcher の出力、`Assign` の評価順、試行ごとのタスクトークン、`Map` の要素と順序、繰り返しの失敗）。取り込みのテスト（最後まで通ること、3 つのステップが断られ続ける場合と応答だけが失われ続ける場合、スキャンの拒否と失敗、2 回走ったステップ、通知の重複、ハートビートが途切れたあとの再試行、`Notify` の失敗、`Publish` の先での失敗と redrive、補償処理の失敗と redrive、補償処理の再実行、同じノート ID の 2 つの取り込み、わざと壊した定義 2 つ、定義の行き先とタイムアウト、入力とメッセージのスキーマ）。照会のテスト（公開前のノートと他人のノートを見せないこと、2 回走っても同じ答えで何も書かないこと、読み取りの再試行、Express で使えない呼び方がないこと）。TestState に送る表と実行器の一致。スタックのアサーション（リソースの種類、削除の設定、公開されていないこと、信頼ポリシー、権限、テンプレートの定義が関数の出力と一致すること、テンプレートから取り出した定義を実行器で歩かせること）。型検査と synth。`sfn:local` を、[手元で動かすページ](/ja/chapters/47-step-functions/local.md)に載せた 3 通りで実行しました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`sfn:infra:diff`、`sfn:infra:deploy`、`sfn:start`、`sfn:callback`、`sfn:status`、`sfn:digest`、`sfn:test-state`、`sfn:infra:drift`、`sfn:empty`、`sfn:infra:destroy` のどれもです。したがって、次のことは実物で確かめていません。手元の実行器が Step Functions と同じ結果を出すこと（JSONata の式の評価、`Retry` と `Catch` の選び方、要素が 1 つの配列の扱いを含む）。`Output` を省いたときの既定。cdkd が、JSONata の定義と、`LoggingConfiguration` つきの Express ステートマシンを作れること。ロールの信頼ポリシーの条件が通ること。各ステートの権限が足りること。DynamoDB の条件式が意図どおりに働くことと、そのエラー名。コピー元がないときのエラー名。`MessageBody` に渡したオブジェクトが JSON の文字列として届くこと。ハートビートが途切れたときのエラー名。再試行で新しいトークンが配られること。redrive が補償処理のステートから続けること。状態遷移の実際の数（`Map` の繰り返しの数え方を含む）と、Express の実行時間と課金されるメモリ。版とエイリアスを cdkd で作れるかどうか。Distributed Map、`Parallel`、`Wait`、`.sync` は、ドキュメントを読んだだけで、コードがありません。Cloudflare Workflows と Vercel Workflows も、ドキュメントを読んだだけです。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/47-step-functions/src/saga.ts`、`src/digest.ts`、`infra/lib/step-functions-stack.ts` | - |
| Standard と Express | `examples/47-step-functions/src/saga.ts`、`src/digest.ts`、`test/digest.test.ts` | `test:unit` |
| ステートの言語 | `examples/47-step-functions/src/asl.ts`、`src/saga.ts`、`src/interpreter.ts`、`test/interpreter.test.ts` | `test:unit` |
| サービスの呼び方 | `examples/47-step-functions/src/saga.ts`、`src/interpreter.ts`、`test/saga.test.ts` | `test:unit` |
| Retry と Catch | `examples/47-step-functions/src/asl.ts`、`src/saga.ts`、`src/interpreter.ts`、`test/interpreter.test.ts` | `test:unit` |
| saga | `examples/47-step-functions/src/saga.ts`、`src/invariant.ts`、`test/saga.test.ts` | `test:unit` |
| Choice、Map、Parallel、Wait | `examples/47-step-functions/src/digest.ts`、`src/interpreter.ts`、`test/digest.test.ts`、`test/interpreter.test.ts` | `test:unit` |
| 手元で動かす | `examples/47-step-functions/src/interpreter.ts`、`src/local-world.ts`、`src/local.ts`、`scripts/run-local.ts` | `sfn:local`、`test:unit` |
| 壊しにいくテスト | `examples/47-step-functions/test/saga.test.ts`、`test/harness.ts`、`src/invariant.ts`、`src/local-world.ts` | `test:unit` |
| TestState | `examples/47-step-functions/src/test-state-cases.ts`、`test/test-state-cases.test.ts`、`scripts/test-state.ts` | `sfn:test-state`、`test:unit` |
| スタック | `examples/47-step-functions/infra/lib/step-functions-stack.ts`、`infra/bin/app.ts`、`infra/test/step-functions-stack.test.ts`、`cdk.json` | `sfn:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/47-step-functions/scripts/start.ts`、`scripts/callback.ts`、`scripts/status.ts`、`scripts/digest.ts` | `sfn:infra:diff`、`sfn:infra:deploy`、`sfn:start`、`sfn:callback`、`sfn:status`、`sfn:digest`、`sfn:infra:drift` |
| 定義を変える | `examples/47-step-functions/scripts/status.ts`、`infra/lib/step-functions-stack.ts` | `sfn:status` |
| 動きを見えるようにする | `examples/47-step-functions/infra/lib/step-functions-stack.ts`、`scripts/status.ts` | `sfn:status` |
| 料金 | `data/pricing/` | `test:unit` |
| 片付け | `examples/47-step-functions/scripts/empty.ts` | `sfn:empty`、`sfn:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-13）

- Step Functions の種類と言語: [Choosing workflow type](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html)、[Transforming data with JSONata](https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html)、[Passing data between states with variables](https://docs.aws.amazon.com/step-functions/latest/dg/workflow-variables.html)、[Amazon States Language の仕様書](https://states-language.net/spec.html)
- ステート: [Task](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html)、[Choice](https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html)、[Map](https://docs.aws.amazon.com/step-functions/latest/dg/state-map.html)、[Inline mode](https://docs.aws.amazon.com/step-functions/latest/dg/state-map-inline.html)、[Distributed mode](https://docs.aws.amazon.com/step-functions/latest/dg/state-map-distributed.html)、[Parallel](https://docs.aws.amazon.com/step-functions/latest/dg/state-parallel.html)、[Wait](https://docs.aws.amazon.com/step-functions/latest/dg/state-wait.html)
- 呼び出しとエラー: [Service integration patterns](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)、[AWS SDK integrations](https://docs.aws.amazon.com/step-functions/latest/dg/supported-services-awssdk.html)、[DynamoDB](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ddb.html)、[SQS](https://docs.aws.amazon.com/step-functions/latest/dg/connect-sqs.html)、[SNS](https://docs.aws.amazon.com/step-functions/latest/dg/connect-sns.html)、[Handling errors](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
- 運用: [Service quotas](https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html)、[Redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html)、[Versions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-state-machine-version.html)、[Aliases](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-state-machine-alias.html)、[CloudWatch Logs](https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html)、[CloudWatch metrics](https://docs.aws.amazon.com/step-functions/latest/dg/procedure-cw-metrics.html)、[EventBridge](https://docs.aws.amazon.com/step-functions/latest/dg/eventbridge-integration.html)、[IAM role](https://docs.aws.amazon.com/step-functions/latest/dg/procedure-create-iam-role.html)
- テスト: [TestState API でのテスト](https://docs.aws.amazon.com/step-functions/latest/dg/test-state-isolation.html)、[Step Functions Local（unsupported）](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local.html)
- API リファレンス: [StartExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html)、[StartSyncExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartSyncExecution.html)、[SendTaskSuccess](https://docs.aws.amazon.com/step-functions/latest/apireference/API_SendTaskSuccess.html)、[SendTaskHeartbeat](https://docs.aws.amazon.com/step-functions/latest/apireference/API_SendTaskHeartbeat.html)、[UpdateStateMachine](https://docs.aws.amazon.com/step-functions/latest/apireference/API_UpdateStateMachine.html)、[TestState](https://docs.aws.amazon.com/step-functions/latest/apireference/API_TestState.html)
- S3 と DynamoDB: [DeleteObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html)、[CopyObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html)、[Reserved words in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html)
- 料金: [AWS Step Functions pricing](https://aws.amazon.com/step-functions/pricing/)、AWS Price List bulk API: [Step Functions](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonStates/current/ap-northeast-1/index.json)
- Cloudflare と Vercel: [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)、[Sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)、[Vercel Workflows](https://vercel.com/docs/workflow)
- [jsonata の npm レジストリの情報](https://registry.npmjs.org/jsonata)とインストールしたパッケージの型定義、[cdkd v0.296.28 の register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)（インストールしたパッケージの dist で確認）

:::
