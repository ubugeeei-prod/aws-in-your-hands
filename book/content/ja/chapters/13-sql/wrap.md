---
title: "13 SQL: 費用、注意点、片付け"
---

# 13 SQL: 費用、注意点、片付け

章の最後に、D1 との違いを 1 つの表にまとめ、料金、つまずきやすいところ、本番に向けて変えること、片付けの順に確かめます。

## D1 から来た人へ

<!-- section: 13.d1 -->

| | Cloudflare D1 | この章（Aurora DSQL） |
| --- | --- | --- |
| SQL | SQLite | PostgreSQL 16 互換の一部 |
| 手元 | `wrangler dev` がローカルの D1 を用意する。本番と同じ D1 | PGlite で代用。DSQL ではない |
| マイグレーション | 番号つきの `.sql` を Wrangler が順に流す。失敗したマイグレーションはロールバックされる | 番号つきの `.sql` を、この章のランナーが順に流す。1 ファイル 1 文。途中で止まっても流し直せる形にする |
| つなぎ方 | binding（`env.DB`） | TCP の接続。IAM のトークンがパスワード |
| トランザクション | `batch()` に並べた文が 1 つのトランザクション | `BEGIN` から `COMMIT` まで。途中で読んだ値を見て、次の文を決められる |
| 同時に書いたとき | 書き込みはプライマリの 1 か所に集まる | コミットのときに競合を調べて、負けた側は `40001`。やり直す |
| 読み取りの置き場所 | リードレプリカを世界中に置ける。非同期 | 1 リージョンの中の 3 つの AZ。同期 |
| バックアップ | Time Travel。過去 30 日の任意の分へ | AWS Backup。クラスター全体。リストアは新しいクラスター |
| 料金の単位 | 読んだ行、書いた行、ストレージ | DPU、ストレージ |

違いがいちばん大きいのは、整合性です。

D1 のリードレプリカは、プライマリから非同期に写しを受け取るので、どこまでも古くなりえます。それを補うのが Sessions API で、1 つのセッションの中では、読み取りが前に戻らないことと、自分が書いたものを読めることを保証します（sequential consistency）。保証の範囲はセッションで、別のセッションが何を見ているかは、ブックマークを渡さないかぎり保証されません。Sessions API を使わなければ、クエリはすべてプライマリに行きます。

Aurora DSQL の単一リージョンのクラスターは、3 つの AZ に同期で書きます。コミットされたものは、次のどのトランザクションからも見えるので、セッションやブックマークを気にする場面がありません。その代わり、東京のクラスターは東京にあります。遠くの読者の近くに写しを置く、D1 のリードレプリカのような仕組みは、この構成にはありません。

DSQL が D1 を分散させたものではない、と章の最初に書いたのは、このためです。D1 は、1 か所で書いたものを遠くでも読めるようにしたデータベースで、DSQL は、1 つのリージョンの中でどこに書いても同じものが見えるようにしたデータベースです。マルチリージョンのクラスターもありますが、組めるのは同じ地域の組（東京なら大阪やソウルなど）の中に限られ、この章では扱いません。同じ種類の分散したデータベースを自分で動かすと何を引き受けることになるかは、[66章](/ja/chapters/66-distributed-sql.md)で見ます。

トランザクションの書き方も違います。D1 の `batch()` は文を先にすべて並べて渡すので、途中で結果を見て分岐することはできません。DSQL では `BEGIN` と `COMMIT` の間で、読んで、判断して、書けます。[しくみと実装](/ja/chapters/13-sql/build.md)のページで書いた件数の上限の処理が、その例です。その自由と引き換えに、やり直しを自分で書くことになりました。

binding、本番と同じものが動くローカル、Time Travel のように、D1 のほうが楽な場面は多くあります。この本は、D1 をやめるよう勧めるものではありません。SQLite では足りず PostgreSQL の SQL が要るときや、AWS のほかのサービスのすぐ隣にデータベースを置きたいときの選択肢として読んでください。

## 料金

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

Aurora DSQL の課金は、DPU とストレージの 2 つだけです。DPU は、SQL の実行にかかった計算、読み取り、書き込みをまとめた単位で、100 万あたり 10.00 です。ストレージは 1 GB 月あたり 0.40 です。毎月、最初の 10 万 DPU と 1 GB が無料になります。料金ページには、この枠に期限があるかどうかは書かれていません。

