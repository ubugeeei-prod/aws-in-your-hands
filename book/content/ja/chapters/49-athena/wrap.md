---
title: "49 Athena: 費用、注意点、片付け"
---

# 49 Athena: 費用、注意点、片付け

## 料金

<!-- section: 49.cost -->

このページでは、ここまでの章で扱ったクエリにいくらかかるかを計算します。金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**デプロイしただけで、クエリを 1 回も実行しない月は、0 です。** ワークグループ、保存したクエリ、ロールには料金がなく、バケットは空です。Price List にも料金ページにも、Athena の毎月の無料枠は見当たりませんでした。

実行したときの料金は、読んだ量だけで決まります。違いが見えるように、26章より大きなテーブルを仮定します。1 日 100 万件の記録が 1 年ぶんあり、同じ問い（ある 1 日のステータスごとの件数）を月に 1,000 回実行します。

| クエリの書き方とテーブル | 1 回に読む量 | 月 1,000 回 |
| --- | --- | --- |
| 日付で絞る、gzip の JSON | 56 MB | 0.27 |
| 日付で絞らない、上限なし | 20,428 MB | 97.41 |
| 日付で絞らない、上限 1 GiB で取り消し | 1,024 MB | 4.88 |
| 日付で絞る、Parquet の 2 列 | 最低の 10 MB | 0.05 |

1 行目と 2 行目の違いは、`WHERE` に `dt` があるかどうかだけです。`LIMIT` を付けても 2 行目は変わりません。集計のクエリは、全部の行を読んでから答えを出すからです。

3 行目は、この章のワークグループで同じ間違いをした場合です。料金は 20 分の 1 になりますが、クエリは 1 つも答えを返しません。上限は間違いを安くするもので、間違いを直すものではありません。取り消されたクエリが上限をどれだけ超えて読むかは確かめていないので、表はちょうど 1 GiB として計算しています。

4 行目は、同じ記録を Parquet のテーブルにした場合です。`at` と `status` の 2 列は、1 日ぶんで 6.4 MB ほどです。10 MB に届かないので、どのクエリも最低額になります。この大きさは、26章のサンプルを手元のライブラリで書いて測ったもので、Athena が書く Parquet の大きさは確かめていません。

表に入れていないものが 3 つあります。Athena がデータを読むときの S3 へのリクエスト、結果を置いておく保存料、Glue Data Catalog へのリクエストです。クエリ 1 回が S3 に何回リクエストするかは、26章と同じく確かめていません。

### 書く文の料金

`INSERT INTO`、CTAS、`UNLOAD`、`MERGE INTO`、`OPTIMIZE` も、読んだ量で課金されます。書いた量は Athena の料金には入りませんが、書いたファイルには S3 の保存料とリクエストの料金がかかります。派生テーブルを作ると、同じ記録を 2 か所に持つことになります。

Iceberg のテーブルでは、消したつもりの行のファイルが、`VACUUM` を実行するまでバケットに残ります。保存料は、テーブルに見えている行数ではなく、バケットにあるファイルの量で決まります。

### キャパシティ予約

最小の予約である 4 DPU を 1 か月持ち続けると、**1,255.60** です。クエリを 1 回も実行しなくても同じ金額がかかります。この章のスタックは予約を作りません。試しに作った予約を消し忘れると、時間で課金され続けます。

## Cloudflare や Vercel から来た人へ

<!-- section: 49.compare -->

26章で、記録を集めて集計する仕組みを両方のプラットフォームについて比べました。ここでは、この章で足した部分だけを見ます。2026 年 10 月 13 日の時点で、公式ドキュメントから読み取れた範囲です。

Cloudflare でこの章にいちばん近いのは Basin SQL です。以前は R2 SQL と呼ばれていたもので、ドキュメントには一般提供とあり、Basin Catalog にある Iceberg のテーブルに SQL を実行します。SQL のリファレンスに載っているのは、結合や集合演算を含む `SELECT`、`SHOW`、`DESCRIBE`、`EXPLAIN` です。`INSERT`、`UPDATE`、`DELETE`、`MERGE`、`CREATE TABLE AS` は載っていません。テーブルに書くのは、Basin Pipelines のような別の仕組みの役目です。クエリのパラメーターについての記述も、リファレンスには見当たりませんでした。`LIMIT` を書かないクエリは、既定で 500 行までを返します。

