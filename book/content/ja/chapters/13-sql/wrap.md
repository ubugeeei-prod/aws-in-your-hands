---
title: "13 SQL: 費用、注意点、片付け"
---

# 13 SQL: 費用、注意点、片付け

## D1 から来た人へ

<!-- section: 13.d1 -->

| | Cloudflare D1 | この章（Aurora DSQL） |
| --- | --- | --- |
| SQL | SQLite | PostgreSQL 16 互換の一部 |
| 手元 | `wrangler dev` がローカルの D1 を用意する。本番と同じ D1 | PGlite で代用。DSQL ではない |
| migration | 番号つきの `.sql` を Wrangler が順に流す。失敗した migration は rollback される | 番号つきの `.sql` を、この章の runner が順に流す。1 ファイル 1 文。途中で止まっても流し直せる形にする |
| つなぎ方 | binding（`env.DB`） | TCP の接続。IAM の token がパスワード |
| transaction | `batch()` に並べた文が 1 つの transaction | `BEGIN` から `COMMIT` まで。途中で読んだ値を見て、次の文を決められる |
| 同時に書いたとき | 書き込みは primary の 1 か所に集まる | commit のときに競合を調べて、負けた側は `40001`。やり直す |
| 読み取りの置き場所 | read replica を世界中に置ける。非同期 | 1 リージョンの中の 3 つの AZ。同期 |
| backup | Time Travel。過去 30 日の好きな分へ | AWS Backup。cluster 全体。restore は新しい cluster |
| 料金の単位 | 読んだ行、書いた行、storage | DPU、storage |

違いがいちばん大きいのは、整合性の話です。

D1 の read replica は、primary から非同期に写しを受け取ります。だから replica は、いくらでも古くなりえます。それを補うのが Sessions API で、1 つの session の中では、読み取りが前に戻らないこと、自分が書いたものが読めることを保証します（sequential consistency）。保証の範囲は session です。別の session が何を見ているかは、bookmark を渡さないかぎり別の話。そして Sessions API を使わなければ、query は全部 primary に行きます。

Aurora DSQL の single-Region の cluster は、3 つの AZ に同期で書きます。commit されたものは、次のどの transaction からも見えます。session や bookmark を気にする場面がありません。そのかわり、東京の cluster は東京にあります。遠くの読者の近くに写しを置く、という D1 の read replica のような仕組みは、この構成にはありません。

だから DSQL は、「D1 を分散させたもの」ではないんです。D1 は、1 か所で書いて、遠くで読めるようにした DB。DSQL は、1 つのリージョンの中で、どこに書いても同じものが見えるようにした DB。目指している場所が違います。multi-Region の cluster もありますが、同じ地域の組（東京なら大阪やソウルなど）の中に限られます。この章では扱いません。

transaction の書き方も違います。D1 の `batch()` は、文を先に全部並べて渡します。途中で結果を見て分岐することはできません。DSQL は `BEGIN` と `COMMIT` の間で、読んで、判断して、書けます。さっきの quota の処理がそれです。その自由のかわりに、やり直しを自分で書くことになりました。

D1 のほうが楽な場面は、たくさんあります。binding、ローカルの本物、Time Travel。この本は、D1 をやめようとは言いません。SQLite では足りない、PostgreSQL の SQL が要る、AWS のほかのサービスのすぐ隣に置きたい、というときの選択肢として読んでください。

## お金の話

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

Aurora DSQL の課金は 2 つだけ。DPU（SQL の実行にかかった計算、読み取り、書き込みをまとめた単位）が 100 万あたり 10.00、storage が 1 GB 月あたり 0.40 です。毎月、最初の 10 万 DPU と 1 GB が無料になります。料金ページには、この枠に期限があるかどうかは書かれていません。

**誰も問い合わせない月は、storage だけです。** 1 GB 置いていたとして、定価で 0.40、無料枠の中なので 0。

置いてあるだけの月を、3 つで比べます。

| 構成 | 仮定 | 定価 / 月 |
| --- | --- | --- |
| Aurora DSQL | 問い合わせなし、1 GB | 0.40（無料枠の適用後は 0） |
| RDS for PostgreSQL | db.t4g.micro、Single-AZ、gp3 を 20 GB（最小）、730 時間 | **21.01** |
| Aurora Serverless v2（auto-pause なし） | 最小 0.5 ACU のまま 730 時間、1 GB | **54.87** |
| Aurora Serverless v2（1 か月ずっと停止） | 最小 0 ACU、一度も再開せず、1 GB | 0.12 |

