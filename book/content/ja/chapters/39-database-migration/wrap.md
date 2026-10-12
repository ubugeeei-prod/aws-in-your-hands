---
title: "39 Database Migration: 費用、注意点、片付け"
---

# 39 Database Migration: 費用、注意点、片付け

章の最後に、料金、つまずきやすいところ、本番に向けて変えること、片付けを確かめます。片付けには、AWS のリソースのほかに、ソースのデータベースの中に残るものが含まれます。

## 料金

<!-- section: 39.cost -->

金額は USD、東京リージョン、従量課金、税別で、単価は 2026-10-13 に AWS Price List から取りました。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。2 つのデータベースの料金は、どの数字にも含めていません。

スタックを置いただけで、レプリケーションを一度も開始しなければ、1 か月 USD 0.80 です。シークレット 2 つの料金（1 つ USD 0.40）で、ほかに時間単位のものはありません。

レプリケーションを開始すると、1 DCU（Single-AZ）で 1 時間 USD 0.1144126570 がかかります。1 週間（168 時間）動かして切り替えた場合を計算すると、DCU が USD 19.22、Secrets Manager のインターフェースエンドポイント（2 つのサブネットに 168 時間）が USD 4.70、シークレットが USD 0.80 で、合計 USD 24.73 です。スケールアップしないと仮定した数字で、最大の 2 DCU で動き続ければ DCU の分は 2 倍になります。

切り替えた後にレプリケーションを止め忘れると、同じ構成で 1 か月 USD 104.76 です（DCU が USD 83.52、エンドポイントが USD 20.44、シークレットが USD 0.80）。

比べるために、この章が作らない構成も計算しておきます。いちばん小さいレプリケーションインスタンス（dms.t3.micro、Single-AZ）は 1 時間 USD 0.028 で、タスクを 1 つも動かさなくても 1 か月 USD 20.44 です。動かしている時間あたりでは Serverless の 1 DCU より安いので、その大きさで足りる複製を何か月も続けるなら、インスタンスのほうが安くなります。

無料枠は適用していません。料金ページによると、2025 年 7 月 15 日より前に Free Tier に入ったアカウントには dms.t3.micro の月 750 時間が 1 年間あり、それ以降のアカウントにはクレジットが付きます。読者のアカウントがどちらかはわからないので、差し引いていません。Serverless の DCU の無料枠は、料金ページに見つかりませんでした。

料金ページには、DMS への転送は無料で、DMS と同じアベイラビリティーゾーンの RDS との間の転送も無料とあります。別のゾーンやリージョンとの間には、通常の転送料金がかかります。この章の数字には含めていません。ログの料金も含めていません。

レプリケーションを止めた後、容量が解放されるまでの間に DCU が課金されるかは、確認できませんでした。止める API の説明には「止めても容量は解放しない」とあり、ユーザーガイドには 48 時間開始されなかったレプリケーションの容量を解放するとあります。確実に課金を止めるには、設定ごと消します。

## つまずきやすいところ

<!-- section: 39.pitfalls -->

タスクは動いているのに、テーブルが 1 つ止まっている。テーブル単位のエラーの既定は、そのテーブルだけを止めてタスクを続ける設定です。レプリケーションの状態だけを見ていると気づきません。テーブルごとの統計を見ます。

`text` の主キー。この章の検査が止める理由にしているものです。型の対応表とトラブルシューティングの記述から読んだもので、実際に失敗するかは確かめていません。premigration assessment の結果を見てください。

本文が切り詰められる。limited LOB mode の上限より長い `text` は切り詰められます。この章は、切り詰める代わりにタスクを失敗させる設定にしています。失敗したら、上限を上げて最初からやり直します。上限の単位がソースの文字コードのバイト数と一致するかは確かめていないので、余裕を持たせてあります。

ターゲットへの最初の `INSERT` が一意制約でぶつかる。シーケンスを進めていません。件数も中身も一致しているのに起きるので、切り替えの判定の項目に入れてあります。

やり直したら主キーの重複が出る。`DO_NOTHING` では、前回入った行が残っています。最初からやり直す前に、ターゲットのテーブルを空にします。

検証がいつまでも終わらない。書き込みが続いている行は検証できず、失敗が 10,000 件を超えると検証は止まります。主キーのないテーブルは `No primary key` のままです。

