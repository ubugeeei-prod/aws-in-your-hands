---
title: "39 Database Migration: デプロイ"
---

# 39 Database Migration: デプロイ

ここまでは、手元の PGlite とこの章のモデルで手順を確かめました。このページは、同じ手順を AWS の上で進めるための用意です。先に書いておくと、このページの手順は 1 つも実行していません。コマンドは、固定している AWS CLI 2.35.11 に同梱されているサービス定義と、API リファレンスで引数を確かめたものです。

## cdkd でデプロイできる範囲

<!-- section: 39.deploy -->

スタックは synth できます。

```bash
vp run dbmig:infra:synth
```

`examples/39-database-migration/cdk.out/` に CloudFormation のテンプレートができます。AWS には問い合わせません。

その先の `vp run dbmig:infra:deploy` は、固定している cdkd 0.296.28 では最後まで進まないはずです。cdkd は、専用の実装を持たない種類のリソースを Cloud Control API 経由で作ります。インストールしたパッケージを読むと、`AWS::DMS::` で始まる種類に専用の実装は 1 つもありません。Cloud Control API が対応している種類の一覧（最終更新 2025-12-23 と書かれています）に載っている DMS の種類は、この章が使う中では `AWS::DMS::ReplicationConfig` だけで、`AWS::DMS::Endpoint` と `AWS::DMS::ReplicationSubnetGroup` は載っていません。

| 種類 | cdkd 0.296.28 での経路 |
| --- | --- |
| `AWS::DMS::ReplicationConfig` | 専用の実装なし。Cloud Control API 経由（一覧にある） |
| `AWS::DMS::Endpoint` | 専用の実装なし。Cloud Control API の一覧にない |
| `AWS::DMS::ReplicationSubnetGroup` | 専用の実装なし。Cloud Control API の一覧にない |
| それ以外（EC2、IAM、Secrets Manager、SNS、EventBridge） | 専用の実装あり |

一覧にない 2 つは、cdkd が Cloud Control API に作成を頼んだ時点で「not supported by Cloud Control API and no SDK provider is registered」というエラーになる、とコードからは読めます。実行して確かめてはいません。一覧が古くなっている可能性もあります。自分のアカウントで `aws cloudformation describe-type --type RESOURCE --type-name AWS::DMS::Endpoint` を実行すると、応答の `ProvisioningType` で確かめられます。

cdkd で作れないとわかった場合、このスタックだけは別の道具でデプロイすることになります。`cdk.out` のテンプレートは普通の CloudFormation のテンプレートなので、AWS CDK CLI でデプロイできます。この本の開発環境には CDK CLI を入れておらず、その手順も試していません。使う場合は、[02章](/ja/chapters/02-toolchain/build.md)に書いたとおり、1 つのスタックを cdkd と CloudFormation で交互に管理しないでください。このスタックは作るのも消すのも CDK CLI で行い、`dbmig:infra:diff`、`deploy`、`drift`、`destroy` のタスクは使いません。

スタックのテストは、使っている種類の一覧を固定しています。DMS の種類を足すと、テストが落ちて、この表を見直すことになります。

## 先に用意するもの

このスタックの外で、次のものが要ります。

- 11章の VPC。Secrets Manager のインターフェースエンドポイントを付けてデプロイしておきます（`vp run net:infra:deploy -c interfaceEndpoints=secretsmanager`）。時間単位で課金されます
- ソースの RDS for PostgreSQL と、ターゲットの Aurora PostgreSQL。どちらも同じ VPC のプライベートサブネットにあるものとします。この章では作りません
- ソースのパラメーターグループで `rds.logical_replication` を 1 にして、再起動してあること
- ターゲットに `sql/target/0001_schema.sql` を流してあること
- ソースに `sql/source/0002_prepare.sql` に当たる変更を済ませてあること

`vp run dbmig:preflight`、`dbmig:verify`、`dbmig:sequences` は、2 つのデータベースに直接つなぎます。データベースはプライベートサブネットにあるので、手元のマシンからは届きません。VPC の中のマシン（[23章](/ja/chapters/23-ec2.md)のインスタンスなど）で実行し、接続文字列は `.env` の `SOURCE_DATABASE_URL` と `TARGET_DATABASE_URL` に書きます。

## スタックを作る

渡す値は、2 つのデータベースのホスト名とセキュリティグループの ID です。