RDS の内訳は、instance が 18.25、storage が 2.76。Aurora は、容量が 54.75、storage が 0.12 です。RDS の無料枠は、この章では確かめていないので、引いていません。0 という意味ではなく、不明です。

最後の行は、いちばん都合のいい場合です。Aurora は保守のために instance を再開することがあって、その時間は課金されます。RDS と Aurora には、ここに VPC まわりの料金（11章）も乗ります。

使ったときの DSQL は、こうなります。月 100 万リクエストで、読み取り 90 万、書き込み 10 万、という仮定です。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| DPU | 24,600 | 0.25 | 0 |
| storage | 1 GB 月 | 0.40 | 0 |
| 小計 | | **0.65** | **0** |

ここは強く断っておきます。24,600 DPU は、測った値ではありません。公式ドキュメントの計算例（主キーでの読み取りが 0.00675 DPU、1 行の `INSERT` が 0.06175 DPU）を借りて、読み取り 1 件を 0.00675、書き込み 1 件をその `INSERT` の 3 倍、と置いただけです。あなたの query の実際の値は、`EXPLAIN ANALYZE VERBOSE` か、CloudWatch の DPU のメトリクスでわかります。

この表は DB の分だけです。Lambda、API Gateway、ログは 04章と同じようにかかります。backup を取れば AWS Backup の料金が、やり直しが増えればそのぶんの DPU が乗ります。

