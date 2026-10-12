---
title: "58 Ledger: デプロイ"
---

# 58 Ledger: デプロイ

手元で動いた台帳を AWS にのせます。スタックに入るのは、テーブル、ロックつきのバケット、ダイジェストを取る Lambda 関数とそのスケジュール、そして書き手と監査する人に渡す権限です。API は入りません。

このページの手順は用意してあるだけで、実行していません。

## スタック

<!-- section: 58.stack -->

<<< @/examples/58-ledger/infra/lib/ledger-stack.ts{table}

テーブルはオンデマンドで、キーは 2 つだけです。`removalPolicy` は `DESTROY` なので、スタックを消すと記録も消えます。練習用の設定です。

<<< @/examples/58-ledger/infra/lib/ledger-stack.ts{bucket}

バケットには、バージョニングと Object Lock を有効にし、既定の保持期間を付けます。書かれたオブジェクトのバージョンは、リクエストが何も指定しなくても、この期間だけロックされます。

**このバケットの `removalPolicy` は `RETAIN` です。** ロックされたバージョンが残っているバケットは、スタックからは消せません。消そうとして失敗するより、最初から残すことにしました。片付けは、保持期間が過ぎてから自分で行います。

保持のモードと期間は、コンテキストで指定します。

<<< @/examples/58-ledger/infra/lib/ledger-stack.ts{lock}

既定は governance モードの 1 日です。練習で作ったダイジェストが、翌日には消せるようになります。`-c lockMode=compliance -c lockDays=2557` のように指定すると、約 7 年のあいだ、root ユーザーを含めて誰にも消せないオブジェクトができます。compliance モードは、試しに使うものではありません。期間を間違えても短くできず、バケットはその日まで残ります。

<<< @/examples/58-ledger/infra/test/ledger-stack.test.ts{lock-test}

### 書き手、関数、監査する人の権限

書き手のポリシーは[しくみと実装](/ja/chapters/58-ledger/build.md)に載せました。`dynamodb:PartiQLInsert` と `dynamodb:Query` だけです。ノートの API を動かす関数のロールに、このマネージドポリシーを付けます。

<<< @/examples/58-ledger/infra/lib/ledger-stack.ts{digester}

ダイジェストを取る関数は、テーブルを読み、決まったプレフィックスの下にオブジェクトを書きます。テーブルには書けません。オブジェクトのバージョンを消す権限も、governance モードのロックを外す権限も持ちません。

<<< @/examples/58-ledger/infra/lib/ledger-stack.ts{auditor}

監査する人のロールは、テーブルとバケットの両方を読めて、どちらにも書けません。バージョンの一覧は `s3:ListBucketVersions`、バージョンを指定した読み取りは `s3:GetObjectVersion` で、どちらも `s3:ListBucket` や `s3:GetObject` とは別のアクションです。

スタックのどのロールにも、アイテムを更新、削除する権限と、オブジェクトのバージョンを削除する権限がありません。テストは、禁止したいアクションの名前を並べて、テンプレートのどこにも現れないことを確かめています。

とはいえ、アカウントの管理者は、こうしたロールとは関係なく、テーブルを書き換えられます。その場合に頼れるのは、ロックされたダイジェストと、CloudTrail です。アイテムへの読み書きを CloudTrail に残すには、証跡でデータイベントを有効にする必要があり、料金がかかります（21章）。

<<< @/examples/58-ledger/infra/lib/ledger-stack.ts{schedule}

スケジュールの間隔は、守られていない記録が存在しうる時間の長さです。短くすれば隙間は狭まり、S3 へのリクエストが増えます。追記のたびにダイジェストを書くこともできますが、追記 1 回ごとに S3 の `PutObject` が 1 回増え、東京リージョンの単価では、DynamoDB への書き込み 1 ユニットの 6 倍あまりになります。

固定した版の cdkd（0.296.28）は、このスタックが使う種類のすべて、つまり `AWS::DynamoDB::Table`、`AWS::Events::Rule`、`AWS::IAM::ManagedPolicy`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy` に専用の実装を登録しています。バケットの実装が、作成のときに Object Lock を有効にし、既定の保持期間を設定するコードを持つことも、インストールしたパッケージの中身で確かめました。実際に作れることは、確かめていません。

## デプロイして確かめる

<!-- section: 58.deploy -->

```bash
vp run ledger:infra:diff
vp run ledger:infra:deploy
vp run ledger:append
vp run ledger:append
vp run ledger:digest
vp run ledger:append
vp run ledger:verify
```

`ledger:append` は、あなた自身の認証情報で、見本の出来事を 1 件追記します。`ledger:digest` は、スケジュールされた関数と同じ処理を手元から 1 回実行して、ダイジェストをバケットに書きます。関数が動くのを 1 時間待たずに済ませるためのタスクです。`ledger:verify` は、テーブルの記録すべてと、ダイジェストのすべてのバージョンを読んで、結果を表示します。この順に実行すれば、記録が 3 件、ダイジェストが 1 件、まだ守られていない記録が 1 件と表示され、見つかった問題は 0 件になるはずです。問題が 1 つでもあれば、タスクは失敗で終わります。

関数のログは、出力 `DigestLogGroupName` のロググループにあります。1 時間ごとに、`written`、`unchanged`、`empty` のどれかが 1 行ずつ出ます。

書き換えを AWS の上で試すなら、コンソールでテーブルのアイテムを 1 つ編集してから、`ledger:verify` を実行します。編集できるのは、あなたが管理者だからです。書き手のポリシーだけを付けたロールでは、同じ編集は断られるはずですが、これも確かめていません。

`ledger:infra:drift` は、スタックの設定が変えられていないかを調べます。バケットの既定の保持期間が短くされていれば、ここで分かるはずです。ユーザーガイドによると、既定の保持期間は、オブジェクトが書かれたときにそのバージョンの期限として計算されます。すでにロックされたバージョンの期限は、既定を変えても動きません。

片付けの前に、出力 `DigestBucketName` を控えてください。スタックを消すと、出力も見えなくなります。続きは[費用、注意点、片付け](/ja/chapters/58-ledger/wrap.md)です。