```bash
vp run dbmig:infra:deploy \
  -c sourceHost=<ソースのエンドポイント> -c sourceSecurityGroupId=<sg-...> \
  -c targetHost=<ターゲットのクラスターエンドポイント> -c targetSecurityGroupId=<sg-...>
```

何も渡さずにデプロイすると、ホスト名は `source.database.invalid` のような、存在しえない名前になります。synth を通すための値で、そのままでは最初のセキュリティグループのルールで失敗します。

この時点でできるのは、設定とシークレットとルールだけです。レプリケーションは動いておらず、DCU の課金もありません。

次に、シークレットのパスワードで DMS 用のユーザーを作ります。スタックの出力 `SourceSecretArn` と `TargetSecretArn` のシークレットを読み、`sql/users/source.sql` と `sql/users/target.sql` を psql で流して、`\password` でパスワードを設定します。こうすると、パスワードを SQL の文に書かずに済みます。

```bash
vp run dbmig:preflight
```

ソースのカタログを読み、どのルールにも当たらないテーブルと、止める理由になる検査結果があれば、0 以外で終わります。

## レプリケーションを始める

```bash
aws dms start-replication \
  --replication-config-arn <ReplicationConfigArn> \
  --start-replication-type start-replication
```

ここから課金が始まります。DMS は、ソースにつないでメタデータを集め、容量を計算して確保し、full load を始めます。初回に指定できるのは `start-replication` だけです。

進み具合は、次の 2 つで見ます。

```bash
aws dms describe-replications \
  --filters Name=replication-config-arn,Values=<ReplicationConfigArn>

aws dms describe-replication-table-statistics \
  --replication-config-arn <ReplicationConfigArn>
```

2 つ目はテーブルごとの統計で、full load で運んだ行数、適用した `INSERT`、`UPDATE`、`DELETE` の件数、検証の状態（`ValidationState`）が返ります。エラーで止まったテーブルがないかも、ここで見ます。

遅れは、CloudWatch の `CDCLatencySource` と `CDCLatencyTarget` で見ます。同じ間、ソースのインスタンスの `OldestReplicationSlotLag` と `TransactionLogsDiskUsage` も見ておきます。

失敗の通知を受け取るには、出力 `FailureTopicArn` のトピックに購読を足します。

## 切り替える

[しくみと実装](/ja/chapters/39-database-migration/build.md)の順序を、コマンドにすると次のようになります。

書き込みを止める前に、遅れが決めた上限より小さいこと、検証が不一致を報告していないこと、ターゲットに足りないインデックスや制約がないことを確かめます。3 つ目は `vp run dbmig:verify` が報告します。書き込みが続いている間は、件数と中身の比較は不一致を報告するのが普通です。

書き込みを止めます。アプリを書き込み不可の状態にしたうえで、ソースの側でも断らせます。アプリが使っているロールから、書き込みの権限を外します。

```sql
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM <アプリのロール>;
```

外した後で、アプリのロールで実際に書き込みを試し、断られることを確かめます。手元のモデルでは、同じ役目を読み取り専用のトランザクションで代用しました。権限を外すほうを選んだのは、DMS のユーザーには影響させたくないからです。エンドポイントの heartbeat はソースに書き込みます。

開いたままのトランザクションがないことを、`pg_stat_activity` で確かめます。`state` が `idle in transaction` の行と、`xact_start` が古い行が、まだ終わっていないトランザクションです。

残りの変更が届くのを待ちます。2 つの遅れが 0 になり、テーブルごとの統計の件数が増えなくなるまでです。

```bash
vp run dbmig:verify
```

すべてのテーブルが `match` で、足りないオブジェクトがなければ、レプリケーションを止めます。

```bash
aws dms stop-replication --replication-config-arn <ReplicationConfigArn>
```

止めるのは、接続先を替える前です。止めた後で、シーケンスを進めます。

```bash
vp run dbmig:sequences
vp run dbmig:sequences --apply
```

1 つ目は計画を表示するだけで、2 つ目がターゲットのシーケンスを動かします。

最後に、アプリの接続先をターゲットに替えて、書き込みを再開します。接続先がシークレットや環境変数にあるなら、その値を替えてデプロイし直します。古い値を持ったインスタンスが残らないことを確かめてください。残っていても、ソースは書き込みを断ります。

ソースは、決めた期間、そのまま残します。レプリケーションは再開しません。

次は[費用、注意点、片付け](/ja/chapters/39-database-migration/wrap.md)です。
