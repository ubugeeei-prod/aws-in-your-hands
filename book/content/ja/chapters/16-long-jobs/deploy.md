---
title: "16 Workflow: デプロイ"
---

# 16 Workflow: デプロイ

手元で確かめたワークフローを AWS に置くためのスタックと、デプロイの手順をまとめます。後半では、同じエクスポートを Lambda durable functions で書き直し、Lambda に収まらないステップの動かし方にも触れます。

## AWS にのせる準備

<!-- section: 16.infra -->

### バケット

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{bucket}

このバケットには、全員のノートが入ります。公開の設定は 4 つとも閉じ、HTTP での接続は拒否しているので、読めるのは IAM で許された相手だけです。エクスポートを利用者に渡すところまでは、この章では作っていません。渡すなら、[07章](/ja/chapters/07-uploads.md)の署名付き URL が使えます。

### 3 つの関数、3 つのロール

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{steps}

関数を 1 つにまとめて、入力で分岐させることもできます。3 つに分けたのは、権限を分けたかったからです。

- `ExportPages` は、テーブルを `Scan` できて、パートを書けます。消せません
- `Finish` は、一覧できて、マニフェストを書けます。テーブルは読めません
- `Discard` は、一覧できて、消せます。書けませんし、テーブルも読めません

ノートを読める関数も、オブジェクトを消せる関数も、それぞれ 1 つだけです。`If-None-Match` の検査が `s3:PutObject` だけでできることは、S3 のドキュメントに書いてあります。`ExportPages` に `s3:GetObject` を付けたのは、412 の後でメタデータを読む `HeadObject` のためです。

### ステートマシン

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{state-machine}

ステートマシンにも、実行ロールがあります。Step Functions があなたの代わりに関数を呼ぶためのロールで、できるのは 3 つの関数の呼び出しだけです。信頼する相手は、このアカウントの、このリージョンのステートマシンに絞っています。条件の書き方は、公式ドキュメントの例と同じ形です。

定義は、`toJsonString` で 1 本の文字列にして渡しています。関数の ARN はデプロイするまで決まらないので、テンプレートの中では `Fn::Join` になります。

CloudFormation には、定義の中の `${名前}` を置き換える `DefinitionSubstitutions` というプロパティもありますが、この章では使いません。固定した版の cdkd（0.296.28）のソースを読むと、cdkd がこの置き換えをするのは、定義を S3 から取ってくる場合だけだからです。テンプレートに直接書いた定義には効きません。テストは、このプロパティがテンプレートに無いことを固定しています。

### スケジュール

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{schedule}

08章のスケジュールは Lambda の関数を呼んでいましたが、今度の相手はステートマシンです。Scheduler は Step Functions の `StartExecution` を呼ぶので、ロールには `states:StartExecution` が必要です。対象は、このステートマシン 1 つに絞っています。

`input` の `<aws.scheduler.scheduled-time>` は、Scheduler が置き換える目印です。その回が予定されていた時刻が、`2026-10-12T03:00:00Z` のような形で入ります。この時刻が、エクスポートの ID のもとになります。

実行に名前を付けて起動すれば、2 重の起動を Step Functions の側で断れます。`StartExecution` は、同じ名前と同じ入力なら、動いている実行をそのまま返すからです。この章がその方法を使っていないのは、この形のターゲットには、Scheduler に実行の名前を渡す場所がないからです。別の形のターゲット（universal target）なら渡せそうですが、時刻に含まれる `:` は実行の名前に使えません。試していないので、これ以上は書きません。2 重に起動された場合は、ステップの側で受け止めます。

### テストが見ていること

- 使っているリソースの種類が 9 つちょうどで、`Custom::` で始まるものがない
- 既定では durable function が無い。関数は 3 つで、`DurableConfig` を持つものがなく、バージョンもエイリアスもない
- バケットの公開の設定が 4 つとも閉じていて、`exports/` の下が 7 日で消える
- 3 つの関数のロールのアクションが、上に書いたものちょうどである
- オブジェクトへの操作が `exports/` の下に限られ、一覧にもプレフィックスの条件が付いている。素の `*` がどこにもない
- ステートマシンのロールにできるのが、3 つの関数の呼び出しだけである
- デプロイされる定義が、手元で動かしたものと同じステートを持ち、`Task` が 3 つの関数を指している
- どの `Task` のタイムアウトも、指している関数のタイムアウトより長い
- スケジュールの入力、間隔、ロール

