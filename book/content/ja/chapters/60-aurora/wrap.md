---
title: "60 Aurora: 費用、注意点、片付け"
---

# 60 Aurora: 費用、注意点、片付け

章の最後に、料金、Cloudflare と Vercel から見たときの違い、つまずきやすいところ、本番に向けて変えること、片付けの順に確かめます。

## 料金

<!-- section: 60.cost -->

金額は USD、東京リージョン、従量課金、税別です。単価は AWS Price List の 2026-10-06 公開分で、計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。Aurora に無料枠やクレジットが当たるかどうかは確かめていないので、引いていません。

Aurora の請求は、インスタンスの分とクラスターの分に分かれます。インスタンスの分は ACU 時間で、止まっているあいだは 0 です。クラスターの分は、ストレージ、I/O、バックアップで、インスタンスが止まっていても、1 台もなくても続きます。

この章の既定の構成（0 から 1 ACU、Aurora Standard）で、月の料金を 3 通りに見積もります。

| 場合 | 仮定 | 定価 / 月 |
| --- | --- | --- |
| ずっと止まっていた | 一度も再開せず。データ 1 GB、シークレット 1 つ | 0.52 |
| 練習で使った | 合計 10 時間起きていて、そのあいだ 1 ACU。I/O が 100 万回、Data API が 1 万回 | 2.26 |
| 一度も止まらなかった | 730 時間ずっと 1 ACU | **110.02** |

1 行目の内訳は、ストレージが 0.12、シークレットが 0.40 です。データベースより、パスワードを置いておく料金のほうが高くなります。2 行目は、それに ACU の 1.50、I/O の 0.24、Data API の 0.0042 が加わります。I/O と Data API の回数は測った値ではなく、置いた数です。

3 行目が、止め忘れたときの上限です。最大を 1 ACU にしてあるので、インスタンスの料金は 109.50 を超えません。最大を上げれば、上限もその倍率で上がります。実際の請求が 1 行目と 3 行目のあいだのどこになるかは、インスタンスが止まっていた時間で決まり、Aurora が保守のために再開した時間も含まれます。

どの行にも、11章の VPC の料金と、バックアップの料金は入っていません。バックアップは、無料の割り当てを超えた分が 1 GB 月あたり 0.023 です。割り当ての大きさは確かめていません。

### provisioned との比較

Serverless v2 の 1 ACU は、1 時間 0.15 です。同じ Aurora PostgreSQL の provisioned のインスタンス、たとえば db.t4g.medium は 1 時間 0.113 で、730 時間で 82.49 になります。負荷が一定で、止まる時間がないなら、大きさを決めて借りるほうが安くなります。Serverless v2 が合うのは、負荷の山と谷の差が大きい場合と、止まっている時間が長い場合です。なお、T 系のインスタンスクラスでは Data API を使えません。

### Standard と I/O-Optimized

ストレージの料金構成は 2 つあります。Aurora Standard は I/O の回数に課金し、Aurora I/O-Optimized は I/O に課金しない代わりに、ACU とストレージの単価が高くなります。

| | Standard | I/O-Optimized |
| --- | --- | --- |
| ACU 時間 | 0.15 | 0.20 |
| ストレージ（GB 月） | 0.12 | 0.27 |
| I/O（100 万回） | 0.24 | 0 |

どちらが安いかは、I/O の回数で決まります。

<<< @/examples/60-aurora/src/cost.ts{break-even}

平均 1 ACU で 730 時間、データが 100 GB のクラスターで計算すると、I/O が月におよそ 2 億 1,458 万回のところで、2 つの料金が同じになります。それより少なければ Standard が、多ければ I/O-Optimized が安くなります。たとえば月 3 億回なら、Standard は 193.50、I/O-Optimized は 173.00 です。

AWS の目安は、I/O の料金が Aurora の請求全体の 25% 以上なら I/O-Optimized、というものです。上の例で 2 つが同じになる点では、I/O の割合は約 30% でした。目安は入口として使い、切り替える前に、請求書の `Aurora:StorageIOUsage` の行と、ACU とストレージの量で計算し直してください。Standard から I/O-Optimized への切り替えは 30 日に 1 回までで、戻すのはいつでもできます。

この章のクラスターは、I/O がほとんどないので Standard のままにしています。

## Cloudflare と Vercel から見ると

