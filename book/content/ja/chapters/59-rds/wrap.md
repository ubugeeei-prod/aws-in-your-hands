---
title: "59 RDS: 費用、注意点、片付け"
---

# 59 RDS: 費用、注意点、片付け

章の最後に、料金、つまずきやすいところ、本番に向けて変えること、片付けの順に確かめます。

## 料金

<!-- section: 59.cost -->

金額は USD、東京リージョン、従量課金、税別です。単価は 2026-10-13 に AWS Price List から取り、1 か月を 730 時間として計算しました。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

RDS の料金の中心は、インスタンスが動いている時間と、割り当てたストレージの量です。どちらも、クエリが 1 つも来なくてもかかります。

既定のスタックを 1 か月置いたままにした場合は、次のとおりです。

| 対象 | 数量 | 定価 |
| --- | --- | --- |
| db.t4g.micro、Single-AZ | 730 時間 | 18.25 |
| gp3 のストレージ | 20 GB 月 | 2.76 |
| マスターユーザーのシークレット | 1 | 0.40 |
| CloudWatch のアラーム | 1 | 0.10 |
| 小計 | | **21.51** |

アラームは毎月 10 個までの無料枠に入るので、その適用後は 21.41 です。シークレットの行には仮定が入っています。RDS が管理するシークレットに、ふつうのシークレットと同じ料金がかかるかどうかを、確かめられませんでした。かかるものとして数えています。Lambda、API Gateway、ログの取り込みは、リクエストが無ければ 0 です。

RDS の無料枠は、引いていません。AWS の 2 つのページの説明が食い違っていたからです。RDS for PostgreSQL の料金ページは、新規の利用者に 1 年間、毎月 750 時間のインスタンスと 20 GB のストレージが無料になると書いています。RDS の無料枠のページは、時間ではなくクレジットで説明しています。どちらが当てはまるかはアカウントによるようで、この章では不明として扱います。0 という意味ではありません。

構成を変えたときの 1 か月の定価を並べます。

| 構成 | 定価 / 月 |
| --- | --- |
| 既定（Single-AZ） | 21.51 |
| `production` のプロファイル（Multi-AZ、インスタンスクラスは同じ） | 42.52 |
| リードレプリカを 1 台足す | 42.52 |
| RDS Proxy を足す（プロキシの分だけ） | + 26.28 |
| Extended Support に入った場合（1〜2 年目、上乗せ分だけ） | + 175.20 |

Multi-AZ とレプリカつきが同じ金額なのは、どちらもインスタンス 2 台分とストレージ 2 つ分だからです。同じ料金で得られるものは違います。Multi-AZ は障害のときに切り替わり、レプリカは読み取りを受けます。

この表に入っていないものもあります。db.t4g は Unlimited モードなので、CPU を使い続けると、クレジットの超過分が別に請求されます。バックアップは、ストレージと同じ量を超えた分に 1 GB 月あたり 0.095 がかかります。AZ をまたぐ通信、ログの保存、11章の VPC の料金（既定の構成なら 0）も別です。

### 止めても、止まり切らない

使わないあいだだけ止めておく、という手はあります。

```bash
aws rds stop-db-instance --db-instance-identifier aih-notes
```

止まっているあいだ、インスタンスの時間は課金されません。ストレージとバックアップは課金され続けます。1 か月ずっと止まっていたとすれば、定価で 3.26 です。

ただし、その金額にはなりません。止めたインスタンスは、7 日たつと RDS が自動で起動するからです。必要な更新から取り残されないようにするため、とドキュメントは説明しています。起動したあとは、気づくまで課金されます。止めるのは、数日のうちにまた使うときの手段です。使い終わったなら、消します。

ほかにも条件があります。リードレプリカを持つインスタンスと、リードレプリカ自身は、止められません。止まっているインスタンスは設定を変えられません。起動には、ドキュメントによれば数分から数時間かかることがあります。

### 叩かれたら