9 種類（`AWS::DynamoDB::Table`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Logs::LogGroup`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy`、`AWS::Scheduler::Schedule`、`AWS::StepFunctions::StateMachine`）は、固定した版の cdkd がどれも専用の実装を持っています。インストールしたパッケージの中身で確かめました。

## デプロイして確かめる

<!-- section: 16.deploy -->

ここから先の手順は、実行していません。用意したのは、手順とタスクまでです。

```bash
vp run export:infra:diff
vp run export:infra:deploy
vp run export:seed --notes 250
vp run export:start --id check-1 --wait
vp run export:status
```

`export:seed` は、05章の repository を使って、テーブルにノートを書きます。`export:start` は、スケジュールを待たずにエクスポートを 1 回起動します。`--wait` を付けると、終わるまで 5 秒おきに状態を見ます。`export:status` は、最近の実行と、バケットにあるエクスポートを並べて表示します。マニフェストがあるか、パートがいくつあるか、履歴が何イベントあるかが見えます。

同じ ID でもう一度 `export:start` を実行すると、`ExecutionAlreadyExists` で断られるはずです。スケジュールと違って、`export:start` は実行に名前を付けて起動しているからです。

失敗した実行を再開するには、`export:status` が表示する ARN を渡します。

```bash
vp run export:status --redrive <execution ARN>
vp run export:logs --function pages
```

スケジュールは、作られるとすぐに 1 回目を起動します。08章と同じで、開始日を指定していない rate のスケジュールはそう動く、とドキュメントにあります。そのため、デプロイした直後に、頼んでいないエクスポートが 1 つできます。

ドリフトの検査は、これまでの章と同じです。

```bash
vp run export:infra:drift
```

## 同じものを durable function で書く

<!-- section: 16.durable -->

ここまでのワークフローは JSON で書きました。ループは `Choice` で、変数はステートの入出力で、try と catch は `Retry` と `Catch` で表しています。ふつうのコードで書きたくなる場面です。

Lambda durable functions は、ワークフローを関数のコードとして書くための機能です。公式ドキュメントで確かめられた範囲で、同じエクスポートを書き直します。

<<< @/examples/16-long-jobs/src/durable-export.ts{durable}

`while` がループで、`try` と `catch` が補償処理です。ステップの関数（`exportPages`、`finishExport`、`discardExport`）は、Step Functions 版と同じものを、1 文字も変えずに使っています。

### 最初から、もう一度

このコードには、15 分で止められる関数の中に `while` があります。それでも続きから再開できるように見えるのは、次の図のように動くからです。

```figure
caption: 2 回目の呼び出しは最初の行から走り直し、チェックポイントのあるステップは実行されずに結果だけが返る
type: sequence
actor lambda: Lambda | チェックポイント
actor handler: ハンドラー
actor s3: S3
note lambda: invocation 1
step lambda -> handler: ハンドラーが始まる
step handler -> handler: pages-from-1 が走る
step handler -> lambda: その結果をチェックポイントに書く
step handler -> handler: pages-from-21 が走る
step handler -x lambda: チェックポイントの前にサンドボックスが死ぬ
note lambda: invocation 2
step lambda -> handler: 最初の行からもう一度始まる
step lambda --> handler: pages-from-1 は走らず、保存した結果が返る
step handler -> handler: pages-from-21 がもう一度走る
step handler -x s3: パートはもう S3 にあり、2 回は書かれない
step handler -> handler: pages-from-41 … finish が走る
step handler -> lambda: それぞれの結果をチェックポイントに書く
```

実際には、関数は続きから再開していません。最初の行から、もう一度実行されます。ただし、`context.step` に包んだ処理は、結果が保存されていれば実行されず、保存された結果が返ります。この動きをリプレイ（replay）と呼びます。コードは最初から走り、済んだステップだけが早送りされます。

リプレイから、決まりが 2 つ出てきます。

1 つ目は、ステップの外のコードが、何度走っても同じ結果にならなければいけないことです。リプレイのたびに、ステップの外のコードはすべてもう一度走ります。そこで時刻を読んだり乱数を引いたりすると、1 回目と 2 回目で違う道を通ります。このコードでステップの外にあるのは、入力の検証と、`while` の条件と、ステップの名前の組み立てだけで、どれも保存された結果から決まります。