違いをまとめると、Basin SQL は読むための入口で、ワークグループ、エンジンの版、結果の保存先、テーブルの整理といった、この章で自分が決めたものを利用者に見せません。Athena は、同じエンジンで書き込みも、行単位の変更も、ログのテーブルも扱える代わりに、それらを全部自分で決めて、自分で片付けます。Iceberg のテーブルを読んで集計するだけなら、Cloudflare の側に置いたままのほうが、決めることはずっと少なくて済みます。

Vercel には、自分のファイルに SQL を実行する機能は見当たりません。Query は、Vercel が集めたリクエストや関数のイベントを、フォームか AI のアシスタントで条件を選んで集計するもので、結果を CSV か JSON で書き出せます。Observability Plus が要り、ドキュメントに SQL のインターフェースの記述はありませんでした。アプリが出すデータを自分の形でためて問い合わせたいなら、Vercel の外に置き場所を持つことになり、その 1 つがこの章の構成です。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| クエリが取り消される | ワークグループの上限（1 GiB）を超えました。`WHERE` に `dt` の条件があるかを確かめます。取り消されても、読んだぶんは課金されます |
| 結果が 0 件 | 26章の表を見ます。フォルダーの日付は UTC で、`2026-10-01` より前は範囲の外です |
| パラメーター付きのクエリが開始で断られる | `?` の数と、渡した値の数が合っているかを確かめます。`athena:sql` で文とパラメーターを表示して数えます |
| 文字列のパラメーターを渡したクエリが失敗する | 値が一重引用符で囲まれているかを確かめます。`text()` を通さずに値を渡すと、引用符が付きません |
| CTAS が `external_location` のエラーで失敗する | ワークグループが結果の保存先を強制しています。場所を決めたいテーブルは、DDL で先に作って `INSERT INTO` します |
| CTAS で作ったテーブルが 1 週間後に空になる | ファイルが `results/tables/` に置かれ、ライフサイクルルールで消えました。テーブルの定義は残っています。`DROP TABLE` で消します |
| `INSERT INTO` のあと件数が 2 倍になった | 同じ日について 2 回実行しました。その日のフォルダーのファイルを消してやり直すか、Iceberg のテーブルと `MERGE INTO` に替えます |
| `UNLOAD` が何も書かない | 書き出し先にすでにファイルがあります。`--export` に別の名前を渡します |
| `VACUUM` は成功したのにバケットが減らない | 実行した人に `s3:DeleteObject` がありません。権限がなくてもクエリは成功します |
| `OPTIMIZE` が `FilterNode` のエラーで失敗する | `WHERE` にパーティション以外の列を書いています。書けるのは `dt` だけです |
| `AccessDenied` で失敗する | メッセージの操作名と ARN を見ます。Glue の操作なら、テーブルだけでなくデータベースとカタログにも権限が要ります |
| 待つのをやめたのに課金が続く | クエリは止めないかぎり動き続けます。クエリの ID を指定して `StopQueryExecution` を呼びます |
| スタックを消せない | バケットが空ではありません。`vp run athena:empty --yes` を先に実行します |

## 本番にするなら

- クエリを実行できる人とワークグループを IAM で決めます。上限は、ほかのワークグループを使える人には効きません。`primary` という既定のワークグループを使えるかどうかも確かめます
- ワークグループ全体の読んだ量に通知を付けます。1 回ごとの上限は、回数の多さを止めません。アプリからクエリを実行するなら、実行の回数を自分でも数えます
- 利用者の操作からクエリを直接実行しません。クエリは非同期に動き、同時に実行できるクエリの数にはクォータがあります。先に集計して結果を DynamoDB などに置き、画面はそれを読みます
- 結果のバケットを読める人を、データを読める人と同じ範囲にします。結果の保持期間も、元のデータと同じ基準で決めます
- 派生テーブルを作る処理を、誰がいつ実行するかを決めます。この章は手で実行しています。定期的に動かすなら、[16章](/ja/chapters/16-long-jobs.md)の仕組みに載せ、`attempt` に日付を入れて、同じ日のやり直しが同じクエリを指すようにします
- Iceberg のテーブルには、`OPTIMIZE` と `VACUUM` を実行する予定を立てます。整理を任せたいなら、S3 Tables を検討します
- エンジンの版を切り替えるときは、新しい版のワークグループを別に作り、よく使うクエリを先に通します。固定していても、古い版の提供が終われば切り替わります
- バケットの `removalPolicy` を `RETAIN` にします
- 反映の経路を AWS CDK CLI と CloudFormation にします。理由は 02章に書いたとおりです