この API にも認証がありません。入口のスロットリング（1 秒に 10 件）と、13章の行の数の上限（持ち主 1 人 100 行）が、呼ばれる量を止めています。

RDS の料金は、DSQL と違って、叩かれても増えません。インスタンスとストレージは固定だからです。増えるのは、Lambda、API Gateway、ログの分（計算のしかたは[13章の同じ節](/ja/chapters/13-sql/wrap.md)）と、db.t4g の CPU クレジットの超過分です。その代わり、データベースの側には伸びる余地がありません。1 台のインスタンスが受けられる量を超えれば、遅くなり、接続を断り、API が止まります。料金が先に尽きるか、性能が先に尽きるかの違いです。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| デプロイが PostgreSQL の版で失敗する | その版が、もう新しいインスタンスに選べません。`aws rds describe-db-engine-versions --engine postgres` で調べ、`-c postgresVersion=<版>` を付ける |
| デプロイが `Fn::ImportValue` で失敗する | 11章のスタック（`AihNetwork`）がデプロイされていません |
| `rds:db:bootstrap` が access denied | あなたの認証情報に、マスターユーザーのシークレットへの `secretsmanager:GetSecretValue` か、運用用の関数への `lambda:InvokeFunction` がありません |
| 運用用の関数がタイムアウトする | 関数からデータベースに届いていません。セキュリティグループと、2 つが同じ VPC にあることを確かめる |
| `password authentication failed` | トークンが通っていません。`rds:db:bootstrap` を流したか、関数のロールの `rds-db:connect` がいまのインスタンスのリソース ID を指しているかを確かめる。インスタンスを作り直すと ID が変わります |
| `self-signed certificate in certificate chain` | Node.js が RDS の認証局を知りません。関数の `NODE_EXTRA_CA_CERTS` を確かめる |
| `no pg_hba.conf entry ... no encryption` | TLS なしでつなごうとしています。`rds.force_ssl` が断っています |
| `/health` は 200 なのに `/notes` が 500 | `rds:db:migrate` を流したかを確かめる。ログに `relation "app.notes" does not exist` や `permission denied` があるはず |
| `too many connections` | 同時に動く実行環境が、接続の上限に達しました。関数の同時実行数を絞るか、RDS Proxy を検討する |
| 作った直後のノートが 404 になる | リードレプリカから読んでいます。クライアントが `x-notes-seen` を送り返しているかを確かめる |
| `cannot execute INSERT in a read-only transaction` | 書き込みがレプリカに向いています。`DB_HOST` と `DB_REPLICA_HOST` が逆になっていないかを確かめる |
| しばらくぶりの最初の呼び出しだけ失敗する | メンテナンスやフェイルオーバーで接続が切れています。次の呼び出しは新しい接続を張るはず |
| 止めたはずのインスタンスが動いている | 7 日たって自動で起動しました |
| パラメーターを変えたのに効かない | 静的なパラメーターです。再起動するまで `pending-reboot` のままです |

エラーメッセージは、PostgreSQL と node-postgres が出す文言をもとに書いています。この章のコードが RDS の上でそのとおりに出すことは、確かめていません。

## 本番にするなら

- `-c profile=production` でデプロイします。待機系、削除保護、14 日分のバックアップ、ストレージの自動拡張が入り、スタックを消してもインスタンスが残ります
- インスタンスクラスを選び直します。db.t のクラスは、AWS のドキュメントが本番以外に勧めているものです。`-c instanceClass=m8g.large` のように指定できます
- リストアを一度は通します。新しいインスタンスができ、エンドポイントが変わるところまで含めて練習します（22章）
- フェイルオーバーを一度は起こして、API が止まる秒数を測ります。その数字が、利用者に約束できる値です
- メジャーバージョンの標準サポートの終了日を予定に入れ、Extended Support に入るか、先に上げるかを決めておきます
- マイグレーションを、手元からではなくパイプラインから流します。運用用の関数を呼べる人と、マスターユーザーのシークレットを読める人を絞ります（[20章](/ja/chapters/20-shipping.md)、21章）
- アラームに通知先を付け、`DatabaseConnections`、CPU クレジット、`ReplicaLag` にもアラームを足します（19章）
- 認証を足します。持ち主はいまも全員 `anonymous` です（[06章](/ja/chapters/06-auth.md)）
- 接続の数を見積もります。関数の同時実行数の上限を `max_connections` より小さくするか、RDS Proxy を置きます
- 反映の経路を AWS CDK CLI と CloudFormation にします。理由は 02章に書きました

