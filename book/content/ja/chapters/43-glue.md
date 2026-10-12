---
title: "43 Glue: Data Catalog、crawler、ETL job、Data Quality"
revision: 1
---

# 43 Glue: Data Catalog、crawler、ETL job、Data Quality

Glue の Data Catalog にあるテーブルは、S3 のファイルについての約束です。どのフォルダーに、どんな列のファイルが、どの形式で入っているかが書いてあります。ただし、ファイルがその約束どおりかどうかを、カタログは確かめません。約束を守るのは、ファイルを書く側の仕事です。

[26章](/ja/chapters/26-analytics.md)では、Firehose が書いたファイルをそのまま Athena で読みました。同じ記録が 2 回入っていることがあり、フォルダーの日付は記録が届いた日で、リクエストに答えた日とは限りませんでした。この 2 つは、クエリのたびに SQL の側で吸収していました。この章では、ファイルを書き直す側を作ります。Glue のジョブが生の JSON を読み、重複を取り除き、リクエストに答えた日ごとの Parquet に書きます。

料金は、ジョブが動いた時間で決まります。スタックを置いてあるだけの月は、定価でアラーム 1 つぶんの USD 0.10 で、アカウントのアラームが 10 個までなら無料枠に収まります。ジョブを 1 回動かすと、最低でも USD 0.0147 かかります。計算は[最後のページ](/ja/chapters/43-glue/wrap.md)にあります。

Spark のジョブのスクリプトは Python で書きます。この本のコードのうち、TypeScript でないのはこの 1 ファイルだけです。手元に Spark は無く、Nix の shell にも入れていないので、このスクリプトは一度も実行していません。ジョブが何を書くべきかは TypeScript の関数として定義し、テストしました。スクリプトはその定義どおりに書いたもので、定義どおりに動くことは、デプロイしてから確かめる手順を用意したところまでです。

前提は [05章](/ja/chapters/05-dynamodb.md)、[07章](/ja/chapters/07-uploads.md)、[16章](/ja/chapters/16-long-jobs.md)、[26章](/ja/chapters/26-analytics.md)です。コードは `examples/43-glue/` にあります。

## 全体像

<!-- section: 43.overview -->

```figure
caption: ジョブは生のファイルを読み、日ごとの Parquet に書き直す。カタログの 2 つのテーブルは、それぞれのフォルダーの場所と列を書いた定義である
node raw: S3 requests_json/ | dt=届いた日、gzip の JSON
node job: Glue ジョブ | Spark、2 DPU
node curated: S3 requests_curated/ | dt=答えた日、Parquet
node catalog: Glue Data Catalog | requests_raw、requests_curated
edge raw -> job: 前後 1 日のフォルダー
edge job -> curated: 日のフォルダーを置き換え
edge catalog --> raw: 場所と列
edge catalog --> curated: 場所と列
mark job
```

```figure
caption: ジョブは手で始めるか、トリガーが始める。書けずに終わった実行は、EventBridge のルールがトピックに知らせる
node you: vp run glue:run
node trigger: Glue トリガー | 01:00 UTC、既定では無効
node job: Glue ジョブ
node rule: EventBridge ルール | FAILED、TIMEOUT、STOPPED
node topic: SNS トピック
node alarm: CloudWatch アラーム
edge you -> job: StartJobRun
edge trigger --> job
edge job --> rule: Glue Job State Change
edge rule -> topic
edge rule --> alarm: MatchedEvents
mark job
```

バケットには 2 つのフォルダーがあります。`requests_json/` は 26章の Firehose が書くのと同じ置き方で、gzip で圧縮した JSON が、届いた日のフォルダーに入っています。`requests_curated/` はジョブが書く場所で、Parquet が、リクエストに答えた日のフォルダーに入ります。このスタックに Firehose は入っていません。生のファイルは、サンプルをアップロードして用意します。

カタログには、2 つのフォルダーに 1 つずつテーブルを置きます。列の一覧は 26章の `record.ts` にある 1 つだけで、両方のテーブルと、Spark が読むときのスキーマが、そこから作られます。

ジョブは、指定された日について、前後 1 日を含む 3 つのフォルダーを読み、その日に答えたリクエストだけを残し、同じ `event_id` を 1 件にまとめます。Data Quality のルールで確かめてから、その日のフォルダーを丸ごと置き換えます。

トリガーは毎日 01:00 UTC にジョブを始める設定で作りますが、既定では有効にしません。有効にするまで、ジョブは誰かが始めたときだけ動きます。