ソースのディスクが減っていく。読み手のいないスロットが WAL を溜めています。`pg_replication_slots` を見ます。

エンドポイントの接続テストが失敗する。データベースのセキュリティグループがレプリケーションのグループからの 5432 番を許しているか、Secrets Manager のエンドポイントが VPC にあるか、シークレットの `host` が正しいか、の順に見ます。この順序は構成から考えたもので、実際の失敗で確かめたものではありません。

移行の途中でソースのスキーマを変えた。この章の設定では DDL は運ばれません。DDL を運ぶ設定にしても、列の既定値と `NOT NULL` の変更は対象外と書かれています。移行の間は、スキーマを変えないのが安全です。

## 本番にするなら

<!-- section: 39.production -->

まず、リハーサルをします。本番のスナップショットから作った写しをソースにして、full load の所要時間、CDC の遅れ、検証にかかる時間を測ります。この章には、時間の実測値が 1 つもありません。停止時間の見積もりは、リハーサルの数字から作ります。

premigration assessment を実行し、結果を残します。

数日にわたる CDC では、Multi-AZ を有効にすることを考えます。レプリケーションが止まっている間もソースのスロットは WAL を溜めるので、レプリケーションの可用性はソースのディスクに関わります。

ソースに、ディスクとスロットのアラームを付けます。[19章](/ja/chapters/19-observability.md)のアラームと同じ作り方です。

切り替えの手順書を書き、判定の項目と、誰が判断するかを決めます。戻す期限と、ソースを残す期間も、数字で書いておきます。

DMS 用のユーザーは強い権限を持っています。切り替えが済んだら消し、シークレットもスタックと一緒に消します。パスワードのローテーションは、数日で終わる移行のためには設定していません。

`dms-vpc-role` の信頼ポリシーには、`aws:SourceAccount` の条件を足すよう勧められています。この章のスタックは足していません。

## 片付け

<!-- section: 39.cleanup -->

消す順序があります。

レプリケーションを止めます。動いているレプリケーションの設定は消せません。

```bash
aws dms stop-replication --replication-config-arn <ReplicationConfigArn>
```

スタックを消します。cdkd でデプロイできた場合は次のタスクで、CDK CLI でデプロイした場合は CDK CLI で消します。

```bash
vp run dbmig:infra:destroy
```

設定、エンドポイント、サブネットグループ、シークレット、セキュリティグループのルール、トピックが消えます。`dms-vpc-role` と `dms-cloudwatch-logs-role` も、このスタックが作った場合は消えます。同じアカウントでほかの DMS のリソースを使っているなら、先に `-c accountRoles=existing` でスタックから外してください。

スタックを消しても残るものが 4 つあります。

ソースのレプリケーションスロット。DMS が作ったスロットはタスクを消したときに消される、とドキュメントにありますが、Serverless の設定を消したときに同じことが起きるかは確かめていません。ソースで `SELECT slot_name, active FROM pg_replication_slots` を実行し、残っていれば `pg_drop_replication_slot` で消します。残したままにすると、ソースのディスクが埋まっていきます。

ソースとターゲットの DMS 用のロール（`dms_source`、`dms_target`）と、ソースの `dms_heartbeat` スキーマ。データベースの中のものなので、自分で消します。ターゲットには、DMS が検証の失敗を記録するために作る `awsdms_control` スキーマが残っていることがあります。

DMS のロググループ（`dms-serverless-replication-` で始まる名前）。レプリケーションを動かしたときに DMS が作ったもので、スタックの外にあります。

サービスリンクロール `AWSServiceRoleForDMSServerless`。Serverless のレプリケーションをすべて消した後で、消せます。

11章のスタックに足した Secrets Manager のインターフェースエンドポイントも、ほかに使うものがなければ外します。置いてある間は時間単位で課金されます。

そして、ソースのデータベースそのものです。残すと決めた期間が過ぎたら、最後のスナップショットを取って消します。この章でいちばん料金がかかるのは、置いたままの古いデータベースです。

::: details この章の検証メモ