## 片付け

<!-- section: 59.cleanup -->

```bash
vp run rds:infra:destroy
```

既定の構成では、インスタンス、自動バックアップ、マスターユーザーのシークレット、パラメーターグループ、サブネットグループ、セキュリティグループ、関数、API、アラーム、ロググループが消えます。最後のスナップショットは取りません。ノートは戻せなくなります。

次のものは、消えずに残ることがあります。

- 手動で取ったスナップショット。自分で消すまで残り、バックアップの料金がかかります
- `production` のプロファイルでデプロイしたインスタンスと自動バックアップ。スタックからは外れますが、実物は残り、課金が続きます。消すには、削除保護を外してから、コンソールか CLI で消します
- ポイントインタイムリストアや blue/green deployment で作った、スタックの外のインスタンス
- 11章の VPC。別のスタックなので、この章の片付けでは消えません

関数を VPC から外すときに、Lambda が作ったネットワークインターフェースの片付けに時間がかかることがあります。その場合に destroy がどう見えるかは、確かめていません。

片付けたあとは、RDS のコンソールで、インスタンス、スナップショット、自動バックアップの 3 つの一覧が空になっていることを見てください。

::: details この章の検証メモ

**手元で確かめたこと。** テスト 48 件。LSN の解析と比較。PGlite が返す実際の位置が、書き込みで進み、読み取りでは進まないこと。プライマリとレプリカのモデルの上で、遅れたレプリカから読むと自分の書き込みが見えないこと、位置を持ち歩くと見えること、読み取りが巻き戻らないこと、位置がわからないときにプライマリへ倒れること、レプリカが書き込みを 25006 で断ること、遅れたレプリカの昇格で書き込みが失われること。API のヘッダーと CORS。運用用の関数が 2 つのロールを作り、`notes_migrator` として 13章のマイグレーションを流し、`notes_api` が行の読み書きだけをできること（PGlite の上で、`SET ROLE` を使って確認）。2 回目の実行で何も変わらないこと。設定と環境変数の検査。スタックのアサーション（既定、`production`、リードレプリカつきの 3 通り）。型検査。synth と、できた 2 つのバンドルを Node.js 24 で読み込んで、API の関数が `GET /health` に答えること、運用用の関数が知らないコマンドを断ること。`dev:rds` を起動して、本文の `curl` の流れ（作成、ヘッダーなしの 404、ヘッダーつきの 200、待ったあとの 200）。