<!-- section: 60.platforms -->

以下は 2026-10-13 に各社のドキュメントを読んだ結果です。

D1 には、インスタンスも、フェイルオーバーも、容量の設定もありません。利用者が扱うのはデータベースという 1 つの名前だけです。D1 との違いは [13章](/ja/chapters/13-sql/wrap.md)にまとめてあり、この章で足したもの、つまりエンドポイント、容量、接続の切れ方は、D1 では利用者の仕事になっていない部分です。

Cloudflare には、Workers から既存の Postgres につなぐ Hyperdrive があります。AWS に置いたデータベースも対象で、接続のプールとクエリのキャッシュを Cloudflare の側で持ちます。Workers をやめずに Aurora を使う道具です。プライベートサブネットにあるクラスターにどう届かせるかは、この章では確かめていません。Data API は HTTPS なので Workers からも呼べるはずですが、AWS の署名が要り、これも試していません。

Vercel は、自社の Vercel Postgres をやめ、Marketplace の連携に移しました。既存のデータベースは 2024 年 12 月に Neon に移されています。Marketplace には AWS の連携もあり、Aurora PostgreSQL、Aurora DSQL、DynamoDB が並んでいます。この連携がクラスターをどう作り、どう請求するかは読んでいません。

これらの環境で足りているなら、そのままでかまいません。Aurora を選ぶ理由になるのは、PostgreSQL の機能がそのまま要ること、データを自分の VPC の中に置きたいこと、reader やクローンのように、ストレージが分かれていることから出てくる機能を使いたいことです。引き換えに、この章で書いた不変条件を自分で守ることになります。ただし、応答の返らなかった書き込みをどうするかは、どの環境でも残る問題です。HTTP の向こうにデータベースがあるかぎり、クライアントは「届いたのに答えが返らなかった」場合に出会います。冪等性の鍵は、Aurora に限らず使える方法です。

## つまずきやすいところ

実際のクラスターで起こして確かめたものではなく、ドキュメントとコードから読める原因です。

| こうなったら | ここを見る |
| --- | --- |
| 何も使っていないのに ACU の料金が出ている | 開いたままの接続、RDS Proxy、論理レプリケーション。`ServerlessDatabaseCapacity` が 0 になっているか |
| 最初の呼び出しだけ遅い、または `DatabaseResumingException` | 止まっていたインスタンスの再開。15 秒ほど、長く止まっていたら 30 秒以上。再試行する |
| `HttpEndpoint isn't enabled for cluster` | クラスターの `EnableHttpEndpoint`。cdkd がクラスターを Cloud Control API 経由で作ったか |
| `Transaction <ID> isn't found` | 前の呼び出しから 3 分たった。または、前の呼び出しのエラーでトランザクションが終わっている |
| 書き込みが読み取り専用のエラーになる | 降格したインスタンスにつながったままの接続。捨てて、つなぎ直す |
| 同じ追記が 2 回入った | SDK のクライアントの `maxAttempts`。クライアントが送り直すたびに新しい鍵を作っていないか |
| デプロイがエンジンの版で失敗する | `aws rds describe-db-engine-versions --engine aurora-postgresql` で作れる版を調べ、`-c engineVersion=` で渡す |

## 本番にするなら

- 別の AZ に reader を 1 台置き、昇格の優先順位を 0 か 1 にします。reader の最小容量が writer に合わせて保たれ、フェイルオーバーが分から秒の単位になります。計算機の料金は 2 台分になります
- 最小容量は、よく使うデータがメモリーに載る大きさにします。0 にするのは、最初の接続が 15 秒待たされてもよいシステムだけです
- 削除保護を入れ、バックアップの保持期間を決め、スタックを消すときに最後のスナップショットを取る設定にします。バックアップとリストアは 59章と [22章](/ja/chapters/22-recovery.md)にあります
- アプリ用のデータベースユーザーと、そのシークレットを作ります。Data API を呼ぶロールには、5 つの `rds-data` のアクションをこのクラスターの ARN にだけ、`secretsmanager:GetSecretValue` をそのシークレットにだけ許します
- 鍵と一緒に、リクエストの中身の要約も記録します。同じ鍵で違う内容が来たら、保存した結果を返さずに断ります。この章のコードにはこの検査がありません
- 古い鍵を消す処理を、定期的に動かします。残す期間は、クライアントが送り直す期間より長くします
- `ServerlessDatabaseCapacity` が最大に張り付いたとき、`ACUUtilization` が高いままのときにアラームを出します（[19章](/ja/chapters/19-observability.md)）
- 接続の数が多いなら RDS Proxy を検討します。ただし、proxy を付けると auto-pause は働きません

