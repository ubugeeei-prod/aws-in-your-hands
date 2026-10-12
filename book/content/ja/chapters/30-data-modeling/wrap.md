---
title: "30 Data Modeling: 費用、注意点、片付け"
---

# 30 Data Modeling: 費用、注意点、片付け

章の最後のページです。この設計の料金、つまずきやすいところ、本番にする前に変えること、片付けの手順をまとめます。

## 料金

<!-- section: 30.cost -->

金額は USD、東京リージョン、オンデマンド、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

既定のスタックには、時間で課金されるリソースがありません。誰も使っていない月にかかるのは、テーブルとインデックスの保存量の料金だけで、最初の 25 GB は価格表の上で 0 です。10 MB なら **USD 0.00** です。ストリームは、有効にしてあるだけでは料金がかかりません。公式の料金ページによると、Lambda がイベントソースマッピングでストリームを読むぶんには、ストリームの読み取りの料金もかかりません（Lambda Managed Instances で動く関数は例外です）。Lambda 以外の方法で読むと、読み取り 1 回ごとに料金がかかります。

使ったときの料金は、読み書きのユニットで決まります。単価は 05章と同じで、書き込みが 100 万ユニットあたり USD 0.715、読み取りが USD 0.1425 です。この章で増えたのは、1 回の操作が使うユニットの数です。

| 操作 | テーブル | インデックス | 合計 |
| --- | --- | --- | --- |
| ノートの作成（タグ 3 つ） | 5 アイテムのトランザクションで 10 | 1 | 11 |
| 本文の編集 | 1 | 2 | 3 |
| 題名の変更（タグ 3 つ） | 4 アイテムのトランザクションで 8 | 2 | 10 |
| 添付の追加 | 2 アイテムのトランザクションで 4 | 0 | 4 |
| タグ 1 つの増減を件数に反映（ストリームの関数） | 2 アイテムのトランザクションで 4 | 0 | 4 |

どのアイテムも 1 KB 以下の場合の数です。本文の長いノートは、1 KB ごとにテーブルのぶんが増えます。添付の追加の 4 は、`ConditionCheck` を書き込み 2 つぶんとして数えた値で、実際にそう課金されるかは確認していません。

月 100 万回の操作で計算します。内訳は、最近の一覧 60%、タグの一覧 10%、ノートと添付の取得 20%、編集 5%（5 回に 1 回は題名も変える）、作成 3%、添付の追加 1%、削除 1% としました。ノート 1 件にタグが 3 つ、一覧の 1 ページは 8 KB 以下、ストリームの関数は 256 MB で 50 ミリ秒と仮定しています。計測値ではありません。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| DynamoDB の読み取り | 96 万ユニット | 0.14 | 0.14 |
| DynamoDB の書き込み | 119 万ユニット | 0.85 | 0.85 |
| DynamoDB の保存 | 1 GB | 0.00 | 0.00 |
| Lambda のリクエスト | 15 万件 | 0.03 | 0 |
| Lambda の実行時間 | 1,875 GB 秒 | 0.03 | 0 |
| CloudWatch Logs | 0.03 GB | 0.02 | 0 |
| 小計 | | **1.07** | **0.99** |

この計算に API Gateway と、API を受ける Lambda は入っていません。05章の同じ規模の計算で、DynamoDB のぶんは読み取り USD 0.28 と書き込み USD 0.07 の合わせて USD 0.35 でした。この章は USD 0.99 です。

読み取りは半分になりました。一覧が、本文を持たないインデックスの写しを読むようになったからです。

書き込みは約 12 倍になりました。119 万ユニットの内訳は、ストリームの関数が 48 万、ノートの作成が 33 万、編集が 22 万、削除が 12 万、添付が 4 万です。このうち、インデックスへの書き込みは 14 万です。**いちばん多いのは、タグの件数という派生データを冪等に保つための書き込み**で、全体の 4 割を占めます。件数を別に持たず、必要なときにタグのアイテムを数えることにすれば、この 48 万ユニットと Lambda のぶんは無くなります。

金額はどれも 1 ドル前後で、この規模では問題になりません。見てほしいのは比率です。DynamoDB の設計で読み方を 1 つ足すと、その値段は、書き込みのたびに払うことになります。

この表に入れていないものがあります。トランザクションの衝突と再試行は 0 と仮定しました。取り消されたトランザクションも、同じだけユニットを使います。条件が成り立たずに断られた書き込みも、write request unit を使います。レスポンスのデータ転送と、point-in-time recovery（1 GB あたり月 USD 0.228、この章では無効）も入っていません。

