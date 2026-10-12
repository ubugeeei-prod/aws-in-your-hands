---
title: "26 Analytics: Firehose、S3、Glue、Athena"
revision: 1
---

# 26 Analytics: Firehose、S3、Glue、Athena

[19章](/ja/chapters/19-observability.md)のログは、いま起きている障害を調べるためのものでした。保持は 7 日で、調べる対象は「このリクエストに何が起きたか」です。

この章で扱うのは、もっと長い期間についての問いです。先月はノートが 1 日に何件作られたか、更新の衝突はどのくらいの割合で起きているか、遅いルートはどこか。こうした問いに答えるために、リクエスト 1 件につき 1 件の記録をファイルとして S3 にため、必要になったときに SQL で集計します。

サーバーもクラスターも立てません。記録が届かず、誰もクエリを実行しない月は、料金がかかりません。そのかわり、ファイルの置き方とクエリの書き方が、そのまま料金と正しさを決めます。この章の中心はそこです。

前提は [07章](/ja/chapters/07-uploads.md)と [19章](/ja/chapters/19-observability.md)です。題材は [05章](/ja/chapters/05-dynamodb.md)のノート API で、アプリのコードは変えずに外側から包みます。コードは `examples/26-analytics/` にあります。

## 全体像

<!-- section: 26.overview -->

```figure
caption: 関数はリクエストに答えたあと、記録を 1 件 Firehose に渡す。Firehose はためてから S3 に書く
node client: Browser / curl
node api: API Gateway HTTP API
node fn: Lambda | 05章のアプリと、記録する部分
node table: DynamoDB テーブル
node stream: Firehose ストリーム | 60 秒か 5 MB までためる
node lake: S3 バケット | requests_json/dt=2026-10-12/
edge client -> api: HTTPS
edge api -> fn
edge fn -> table
edge fn -> stream: PutRecord（1 行の JSON）
edge stream --> lake: gzip のオブジェクト
mark stream
```

```figure
caption: クエリは Athena が実行する。テーブルの定義は Glue から、データは S3 から読む
node you: vp run analytics:query
node athena: Athena | ワークグループ、上限 1 GiB
node glue: Glue Data Catalog | テーブルの定義
node lake: S3 バケット | 記録
node results: S3 バケット | athena-results/
edge you -> athena: SQL
edge athena -> glue: 列とパーティションの規則
edge athena -> lake: 該当する日のオブジェクトを読む
edge athena --> results: 結果の CSV
mark athena
```

登場するサービスは 4 つで、どれも役割が 1 つだけです。

Amazon Data Firehose は、受け取ったレコードをためて、まとめて S3 に書くサービスです。リクエストのたびに関数が S3 へ直接書くと、月 100 万リクエストで 100 万個の小さなオブジェクトができます。Firehose は 60 秒ぶんを 1 つにまとめます。

S3 のバケットには、記録が日付ごとのフォルダーに分かれて入ります。`dt=2026-10-12/` のような名前のフォルダーを、Athena はパーティション（partition）として扱います。

AWS Glue Data Catalog は、テーブルの定義を置く場所です。どのバケットのどのフォルダーに、どんな列のファイルがあるかを持っています。データそのものは持ちません。

Amazon Athena は、S3 のファイルに対して SQL を実行するサービスです。料金は読んだバイト数で決まり、東京リージョンでは 1 TB あたり USD 5.00 です。日付で絞ったクエリは、その日のフォルダーしか読みません。

### この章の不変条件

記録が 1 件も書けなくても、API のレスポンスは変わりません。反対に、バケットにある記録はノートの正本ではありません。記録は欠けることも、同じものが 2 回入ることもあります。クエリはそれを前提に書きます。

## この構成を選んだ理由

<!-- section: 26.choices -->

### CloudWatch Logs をそのまま使わない理由

19章の Logs Insights でも集計はできます。それでも別の置き場所を作るのは、目的が違うからです。ログは障害を調べるための記録で、形は実装の都合で変わり、保持は短くします。集計のための記録は、形を決めて長く残します。料金の形も違い、CloudWatch Logs は取り込みに 1 GB あたり 0.76 かかりますが、S3 の保存は 1 GB 月あたり 0.025 です。

DynamoDB のテーブルを集計しないのは、テーブルにあるのがいまの状態だけだからです。先月作られて消されたノートは、テーブルには残っていません。

### dynamic partitioning を使わない理由

Firehose には、レコードの中の値でフォルダーを分ける dynamic partitioning があります。たとえば利用者の ID やイベントの種類ごとに分けられます。この章では使わず、Firehose がレコードを受け取った時刻から日付のフォルダーを作る、追加料金のない書き方にしました。理由は 3 つあります。

- 日付で絞れれば足りる。この章の問いは、どれも期間を決めて集計するものです
- 料金がかかる。届けたデータ 1 GB あたり 0.032 に加えて、オブジェクト 1,000 個あたり 0.008、レコードから値を取り出す処理に 1 時間あたり 0.112 です。金額の試算は[最後のページ](/ja/chapters/26-analytics/wrap.md)にあります
- 作るときにしか有効にできず、あとから無効にもできない

もう 1 つ、この本の道具の事情があります。固定している版の cdkd（0.296.28）の Firehose のプロバイダーは、`DynamicPartitioningConfiguration` を Firehose に渡しません。ソースを読んで確かめました。この本の手順のままでは、dynamic partitioning を使うストリームをデプロイできません。

受け取った時刻で分ける方法には、日付の境目でずれが出るという代償があります。[次のページ](/ja/chapters/26-analytics/build.md)で、ずれを再現するテストと、クエリの側での扱いを書きます。

### crawler を使わない理由

Athena は、テーブルにどんなパーティションがあるかを知らなければ読めません。新しい日付のフォルダーを毎日登録する方法には、Glue の crawler を動かす方法と、`ALTER TABLE ADD PARTITION` を実行する方法があります。この章はどちらも使わず、partition projection を使います。フォルダーの名前の規則をテーブルに書いておくと、Athena がクエリの条件から読むべきフォルダーを計算します。動かし続けるものがありません。

### API Gateway のアクセスログとの違い

この章の記録は、アプリが答えたリクエストだけです。ステージのスロットリングで 429 になったリクエストは関数まで届かないので、記録にも残りません。

それも集計したいときは、API Gateway のアクセスログを使います。HTTP API のアクセスログは CloudWatch Logs に書かれ、ロググループのサブスクリプションフィルター（subscription filter）で Firehose に流せます。CloudWatch Logs から届くレコードは gzip で圧縮された JSON の包みで、中に複数のログイベントが入っています。Firehose には、この包みを展開する機能があります。この経路は、この章のスタックには入れていません。

### この構成にしないほうがよい場合

知りたいことが 19章のメトリクスとログで足りているなら、この章の仕組みは要りません。記録の形を決めて保ち続けることには手間がかかり、形を変えると古いファイルとの互換を考えることになります。まず 19章のダッシュボードとクエリで困るかどうかを見て、ログの保持期間より長い期間の問いが出てきたときに足すものです。