## 片付け

<!-- section: 60.cleanup -->

```bash
vp run aurora:infra:destroy
```

インスタンス、クラスター、サブネットグループ、セキュリティグループが消えます。Aurora が管理していたシークレットは、ドキュメントによれば、クラスターと一緒に消えます。最後のスナップショットは取らないので、データは戻せません。

消したあとに確かめるものが 2 つあります。RDS のコンソールで、手動のスナップショットと、保持された自動バックアップが残っていないこと。Secrets Manager に、Aurora が作ったシークレットが残っていないこと。どちらも、残っていれば料金が続きます。スタックを消したあとに実際に何が残るかは、この章では確かめていません。

11章の VPC は、このスタックとは別です。ほかの章で使わないなら、`vp run net:infra:destroy` で消します。この章のスタックは VPC の出力をインポートしているので、消す順序は、この章のスタックが先、VPC があとです。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト 54 件（`vp test run examples/60-aurora`）。追記の 5 つの文それぞれの前と後、10 か所で接続を落とし、どの場合も 1 回だけ適用されて同じ答えが返ること。鍵のない再試行が 2 回適用すること。記録済みの鍵で本体が実行されないこと、持ち主ごとの鍵の分離、何も変えなかった答えの記録、データベースが断ったリクエストを再試行も記録もしないこと、古い鍵の掃除。SQLSTATE の分類。Data API の adapter の変換と例外の仕分け、SDK のクライアントの `maxAttempts` が 1 であること、PGlite で作った代役のサービスに対して `CommitTransaction` の応答が失われても 1 回だけ適用されること。Standard と I/O-Optimized の損益分岐の計算。スタックのアサーション。型検査（`tsc --noEmit`）。`vp run aurora:infra:synth`。手元の PostgreSQL は PGlite（13章によれば PostgreSQL 18.3）で、Aurora PostgreSQL 17 とは版が違います。

**まだ確かめていないこと。** スタックを一度もデプロイしていません。`aurora:infra:deploy`、`aurora:db:schema`、`aurora:smoke`、`aurora:infra:drift`、`aurora:infra:destroy` は未実行です。とくに次が確認待ちです。エンジンの版 17.9 で東京に新しいクラスターを作れること。cdkd がクラスターを Cloud Control API 経由で作り、`EnableHttpEndpoint` と `SecondsUntilAutoPause` が効き、`MasterUserSecret.SecretArn` の出力が解決されること。インバウンドのルールのないセキュリティグループのまま Data API が届くこと。Aurora が管理するシークレットを Data API に渡せること。`$1` を `:p1` に書き換えた SQL と `CAST` が Data API で通ること。`UPDATE ... RETURNING` の行が `records` と列のラベルで返ること。止まっているインスタンスへの呼び出しが `DatabaseResumingException` になるのか、待って成功するのか。300 秒で止まること、再開にかかる時間。フェイルオーバーは一度も起こしていません。フェイルオーバーのときに node-postgres と Data API が実際に返すエラー、降格したインスタンスが返す SQLSTATE、エンドポイントの名前が切り替わるまでの時間は、どれも未確認です。`src/pg.ts` は型検査だけで、実行していません。同じ鍵の 2 つのリクエストが別々の接続で同時に走る場合は、台本のテストだけで、実際の PostgreSQL では動かしていません。再開の手順は[検証の記録](/ja/reference/validation.md)にあります。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| フェイルオーバーとアプリの仕事 | `src/failure.ts`、`test/failure.test.ts` | `test:unit` |
| 不変条件と、1 回だけ適用する仕組み | `src/once.ts`、`src/append.ts`、`migrations/0005_create_requests.sql`、`src/migrations.ts` | `test:unit` |
| 接続を落とすテスト | `test/support.ts`、`test/once.test.ts` | `test:unit` |
| Serverless v2 の容量 | `src/config.ts`、`src/pg.ts` | `test:unit` |
| Data API | `src/data-api.ts`、`test/data-api.test.ts` | `test:unit` |
| スタック | `infra/lib/aurora-stack.ts`、`infra/bin/app.ts`、`infra/test/aurora-stack.test.ts` | `aurora:infra:synth` |
| デプロイと動作確認 | `scripts/cloud.ts` | `aurora:infra:diff`、`aurora:infra:deploy`、`aurora:db:schema`、`aurora:smoke`、`aurora:infra:drift` |
| 料金 | `src/cost.ts`、`test/cost.test.ts` | `test:unit` |
| 片付け | `infra/lib/aurora-stack.ts` | `aurora:infra:destroy` |