**手元で確かめたこと。** この章のモデル（PGlite 2 つ、トリガーによる変更の記録、テーブルごとの写しと変更の適用）の上で、次のことをテストしました。写している間に変更された行と削除された行が変更の適用で一致すること。写しと記録の両方に入った変更を受け止めること。適用の途中で止まり、チェックポイントが進んでいない状態から再開しても結果が同じになること。主キーのないテーブルでは同じ再開で行が増え、`UPDATE` と `DELETE` が運ばれないこと。外部キーを眠らせている間は子のテーブルを先に写せること。シーケンスを進める前の衝突と、進めた後の番号、消された行の番号を出し直さないこと。件数と中身の比較が見つけるもの（切り詰められた本文）と見つけないもの（インデックスと制約、進行中の書き込み）。切り替え後の、ソースへの遅れた書き込みと、レプリケーションの再開による上書き。このほか、テーブルマッピングのスキーマと、ソースとターゲットのスキーマへの当てはめ、事前の検査、切り替えの判定、タスクの設定の LOB の上限、スタックのアサーション（リソースの種類、最小権限、シークレット、セキュリティグループ、名前の決まったロール、失敗の通知）です。`vp run dbmig:demo` と `vp run dbmig:infra:synth` を実行し、型検査を通しました。

**まだ確かめていないこと。** AWS に対しては何も実行していません。DMS は一度も動かしていません。したがって、次のことは未確認です。このスタックが cdkd 0.296.28 でどこまでデプロイできるか。`text` の主キーが PostgreSQL どうしの移行で実際に失敗するか。LOB の上限 64 KB で 10,000 文字の本文が切り詰められないか。`AfterConnectScript` の `SET` をターゲットのユーザーが実行できるか。`HeartbeatSchema` に指定したスキーマを先に作っておく必要があるか。出ていく通信を 3 種類に絞ったセキュリティグループで Serverless のレプリケーションが動くか。開始していない設定と、止めた後のレプリケーションの課金。設定を消したときにソースのスロットが消えるか。DMS のロググループの保持期間。full load の所要時間、遅れ、停止時間のすべて。`dbmig:preflight`、`dbmig:verify`、`dbmig:sequences` は、本物の PostgreSQL に対しては実行していません（同じ関数を PGlite で実行しています）。Neon をソースにできるか、D1 の書き出しを PostgreSQL へ流せるかも、試していません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| ソースの準備 | `examples/39-database-migration/sql/source/`、`sql/users/`、`src/catalog.ts`、`src/preflight.ts`、`test/preflight.test.ts` | `test:unit`、`dbmig:preflight` |
| テーブルマッピング | `examples/39-database-migration/src/table-mappings.ts`、`test/table-mappings.test.ts` | `test:unit` |
| タスクの設定 | `examples/39-database-migration/src/task-settings.ts`、`test/cutover.test.ts` | `test:unit` |
| スタック | `examples/39-database-migration/infra/lib/migration-stack.ts`、`infra/bin/app.ts`、`src/config.ts`、`infra/test/migration-stack.test.ts` | `dbmig:infra:synth`、`test:unit` |
| 切り替え | `examples/39-database-migration/src/cutover.ts`、`src/sequences.ts`、`src/verify.ts`、`test/cutover.test.ts`、`test/sequences.test.ts`、`test/verify.test.ts` | `test:unit`、`dbmig:verify`、`dbmig:sequences` |
| 分散システムとして見る | `examples/39-database-migration/src/cutover.ts`、`test/replicate.test.ts` | `test:unit` |
| この章のモデル | `examples/39-database-migration/src/model/capture.ts`、`src/model/replicate.ts`、`test/replicate.test.ts`、`test/support.ts`、`scripts/demo.ts` | `test:unit`、`dbmig:demo` |
| デプロイ | `examples/39-database-migration/infra/lib/migration-stack.ts`、`scripts/db.ts` | `dbmig:infra:diff`、`dbmig:infra:deploy`、`dbmig:preflight`、`dbmig:verify`、`dbmig:sequences` |
| 片付け | `examples/39-database-migration/infra/lib/migration-stack.ts` | `dbmig:infra:destroy` |
| 料金 | `data/pricing/` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-13）