**誰も問い合わせない月にかかるのは、ストレージだけです。** 1 GB 置いていたとして、定価で 0.40、無料枠の中なので 0 です。

置いてあるだけの月の料金を、3 つのサービスで比べます。

| 構成 | 仮定 | 定価 / 月 |
| --- | --- | --- |
| Aurora DSQL | 問い合わせなし、1 GB | 0.40（無料枠の適用後は 0） |
| RDS for PostgreSQL | db.t4g.micro、Single-AZ、gp3 を 20 GB（最小）、730 時間 | **21.01** |
| Aurora Serverless v2（auto-pause なし） | 最小 0.5 ACU のまま 730 時間、1 GB | **54.87** |
| Aurora Serverless v2（1 か月ずっと停止） | 最小 0 ACU、一度も再開せず、1 GB | 0.12 |

RDS の内訳は、インスタンスが 18.25、ストレージが 2.76 です。Aurora は、容量が 54.75、ストレージが 0.12 です。RDS の無料枠はこの章では確かめていないので、引いていません。0 という意味ではなく、不明です。

最後の行は、いちばん都合のよい場合です。Aurora は保守のためにインスタンスを再開することがあり、その時間は課金されます。RDS と Aurora には、VPC まわりの料金（11章）も加わります。

使ったときの DSQL の料金は、月 100 万リクエストで、読み取りが 90 万、書き込みが 10 万という仮定で計算すると、次のようになります。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| DPU | 24,600 | 0.25 | 0 |
| ストレージ | 1 GB 月 | 0.40 | 0 |
| 小計 | | **0.65** | **0** |

24,600 DPU は、測った値ではありません。公式ドキュメントの計算例（主キーでの読み取りが 0.00675 DPU、1 行の `INSERT` が 0.06175 DPU）を借りて、読み取り 1 件を 0.00675、書き込み 1 件をその `INSERT` の 3 倍と置いただけです。あなたのクエリの実際の値は、`EXPLAIN ANALYZE VERBOSE` か、CloudWatch の DPU のメトリクスでわかります。

この表はデータベースの分だけです。Lambda、API Gateway、ログには 04章と同じように料金がかかります。バックアップを取れば AWS Backup の料金が、やり直しが増えればその分の DPU が加わります。

### 叩かれたら

URL を知っていれば、誰でも、何回でもこの API を呼べます。呼ばれる量を止めるものは 3 つあります。ステージのスロットリング（API 全体で 1 秒に 10 件）、行の数の上限（持ち主 1 人 100 行）、レスポンスの大きさの上限（一覧は 20 KiB まで、ノート 1 件は 64 KiB まで）です。

1 秒 10 件が 30 日続くと、2,592 万件になります。そのすべてが書き込みだったとして、上の仮定（1 件 0.18525 DPU）を当てはめます。Lambda、API Gateway、ログは、04章の仮定と単価のままです。

| 対象 | 定価 |
| --- | --- |
| API Gateway HTTP API のリクエスト（2,592 万件） | 33.44 |
| Lambda のリクエストと実行時間（324,000 GB 秒） | 9.50 |
| CloudWatch Logs（12.36 GB） | 9.49 |
| DPU（4,801,680） | 48.02 |
| ストレージ（100 行） | 0.00 |
| 合計 | **100.45** |

合計は月に USD 100 ほどですが、この表は仮定の上に仮定を重ねています。DPU は測っていない値で、本文が 10,000 文字ある行は、計算例の 1 行より重いはずです。競合でやり直した分の DPU も入っていません。実行時間の 50 ミリ秒は 04章から借りた値で、データベースを呼ぶこの章では、もっと長くなります。DSQL の側に DPU を止める設定があるかどうかは、確かめていません。この章が上限を掛けているのは、入口の件数だけです。

レスポンスのデータ転送も、この表には入っていません。計算の方法は、[04章の同じ節](/ja/chapters/04-http-api/wrap.md)と同じです。`GET /notes` は新しい 20 行の要約だけを返し、20 KiB を超えないことをテストで固定したので、1 秒 10 回が 30 日続いて約 494 GB、USD 56 ほどです。2,592 万件がすべて 64 KiB のノート 1 件だったとしても、約 1,582 GB で USD 180 ほどに収まります。この単価が API Gateway のレスポンスにそのまま当てはまるかどうかは、確かめていません。