Contributor Insights を `-c insights=on` で有効にすると、月に **USD 1.00** がかかります。価格表では、DynamoDB のルールが 1 つあたり月 USD 0.50 で、スロットリングされたキーだけを数えるモードでは、ソートキーのあるテーブルにルールが 2 つ作られます。イベントは 100 万件あたり USD 0.034 で、このモードではスロットリングされたリクエストだけが数えられます。インデックスにも付けると、ルールがさらに 2 つ増えます。価格表のこのルールの項目は、単位の欄が `Rule-Hour`、説明が「1 ルールあたり月 USD 0.50」になっています。ここでは説明のほうに従って計算しました。

スタックを消せば、テーブルも、キューも、ロググループも一緒に消えて、料金のかかるものは残りません。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| 作ったノートが最近の一覧に出ない。消したノートが一覧に残っている | インデックスは結果整合です。少し待って読み直すと反映されます。古いノートがいつまでも出ないなら、そのノートに `gsi1pk` と `gsi1sk` があるかを確かめます。無ければバックフィルが済んでいません |
| タグの件数が合わない | まず、ストリームの関数のログで `failedAt` と、デッドレターキューにメッセージがあるかを見ます。再試行が尽きたバッチのぶんは、件数に入っていません |
| `BusyError` が出る | 同じ持ち主への作成や削除が同時に重なり、3 回続けてトランザクションが衝突しました。持ち主ごとのカウンターを全員が書いているためです。同時の書き込みが多い使い方なら、件数を正確に持つこと自体を見直します |
| トランザクションが、条件とは関係なく検証の段階で断られる | 1 つのトランザクションに同じキーのアイテムを 2 回入れているか、100 アイテムを超えています。条件の確認と更新は、1 つの操作にまとめます |
| 式が予約語を理由に断られる | 式に属性の名前を直接書いています。`ExpressionAttributeNames` を通します。`count`、`size`、`name` は予約語です |
| デプロイ後、インデックスへの `Query` だけが `AccessDeniedException` | テーブルの ARN への許可は、インデックスには及びません。`table/<名前>/index/gsi1` を対象に入れます |
| テーブルへの書き込みがスロットリングされ、エラーがインデックスの ARN を指している | インデックスの書き込みの上限か、インデックスのパーティションに当たっています。[実装のつづき](/ja/chapters/30-data-modeling/more.md)の「ホットパーティション」を見てください |
| 一覧の続きを読むと `InvalidPageTokenError` になる | ページトークンは、発行した一覧にしか使えません。最近の一覧のトークンをタグの一覧に渡していないか、別のタグに渡していないかを確かめます |
| 関数が同じレコードを何度も処理している | Lambda は少なくとも 1 回届けます。ログの `duplicates` が増えているだけなら、目印が働いています |
| `modeling:test:local` が「Nothing answers」で止まる | DynamoDB Local が動いていません。`vp run db:local:start` のあと、`vp run modeling:db:migrate:local` でテーブルを作ります |

## 本番にするなら

- テーブルを守ります。`removalPolicy` を `RETAIN` にして、削除保護と point-in-time recovery を有効にします（[22章](/ja/chapters/22-recovery.md)）。single-table design では、バックアップもリストアもテーブル単位です。一部の種類のアイテムだけを戻すことはできません
- 上限を自分の量に合わせます。テーブルとインデックスの 1 秒あたりの上限は、練習用の値です。インデックスの書き込みの上限は、テーブルの書き込みを止めることを忘れないでください
- デッドレターキューにアラームを付けます。メッセージが 1 件でもあれば、件数がずれています（[19章](/ja/chapters/19-observability.md)）。ストリームの関数の `IteratorAge` も見ます。関数が追いついていないことが分かります
- 派生データを作り直す手段を用意します。タグのアイテムを数え直して件数を書き込むスクリプトと、それを動かす手順です。この章には入れていません
- 添付の数に、確実な上限を付けます。添付を足すトランザクションでノートのカウンターを増やす形にすれば、07章の「超えることがある上限」を、超えない上限にできます。そのかわり、添付の追加がノートのアイテムを書くようになり、同じノートへの操作同士が衝突します
- ノートを消したあとに残った添付を、定期的に掃き出します。削除が途中で止まったときに残るぶんです。S3 のオブジェクトも消す必要があります（07章、08章）
- トランザクションの再試行に、待ち時間とばらつきを入れます。`src/compose.ts` の `jitteredBackoff` がその例です。再試行の考え方は [32章](/ja/chapters/32-limits.md)で扱います
- キーの設計を変える前に、読み方の表を書き直します。そして、[実装のつづき](/ja/chapters/30-data-modeling/more.md)の移行の手順を、本番と同じ量のデータを入れた別のテーブルで、一度通して練習します
- 反映の経路を AWS CDK CLI と CloudFormation にします。02章で説明したとおりです

