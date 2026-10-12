---
title: "16 Workflow: デプロイ"
---

# 16 Workflow: デプロイ

## AWS にのせる準備

<!-- section: 16.infra -->

### bucket

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{bucket}

この bucket には、全員のノートが入ります。公開の設定は 4 つとも閉じて、HTTP での接続は拒否します。読めるのは、IAM で許された相手だけです。この章は、export を利用者に渡すところまでは作っていません。渡すなら、[07章](/ja/chapters/07-uploads.md)の presigned URL が使えます。

### 3 つの関数、3 つの role

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{steps}

関数を 1 つにまとめて、入力で分岐させることもできます。分けたのは、権限を分けたかったからです。

- `ExportPages` は、table を `Scan` できて、part を書けます。消せません
- `Finish` は、一覧できて、manifest を書けます。table は読めません
- `Discard` は、一覧できて、消せます。書けませんし、table も読めません

ノートを読める関数は 1 つだけ。object を消せる関数も 1 つだけです。`s3:PutObject` だけで `If-None-Match` の検査ができることは、S3 のドキュメントに書いてあります。`ExportPages` の `s3:GetObject` は、412 の後で metadata を読む `HeadObject` のためです。

### state machine

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{state-machine}

state machine にも、実行 role があります。Step Functions が、あなたの代わりに関数を呼ぶための role です。できるのは、3 つの関数の呼び出しだけ。信頼する相手を絞る条件（このアカウントの、このリージョンの state machine）は、公式ドキュメントの例と同じ形です。

定義は、`toJsonString` で 1 本の文字列にして渡しています。関数の ARN はデプロイするまで決まらないので、template の中では `Fn::Join` になります。

CloudFormation には、定義の中の `${名前}` を置き換える `DefinitionSubstitutions` という property もあります。この章は使いません。固定した版の cdkd（0.296.28）のソースを読むと、この置き換えは、定義を S3 から取ってくる場合にしか行われないからです。template に直接書いた定義には、効きません。テストは、この property が template に無いことを固定しています。

### schedule

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{schedule}

08章の schedule は、Lambda の関数を呼んでいました。今度の相手は state machine です。Scheduler は、Step Functions の `StartExecution` を呼びます。role に要るのは `states:StartExecution` で、対象はこの state machine 1 つです。

`input` の `<aws.scheduler.scheduled-time>` は、Scheduler が置き換える目印です。その回が予定されていた時刻（`2026-10-12T03:00:00Z` のような形）になります。これが、export の ID のもとです。

名前を付けて起動すれば、Step Functions の側で 2 重の起動を断ってもらえます。`StartExecution` は、同じ名前と同じ入力なら、動いている実行をそのまま返します。この章は、それを使っていません。この形の target では、Scheduler に実行の名前を渡す場所がないからです。別の形の target（universal target）なら渡せそうですが、時刻に含まれる `:` は実行の名前に使えません。試していないので、ここまでにします。2 重に起動されても困らないことは、step の側で受け止めています。

### テストが見ていること

- 使っているリソースの種類が 9 つちょうどで、`Custom::` で始まるものがない
- 既定では durable function が無い。関数は 3 つで、`DurableConfig` を持つものがなく、version も alias もない
- bucket の公開の設定が 4 つとも閉じていて、`exports/` の下が 7 日で消える
- 3 つの関数の role の action が、上に書いたものちょうどである
- object への操作が `exports/` の下に限られ、一覧にも prefix の条件が付いている。素の `*` がどこにもない
- state machine の role にできるのが、3 つの関数の呼び出しだけである
- デプロイされる定義が、手元で動かしたものと同じ state を持ち、`Task` が 3 つの関数を指している
- どの `Task` の timeout も、指している関数の timeout より長い
- schedule の入力、間隔、role

9 種類（`AWS::DynamoDB::Table`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Logs::LogGroup`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy`、`AWS::Scheduler::Schedule`、`AWS::StepFunctions::StateMachine`）は、固定した版の cdkd がどれも専用の実装を持っています。install した package の中身で確かめました。

## デプロイして確かめる

<!-- section: 16.deploy -->

ここから先は、実行していません。手順とタスクを用意したところまでです。

```bash
vp run export:infra:diff
vp run export:infra:deploy
vp run export:seed --notes 250
vp run export:start --id check-1 --wait
vp run export:status
```

`export:seed` は、05章の repository を使って、table にノートを書きます。`export:start` は、schedule を待たずに export を 1 回起動します。`--wait` を付けると、終わるまで 5 秒おきに状態を見ます。`export:status` は、最近の実行と、bucket にある export を並べます。manifest があるか、part がいくつあるか、履歴が何イベントあるかが見えます。

同じ ID でもう一度 `export:start` を実行すると、`ExecutionAlreadyExists` で断られるはずです。こちらは名前を付けて起動しているからです。

失敗した実行を再開するには、`export:status` が表示する ARN を渡します。

```bash
vp run export:status --redrive <execution ARN>
vp run export:logs --function pages
```

schedule は、作られるとすぐに 1 回目を起動します。08章と同じで、開始日を指定していない rate の schedule は、そう動くとドキュメントにあります。デプロイした直後に、頼んでいない export が 1 つできます。