- AWS DMS ユーザーガイド: [What is AWS DMS?](https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html)、[High-level view](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Introduction.HighLevelView.html)、[Components](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Introduction.Components.html)、[Sources](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Introduction.Sources.html)、[Targets](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Introduction.Targets.html)、[PostgreSQL as a source](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Source.PostgreSQL.html)、[PostgreSQL as a target](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Target.PostgreSQL.html)
- DMS Serverless: [Working with AWS DMS Serverless](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Serverless.html)、[Components](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Serverless.Components.html)、[Limitations](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Serverless.Limitations.html)、[Service-linked role](https://docs.aws.amazon.com/dms/latest/userguide/slr-services-sl.html)
- テーブルマッピング: [Selection rules](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TableMapping.SelectionTransformation.Selections.html)、[Transformation rules](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TableMapping.SelectionTransformation.Transformations.html)、[Wildcards](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TableMapping.SelectionTransformation.Wildcards.html)
- タスクの設定: [Task settings](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TaskSettings.html)、[Full-load](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TaskSettings.FullLoad.html)、[Error handling](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TaskSettings.ErrorHandling.html)、[Data validation settings](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.CustomizingTasks.TaskSettings.DataValidation.html)、[LOB support](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.LOBSupport.html)、[Data validation](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Validating.html)、[Premigration assessments](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Tasks.AssessmentReport.html)、[Troubleshooting](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Troubleshooting.html)、[Homogeneous data migrations](https://docs.aws.amazon.com/dms/latest/userguide/data-migrations.html)
- 権限と通知: [Using secrets](https://docs.aws.amazon.com/dms/latest/userguide/security_iam_secretsmanager.html)、[Secrets Manager VPC endpoint](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Advanced.Endpoints.secretsmanager.html)、[IAM](https://docs.aws.amazon.com/dms/latest/userguide/security-iam.html)、[EventBridge events](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_EventBridge.html)、[Quotas](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Limits.html)（既定のクォータ: Serverless のレプリケーション 100、エンドポイント 1,000、サブネットグループ 60）
- API と CloudFormation: [StartReplication](https://docs.aws.amazon.com/dms/latest/APIReference/API_StartReplication.html)、[StartReplicationTask](https://docs.aws.amazon.com/dms/latest/APIReference/API_StartReplicationTask.html)、[CreateEndpoint](https://docs.aws.amazon.com/dms/latest/APIReference/API_CreateEndpoint.html)、[AWS::DMS::ReplicationConfig](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dms-replicationconfig.html)、[AWS::DMS::Endpoint](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dms-endpoint.html)、[AWS::DMS::ReplicationSubnetGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dms-replicationsubnetgroup.html)、[Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)
- 料金: [AWS DMS pricing](https://aws.amazon.com/dms/pricing/)、AWS Price List bulk API の [AWSDatabaseMigrationSvc](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDatabaseMigrationSvc/current/ap-northeast-1/index.json)（公開日 2026-09-11）
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（インストールしたパッケージの dist）。AWS CLI 2.35.11 に同梱の DMS のサービス定義（コマンドの引数）
- PostgreSQL 18: [Logical replication restrictions](https://www.postgresql.org/docs/current/logical-replication-restrictions.html)、[Publication](https://www.postgresql.org/docs/current/logical-replication-publication.html)、[Replication slots](https://www.postgresql.org/docs/current/warm-standby.html)、[Replication settings](https://www.postgresql.org/docs/current/runtime-config-replication.html)、[pg_replication_slots](https://www.postgresql.org/docs/current/view-pg-replication-slots.html)、[System administration functions](https://www.postgresql.org/docs/current/functions-admin.html)、[pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)、[Sequence functions](https://www.postgresql.org/docs/current/functions-sequence.html)、[REVOKE](https://www.postgresql.org/docs/current/sql-revoke.html)、[pg_stat_activity](https://www.postgresql.org/docs/current/monitoring-stats.html)
- RDS と Aurora: [Logical replication for RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.FeatureSupport.LogicalReplication.html)、[CloudWatch metrics for RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-metrics.html)、[RDS Blue/Green Deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-overview.html)、[その制限](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-considerations.html)、[Migrating data to Aurora PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.Migrating.html)、[Loading data into Aurora DSQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/loading-data.html)
- Cloudflare、Vercel、Neon: [D1: Import and export data](https://developers.cloudflare.com/d1/best-practices/import-export-data/)、[D1: Query a database](https://developers.cloudflare.com/d1/best-practices/query-d1/)、[Postgres on Vercel](https://vercel.com/docs/postgres)、[Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage)、[Neon: Logical replication](https://neon.com/docs/guides/logical-replication-neon)、[Neon: pg_dump](https://neon.com/docs/import/migrate-from-postgres)、[Neon: AWS DMS](https://neon.com/docs/import/migrate-aws-dms)

:::
