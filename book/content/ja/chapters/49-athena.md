---
title: "49 Athena: workgroup、partition、CTAS、Iceberg、ログを引く"
revision: 1
---

# 49 Athena: workgroup、partition、CTAS、Iceberg、ログを引く

Athena の料金は、クエリが S3 から読んだバイト数で決まります。東京リージョンでは 1 TB あたり USD 5.00 で、置いてあるだけでかかる料金はありません。この章で扱うことは、どれもこの 1 行から出てきます。読む量を減らすファイルの置き方、読みすぎを止めるワークグループ、利用者の値で文が書き換わらないクエリの組み立て方、そして Athena に書かせるときの注意です。

[26章](/ja/chapters/26-analytics.md)では、リクエストの記録を Firehose で S3 にため、Athena のテーブルとして定義し、集計のクエリを 3 つ用意しました。この章はその続きです。26章のテーブルをそのまま使い、Athena そのものを掘り下げます。Glue の crawler や ETL ジョブは[43章](/ja/chapters/43-glue.md)の範囲なので、ここでは扱いません。

前提は [07章](/ja/chapters/07-uploads.md)、[19章](/ja/chapters/19-observability.md)、[26章](/ja/chapters/26-analytics.md)です。コードは `examples/49-athena/` にあり、26章のコードを workspace の依存として使います。

この章のスタックには、時間で課金されるものがありません。デプロイしただけなら料金は 0 で、かかるのはクエリを実行したときと、バケットにファイルが残っているあいだだけです。金額の計算は[最後のページ](/ja/chapters/49-athena/wrap.md)にあります。

## 全体像

<!-- section: 49.overview -->

```figure
caption: クエリはワークグループを通る。読むのは 26章のバケットで、書くのはこの章のバケットだけ
node you: vp run athena:run | アナリストのロール
node wg: Athena ワークグループ | 上限 1 GiB、engine version 3
node glue: Glue Data Catalog | aih_analytics
node lake: 26章のバケット | requests_json/
node out: この章のバケット | results/、tables/、exports/
edge you -> wg: SQL と実行パラメーター
edge wg -> glue: テーブルの定義
edge wg -> lake: 該当する日だけ読む
edge wg --> out: 結果、派生テーブル
mark wg
```

Athena にはサーバーもクラスターもなく、利用者から見えるのはワークグループ（workgroup）だけです。ワークグループは、クエリの結果をどこに書くか、1 回のクエリがどこまで読んでよいか、どの版のエンジンで実行するかを決める場所です。この章のスタックは、上限を 1 GiB にしたワークグループを 1 つ作ります。

クエリを実行する人には、4 か所への権限が要ります。ワークグループ、テーブルの定義がある Glue Data Catalog、データのあるバケット、結果を書くバケットです。Athena は、クエリを実行した人の権限で S3 を読み書きします。スタックには、この 4 つをそれぞれ必要なだけに絞ったロールを入れてあります。

Athena が書くものは、種類ごとに捨ててよい時期が違います。クエリの結果は 7 日、書き出したファイルは 30 日で消し、テーブルのファイルは消しません。この 3 つを、1 つのバケットの中でフォルダーに分けています。

### クエリは非同期に動く

```figure
caption: クエリは開始、待ち、結果の取得の 3 つの呼び出しに分かれる
type: sequence
actor client: runQuery
actor athena: Athena
step client -> athena: StartQueryExecution（トークン付き）
step athena --> client: QueryExecutionId
step client -> athena: GetQueryExecution
step athena --> client: QUEUED / RUNNING
step client -> athena: GetQueryExecution
step athena --> client: SUCCEEDED
step client -> athena: GetQueryResults
step athena --> client: 行と NextToken
```

Athena の API には、SQL を渡すと結果が返ってくる呼び出しがありません。開始すると ID だけが返り、状態を問い合わせて待ち、終わってから結果を取りにいきます。待つのをやめても、クエリは止まりません。読み続け、料金もかかり続けます。