**cdkd が扱うリソースの種類。** 固定した版（0.296.28）の npm パッケージの中身（`dist/rds-provider-*.js` と `dist/deploy-engine-*.js`）を読みました。`AWS::RDS::DBSubnetGroup`、`AWS::RDS::DBCluster`、`AWS::RDS::DBInstance`、`AWS::EC2::SecurityGroup` には専用の実装があります。ただし `DBCluster` の実装が扱うプロパティの一覧に `EnableHttpEndpoint` と `StorageType` はなく、`ServerlessV2ScalingConfiguration` からは `MinCapacity` と `MaxCapacity` だけを送ります。専用の実装が扱わないプロパティを持つリソースは Cloud Control API 経由に切り替わる、という分岐もパッケージの中にあります。読んだのは束ねられた JavaScript で、GitHub の `register-providers.ts` ではありません。

**一次情報**（確認日はすべて 2026-10-13）

- しくみ: [Amazon Aurora storage](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.StorageReliability.html)、[Endpoint connections](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.Endpoints.html)、[Cluster endpoints](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Endpoints.Cluster.html)、[Reader endpoints](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Endpoints.Reader.html)、[Custom endpoints](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Endpoints.Custom.html)、[High availability](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html)、[Fast failover with Aurora PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.BestPractices.FastFailover.html)、[Replication with Aurora PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.Replication.html)、[Quotas and constraints](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_Limits.html)
- Serverless v2: [How Aurora serverless works](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.how-it-works.html)、[Scaling to Zero ACUs](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)、[Performance and scaling](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.setting-capacity.html)、[Supported Regions and engines](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.ServerlessV2.html)、[Storage configurations: Regions and engines](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.storage-type.html)
- Data API: [Using the RDS Data API](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html)、[Limitations](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.limitations.html)、[Supported Regions and engines](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.Data_API.html)、[Operations reference](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api-operations.html)、[Timeout behavior](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api-timeouts.html)、[Session management](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.session-management.html)、[Authorizing access](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.access.html)、[Troubleshooting](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.troubleshooting.html)、[Results in JSON format](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api-json.html)、[@aws-sdk/client-rds-data 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-rds-data/v/3.1149.0) の型定義
- そのほかの機能: [Cloning](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Clone.html)、[Backtrack](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Managing.Backtrack.html)、[Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database.html)、[Zero-ETL integrations](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/zero-etl.html)、[Password management with Secrets Manager](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-secrets-manager.html)
- PostgreSQL との互換性と版: [Working with Aurora PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.AuroraPostgreSQL.html)、[Extension versions](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraPostgreSQLReleaseNotes/AuroraPostgreSQL.Extensions.html)、[Aurora PostgreSQL updates](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraPostgreSQLReleaseNotes/AuroraPostgreSQL.Updates.html)、[PostgreSQL 17: Error Codes](https://www.postgresql.org/docs/17/errcodes-appendix.html)、[pg 8.23.1](https://www.npmjs.com/package/pg/v/8.23.1) のソース
- Aurora DSQL: [What is Aurora DSQL?](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/what-is-aurora-dsql.html)、[Migrating from PostgreSQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html)、[Quotas and limits](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html)、[Concurrency control](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html)
- 料金とインフラ: AWS Price List bulk API の [Amazon RDS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-northeast-1/index.json) と [Secrets Manager](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/ap-northeast-1/index.json)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) の型定義、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) のパッケージの中身
- Cloudflare と Vercel: [Hyperdrive](https://developers.cloudflare.com/hyperdrive/)、[Postgres on Vercel](https://vercel.com/docs/postgres)、[Vercel Marketplace: AWS](https://vercel.com/marketplace/aws)

:::