## 片付け

<!-- section: 30.cleanup -->

```bash
vp run modeling:infra:destroy
vp run db:local:stop
```

`modeling:infra:destroy` で、テーブル、インデックス、ストリーム、関数、ロール、ポリシー、キュー、ロググループが消えます。テーブルの中身は戻せません。デッドレターキューに残っていたメッセージも消えます。

`db:local:stop` は、手元の DynamoDB Local のコンテナを消します。05章のテーブルも一緒に消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** `examples/30-data-modeling` のテスト（119 件が通り、DynamoDB Local 用の 1 件はスキップ）、型検査、`modeling:infra:synth`（リソース 9 個、AWS SDK を含むバンドル込み）を実行しました。synth したバンドルを、素の Node.js で読み込めることも確かめました。`modeling:demo` を実行し、本文の出力はその実行のものです。テーブルの規則 16 件とノートブックの規則 19 件を、DynamoDB Local 3.3.1 に対して実行しました。Docker は使わず、AWS が配布する jar を Java 21 で直接起動しています（ポート 8030、`-inMemory -sharedDb -disableTelemetry`）。`modeling:db:reset:local`、`modeling:db:migrate:local`、`modeling:test:local` は、環境変数 `DYNAMODB_ENDPOINT` でこのポートを指して、タスクとして実行しました。

**まだ確かめていないこと。** AWS には一度もデプロイしていません。`modeling:infra:diff`、`modeling:infra:deploy`、`modeling:smoke`、`modeling:infra:drift`、`modeling:infra:destroy`、`modeling:backfill`、`modeling:verify`、`modeling:remove-legacy` は実行していません。DynamoDB Local を Docker で起動する `db:local:start` も、この章のためには実行していません。

したがって、次のことは実物の上では確かめていません。トランザクションが実際に衝突したときの取り消しの理由と、再試行が効くこと。DynamoDB Local は衝突を報告しないので、この経路はメモリ上のモデルでしか通していません。GSI が実際にどれだけ遅れるか。ストリームの関数に同じレコードがどのくらいの頻度で届くか。イベントソースマッピングのフィルターが、関数自身の書き込みを関数に渡さないこと。再試行が尽きたバッチがデッドレターキューに届くことと、失敗し続けるレコードが後ろのレコードを待たせること。TTL が目印を消すこと。`ConditionCheck` が書き込みと読み取りのどちらとして課金されるか。別のパーティションを指す `ExclusiveStartKey` を、実際の DynamoDB が拒否するか（DynamoDB Local は拒否しました）。テーブルとインデックスの上限に当たったときのエラー。`dynamodb:ListStreams` が無いとイベントソースマッピングを作れないのかどうか。ホットパーティションと Contributor Insights の節は、公式ドキュメントの記述だけに基づいています。

キーの移行は、メモリ上のモデルでしか実行していません。既存のテーブルに GSI を足したときのバックフィルにかかる時間と料金、アプリが動いている最中の `modeling:backfill` の挙動、05章の一覧が新しいキーの添付を読んだときの失敗の形は、確かめていません。