行の数の上限にも但し書きがあります。いまは全員が同じ持ち主（`anonymous`）なので、100 行は API 全体で 100 行という意味になり、誰かが埋めれば、ほかの人は作れません。そして、誰でも消せます。持ち主を分けるのは、06章の認証です。

IP アドレスごとに止めるには AWS WAF を使いますが、HTTP API には付けられないので、手前に CloudFront を置く構成になります。[21章](/ja/chapters/21-security.md)の web ACL は月 USD 8.00 と、リクエスト 100 万件あたり USD 0.60 です。その構成は、この本では作っていません。

スタックを消せば、この章の分の料金は止まります。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `dev:sql` が `Not applied yet` で止まる | 先に `vp run sql:db:migrate:local` を実行する |
| `The local database ... is open in process` | `dev:sql` が動いています。止めてからもう一度実行する |
| デプロイ後、`/health` は 200 なのに `/notes` が 500 | `sql:db:migrate` と `sql:db:grant` を流したかを確かめる。ログに `relation "app.notes" does not exist` や `permission denied` があるはず |
| ログに `Wrong user to action mapping` | トークンの種類とデータベースロールが合っていません。`admin` には admin 用のトークン、それ以外にはふつうのトークンを使う |
| ログに `IAM authentication failed` や access denied | 実行ロールに `dsql:DbConnect` があるか、`sql:db:grant` をいまのロールの ARN で流したかを確かめる（スタックを作り直すと ARN が変わります） |
| `{"message":"Too Many Requests"}` のような 429 が返る | ステージのスロットリングです。API 全体で 1 秒に 10 件を超えました。自分が呼んでいなくても、ほかの誰かの分で起きます |
| 503 と `busy` が返る | 4 回試して、すべて負けました。同じ行に書き込みが集中しています。`transaction retry` の行を数えて、どの行でぶつかっているかを見直す |
| マイグレーションの直後だけ `40001` が出る | スキーマの変更で、古いスキーマを覚えていた接続が負けています（OC001）。やり直しで通るはず |
| `use CREATE INDEX ASYNC instead` | インデックスの文に `ASYNC` がありません。lint が通っているなら、ランナーの `dialect` を確かめる |
| `transaction row limit exceeded` | 1 つのトランザクションで 3,000 行を超えました。分けてください |
| しばらくぶりの最初の呼び出しだけ遅い、または失敗する | クラスターが Idle や Inactive から戻っているか、凍結されていた実行環境の接続が切れています。呼ぶ側でもう一度呼ぶ |

最後の行は、推測で書いています。凍結から戻った実行環境で、切れた接続がどのエラーになるかは、実機で見ていません。

## 本番にするなら

- 削除保護を入れて、スタックを消してもクラスターが残るようにします。いまは逆です
- バックアップの計画を作り、新しいクラスターへの切り替えまで含めて、リストアを一度は練習します
- 認証を足します。いまは持ち主が全員 `anonymous` で、誰でも消せます（[06章](/ja/chapters/06-auth.md)）
- 流量の上限を、自分の API に合わせます。1 秒に 10 件は練習用の値です。上げるときは、「叩かれたら」の計算を、データ転送の分も含めてやり直してください
- 競合の回数を見張ります。`transaction retry` の行と 503 の数にアラームを付けます（ログの行を数えてアラームにする方法は [19章](/ja/chapters/19-observability.md)）
- マイグレーションを、手元からではなく決まった経路で流します。`dsql:DbConnectAdmin` を持つ人と場所を絞ります（CI の経路の作り方は [20章](/ja/chapters/20-shipping.md)）
- 作成を、呼ぶ側からも安全に送り直せるようにします。いまは ID をサーバーが決めるので、応答が届かなかった `POST` を送り直すと、2 件目ができます。呼ぶ側が決めた key を受け取る作りに変えます
- 接続が切れたときの再試行を決めます。この章がやり直すのは `40001` だけです。接続のエラーでは、コミットされたかどうかがわかりません。やり直してよいのは、何度実行しても同じ結果になる処理だけです
- 反映の経路を AWS CDK CLI と CloudFormation にします。理由は 02章に書きました

## 片付け

<!-- section: 13.cleanup -->

```bash
vp run sql:infra:destroy
```

