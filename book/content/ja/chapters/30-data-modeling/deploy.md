---
title: "30 Data Modeling: デプロイ"
---

# 30 Data Modeling: デプロイ

手元で動いた設計を AWS にのせます。スタックに入るのは、テーブルとそのインデックスとストリーム、ストリームを読む Lambda 関数、あきらめたバッチを受けるキュー、そしてアプリに渡すための権限です。API は入りません。

## AWS にのせる準備

<!-- section: 30.infra -->

<<< @/examples/30-data-modeling/infra/lib/modeling-stack.ts{limits}

05章と同じく、オンデマンドのテーブルに 1 秒あたりの上限を付けます。書き込みの上限は 05章の 40 より大きくしました。いちばん大きな書き込みは、本文が上限いっぱいのノートを、タグ 8 個と slug と一緒に書くトランザクションで、82 ユニットほどになるからです。上限より大きな 1 回の書き込みが通るかどうかは 05章でも確かめていないので、それより上にしてあります。

インデックスにも、別に上限があります。インデックスの写しは本文を持たず小さいので、値は小さくて済みます。ただし、インデックスの書き込みの上限は、テーブルへの書き込みを止める力を持っています。低くしすぎないでください。

テーブルの定義は[実装のつづき](/ja/chapters/30-data-modeling/more.md)の「ホットパーティション」に、インデックスの定義は[しくみと実装](/ja/chapters/30-data-modeling/build.md)の「別の並び順のためのインデックス」に載せました。`removalPolicy` は `DESTROY` です。練習用なので、スタックを消すと、テーブルの中身もすべて消えます。

### アプリに渡す権限

このスタックには、ノートブックを呼ぶ関数がありません。かわりに、06章や 07章の関数のロールに付けられるマネージドポリシーを 1 つ作ります。

<<< @/examples/30-data-modeling/infra/lib/modeling-stack.ts{app-policy}

05章の 5 つの操作に、`dynamodb:ConditionCheckItem` が増えました。`TransactWriteItems` という名前の権限はありません。公式ドキュメントによると、トランザクションの中の `Put`、`Update`、`Delete` は、それぞれ `PutItem`、`UpdateItem`、`DeleteItem` の権限で判定され、`ConditionCheck` は `ConditionCheckItem` の権限で判定されます。

インデックスは、テーブルとは別のリソースです。ARN は `table/<テーブル名>/index/<インデックス名>` で、テーブルの ARN への許可はインデックスには及びません。インデックスへの `Query` を、別のステートメントで許可しています。

`Scan` と、まとめて読み書きする操作は、今回も入れていません。移行のスクリプトは `Scan` を使いますが、実行する人の認証情報で動かします。

### ストリームを読む関数の権限

<<< @/examples/30-data-modeling/infra/lib/modeling-stack.ts{projector-role}

関数がテーブルに対して行うのは、目印の `Put` と件数の `Update` を 1 つにまとめたトランザクションだけです。読み取りも削除もしないので、権限は 2 つです。

ストリームを読むのは Lambda ですが、使うのは関数のロールです。ストリームの ARN に対して 3 つの操作を許可します。

`dynamodb:ListStreams` だけは、対象を `*` にしてあります。この操作はリソースを指定できません。IAM のサービスリファレンスでも、対象にできるリソースの種類が載っていません。この本のほかのスタックは `*` を使わない方針ですが、ここは絞りようがないので、テストで「`*` を使うのはこの 1 つだけ」であることを固定しました。Lambda がイベントソースマッピングを作るときに、この権限を実際に必要とするかどうかは、AWS で確かめていません。AWS の管理ポリシー `AWSLambdaDynamoDBExecutionRole` に含まれている操作なので、入れてあります。

<<< @/examples/30-data-modeling/infra/lib/modeling-stack.ts{dead-letters}

イベントソースマッピングの定義は[実装のつづき](/ja/chapters/30-data-modeling/more.md)の「Streams で派生データを作る」に載せました。

固定した版の cdkd（0.296.28）は、このスタックが使う種類のうち、`AWS::DynamoDB::Table`、`AWS::IAM::ManagedPolicy`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::EventSourceMapping`、`AWS::Lambda::Function`、`AWS::Logs::LogGroup`、`AWS::SQS::Queue` に専用の実装を登録しています。インストールしたパッケージの中身で確かめました。`AWS::SQS::QueuePolicy` は、08章のスタックがすでに使っている種類です。

## デプロイして確かめる

<!-- section: 30.deploy -->

```bash
vp run modeling:infra:diff
vp run modeling:infra:deploy
vp run modeling:smoke
```

`modeling:smoke` は、あなた自身の認証情報で、デプロイしたテーブルにノートを 1 件作り、添付を足し、1 回の `Query` で両方が返ることを確かめます。そのあと、遅れて届く 2 つを待ちます。

<<< @/examples/30-data-modeling/scripts/modeling.ts{smoke}

インデックスの一覧にノートが出るまでと、ストリームの関数がタグの件数を書くまでを、250 ミリ秒おきに読み直して待ち、見えるまでの時間を表示します。表示される時間には、読み直しの間隔と、あなたの端末から AWS までの往復が含まれます。目安であって、インデックスや関数の遅れそのものではありません。

最後にノートを消し、タグの件数が 0 に戻るのを待ちます。件数のアイテム（`QUOTA` と `TAGCOUNT#smoke`）と、関数が書いた目印は、テーブルに残ります。目印は TTL で消えます。

関数のログは、スタックの出力 `ProjectorLogGroupName` のロググループにあります。1 回の呼び出しごとに、受け取ったレコードの数、適用した数、重複として見分けた数が 1 行で出ます。

ドリフトの検査は、これまでの章と同じです。

```bash
vp run modeling:infra:drift
```

Contributor Insights を有効にするときは、`-c insights=on` を付けてデプロイします。ルール 2 つぶんの月額がかかります。次のデプロイで付け忘れると無効に戻るので、続けて使うなら `cdk.json` の `context` に書いてください。

```bash
vp run modeling:infra:deploy -c insights=on
```

### 既存のテーブルを移す

05章から 08章のテーブルを新しい形に移すなら、手順は[実装のつづき](/ja/chapters/30-data-modeling/more.md)の「キーを止めずに移す」のとおりです。そのテーブルのスタックにインデックスを足してデプロイしたあと、次のタスクを使います。

```bash
vp run modeling:backfill --table <テーブル名>
vp run modeling:backfill --table <テーブル名> --apply
vp run modeling:verify --table <テーブル名>
vp run modeling:remove-legacy --table <テーブル名>
```

`modeling:backfill` と `modeling:remove-legacy` は、`--apply` を付けないかぎり、何件を書くか、消すかを表示するだけで、何も変えません。`modeling:backfill` は 1 ページごとに、再開する位置を `--after` の形で表示します。`modeling:verify` は、新しい形になっていないアイテムを並べ、1 件でもあれば失敗で終わります。

この節のタスクは、どれも実際の AWS では動かしていません。