2 つ目は、ステップの中が、durable function でも冪等でなければいけないことです。ドキュメントは、ステップの既定を at-least-once と説明しています。ステップが終わる前に中断されると、リプレイでもう一度走ります。上の図の `pages-from-21` がその例です。この章のステップは、[最初のページ](/ja/chapters/16-long-jobs.md)で作ったとおり、何度走っても同じパートしか残しません。durable function にしても、冪等にする作業は省けません。

SDK には、ステップを「高々 1 回」にする設定もあります。ただ、ドキュメントの説明は慎重で、「再試行 1 回につき高々 1 回」としています。再試行を止めないかぎり、ステップ全体で 1 回とは言えません。名前から保証を読み取らないほうがよい、という例です。

### Step Functions との違い

| | Step Functions（Standard） | Lambda durable functions |
| --- | --- | --- |
| ワークフローを書く場所 | ASL（JSON） | 関数のコード |
| 進捗の持ち主 | Step Functions | Lambda |
| 1 つのステップの上限 | 呼ぶ相手による。Lambda なら 15 分 | 1 回の呼び出しが 15 分 |
| 全体の上限 | 1 年、履歴 25,000 イベント | 1 年、durable operation 3,000 個、保存 100 MB |
| 権限の分け方 | ステップごとに別の関数、別のロールにできる | 1 つの関数、1 つのロール |
| Lambda 以外を呼ぶ | 多くのサービスを定義から直接呼べる | コードから SDK で呼ぶ |
| 課金 | 状態遷移 | durable operation、書いた量、保持した量 |

この章の題材でいちばん効いた違いは、5 行目の権限の分け方でした。Step Functions 版では、ノートを読める関数とオブジェクトを消せる関数が別々でした。durable function 版では、1 つのロールが両方の権限を持ちます。

AWS 自身は、ロジックがほとんど Lambda の中にあってコードで書きたいなら durable functions を、多くのサービスをまたぐ場合や流れを図で見せたい場合は Step Functions を勧めています。両方を組み合わせる構成も勧めています。

### デプロイするなら

<<< @/examples/16-long-jobs/infra/bin/app.ts{context}

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{durable}

durable function 版は、既定のスタックには入っていません。`-c durable=true` を付けたときだけ、関数が 1 つ増えます。

```bash
vp run export:infra:deploy -c durable=true
vp run export:durable:start --id check-1
```

ふつうの関数と違うところが 3 つあります。

まず、`durableConfig` で durable execution を有効にします。`executionTimeout` は実行全体の上限、`timeout` は 1 回の呼び出しの上限で、別々の設定です。すでにある関数に `durableConfig` を後から付けると、関数は作り直しになります。CDK は synth のときに、作り直しになることを知らせてきます。

次に、実行ロールに、チェックポイントを読み書きする 2 つの権限が要ります。対象の書き方には癖があります。Lambda は、この 2 つの権限を「実行」の ARN に対して検査します。実行の ARN は、バージョンの付いた関数の ARN の先に続く形をしているので、関数の ARN そのままでは一致しません。関数の ARN に `:*` を付けて指定します。

最後に、呼ぶときはバージョンかエイリアスを付けます。素の関数名では呼べません。実行は、始めたときのバージョンに固定されます。`$LATEST` で始めた実行は、途中でコードを差し替えると、新しいコードでリプレイされます。ステップの名前や順番を変えていたら、保存された結果と合わなくなります。

`Lambda::Version` と `Lambda::Alias` は、固定した版の cdkd に専用の実装がなく、[20章](/ja/chapters/20-shipping.md)と同じく Cloud Control API 経由になります。

durable function 版は、Step Functions 版よりも確かめられていません。手元では、SDK に付いてくる実行器（`LocalDurableTestRunner`）でコードを動かし、ステップが失敗した後のやり直しでパートが増えないことまでは見ました。東京リージョンで使えることは、Price List に東京の単価が載っていることから推測しているだけです。使えるリージョンの一覧は、公式ドキュメントに見つけられませんでした。

### Durable Objects とは別のもの