クラスター、関数、ロール、API、ロググループが消えます。ノートもデータベースロールも、クラスターと一緒に消えます。バックアップは取っていないので、戻せません。

手元のデータベースは、`examples/13-sql/.pglite/` を消せば無くなります。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（トランザクションの再試行、PGlite の上での repository、`COMMIT` の競合の注入、マイグレーションの lint と中断からの再開、grant の文、API、インフラ）。一覧が本文を返さないこと、20 件で止まること、いちばん大きい題名を並べても 20 KiB を超えないことも、このテストで固定しています。型検査。synth と、できたバンドルを Node.js 24 で読み込んで `GET /health` と UUID でない ID の 404 が返ること。`sql:db:reset:local`、`sql:db:migrate:local`、`sql:db:seed:local` と、2 回目の実行で何も変わらないこと。`dev:sql` を起動して、本文の `curl`（作成、更新、古い `version` の 409）と削除。`dev:sql` の起動中に reset が拒否されること、サーバーを止めたあとは古いロックが引き継がれること。

**まだ確かめていないこと。** ステージのスロットリングは、テンプレートに入っていることをテストで固定し、固定した版の cdkd（0.296.28）のソースが `DefaultRouteSettings` を API Gateway に渡していることを読んだだけです。実際に反映されること、429 の本文の形、429 に料金がかかるかどうかは確かめていません。「叩かれたら」の金額は、単価と設定と仮定から計算しただけです。

実際の Aurora DSQL には、一度もつないでいません。`sql:infra:deploy`、`sql:db:migrate`、`sql:db:grant`、`sql:db:seed`、`sql:smoke`、`sql:logs`、`sql:infra:drift`、`sql:infra:destroy`、`NOTES_DB=dsql` での `dev:sql` は未実行です。とくに次が確認待ちです。4 つのマイグレーションが DSQL に受け付けられること。`CREATE INDEX ASYNC` の応答からジョブの ID を読めて、`sys.jobs` で完了を待てること。`AWS IAM GRANT` と `GRANT` で `notes_api` が読み書きできること。`password` の関数でトークンが通ること。競合が node-postgres のエラーの `code` に `40001` として現れること。cdkd が Cloud Control API 経由でクラスターを作り、`Ref` が identifier を返すこと。バックアップとリストア。料金の DPU は仮定で、測っていません。RDS for PostgreSQL と Aurora Serverless v2 は、ドキュメントと Price List を読んだだけで、作っていません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像、3 つの選択肢 | `examples/13-sql/infra/lib/sql-stack.ts` | `sql:infra:synth` |
| Aurora DSQL と PostgreSQL の違い | `examples/13-sql/src/migrate.ts`、`test/migrate.test.ts` | `test:unit` |
| スキーマとマイグレーション | `examples/13-sql/migrations/`、`src/migrate.ts`、`test/migrate.test.ts` | `test:unit`、`sql:db:migrate:local` |
| 行を型にする | `examples/13-sql/src/contract.ts`、`src/db.ts`、`src/notes-repository.ts`、`src/notes.ts`、`src/app.ts` | `test:unit` |
| トランザクションは丸ごとやり直す | `examples/13-sql/src/transaction.ts`、`src/notes-repository.ts`、`test/transaction.test.ts` | `test:unit` |
| 競合をわざと起こす | `examples/13-sql/test/support.ts`、`test/notes-repository.test.ts`、`test/app.test.ts` | `test:unit` |
| 手元で動かす | `examples/13-sql/src/pglite.ts`、`src/dev.ts`、`src/compose.ts`、`scripts/local-db.ts`、`scripts/db-tasks.ts`、`test/fixtures/seed-notes.json`、`.env.example` | `dev:sql`、`sql:db:migrate:local`、`sql:db:seed:local`、`sql:db:reset:local` |
| Lambda からつなぐ | `examples/13-sql/src/dsql.ts`、`src/lambda.ts`、`src/env.ts`、`src/grant.ts`、`infra/lib/sql-stack.ts`、`infra/bin/app.ts`、`infra/test/sql-stack.test.ts`、`cdk.json` | `sql:infra:synth`、`test:unit` |
| デプロイして、マイグレーションを流す | `examples/13-sql/scripts/cloud-db.ts`、`scripts/db-tasks.ts`、`scripts/smoke.ts`、`scripts/logs.ts`、`test/grant.test.ts` | `sql:infra:diff`、`sql:infra:deploy`、`sql:db:migrate`、`sql:db:grant`、`sql:db:seed`、`sql:smoke`、`sql:logs`、`sql:infra:drift` |
| 片付け | `tools/src/infra/`、`examples/13-sql/scripts/local-db.ts` | `sql:infra:destroy`、`sql:db:reset:local` |
| 料金 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