## 片付け

<!-- section: 49.cleanup -->

派生テーブルを作ったなら、先にテーブルの定義を消します。定義は 26章のデータベースにあるので、この章のスタックを消しても残ります。`<名前>` を `requests_compact`、`requests_iceberg`、`scratch_errors` に置き換えて、作ったものだけを消してください。

```bash
aws athena start-query-execution --work-group aih-athena --query-string 'DROP TABLE IF EXISTS aih_analytics.<名前>'
```

次に、バケットを空にして、スタックを消します。

```bash
vp run athena:empty
vp run athena:empty --yes
vp run athena:infra:destroy
```

1 つ目は、バケットにあるオブジェクトの数を表示するだけです。`--yes` を付けると、クエリの結果、書き出したファイル、派生テーブルのファイルをすべて消します。固定している版の cdkd は空でないバケットを消さないので、スタックを消す前に実行します。

スタックを消すと、ワークグループ、保存したクエリ、ロール、バケットが消えます。ワークグループには `recursiveDeleteOption` を付けてあるので、クエリの履歴が残っていても消せるはずです。実際の AWS では確かめていません。

26章のスタックとその記録は、この章の片付けでは消えません。26章の手順で片付けます。

## 分散システムとして見ると

Athena は、状態を持たないクエリのエンジンに見えますが、扱いを間違えると二重になるものが 2 つあります。

- 状態の持ち主: テーブルの定義は Glue Data Catalog、データは S3 のファイル、クエリの状態は Athena が持ちます。Iceberg のテーブルでは、どのファイルがテーブルに属するかをメタデータが持ちます
- 不変条件（invariant）: Athena に渡す SQL の本文は、利用者の値で変わらない。クライアントは、待つのをやめたクエリを動かしたままにしない。同じ開始は、何回送ってもクエリを 1 つしか始めない
- 不変条件を壊そうとするテスト: 引用符を含む値を渡す、開始の応答を失わせる、いつまでも終わらないクエリを待たせる、止める呼び出しを失敗させる、の 4 通りです
- 重複（クエリ）: 開始の再試行で、同じクエリが 2 つ動きます。`ClientRequestToken` を自分で決めて防ぎます
- 重複（データ）: `INSERT INTO` のやり直しで、同じ行が 2 回入ります。Hive 形式のテーブルには防ぐ仕組みがないので、Iceberg のテーブルに `event_id` で `MERGE INTO` します
- 部分的な失敗: 失敗した `INSERT INTO`、CTAS、`UNLOAD` は、書きかけのファイルを残すことがあります。Iceberg のテーブルでは、失敗した書き込みはテーブルから見えません
- 古さ: 再利用された結果は、許した時間のぶんだけ古い可能性があります。Athena は元のデータの変化を確かめません
- 同時の書き込み: 2 つの `MERGE INTO` が同時に同じテーブルに書いたときに何が起きるかは、この章では扱っておらず、確かめてもいません。Athena は Glue の楽観的なロックだけに対応する、とドキュメントにあります

::: details この章の検証メモ

**手元で確かめたこと。** 文の組み立て、パラメーターの引用、DDL と `MERGE` に入れる値の検査、クライアント（自作の代役に対して）、読む量と料金の計算、ログのテーブル定義の穴埋め、スタックのユニットテスト（70 件）。型検査。synth（`-c lakeBucketName=<名前>` を付けた場合も）。`athena:sql` で 10 個の文を、`athena:logs:ddl` で 4 種類のテーブル定義を表示。26章の `analytics:sizes` を実行し直して、料金の計算に使ったバイト数を確認。

**まだ確かめていないこと。** `athena:infra:deploy`、`athena:run`、`athena:infra:drift`、`athena:empty`、`athena:infra:destroy` は、実際の AWS では動かしていません。とくに次の点は、ドキュメントから読み取っただけです。