### この章の不変条件

実行が成功したあと、その日のフォルダーには、その日に答えたリクエストが 1 件ずつ入っています。前の実行が途中で失敗していても、同じ日を何度実行しても、行は欠けず、重複もしません。[次のページ](/ja/chapters/43-glue/build.md)で、この条件を壊そうとするテストを書きます。

## Glue という名前が指すもの

<!-- section: 43.names -->

Glue は 1 つの機能の名前ではありません。2026 年 10 月 13 日の時点で、ドキュメントは次のものを Glue と呼んでいます。

Data Catalog は、テーブルの定義を置く場所です。Athena、Redshift Spectrum、EMR、Glue のジョブが、同じ定義を読みます。26章で作ったデータベースとテーブルは、ここにありました。オブジェクト 100 万個と、月 100 万回のリクエストまでは無料です。

crawler は、S3 などのデータを実際に読んで、形式と列を推測し、テーブルとパーティションをカタログに書きます。動いた時間に課金され、1 回につき最低 10 分ぶんがかかります。

ジョブは、Glue が実行するスクリプトです。種類は 4 つあります。Spark のジョブはコマンド名が `glueetl` で、最低 2 DPU が要ります。Spark Streaming のジョブは `gluestreaming` です。Python shell のジョブは `pythonshell` で、Spark を使わない Python のスクリプトを 0.0625 DPU か 1 DPU で動かします。AWS は Python shell からほかの手段へ移る手順のページを公開していて、移行先に Spark のジョブ、Lambda、ECS を挙げています。4 つ目の Ray のジョブは、2026 年 4 月 30 日から新しい利用者を受け付けていません。この章が作るのは Spark のジョブです。

トリガーは、ジョブや crawler を、スケジュール、条件、手動のどれかで始めます。ワークフローは、複数のジョブ、crawler、トリガーを 1 つのグラフにまとめたものです。

Data Quality は、DQDL という言語で書いたルールを、カタログのテーブルか、ジョブの中のデータに対して評価します。

Schema Registry は、Kafka や Kinesis Data Streams のようなストリームを流れるレコードのスキーマを、版を付けて管理します。ファイルのテーブルの定義とは別のもので、この章では使いません。

ほかに DataBrew や interactive sessions も Glue の名前で提供されていますが、この章では扱いません。

## ジョブにする場合、しない場合

<!-- section: 43.choices -->

生の JSON を Parquet にする方法は、Glue のジョブのほかにもあります。

Firehose のフォーマット変換は、26章で `-c format=parquet` として試しました。届いたレコードを、届いた順に Parquet で書きます。重複を取り除くことも、答えた日のフォルダーに入れ直すこともできません。

Athena の `CREATE TABLE AS SELECT` と `INSERT INTO` は、SQL で書ける変換なら何でもできます。料金は読んだ量で決まり、26章の計算では 1 回のクエリが USD 0.00005 ほどでした。Glue のジョブの最低額の、約 300 分の 1 です。制約は 2 つあります。1 回のクエリが書けるパーティションは 100 個までです。そして `INSERT INTO` はファイルを足すだけで、置き換えません。同じ日をもう一度実行すると、行が 2 倍になります。Athena そのものは [49章](/ja/chapters/49-athena.md)で扱います。

Lambda は、1 日ぶんがメモリに収まり 15 分で終わるなら、いちばん手軽です。Parquet を書くライブラリと、フォルダーを置き換える処理は、自分で用意します。15 分で終わらない処理は、[16章](/ja/chapters/16-long-jobs.md)の ECS のタスクにします。

Glue の Spark のジョブは、この中で最低額がいちばん高い選択肢です。1 回の実行に、少なくとも 2 DPU の 1 分ぶんがかかります。この章のサンプルは 1 日 400 件です。26章の月 100 万リクエストの試算でも、1 日ぶんは gzip で 2 MB ほどでした。量だけを見れば、Lambda か Athena で足ります。

Spark のジョブが合うのは、1 台のメモリに収まらない量を扱うとき、すでに Spark で書いた処理があるとき、変換の途中に Data Quality の検査を入れたいときです。ワーカーの数を増やせば、同じスクリプトでより大きな量を処理できます。

この章がジョブを作るのは、Glue が主題だからです。ただし、ジョブの外側にある考え方は、どの方法を選んでも同じです。何を書くべきかを先に関数として決めること、出力の場所を入力から一意に決めること、追記ではなく置き換えにすることは、Lambda で書いても Athena で書いても変わりません。