drift の検査は、これまでと同じです。

```bash
vp run export:infra:drift
```

## 同じものを durable function で書く

<!-- section: 16.durable -->

ここまでの workflow は、JSON でした。loop は `Choice` で、変数は state の入出力で、try と catch は `Retry` と `Catch` でした。「ふつうのコードで書けたら」と思った人は、多いはずです。

Lambda durable functions は、それをやる機能です。公式ドキュメントで確かめた範囲で、同じ export を書き直してみます。

<<< @/examples/16-long-jobs/src/durable-export.ts{durable}

`while` が loop で、`try` と `catch` が補償処理です。step の関数（`exportPages`、`finishExport`、`discardExport`）は、Step Functions 版と同じものを、1 文字も変えずに使っています。

### 最初から、もう一度

読んで最初に引っかかるのは、「15 分で止められる関数の中の `while` が、なぜ続きから再開できるのか」でしょう。

```figure
caption: 2 回目の呼び出しは最初の行から走り直し、checkpoint のある step は実行されずに結果だけが返る
type: sequence
actor lambda: Lambda | checkpoint
actor handler: handler
actor s3: S3
note lambda: invocation 1
step lambda -> handler: handler が始まる
step handler -> handler: pages-from-1 が走る
step handler -> lambda: その結果を checkpoint
step handler -> handler: pages-from-21 が走る
step handler -x lambda: checkpoint の前に sandbox が死ぬ
note lambda: invocation 2
step lambda -> handler: 最初の行からもう一度始まる
step lambda --> handler: pages-from-1 は走らず、保存した結果が返る
step handler -> handler: pages-from-21 がもう一度走る
step handler -x s3: part はもう S3 にあり、2 回は書かれない
step handler -> handler: pages-from-41 … finish が走る
step handler -> lambda: それぞれの結果を checkpoint
```

答えは、続きから再開していない、です。関数は、最初の行からもう一度実行されます。ただし、`context.step` に包んだ処理は、結果が保存されていれば実行されず、保存された結果が返ります。これが replay です。コードは最初から走り、済んだ step だけが早送りされます。

ここから、決まりが 2 つ出てきます。

**step の外は、何度走っても同じでなければいけない。** replay のたびに、step の外のコードは全部もう一度走ります。そこで時刻を読んだり、乱数を引いたりすると、1 回目と 2 回目で違う道を通ります。このコードで step の外にあるのは、入力の検証と、`while` の条件と、step の名前の組み立てだけです。どれも、保存された結果から決まります。

**step の中は、やっぱり冪等でなければいけない。** ドキュメントは、step の既定を at-least-once と説明しています。step が終わる前に中断されたら、replay でもう一度走ります。上の図の `pages-from-21` です。この章の step は、前半で作ったとおり、何度走っても同じ part しか残しません。durable function にしたからといって、あの作業が要らなくなるわけではありません。

SDK には、step を「高々 1 回」にする設定もあります。ただ、ドキュメントの説明は慎重で、「再試行 1 回につき高々 1 回」です。再試行を止めないかぎり、step 全体で 1 回とは言えません。名前から保証を読み取らないほうがよい、という例です。

### Step Functions との違い

| | Step Functions（Standard） | Lambda durable functions |
| --- | --- | --- |
| workflow を書く場所 | ASL（JSON） | 関数のコード |
| 進捗の持ち主 | Step Functions | Lambda |
| 1 つの step の上限 | 呼ぶ相手による。Lambda なら 15 分 | 1 回の呼び出しが 15 分 |
| 全体の上限 | 1 年、履歴 25,000 イベント | 1 年、durable operation 3,000 個、保存 100 MB |
| 権限の分け方 | step ごとに別の関数、別の role にできる | 1 つの関数、1 つの role |
| Lambda 以外を呼ぶ | 多くのサービスを定義から直接呼べる | コードから SDK で呼ぶ |
| 課金 | state transition | durable operation、書いた量、保持した量 |

この章の題材で、いちばん効いた違いは 5 行目でした。Step Functions 版では、ノートを読める関数と、object を消せる関数が別々でした。durable function 版では、1 つの role が両方を持ちます。

AWS 自身の説明は、こうです。ロジックがほとんど Lambda の中にあって、コードで書きたいなら durable functions。多くのサービスをまたいだり、流れを図で見せたかったりするなら Step Functions。両方を使う構成も勧めています。

### デプロイするなら

<<< @/examples/16-long-jobs/infra/bin/app.ts{context}

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{durable}

durable function 版は、既定の stack には入っていません。`-c durable=true` を付けたときだけ、関数が 1 つ増えます。

```bash
vp run export:infra:deploy -c durable=true
vp run export:durable:start --id check-1
```

ふつうの関数と違うところが 3 つあります。

`durableConfig` で、durable execution を有効にします。`executionTimeout` は実行全体の上限、`timeout` は 1 回の呼び出しの上限で、別の設定です。すでにある関数に後から付けると、関数の作り直しになります。CDK は synth のときに、そう知らせてきます。