- この章の SQL のすべて。Athena で 1 つも実行していません。構文は、ドキュメントの書式に合わせただけです。パラメーターにした `dt` の条件でパーティションが絞られること、すべての列を `GROUP BY` に並べる重複の除き方が通ることも確かめていません
- 実行パラメーターの値を Athena がどう解釈するか。引用符で囲んで引用符を重ねた値が、常に 1 つの文字列として扱われること
- 結果の保存先を強制するワークグループで、`location` を指定した Iceberg の `CREATE TABLE`、`UNLOAD`、`LOCATION` を指定した `CREATE EXTERNAL TABLE` が通ること。ドキュメントが失敗すると書いているのは、`external_location` を指定した CTAS だけです
- アナリストのロールの権限で、この章の文がすべて実行できること
- `GetQueryResults` の最初の行が列の名前であること。API リファレンスには記述がありません
- `LIMIT` だけのクエリが途中で読むのをやめるかどうか。上限を超えたクエリが、どれだけ読んでから取り消されるか
- `MERGE INTO` がテーブルの側をどれだけ読むか。同時に実行した 2 つの書き込みの扱い
- cdkd が、ワークグループと保存したクエリを Cloud Control API 経由で作成・更新・削除できること
- ログの 4 つのテーブル定義。ドキュメントの文を保存しただけで、Athena では作っていません。この本のスタックは、これらのログを S3 に配送していません
- 料金のうち、Athena のクエリ 1 回が S3 に行うリクエストの数、結果の保存料、S3 Tables の料金、キャパシティ予約で実行したクエリの課金の扱い
- Cloudflare と Vercel の記述は、公式ドキュメントを要約して読んだものです。どちらのサービスも動かしていません

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像、この構成を選んだ理由 | `examples/49-athena/infra/lib/athena-stack.ts` | `athena:infra:synth` |
| 読む量を決めるもの、料金 | `examples/49-athena/src/cost.ts`、`test/cost.test.ts` | `test:unit` |
| ワークグループと結果の置き場所、権限 | `examples/49-athena/infra/lib/athena-stack.ts`、`infra/test/athena-stack.test.ts` | `test:unit`、`athena:infra:synth` |
| 値を文に埋め込まない | `examples/49-athena/src/statement.ts`、`src/queries.ts`、`test/statement.test.ts`、`test/queries.test.ts` | `test:unit`、`athena:sql` |
| 開始して、待って、取りにいく | `examples/49-athena/src/client.ts`、`src/athena-sdk.ts`、`test/client.test.ts`、`test/fake-athena.ts` | `test:unit` |
| Athena に書かせる、Iceberg のテーブル | `examples/49-athena/src/queries.ts`、`test/queries.test.ts` | `test:unit`、`athena:sql` |
| ログのテーブル | `examples/49-athena/src/logs.ts`、`sql/`、`test/logs.test.ts`、`scripts/log-table.ts` | `test:unit`、`athena:logs:ddl` |
| 手元で確かめられること | `examples/49-athena/scripts/query.ts`、`test/` | `test:unit`、`athena:sql`、`athena:infra:synth` |
| デプロイして確かめる | `examples/49-athena/infra/bin/app.ts`、`scripts/query.ts` | `athena:infra:diff`、`athena:infra:deploy`、`athena:run`、`athena:infra:drift` |
| 片付け | `examples/49-athena/scripts/empty-output.ts` | `athena:empty`、`athena:infra:destroy` |

**cdkd（0.296.28）での扱い。** インストールした版の `dist/` を読んで確かめました。専用の実装があるもの: `AWS::S3::Bucket`、`AWS::S3::BucketPolicy`、`AWS::IAM::Role`、`AWS::IAM::Policy`。専用の実装が無く Cloud Control API 経由になるもの: `AWS::Athena::WorkGroup`、`AWS::Athena::NamedQuery`。cdkd が持っている「Cloud Control API では扱えない種類」の一覧に、この 2 つはありません（Athena で載っているのは `AWS::Athena::Session` だけです）。削除のときは、保存したクエリをワークグループより先に消す順序が組み込まれています。

**一次情報**（確認日は 2026-10-13。出典ごとの内容は[出典の一覧](/ja/reference/sources.md)にあります）