stack を消せば、この章のぶんの料金は止まります。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:sql` が `Not applied yet` で止まる | `vp run sql:db:migrate:local` を先に |
| `The local database ... is open in process` | `dev:sql` が動いています。止めてからもう一度 |
| デプロイ後、`/health` は 200 なのに `/notes` が 500 | `sql:db:migrate` と `sql:db:grant` は流しましたか。ログに `relation "app.notes" does not exist` や `permission denied` があるはず |
| ログに `Wrong user to action mapping` | token の種類と database role が合っていません。`admin` には admin 用の token、それ以外にはふつうの token |
| ログに `IAM authentication failed` や access denied | 実行 role に `dsql:DbConnect` がありますか。`sql:db:grant` は、いまの role の ARN で流しましたか（stack を作り直すと ARN が変わります） |
| 503 と `busy` が返る | 4 回やり直して、全部負けました。同じ行に書き込みが集中しています。`transaction retry` の行を数えて、どの行でぶつかっているかを見直す |
| migration の直後だけ `40001` が出る | schema の変更で、古い schema を覚えていた接続が負けています（OC001）。やり直しで通るはず |
| `use CREATE INDEX ASYNC instead` | index の文に `ASYNC` がありません。lint が通っているなら、runner の `dialect` を確認 |
| `transaction row limit exceeded` | 1 つの transaction で 3,000 行を超えました。分けてください |
| しばらくぶりの最初の呼び出しだけ遅い、または失敗する | cluster が Idle や Inactive から戻っているか、凍っていた実行環境の接続が切れています。呼ぶ側でもう一度 |

最後の行は、想像で書いています。凍結から戻った実行環境で、切れた接続がどういうエラーになるかは、実機で見ていません。

## 本番にするなら

- **削除保護を入れて、stack を消しても cluster が残るようにする。** いまは逆です
- **backup の計画を作って、restore を一度は練習する。** 新しい cluster への切り替えまで含めて
- **認証を足す。** いまは owner が全員 `anonymous` です（[06章](/ja/chapters/06-auth.md)）
- **競合の回数を見張る。** `transaction retry` の行と 503 の数にアラームを付けます（ログの行を数えてアラームにする方法は [19章](/ja/chapters/19-observability.md)）
- **migration を、手元からではなく決まった経路で流す。** `dsql:DbConnectAdmin` を持つ人と場所を絞ります（CI の経路の作り方は [20章](/ja/chapters/20-shipping.md)）
- **作成を、呼ぶ側からも安全に送り直せるようにする。** いまは ID をサーバーが決めるので、応答が届かなかった `POST` を送り直すと、2 件目ができます。呼ぶ側が決めた key を受け取る作りに変えます
- **接続が切れたときの再試行を決める。** この章がやり直すのは `40001` だけです。接続のエラーでは、commit されたかどうかがわかりません。やり直していいのは、何度実行しても同じ結果になる処理だけです
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです

## 片付け

<!-- section: 13.cleanup -->

```bash
vp run sql:infra:destroy
```

cluster、関数、role、API、log group が消えます。ノートも、database role も、cluster と一緒です。backup は取っていないので、戻せません。

手元の DB は、`examples/13-sql/.pglite/` を消せば無くなります。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（transaction の再試行、PGlite の上での repository、`COMMIT` の競合の注入、migration の lint と中断からの再開、grant の文、API、インフラ）。型検査。synth と、できた bundle を Node.js 24 で読み込んで `GET /health` と UUID でない ID の 404 が返ること。`sql:db:reset:local`、`sql:db:migrate:local`、`sql:db:seed:local` と、2 回目の実行で何も変わらないこと。`dev:sql` を起動して、本文の `curl`（作成、更新、古い `version` の 409）と削除。`dev:sql` の起動中に reset が拒否されること、サーバーを止めたあとは古い lock が引き継がれること。

**まだ確かめていないこと。** 実際の Aurora DSQL には、一度もつないでいません。`sql:infra:deploy`、`sql:db:migrate`、`sql:db:grant`、`sql:db:seed`、`sql:smoke`、`sql:logs`、`sql:infra:drift`、`sql:infra:destroy`、`NOTES_DB=dsql` での `dev:sql` は未実行です。とくに次が確認待ちです。4 つの migration が DSQL に受け付けられること。`CREATE INDEX ASYNC` の応答から job の ID を読めて、`sys.jobs` で完了を待てること。`AWS IAM GRANT` と `GRANT` で `notes_api` が読み書きできること。`password` の関数で token が通ること。競合が node-postgres のエラーの `code` に `40001` として現れること。cdkd が Cloud Control API 経由で cluster を作り、`Ref` が identifier を返すこと。backup と restore。料金の DPU は仮定で、測っていません。RDS for PostgreSQL と Aurora Serverless v2 は、ドキュメントと Price List を読んだだけで、作っていません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像、どれを選ぶ？ | `examples/13-sql/infra/lib/sql-stack.ts` | `sql:infra:synth` |
| Aurora DSQL は PostgreSQL そのものではない | `examples/13-sql/src/migrate.ts`、`test/migrate.test.ts` | `test:unit` |
| schema と migration | `examples/13-sql/migrations/`、`src/migrate.ts`、`test/migrate.test.ts` | `test:unit`、`sql:db:migrate:local` |
| 行を型にする | `examples/13-sql/src/contract.ts`、`src/db.ts`、`src/notes-repository.ts`、`src/notes.ts`、`src/app.ts` | `test:unit` |
| transaction は丸ごとやり直す | `examples/13-sql/src/transaction.ts`、`src/notes-repository.ts`、`test/transaction.test.ts` | `test:unit` |
| 競合をわざと起こす | `examples/13-sql/test/support.ts`、`test/notes-repository.test.ts`、`test/app.test.ts` | `test:unit` |
| 手元で動かす | `examples/13-sql/src/pglite.ts`、`src/dev.ts`、`src/compose.ts`、`scripts/local-db.ts`、`scripts/db-tasks.ts`、`test/fixtures/seed-notes.json`、`.env.example` | `dev:sql`、`sql:db:migrate:local`、`sql:db:seed:local`、`sql:db:reset:local` |
| Lambda からつなぐ | `examples/13-sql/src/dsql.ts`、`src/lambda.ts`、`src/env.ts`、`src/grant.ts`、`infra/lib/sql-stack.ts`、`infra/bin/app.ts`、`infra/test/sql-stack.test.ts`、`cdk.json` | `sql:infra:synth`、`test:unit` |
| デプロイして、migration を流す | `examples/13-sql/scripts/cloud-db.ts`、`scripts/db-tasks.ts`、`scripts/smoke.ts`、`scripts/logs.ts`、`test/grant.test.ts` | `sql:infra:diff`、`sql:infra:deploy`、`sql:db:migrate`、`sql:db:grant`、`sql:db:seed`、`sql:smoke`、`sql:logs`、`sql:infra:drift` |
| 片付け | `tools/src/infra/`、`examples/13-sql/scripts/local-db.ts` | `sql:infra:destroy`、`sql:db:reset:local` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

**cdkd が扱うリソースの種類。** 固定した版（0.296.28）の `src/provisioning/register-providers.ts` を見ると、`AWS::ApiGatewayV2::Api`、`Integration`、`Route`、`Stage`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup` には専用の実装があります。`AWS::DSQL::Cluster` にはありません。Cloud Control API 経由です。同じ tag の `cc-protection-properties.ts` に、削除保護の property として `DeletionProtectionEnabled` が登録されています。