GSI の multi-attribute keys は、公式ドキュメントに載っていることを確かめただけで、固定した版の cdkd でも DynamoDB Local でも試していません。料金の表は、単価と仮定から計算した値で、測った値ではありません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 読み方を先に書き出す | `examples/30-data-modeling/src/model.ts`、`src/notebook.ts` | `test:unit` |
| 1 つのテーブルにキーを並べる | `examples/30-data-modeling/src/keys.ts`、`src/model.ts`、`test/keys.test.ts` | `test:unit` |
| ノートと添付を 1 回で読む | `examples/30-data-modeling/src/notebook.ts`、`src/table.ts`、`src/dynamodb-table.ts`、`test/notebook-contract.ts`、`test/table-contract.ts` | `test:unit`、`modeling:test:local` |
| トランザクションと一意性 | `examples/30-data-modeling/src/plan.ts`、`src/notebook.ts`、`src/dynamodb-table.ts`、`test/plan.test.ts`、`test/notebook.test.ts`、`test/dynamodb-table.test.ts` | `test:unit`、`modeling:test:local` |
| 別の並び順のためのインデックス | `examples/30-data-modeling/src/plan.ts`、`src/notebook.ts`、`src/memory-table.ts`、`infra/lib/modeling-stack.ts`、`test/memory-table.test.ts`、`test/notebook.test.ts` | `test:unit`、`modeling:test:local` |
| タグは自分で持つインデックス | `examples/30-data-modeling/src/plan.ts`、`src/notebook.ts`、`test/plan.test.ts`、`test/notebook-contract.ts` | `test:unit` |
| クライアントに渡せるページトークン | `examples/30-data-modeling/src/page-token.ts`、`src/notebook.ts`、`test/page-token.test.ts`、`test/notebook-contract.ts` | `test:unit` |
| Streams で派生データを作る | `examples/30-data-modeling/src/projector.ts`、`src/stream-lambda.ts`、`infra/lib/modeling-stack.ts`、`test/projector.test.ts`、`test/stream-lambda.test.ts` | `test:unit` |
| ホットパーティション | `examples/30-data-modeling/infra/lib/modeling-stack.ts`、`src/keys.ts` | なし |
| キーを止めずに移す | `examples/30-data-modeling/src/layout.ts`、`src/migration.ts`、`scripts/modeling.ts`、`test/migration.test.ts`、`test/keys.test.ts` | `test:unit`、`modeling:backfill`、`modeling:verify`、`modeling:remove-legacy` |
| 手元で動かす | `examples/30-data-modeling/scripts/demo.ts`、`src/memory-table.ts`、`scripts/local-db.ts`、`.env.example` | `modeling:demo`、`modeling:db:migrate:local`、`modeling:db:reset:local` |
| テスト | `examples/30-data-modeling/test/`、`infra/test/modeling-stack.test.ts`、`scripts/test-local.ts` | `test:unit`、`modeling:test:local` |
| AWS にのせる準備 | `examples/30-data-modeling/infra/lib/modeling-stack.ts`、`infra/bin/app.ts`、`infra/test/modeling-stack.test.ts`、`cdk.json` | `modeling:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/30-data-modeling/scripts/modeling.ts` | `modeling:infra:diff`、`modeling:infra:deploy`、`modeling:smoke`、`modeling:infra:drift` |
| 料金 | `data/pricing/` | `test:unit` |
| 片付け | `tools/src/infra/` | `modeling:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-13）

- DynamoDB の設計: [Data modeling foundations](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/data-modeling-foundations.html)、[Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)、[Sparse indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-general-sparse-indexes.html)、[Managing Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.OnlineOps.html)、[Local secondary indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/LSI.html)
- トランザクションと条件: [DynamoDB Transactions: How it works](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)、[Using IAM with DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)、[Constraints](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html)、[Quotas](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html)、[Working with items](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html)、[Reserved words](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html)、[Query（API リファレンス）](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html)
- ストリームと Lambda: [DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)、[Using AWS Lambda with Amazon DynamoDB](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html)、[イベントソースマッピングのパラメーター](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-params.html)、[Partial batch response](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-batchfailurereporting.html)、[Retain discarded records](https://docs.aws.amazon.com/lambda/latest/dg/services-dynamodb-errors.html)、[Event filtering](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb-filtering.html)、[TTL: how it works](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/howitworks-ttl.html)
- パーティションとスロットリング: [Partition key design](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html)、[Burst and adaptive capacity](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/burst-adaptive-capacity.html)、[Key range throughput exceeded](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/throttling-key-range-limit-exceeded-mitigation.html)、[GSI write throttling and back pressure](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/gsi-throttling.html)、[Contributor Insights for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/contributorinsights_HowItWorks.html)
- 手元と権限: [DynamoDB local usage notes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.UsageNotes.html)、[IAM のサービスリファレンス（DynamoDB）](https://servicereference.us-east-1.amazonaws.com/v1/dynamodb/dynamodb.json)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（インストールしたパッケージの中身を読みました）
- 料金: AWS Price List bulk API の [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json) と [CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json)、[DynamoDB の料金ページ（オンデマンド）](https://aws.amazon.com/dynamodb/pricing/on-demand/)
- Cloudflare と Vercel: [D1: Limits](https://developers.cloudflare.com/d1/platform/limits/)、[D1: Use indexes](https://developers.cloudflare.com/d1/best-practices/use-indexes/)、[D1: Pricing](https://developers.cloudflare.com/d1/platform/pricing/)、[D1: D1Database](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[Durable Objects: SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)、[Durable Objects: Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)、[What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)、[Vercel Storage](https://vercel.com/docs/storage)

:::