- 料金: [Amazon Athena Pricing](https://aws.amazon.com/athena/pricing/)（課金の考え方）、[AWS Price List: Athena](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonAthena/current/ap-northeast-1/index.json)（単価）
- ワークグループとエンジン: [Configure per-query and per-workgroup data usage controls](https://docs.aws.amazon.com/athena/latest/ug/workgroups-setting-control-limits-cloudwatch.html)、[Athena engine versioning](https://docs.aws.amazon.com/athena/latest/ug/engine-versions-reference.html)、[Athena engine version 3](https://docs.aws.amazon.com/athena/latest/ug/engine-versions-reference-0003.html)、[Change Athena engine versions](https://docs.aws.amazon.com/athena/latest/ug/engine-versions-changing.html)、[Managed query results](https://docs.aws.amazon.com/athena/latest/ug/managed-results.html)、[Manage query processing capacity](https://docs.aws.amazon.com/athena/latest/ug/capacity-management.html)、[Service Quotas](https://docs.aws.amazon.com/athena/latest/ug/service-limits.html)
- 読む量: [Partition your data](https://docs.aws.amazon.com/athena/latest/ug/partitions.html)、[Optimize data](https://docs.aws.amazon.com/athena/latest/ug/performance-tuning-data-optimization-techniques.html)、[Optimize queries](https://docs.aws.amazon.com/athena/latest/ug/performance-tuning-query-optimization-techniques.html)
- パラメーター: [Use parameterized queries](https://docs.aws.amazon.com/athena/latest/ug/querying-with-prepared-statements.html)、[Configure access to prepared statements](https://docs.aws.amazon.com/athena/latest/ug/security-iam-athena-prepared-statements.html)、[SELECT](https://docs.aws.amazon.com/athena/latest/ug/select.html)（引用符の書き方）、[Escape reserved keywords in queries](https://docs.aws.amazon.com/athena/latest/ug/reserved-words.html)
- API: [StartQueryExecution](https://docs.aws.amazon.com/athena/latest/APIReference/API_StartQueryExecution.html)、[QueryExecutionStatus](https://docs.aws.amazon.com/athena/latest/APIReference/API_QueryExecutionStatus.html)、[GetQueryResults](https://docs.aws.amazon.com/athena/latest/APIReference/API_GetQueryResults.html)、[Reuse query results in Athena](https://docs.aws.amazon.com/athena/latest/ug/reusing-query-results.html)、[Identify query output files](https://docs.aws.amazon.com/athena/latest/ug/querying-finding-output-files.html)
- 書く文: [Considerations and limitations for CTAS queries](https://docs.aws.amazon.com/athena/latest/ug/ctas-considerations-limitations.html)、[CREATE TABLE AS](https://docs.aws.amazon.com/athena/latest/ug/create-table-as.html)、[INSERT INTO](https://docs.aws.amazon.com/athena/latest/ug/insert-into.html)、[UNLOAD](https://docs.aws.amazon.com/athena/latest/ug/unload.html)
- Iceberg: [Query Apache Iceberg tables](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg.html)、[Create Iceberg tables](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg-creating-tables.html)、[Update Iceberg table data](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg-updating-iceberg-table-data.html)、[MERGE INTO](https://docs.aws.amazon.com/athena/latest/ug/merge-into-statement.html)、[Perform time travel and version travel queries](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg-time-travel-and-version-travel-queries.html)、[Optimize Iceberg tables](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg-data-optimization.html)、[Evolve Iceberg table schema](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg-evolving-table-schema.html)、[Register S3 table bucket catalogs and query Tables from Athena](https://docs.aws.amazon.com/athena/latest/ug/gdc-register-s3-table-bucket-cat.html)
- ログのテーブル: [CloudTrail](https://docs.aws.amazon.com/athena/latest/ug/create-cloudtrail-table-partition-projection.html)、[ALB](https://docs.aws.amazon.com/athena/latest/ug/create-alb-access-logs-table.html)、[CloudFront](https://docs.aws.amazon.com/athena/latest/ug/create-cloudfront-table-standard-logs.html)、[S3 のサーバーアクセスログ](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-s3-access-logs-to-identify-requests.html)
- 権限: [Example workgroup policies](https://docs.aws.amazon.com/athena/latest/ug/example-policies-workgroup.html)、[Configure access to databases and tables in the AWS Glue Data Catalog](https://docs.aws.amazon.com/athena/latest/ug/fine-grained-access-to-glue-resources.html)、[Control access to Amazon S3 from Athena](https://docs.aws.amazon.com/athena/latest/ug/s3-permissions.html)
- そのほか: [Use Amazon Athena Federated Query](https://docs.aws.amazon.com/athena/latest/ug/federated-queries.html)、[AWS::Athena::WorkGroup EngineVersion](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-athena-workgroup-engineversion.html)
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) の型定義、[@aws-sdk/client-athena 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-athena/v/3.1149.0) の型定義
- Cloudflare: [Basin SQL](https://developers.cloudflare.com/r2-sql/)、[SQL reference](https://developers.cloudflare.com/r2-sql/sql-reference/)
- Vercel: [Query](https://vercel.com/docs/query)

:::