### この章の不変条件

この章で守ることは 2 つです。1 つは、Athena に渡す SQL の本文が、利用者から来た値によって変わらないことです。もう 1 つは、クライアントが待つのをやめたクエリを動かしたままにしないことと、同じ開始を 2 回送ってもクエリが 1 つしか始まらないことです。どちらも、[次のページ](/ja/chapters/49-athena/build.md)で壊そうとするテストを書きます。

## この構成を選んだ理由

<!-- section: 49.choices -->

### エンジンの版を固定する

Athena の SQL は、いまは Athena engine version 3 で動きます。ドキュメントによると、この版は Trino と Presto の開発を継続的に取り込んでいて、関数の一覧は Trino のドキュメントを参照する形になっています。どの版の Trino に当たるかは、ドキュメントに書かれていません。テーブルを作る `CREATE EXTERNAL TABLE` のような DDL は、これとは別の Hive の書き方です。予約語の囲み方も違い、DDL ではバッククォート、`SELECT` では二重引用符を使います。

ワークグループの既定は自動アップグレードで、新しい版が出ると、互換性の問題が見つからないかぎり Athena が切り替えます。この章のワークグループは版を明示しました。SQL を書いたときの版のまま動かし、切り替える時期を自分で決めるためです。固定しても、その版の提供が終われば、Athena が切り替えます。

### クエリ結果を自分のバケットに置く

ワークグループには、結果を Athena の管理する場所に置く設定（managed query results）もあります。バケットを用意する必要がなく、結果は 24 時間で消え、保存料はかかりません。それでもこの章が自分のバケットを使うのは、managed query results では結果の再利用が使えないからです。同じクエリを繰り返すダッシュボードのような使い方では、再利用を有効にすると、Athena はクエリを実行せずに前の結果を返します。結果を 24 時間より長く残したいときも、自分のバケットが要ります。

### キャパシティ予約を使わない

読んだ量ではなく、確保した処理能力に時間で払う方法もあります。キャパシティ予約（capacity reservation）は DPU という単位で処理能力を確保するもので、最小は 4 DPU、東京リージョンでは 1 DPU 時間あたり 0.43 です。4 DPU を 1 か月持ち続けると、クエリを 1 回も実行しなくても 1,255.60 になります。同時に実行するクエリの数を自分で決めたい規模になってから考えるもので、この本の規模では使いません。

### S3 Tables を使わない

Iceberg のテーブルを置く場所として、S3 にはテーブルバケット（S3 Tables）があります。ファイルのまとめ直しと古いスナップショットの整理を S3 が自動で行うもので、Athena からは Glue Data Catalog のカタログとして見えます。ドキュメントは、S3 Tables のテーブルに対して Athena の `OPTIMIZE` と `VACUUM` は使えず、整理は S3 の側で管理すると説明しています。

この章は、ふつうのバケットに Iceberg のテーブルを置きます。`OPTIMIZE` と `VACUUM` が何をしているかを、自分で実行して見るためです。Iceberg のテーブルを本番で長く持つなら、整理を任せられる S3 Tables は有力な選択肢です。S3 Tables の料金は、この章では確かめていません。

### S3 以外のデータ

Athena は、S3 以外のデータにもクエリを実行できます。Federated Query は、コネクターを通して、リレーショナルデータベースやそれ以外のデータソースを読む機能です。コネクターには、自分のアカウントの Lambda 関数として動くものと、Glue の接続として登録するものがあります。ノートの現在の状態を記録と突き合わせたい、という場面で候補になりますが、コネクターが読んだ量にも料金がかかり、Lambda の料金も別にかかります。この章では使っていません。

### この章の仕組みが要らない場合

26章のクエリを月に数回実行するだけなら、26章のワークグループで足ります。この章の内容が要るのは、利用者の入力がクエリの条件になるとき、アプリからクエリを実行するとき、記録が増えて JSON のままでは読む量が気になってきたとき、行を直したり消したりする必要が出てきたときです。