**まだ確かめていないこと。** 実際の RDS には、一度もつないでいません。`rds:infra:deploy`、`rds:db:bootstrap`、`rds:db:migrate`、`rds:db:status`、`rds:smoke`、`rds:infra:drift`、`rds:infra:destroy` は未実行です。とくに次が確認待ちです。cdkd が `ManageMasterUserPassword` つきのインスタンスと、Cloud Control API 経由のパラメーターグループを作れること。PostgreSQL 18.3 がいまも選べること。先に作ったロググループに RDS が書くこと。`NODE_EXTRA_CA_CERTS` で Node.js 24 のランタイムが RDS の証明書を検証できること。IAM のトークンが node-postgres を通ること。RDS が管理するシークレットの中身の形。db.t4g.micro のメモリで IAM データベース認証が安定して動くこと。リードレプリカつきのスタックがデプロイできること、レプリカの `pg_last_wal_replay_lsn()` がプライマリの位置と比べられること。フェイルオーバー、ポイントインタイムリストア、バージョンアップ、blue/green deployment、RDS Proxy、ストレージの自動拡張、停止と自動起動は、どれも実行していません。本文の秒数や割合は、ドキュメントの記述です。料金は単価と仮定から計算しただけで、RDS が管理するシークレットの料金と、無料枠の適用は確認できていません。Cloudflare が自社で PostgreSQL を運用するサービスを持つかどうかも、確かめていません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像、インスタンスクラスとストレージ、RDS を選ばない場面 | `examples/59-rds/infra/lib/rds-stack.ts`、`src/config.ts` | `rds:infra:synth` |
| インスタンスを定義する | `examples/59-rds/infra/lib/rds-stack.ts`、`infra/bin/app.ts`、`src/config.ts`、`infra/test/rds-stack.test.ts`、`test/config.test.ts` | `rds:infra:synth`、`test:unit` |
| 誰がどうやってサインインするか | `examples/59-rds/src/roles.ts`、`src/ops.ts`、`src/ops-lambda.ts`、`src/rds.ts`、`src/env.ts`、`test/ops.test.ts` | `test:unit` |
| Lambda からの接続の数 | `examples/59-rds/src/rds.ts`、`src/lambda.ts` | `rds:infra:synth` |
| 待機系を持つ | `examples/59-rds/src/config.ts`、`infra/test/rds-stack.test.ts` | `test:unit` |
| リードレプリカは遅れる | `examples/59-rds/src/model/replication.ts`、`test/routing.test.ts`、`test/support.ts` | `test:unit` |
| 自分の書き込みを読む | `examples/59-rds/src/lsn.ts`、`src/position.ts`、`src/routing.ts`、`src/app.ts`、`test/lsn.test.ts`、`test/routing.test.ts`、`test/app.test.ts` | `test:unit` |
| 遅れるレプリカを手元で見る | `examples/59-rds/src/dev.ts`、`src/migrations.ts`、`.env.example` | `dev:rds` |
| デプロイして、使えるようにする | `examples/59-rds/scripts/ops.ts`、`scripts/smoke.ts` | `rds:infra:diff`、`rds:infra:deploy`、`rds:db:bootstrap`、`rds:db:migrate`、`rds:db:status`、`rds:smoke`、`rds:infra:drift` |
| バックアップとリストア、バージョンを上げる、見張る | `examples/59-rds/infra/lib/rds-stack.ts`、`src/config.ts` | `rds:infra:synth` |
| 料金 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |
| 片付け | `tools/src/infra/` | `rds:infra:destroy` |