**cdkd が扱うリソースの種類。** 固定した版（0.296.28）の `src/provisioning/register-providers.ts` を見ると、`AWS::ApiGatewayV2::Api`、`Integration`、`Route`、`Stage`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup` には専用の実装があります。`AWS::DSQL::Cluster` にはありません。Cloud Control API 経由です。同じタグの `cc-protection-properties.ts` に、削除保護のプロパティとして `DeletionProtectionEnabled` が登録されています。

**一次情報**（確認日はすべて 2026-10-11）

- Aurora DSQL のユーザーガイド: [What is Amazon Aurora DSQL?](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/what-is-aurora-dsql.html)、[Migrating from PostgreSQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html)、[Supported SQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-features.html)、[CREATE TABLE](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-table-syntax-support.html)、[ALTER TABLE](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html)、[CREATE INDEX](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-index-syntax-support.html)、[Asynchronous indexes](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-create-index-async.html)、[DDL and distributed transactions](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-ddl.html)、[Concurrency control](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html)、[Foreign key constraints](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-foreign-key-constraints.html)、[Primary keys](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-primary-keys.html)、[Sequences and identity columns](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/sequences-identity-columns-working-with.html)、[Quotas and limits](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html)、[Considerations](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/considerations.html)、[Release notes](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/release-notes.html)
- 認証と接続: [Authentication and authorization](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/authentication-authorization.html)、[Generating an authentication token](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_authentication-token.html)、[Database roles and IAM authentication](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/using-database-and-iam-roles.html)、[Connectors for Node.js](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_Node-js-connectors.html)、[Connector for node-postgres](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_program-with-dsql-connector-for-node-postgres.html)、[Cluster connectivity tools](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/aws-sdks.html)、[AWS PrivateLink](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/privatelink-managing-clusters.html)、[SSL/TLS certificates](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/configure-root-certificates.html)、[Troubleshooting](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/troubleshooting.html)、[aws-samples: Using AWS Lambda with Amazon Aurora DSQL](https://github.com/aws-samples/aurora-dsql-samples/blob/main/lambda/README.md)
- 運用と料金: [Cluster lifecycle](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/cluster-lifecycle.html)、[Backup and restore](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/backup-aurora-dsql.html)、[How billing works](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/billing-metering.html)、[Aurora DSQL pricing](https://aws.amazon.com/rds/aurora/dsql/pricing/)、AWS Price List bulk API: [Aurora DSQL](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AuroraDSQL/current/ap-northeast-1/index.json)、[RDS と Aurora](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-northeast-1/index.json)
- インフラ: [AWS::DSQL::Cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dsql-cluster.html)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) の型定義、[cdkd v0.296.28 の register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)
- RDS と Aurora: [Aurora Serverless の auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)、[How Aurora serverless works](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.how-it-works.html)、[RDS Data API](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html)、[Aurora のバックアップ](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Backups.html)、[DB instance in a VPC](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html)、[RDS のストレージ](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html)、[IAM database authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html)、[RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html)、[Point-in-time restore](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html)
- PostgreSQL と npm: [PostgreSQL 16: Transaction Isolation](https://www.postgresql.org/docs/16/transaction-iso.html)、[pg 8.23.1](https://www.npmjs.com/package/pg/v/8.23.1)、[@aws-sdk/dsql-signer 3.1149.0](https://www.npmjs.com/package/@aws-sdk/dsql-signer/v/3.1149.0)、[@electric-sql/pglite 0.5.8](https://www.npmjs.com/package/@electric-sql/pglite/v/0.5.8)（PGlite はドキュメントを読んでおらず、動かして確かめたことだけを書いています）
- Cloudflare D1: [Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)、[Migrations](https://developers.cloudflare.com/d1/reference/migrations/)、[Global read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)、[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)、[D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/)、[Pricing](https://developers.cloudflare.com/d1/platform/pricing/)、[Wrangler の d1 コマンド](https://developers.cloudflare.com/workers/wrangler/commands/d1/)

:::