Lambda durable functions と Cloudflare の Durable Objects は、名前が似ているだけで別のものです。Cloudflare を使ってきた人は、名前で混乱するかもしれません。

Durable Objects は、ID ごとに 1 つだけ存在するオブジェクトです。それぞれが自分専用のストレージを持ち、1 本のスレッドで動きます。「この部屋」「この利用者」のような 1 つの ID の状態を、1 か所で順番に扱うための部品です。[14章](/ja/chapters/14-kv-cache.md)では、レート制限の置き場所として出てきました。

Lambda durable functions は、1 回の処理の進み具合を保存する仕組みで、ID ごとの状態を持ち続けるものではありません。実行が終われば、残るのは履歴だけで、その履歴も保持期間が過ぎれば消えます。

Cloudflare の側で近いのは、Workflows です。`step.do` でステップを包むと、ステップの結果が保存され、失敗すれば再試行されます。公式ドキュメントの注意書きもよく似ています。ステップは何度も再試行されうるので冪等にすること、ワークフローは休止してメモリ上の状態を失うことがあるので状態はステップの戻り値から組み立てること、乱数や時刻はステップの中で扱うこと、が挙げられています。

違いもあります。Workflows の 1 つのステップには、経過時間の上限がありません（CPU 時間には上限があります）。Lambda は、durable function でも、1 回の呼び出しが 15 分までです。ステップの数の上限は、Workflows が有料プランの既定で 10,000、durable functions が 3,000 です。Workflows の配送の保証と、同じ ID の instance を 2 重に作ろうとしたときの動きは、読んだページからは確かめられませんでした。

## Lambda に入らないステップ

<!-- section: 16.containers -->

ここまでは、仕事を 15 分より短く割れることを前提にしてきました。しかし、1 本の動画の変換や、1 つの大きなファイルの圧縮のように、途中で止めると最初からになる仕事は割れません。メモリが 10 GB では足りない仕事や、Lambda に入らない道具が要る仕事もあります。

こうしたステップは、コンテナで動かします。この節は説明だけで、コードは作っていません。

1 つ目の選択肢は、ECS のタスクです。12章のサービスは、タスクを「常に N 個」動かし続けるものでしたが、タスクは 1 回だけ動かして、終わったら消えるようにも使えます。Step Functions から呼ぶには、`Task` の `Resource` を `arn:aws:states:::ecs:runTask.sync` にします。`.sync` を付けると、Step Functions はタスクが終わるまで待ってから、次のステートに進みます。Lambda の 15 分の上限は、ECS のタスクにはかかりません。Fargate なら、動いた秒数ぶんの vCPU とメモリに課金されます。

Lambda の関数と比べて、変わるところが 3 つあります。タスクは戻り値を返さないので、進捗は S3 や DynamoDB に自分で書き、次のステートがそれを読みます。入力は、コンテナの環境変数や引数として渡します。そして、イメージが要ります。12章の決まり（タグは immutable、`fromAsset` を使わない、イメージのタグなしで時間課金のものを作らない）が、そのまま当てはまります。

冪等性については、何も変わりません。タスクも再試行されますし、Step Functions があきらめた後で動き続けることもあります。ドキュメントは、`.sync` のタスクを中止したとき、止められずに課金が続く場合がある、と書いています。

2 つ目の選択肢は、AWS Batch です。コンテナのジョブをキューに積み、必要なだけの計算資源を用意して、順番に実行するサービスです。中で動くのは ECS（や EKS）で、Fargate も使えます。長いステップが 1 つあるだけなら、ECS のタスクで足ります。Batch が役に立つのは、ジョブが何千個もあって、優先順位を付けたり、Spot のインスタンスで安く動かしたりしたいときです。Step Functions からは、`arn:aws:states:::batch:submitJob.sync` で呼べます。

仕事と道具の対応を、表にまとめます。

| 仕事 | 道具 |
| --- | --- |
| 15 分より短く割れて、ステップが Lambda で書ける | Step Functions と Lambda（この章）、または durable functions |
| 割れないが、1 つずつ動かせばよい | Step Functions から ECS のタスク |
| 割れないジョブが大量にあって、キューと計算資源の管理が要る | AWS Batch |
| 5 分以内に必ず終わり、数が非常に多い | Express ワークフロー |