**一次情報**（確認日はすべて 2026-10-11）

- Aurora DSQL のユーザーガイド: [What is Amazon Aurora DSQL?](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/what-is-aurora-dsql.html)、[Migrating from PostgreSQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html)、[Supported SQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-features.html)、[CREATE TABLE](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-table-syntax-support.html)、[ALTER TABLE](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html)、[CREATE INDEX](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-index-syntax-support.html)、[Asynchronous indexes](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-create-index-async.html)、[DDL and distributed transactions](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-ddl.html)、[Concurrency control](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html)、[Foreign key constraints](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-foreign-key-constraints.html)、[Primary keys](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-primary-keys.html)、[Sequences and identity columns](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/sequences-identity-columns-working-with.html)、[Quotas and limits](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html)、[Considerations](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/considerations.html)、[Release notes](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/release-notes.html)
- 認証と接続: [Authentication and authorization](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/authentication-authorization.html)、[Generating an authentication token](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_authentication-token.html)、[Database roles and IAM authentication](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/using-database-and-iam-roles.html)、[Connectors for Node.js](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_Node-js-connectors.html)、[Connector for node-postgres](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_program-with-dsql-connector-for-node-postgres.html)、[Cluster connectivity tools](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/aws-sdks.html)、[AWS PrivateLink](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/privatelink-managing-clusters.html)、[SSL/TLS certificates](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/configure-root-certificates.html)、[Troubleshooting](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/troubleshooting.html)、[aws-samples: Using AWS Lambda with Amazon Aurora DSQL](https://github.com/aws-samples/aurora-dsql-samples/blob/main/lambda/README.md)
- 運用と料金: [Cluster lifecycle](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/cluster-lifecycle.html)、[Backup and restore](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/backup-aurora-dsql.html)、[How billing works](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/billing-metering.html)、[Aurora DSQL pricing](https://aws.amazon.com/rds/aurora/dsql/pricing/)、AWS Price List bulk API: [Aurora DSQL](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AuroraDSQL/current/ap-northeast-1/index.json)、[RDS と Aurora](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-northeast-1/index.json)
- インフラ: [AWS::DSQL::Cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dsql-cluster.html)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) の型定義、[cdkd v0.296.28 の register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)
- RDS と Aurora: [Aurora Serverless の auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)、[How Aurora serverless works](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.how-it-works.html)、[RDS Data API](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html)、[Aurora の backup](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Backups.html)、[DB instance in a VPC](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html)、[RDS の storage](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html)、[IAM database authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html)、[RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html)、[Point-in-time restore](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html)
- PostgreSQL と npm: [PostgreSQL 16: Transaction Isolation](https://www.postgresql.org/docs/16/transaction-iso.html)、[pg 8.23.1](https://www.npmjs.com/package/pg/v/8.23.1)、[@aws-sdk/dsql-signer 3.1149.0](https://www.npmjs.com/package/@aws-sdk/dsql-signer/v/3.1149.0)、[@electric-sql/pglite 0.5.8](https://www.npmjs.com/package/@electric-sql/pglite/v/0.5.8)（PGlite はドキュメントを読んでおらず、動かして確かめたことだけを書いています）
- Cloudflare D1: [Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)、[Migrations](https://developers.cloudflare.com/d1/reference/migrations/)、[Global read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)、[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)、[D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/)、[Pricing](https://developers.cloudflare.com/d1/platform/pricing/)、[Wrangler の d1 コマンド](https://developers.cloudflare.com/workers/wrangler/commands/d1/)

:::