**cdkd が扱うリソースの種類。** インストールした cdkd 0.296.28 のパッケージを見ると、`AWS::ApiGatewayV2::Api`、`Integration`、`Route`、`Stage`、`AWS::CloudWatch::Alarm`、`AWS::EC2::SecurityGroup`、`AWS::EC2::SecurityGroupIngress`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup`、`AWS::RDS::DBInstance`、`AWS::RDS::DBSubnetGroup` には専用の実装が登録されています。`AWS::RDS::DBParameterGroup` と `AWS::EC2::SecurityGroupEgress` には、登録が見当たりませんでした。この 2 つは Cloud Control API 経由になるはずで、どちらも Cloud Control API の対応一覧に載っています。実際に作れるかは未確認です。

**一次情報**（確認日はすべて 2026-10-13）

- Multi-AZ とフェイルオーバー: [Multi-AZ DB instance deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html)、[Failing over a Multi-AZ DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.Failover.html)、[Multi-AZ DB cluster deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html)、[Failing over a Multi-AZ DB cluster](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts-failover.html)、[Limitations of Multi-AZ DB clusters](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.Limitations.html)、[Best practices for Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_BestPractices.html)
- リードレプリカ: [Working with DB instance read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html)、[Creating a read replica](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.Create.html)、[Read replicas for RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PostgreSQL.Replication.ReadReplicas.html)、[Read replica configuration with PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PostgreSQL.Replication.ReadReplicas.Configuration.html)、[Monitoring and tuning the replication process](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PostgreSQL.Replication.ReadReplicas.Monitor.html)、[CloudWatch metrics for Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-metrics.html)
- インスタンスとストレージ: [DB instance class types](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.Types.html)、[DB instance storage](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html)、[Storage autoscaling](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIOPS.Autoscaling.html)、[Quotas and constraints for Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html)、[Overview of parameter groups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/parameter-groups-overview.html)、[Working with a DB instance in a VPC](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html)、[Encrypting Amazon RDS resources](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html)、[Stopping a DB instance temporarily](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html)、[Deleting a DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_DeleteInstance.html)
- 認証と TLS: [Password management with Amazon RDS and AWS Secrets Manager](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html)、[IAM database authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html)、[IAM policy for IAM database access](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.IAMPolicy.html)、[Creating a database account using IAM authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.DBAccounts.html)、[Using SSL/TLS to encrypt a connection](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)、[Using SSL with a PostgreSQL DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html)
- Lambda と RDS Proxy: [Building Lambda functions with Node.js](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html)、[Using AWS Lambda with Amazon RDS](https://docs.aws.amazon.com/lambda/latest/dg/services-rds.html)、[Giving Lambda functions access to resources in an Amazon VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)、[Amazon RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html)、[Planning where to use RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-planning.html)、[Avoiding pinning an RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-pinning.html)、[RDS Proxy endpoints](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-endpoints.html)
- バックアップ: [Introduction to backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)、[Backup retention period](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html)、[Managing automated backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ManagingAutomatedBackups.html)、[Restoring a DB instance to a specified time](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html)
- バージョンとメンテナンス: [Maintaining a DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.Maintenance.html)、[Upgrading a DB instance engine version](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.Upgrading.html)、[Upgrades of the RDS for PostgreSQL DB engine](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.PostgreSQL.html)、[Major version upgrade process](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.PostgreSQL.MajorVersion.Process.html)、[Minor version upgrades](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.PostgreSQL.Minor.html)、[Release calendars for RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-release-calendar.html)、[RDS Extended Support](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/extended-support.html)、[Creating a DB instance with RDS Extended Support](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/extended-support-creating-db-instance.html)、[RDS Extended Support charges](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/extended-support-charges.html)、[Blue/Green Deployments の概要](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-overview.html)、[制約](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-considerations.html)、[PostgreSQL のレプリケーション方式](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-replication-type.html)
- 監視とログ: [CloudWatch Database Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Database-Insights.html)、[Database Insights on Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_DatabaseInsights.html)、[RDS for PostgreSQL database log files](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_LogAccess.Concepts.PostgreSQL.html)、[Parameters for logging](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_LogAccess.Concepts.PostgreSQL.overview.parameter-groups.html)、[Turning on query logging](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_LogAccess.Concepts.PostgreSQL.Query_Logging.html)
- 料金: AWS Price List bulk API の [Amazon RDS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-northeast-1/index.json)（公開日 2026-10-06）、[RDS for PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/)、[RDS Proxy pricing](https://aws.amazon.com/rds/proxy/pricing/)、[RDS Free Tier](https://aws.amazon.com/rds/free/)
- インフラ: [AWS::RDS::DBInstance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html)、[Cloud Control API の対応一覧](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) の型定義、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) のパッケージ、[@aws-sdk/rds-signer 3.1149.0](https://www.npmjs.com/package/@aws-sdk/rds-signer/v/3.1149.0) の型定義
- PostgreSQL: [System Administration Functions](https://www.postgresql.org/docs/18/functions-admin.html)、[Hot Standby](https://www.postgresql.org/docs/18/hot-standby.html)、[ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html)
- Cloudflare と Vercel: [Hyperdrive](https://developers.cloudflare.com/hyperdrive/)、[Hyperdrive の料金](https://developers.cloudflare.com/hyperdrive/platform/pricing/)、[Hyperdrive からプライベートなデータベースへ](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/)、[D1 の read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)、[Vercel Postgres](https://vercel.com/docs/postgres)、[Vercel Storage](https://vercel.com/docs/storage)

:::