実行 role に、checkpoint を読み書きする 2 つの権限が要ります。対象の書き方に癖があります。Lambda は、この 2 つを「実行」の ARN に対して検査します。実行の ARN は、version の付いた関数の ARN の先に続きます。なので、関数の ARN そのままでは一致しません。`:*` を付けます。

呼ぶときは、version か alias を付けます。素の関数名では呼べません。実行は、始めたときの version に固定されます。`$LATEST` で始めた実行は、途中でコードを差し替えると、新しいコードで replay されます。step の名前や順番を変えていたら、保存された結果と合わなくなります。

`Lambda::Version` と `Lambda::Alias` は、固定した版の cdkd に専用の実装がなく、Cloud Control API 経由になります。[20章](/ja/chapters/20-shipping.md)と同じです。

正直に言うと、こちらは Step Functions 版よりも確かめられていません。手元では、SDK に付いてくる実行器（`LocalDurableTestRunner`）でコードを動かして、step が失敗した後のやり直しで part が増えないことまでは見ました。東京リージョンで使えることは、Price List に東京の単価が載っていることから推測しているだけです。公式ドキュメントに、使えるリージョンの一覧は見つけられませんでした。

### Durable Objects とは別のもの

Cloudflare を使ってきた人は、名前で混乱すると思います。Lambda durable functions と、Cloudflare の Durable Objects は、名前が似ているだけで、別のものです。

Durable Objects は、ID ごとに 1 つだけ存在する object です。それぞれが自分専用の storage を持ち、1 本の thread で動きます。「この部屋」「この利用者」のような 1 つの ID の状態を、1 か所で順番に扱うための部品です。[14章](/ja/chapters/14-kv-cache.md)で、rate limit の置き場所として出てきました。

Lambda durable functions は、1 回の処理の進み具合を保存する仕組みです。ID ごとの状態を持ち続けるものではありません。実行が終われば、残るのは履歴だけで、それも保持期間が過ぎれば消えます。

Cloudflare の側で近いのは、Workflows です。`step.do` で step を包み、step の結果が保存され、失敗すれば再試行されます。公式ドキュメントの注意書きも、よく似ています。step は何度も再試行されうるので冪等に。workflow は休止してメモリ上の状態を失うことがあるので、状態は step の戻り値から組み立てる。乱数や時刻は step の中で。

違いもあります。Workflows の 1 つの step は、経過時間に上限がありません（CPU 時間には上限があります）。Lambda は、durable function でも、1 回の呼び出しが 15 分までです。step の数の上限は、Workflows が有料プランの既定で 10,000、durable functions が 3,000 です。Workflows の配送の保証や、同じ ID の instance を 2 重に作ろうとしたときの動きは、読んだページからは確かめられませんでした。

## Lambda に入らない step

<!-- section: 16.containers -->

ここまでは、仕事を 15 分より短く割れる前提でした。割れない仕事もあります。1 本の動画を変換する。大きなファイルを 1 つ圧縮する。途中で止めたら最初からになる仕事です。メモリが 10 GB では足りない仕事や、Lambda に入らない道具が要る仕事もあります。

そういう step は、コンテナで動かします。この章では、説明だけにします。コードは作っていません。

**ECS の task。** 12章の service は、task を「常に N 個」動かし続けるものでした。task は、1 回だけ動かして、終わったら消えるようにも使えます。Step Functions からは、`Task` の `Resource` を `arn:aws:states:::ecs:runTask.sync` にします。`.sync` を付けると、Step Functions は task が終わるまで待ってから、次の state に進みます。Lambda の 15 分は、ここにはかかりません。Fargate なら、動いた秒数ぶんの vCPU とメモリに課金されます。

変わるところが 3 つあります。task は戻り値を返しません。進捗は、S3 や DynamoDB に自分で書いて、次の state がそれを読みます。入力は、コンテナの環境変数や引数として渡します。そして、image が要ります。12章の決まり（tag は immutable、`fromAsset` を使わない、image の tag なしで時間課金のものを作らない）が、そのまま当てはまります。

冪等性の話は、変わりません。task も再試行されますし、Step Functions があきらめた後で動き続けることもあります。ドキュメントは、`.sync` の task を中止したとき、止められずに課金が続く場合がある、と書いています。

**AWS Batch。** コンテナの job を queue に積んで、順番に、必要なだけの計算資源を用意して実行するサービスです。中で動くのは ECS（や EKS）で、Fargate も使えます。1 つの長い step なら、ECS の task で足ります。Batch が効くのは、job が何千個もあって、優先順位を付けたり、Spot の instance で安く回したりしたいときです。Step Functions からは、`arn:aws:states:::batch:submitJob.sync` で呼べます。

選び方を 1 行ずつにすると、こうなります。

| 仕事 | 道具 |
| --- | --- |
| 15 分より短く割れて、step が Lambda で書ける | Step Functions と Lambda（この章）、または durable functions |
| 割れないが、1 つずつ動かせばよい | Step Functions から ECS の task |
| 割れない job が大量にあって、queue と計算資源の管理が要る | AWS Batch |
| 5 分以内に必ず終わり、数が非常に多い | Express workflow |
