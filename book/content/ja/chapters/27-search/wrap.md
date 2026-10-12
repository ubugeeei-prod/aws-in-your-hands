---
title: "27 Search: 費用、注意点、片付け"
---

# 27 Search: 費用、注意点、片付け

[デプロイ](/ja/chapters/27-search/deploy.md)まで終えたところで、Cloudflare と Vercel での同じ仕事と比べ、料金を計算し、作ったものを片付けます。

## Cloudflare と Vercel では

<!-- section: 27.compare -->

Cloudflare には、この章の 2 つの層に当たる製品があります。以下は 2026-10-13 に公式ドキュメントで確かめた内容です。

Vectorize は、S3 Vectors に当たるベクトルのデータベースです。Workers か HTTP API から呼びます。課金は、保存したベクトルの次元数と、問い合わせたベクトルの次元数で決まり、Workers Paid には毎月、保存 1,000 万次元と問い合わせ 5,000 万次元が含まれます。稼働時間やインデックスの数には課金されない、とドキュメントに明記されています。置いてあるだけの料金がないという点は、S3 Vectors と同じです。

違いもあります。Vectorize の 1 本のベクトルは 1,536 次元まで、1 回の問い合わせで返る数は 100 件まで（メタデータを返すなら 50 件まで）です。メタデータで絞り込むには、ベクトルを入れる前に、絞り込みに使うプロパティのメタデータインデックスを作っておく必要があります。あとから作っても、すでに入っているベクトルには効きません。S3 Vectors では、メタデータは何もしなくても絞り込みに使えます。Vectorize には namespace もあり、1 つのインデックスの中でベクトルを分けられます。

AI Search は、取り込み、切り分け、埋め込み、検索までをまとめて引き受ける製品で、Bedrock のマネージド型ナレッジベースに当たります。意味の検索と言葉の検索を組み合わせたハイブリッド検索が、既定で有効です。この章が自分で書いた順位の合わせ込みを、製品が持っています。課金は 2026-11-01 に始まるとされ、毎月の枠（取り込み 500 万トークン、保存 10 GB、意味の検索 1,000 回、全文検索 1,000 回）を超えた分に単価がかかります。独自のメタデータは 1 つのインスタンスにつき 5 項目までです。取り込み元として何を選べるかは、確かめていません。

Vercel には、自前のベクトルのデータベースも検索の製品もありません。ストレージの案内は、ベクトルのデータベースを Marketplace のプロバイダー（Neon、Upstash、Supabase など）から選ぶよう勧めています。モデルの呼び出しは AI SDK で書き、保存先は選んだプロバイダーのものになります。

この章の構成が Cloudflare や Vercel より優れている、とは言えません。文書を渡せば検索できるようになるまでの手数は、AI Search のほうがずっと少なく、言葉と意味の合わせ込みも用意されています。Cloudflare にアプリがあり、検索したい文書を AI Search に入れられるなら、そのまま使うのが近道です。

この章で手に入るのは、部品が見えていることです。どの文章がどこに写され、誰の検索に何が返るかを、自分のコードとテストで決められます。ノートが DynamoDB にあり、所有者ごとの分離を自分で証明したいなら、この形に意味があります。その代わり、ストリーム、索引の関数、キュー、作り直しの手順を、自分で持つことになります。

## 料金

<!-- section: 27.cost -->

金額は USD、東京リージョン、従量課金、税別です。単価は AWS Price List（2026-10-13 確認）のもので、計算の詳細は[料金の計算](/ja/reference/pricing.md)にあります。

**デプロイしたまま、書き込みも検索もない月の料金は USD 0.00 です。** 1,000 件のノートを索引してあり、ベクトルが 2,000 本あると仮定すると、S3 Vectors の保存量は約 8 MB で、料金は USD 0.0005 です（0.008011 GB × 0.066）。小数第 2 位までで表すと 0 になります。Lambda、function URL、ストリーム、空のキューには、置いてあるだけでかかる料金がありません。DynamoDB の保存量は、25 GB の無料枠の内側です。

同じ月に、検索エンジンを 1 つ置いておくとどうなるかを並べます。

| 構成 | 何もしない月の料金 | 根拠 |
| --- | --- | --- |
| この章（S3 Vectors と Lambda） | 0.00 | 保存量だけ |
| OpenSearch Serverless、Classic、既定の冗長構成 | 487.64 | 2 OCU × 730 時間 × 0.334 |
| OpenSearch Serverless、Classic、冗長なし | 243.82 | 1 OCU × 730 時間 × 0.334 |
| OpenSearch Serverless、NextGen | 不明 | OCU は 0 まで縮むとされる。東京での提供と単価は未確認 |
| Bedrock のマネージド型ナレッジベース | 0.01 | 2 MB × 1 GB あたり月 5.00。料金ページの値で、リージョンは書かれていない |

Classic の 2 行に、保存量の料金は入っていません。

使ったときの料金を、月に書き込み 1,000 件、検索 10,000 件、そのうち回答まで進むものが 1,000 件、という仮定で計算します。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| S3 Vectors の保存 | 0.008 GB | 0.00 | 0.00 |
| S3 Vectors への書き込み | 0.122 GB | 0.03 | 0.03 |
| S3 Vectors への問い合わせ | 10,000 回 | 0.03 | 0.03 |
| 問い合わせが処理したデータ | 80.1 GB | 0.00 | 0.00 |
| Titan の埋め込み | 110 万トークン | 0.03 | 0.03 |
| Nova 2 Lite の入力 | 250 万トークン | 0.99 | 0.99 |
| Nova 2 Lite の出力 | 15 万トークン | 0.50 | 0.50 |
| DynamoDB の書き込み | 2,000 ユニット | 0.00 | 0.00 |
| DynamoDB の読み込み | 30,000 ユニット | 0.00 | 0.00 |
| Lambda のリクエスト | 11,000 件 | 0.00 | 0 |
| Lambda の実行時間 | 2,375 GB 秒 | 0.03 | 0 |
| CloudWatch Logs の取り込み | 0.01 GB | 0.01 | 0 |
| 小計 | | **1.62** | **1.58** |

S3 Vectors と Bedrock の行は、無料枠を確認できなかったので、何も引いていません。

料金のほとんどは、答えを書くモデルの分です（USD 1.49）。検索と索引だけなら、月に USD 0.13 です。検索そのものより、検索の結果をモデルに読ませるところに料金がかかります。回答 1 件の入力を 2,500 トークンと仮定したのは、最大 4 つのパッセージを渡すからで、パッセージを増やせば、この行がそのまま増えます。

仮定のうち、確かめていないものが多いことに注意してください。日本語のノートが何トークンになるかは測っていません。1 パッセージ 400 トークン、クエリ 30 トークンは置いた値です。実際の値は、ログの `embedded` 行と、回答の `usage` でわかります。

S3 Vectors の料金には、表から読み取りにくい性質が 2 つあります。

書き込みは、1 回の `PutVectors` につき最低 128 KB 分が課金されます。この章は、ノート 1 件の変更ごとに 1 回呼ぶので、数 KB のベクトルを書くたびに 128 KB 分を払います。上の表の書き込みの行は、この最低額で計算しています。大量に入れ直すときは、500 本までを 1 回にまとめると、料金が大きく下がります。

問い合わせが処理したデータの量は、インデックス全体の大きさで決まります。所有者で絞っても、料金の計算には全員のベクトルが入ります。2,000 本のうちは無視できる額ですが、インデックスが大きくなると、問い合わせ 1 回あたりの料金が比例して増えます。所有者ごとにインデックスを分ければ、処理したデータの量も、その所有者の分だけになります。

データ転送と、問い合わせが返したバイト数の料金は、表に入れていません。0 という意味ではなく、未算入です。問い合わせが返すデータは 1 回 512 KB まで無料とされていて、この章の問い合わせは 30 件のキーと短いメタデータしか返さないので、その内側に収まるはずです。

スタックを消せば、この章の分の料金は止まります。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `dev:search` が `Invalid environment` で止まる | `examples/27-search/.env` があるかを確認します。`SEARCH_BACKEND` に既定値はありません |
| 検索が 401 | `x-notes-owner` ヘッダーがないか、使えない文字が入っています |
| function URL が 403 | 署名がないか、呼んでいる人に `lambda:InvokeFunctionUrl` と `lambda:InvokeFunction` がありません |
| 言葉では見つかるのに、意味では見つからない | 索引が追いついていないか、距離がしきい値より遠いかです。`vp run search:logs -- --indexer` に `indexed` の行があるか、`vp run search:reindex` の差が 0 かを見ます |
| レスポンスの `meaning` が `unavailable` | 埋め込みか問い合わせが失敗しています。検索のログに原因は出ません。実行ロールが Titan とインデックスを呼べるか、Bedrock のスロットリングが起きていないかを確認します |
| 検索のログの `dropped` が 0 でない | インデックスとテーブルがずれています。返った結果は正しいままです。`vp run search:reindex -- --apply` で揃えます |
| デッドレターキューにメッセージがある | 索引の関数が、再試行しても適用できなかった変更があります。索引のログの `indexing failed` で原因を確かめ、直してから `search:reindex -- --apply` を実行します |
| デプロイがインデックスの作成で失敗する | cdkd が Cloud Control API 経由で `AWS::S3Vectors::Index` を作る経路は、確かめていません。エラーの内容を見てください |
| 回答の `unknownCitations` が空でない | モデルが、渡していない番号を引用しました。答えを疑う理由になります |

## 本番にするなら

- 所有者を、ヘッダーではなく検証したトークンから決めます。06章のアクセストークンを検証し、`sub` を `ownerOf` で返します。この章で最も先に変えるべき箇所です
- しきい値とパッセージの長さを、実際のノートで決め直します。この章の 0.7 と 800 文字は、どちらも調整していません。自分のデータで「見つかるべきノート」の組を用意し、値を変えて比べます
- デッドレターキューにアラームを付けます。メッセージが 1 件でもあれば、検索に現れない変更があります。19章の方法で、キューの長さを見張ります
- 索引の遅れを測ります。ノートを書いてから意味の検索で見つかるまでの時間を、この章は一度も測っていません
- Bedrock のクォータを確かめます。埋め込みのモデルは、1 分あたりのリクエスト数で制限される、とドキュメントにあります。この章の索引は、パッセージ 1 つにつき 1 回呼ぶので、大量の入れ直しでは最初にここに当たります。東京リージョンでの値は確かめていません
- ノートを消したら、ベクトルも消えたことを確かめます。個人のデータを消す義務があるなら、写しであるインデックスも対象です。この章のインデックスに文章は入っていませんが、ベクトルは元の文章から作ったものです
- 利用者ごとの上限を付けます。17章と同じく、同じ人が 1 万回質問すれば、1 万回分の料金になります
- ノートの数の上限を外すなら、言葉の検索を作り直します。この章の言葉の検索は、所有者のノートが 100 件までだから成り立っています
- 反映の経路を AWS CDK CLI と CloudFormation にします。02章で説明したとおりです

## 分散システムとして見ると

状態の持ち主は、テーブルです。インデックスは、テーブルから計算できる写しで、遅れ、欠け、余分を持ちます。この章の設計は、写しが間違っていても害が出ないようにすることでした。

不変条件は「検索は、他の所有者のノートを決して返さない」です。返す文章を、必ず呼び出し元の所有者のキーでテーブルから読むことで守っています。インデックスの絞り込みは、1 つ目の歯止めにすぎません。

写しの遅れは、消せません。書き換えた直後のノートは、索引が追いつくまで、意味の検索では見つかりません。この章は、古い内容で見つかるよりも、見つからないほうを選びました。言葉の検索がテーブルを読むので、新しい内容で見つける道は残っています。

配送は少なくとも 1 回で、同じノートへの変更の順序は保たれます。索引の操作を、2 回適用しても同じ結果になるように書いたので、重複は害になりません。順序が崩れるのは、ストリームの外から書く作り直しのときだけで、そこでは書いたあとに読み直します。

## 片付け

<!-- section: 27.cleanup -->

```bash
vp run search:infra:destroy
```

テーブルとノート、インデックスとベクトル、ベクトルバケット、2 つの関数、function URL、キュー、ロール、ロググループが消えます。

CloudFormation のリファレンスには、空でないベクトルバケットは削除できない、とあります。このスタックはインデックスを先に消すので、バケットは空になるはずですが、ベクトルの入ったインデックスを cdkd が消せることは、確かめていません。削除が途中で止まったら、S3 のコンソールの「Vector buckets」で `aih-search-notes` を確認してください。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルです。Bedrock の側には、この章が作ったリソースはありません。

::: details この章の検証メモ

**手元で確かめたこと。** 2026-10-13 に、ユニットテスト（9 ファイル、80 件）、型検査、synth（esbuild のバンドル込み、14 リソース）を実行しました。`dev:search` を `SEARCH_BACKEND=local` で起動し、[手元で動かす](/ja/chapters/27-search/local.md)に載せた `curl` を実行しています。載せた出力はそのときのものです。不変条件のテストが実際に失敗を捉えることは、検索のバージョンの確認を外すとテストが 1 件落ち、索引の削除を外すと 2 件落ちることで確かめました。導入した配布物では、次を確かめています。`aws-cdk-lib` 2.273.0 に `CfnVectorBucket` と `CfnIndex` があること。`@aws-sdk/client-s3vectors` 3.1149.0 のコマンドと入出力の型。固定した版の cdkd（0.296.28）が、`AWS::DynamoDB::Table`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::EventSourceMapping`、`AWS::Lambda::Function`、`AWS::Lambda::Url`、`AWS::Logs::LogGroup`、`AWS::S3Vectors::VectorBucket`、`AWS::SQS::Queue` に専用の実装を持つこと。`AWS::S3Vectors::Index` には専用の実装がなく、Cloud Control API 経由になること。確かめたのは npm の配布物に入っているバンドル済みのファイルで、`src/provisioning/register-providers.ts` そのものではありません。

**まだ確かめていないこと。** この章は、AWS に一度もデプロイしていません。Titan の埋め込みも、S3 Vectors も、回答のモデルも、一度も実際に呼んでいません。`search:infra:deploy`、`search:seed`、`search:smoke`、`search:reindex`、`search:logs`、`search:infra:drift`、`search:infra:destroy`、`SEARCH_BACKEND=aws` での `dev:search` は未実行です。とくに次の点は、実環境での確認を待っています。

- cdkd 0.296.28 が `AWS::S3Vectors::Index` を Cloud Control API 経由で作り、消せること
- Titan Text Embeddings V2 が東京から呼べて、1,024 次元のベクトルを返すこと。モデルカードとリクエストの仕様を読んだだけです
- S3 Vectors の実際のレスポンスが、アダプターのスキーマに合うこと。所有者の条件を付けた問い合わせが通ること。`PutVectors` が同じキーを置き換えること。`DeleteVectors` に存在しないキーを渡したときの振る舞い
- DynamoDB Streams の実際のレコードが、ハンドラーのスキーマに合うこと。テストのレコードは、ドキュメントと型定義から手で書いたものです
- イベントソースマッピングの絞り込み、部分的な失敗の報告、再試行の打ち切り、キューへの送信が、設定どおりに働くこと。キューに届くメッセージの中身
- 距離のしきい値（0.7）とパッセージの長さ（800 文字）が、日本語のノートで妥当かどうか。日本語 1 文字あたりのトークン数
- 索引の遅れ、検索と回答の応答時間。何も計測していません
- OpenSearch Serverless の NextGen が東京リージョンで使えるか、単価が Classic と同じか、0 から戻るまでの時間
- Bedrock のマネージド型ナレッジベースの料金が、東京リージョンでも料金ページの値かどうか
- `dynamodb:ListStreams` の対象を、ストリーム 1 本に絞れるかどうか

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像、何で検索するか | `examples/27-search/infra/lib/search-stack.ts` | `search:infra:synth` |
| 言葉で探す | `examples/27-search/src/tokenize.ts`、`src/bm25.ts`、`test/ranking.test.ts` | `test:unit` |
| ノートをパッセージに切る | `examples/27-search/src/chunk.ts`、`test/chunk.test.ts` | `test:unit` |
| 埋め込み | `examples/27-search/src/embedder.ts`、`src/bedrock-embedder.ts` | `test:unit` |
| インデックス | `examples/27-search/src/vector-index.ts`、`src/memory-vector-index.ts`、`src/s3-vectors-index.ts`、`test/s3-vectors-index.test.ts` | `test:unit` |
| テーブルと揃える | `examples/27-search/src/indexer.ts`、`src/stream.ts`、`src/indexer-lambda.ts`、`test/indexer.test.ts` | `test:unit` |
| 検索と不変条件 | `examples/27-search/src/search.ts`、`src/fusion.ts`、`test/search.test.ts` | `test:unit` |
| 最初から作り直す | `examples/27-search/src/reconcile.ts`、`scripts/reindex.ts`、`test/reconcile.test.ts` | `test:unit`、`search:reindex` |
| 引用つきで答える | `examples/27-search/src/prompt.ts`、`src/answer.ts`、`src/app.ts`、`src/contract.ts`、`src/owner.ts`、`test/answer.test.ts`、`test/app.test.ts` | `test:unit` |
| 手元で動かす | `examples/27-search/src/dev.ts`、`src/local.ts`、`src/compose.ts`、`src/env.ts`、`fixtures/`、`.env.example` | `dev:search` |
| スタック | `examples/27-search/infra/lib/search-stack.ts`、`infra/bin/app.ts`、`infra/test/search-stack.test.ts`、`src/lambda.ts`、`src/aws-parts.ts` | `search:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/27-search/scripts/seed.ts`、`scripts/smoke.ts`、`scripts/sign.ts`、`scripts/logs.ts` | `search:infra:diff`、`search:infra:deploy`、`search:seed`、`search:smoke`、`search:logs`、`search:infra:drift` |
| 料金 | `data/pricing/`、`tools/src/pricing/calc.ts` | `test:unit` |
| 片付け | `tools/src/infra/` | `search:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-13）

- S3 Vectors: [Working with S3 Vectors and vector buckets](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors.html)、[Limitations and restrictions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html)、[Regions, endpoints, and quotas](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-regions-quotas.html)、[Metadata filtering](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-metadata-filtering.html)、[Best practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-best-practices.html)、[Creating a vector index](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-create-index.html)、[Identity and Access management](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-access-management.html)
- S3 Vectors の API: [QueryVectors](https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_QueryVectors.html)、[PutVectors](https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_PutVectors.html)、[DeleteVectors](https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_DeleteVectors.html)
- CloudFormation: [AWS::S3Vectors::Index](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3vectors-index.html)、[AWS::S3Vectors::VectorBucket](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3vectors-vectorbucket.html)
- OpenSearch Serverless: [What is Amazon OpenSearch Serverless?](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-overview.html)、[Managing capacity limits](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-scaling.html)、[Collection group capacity limits](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/collection-groups-capacity-limits.html)、[Working with vector search collections](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-vector-search.html)、[Endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/opensearch-service.html)、[Amazon OpenSearch Service pricing](https://aws.amazon.com/opensearch-service/pricing/)、[AWS News Blog（2026-05-28）](https://aws.amazon.com/blogs/aws/introducing-the-next-generation-of-amazon-opensearch-serverless-for-building-your-agentic-ai-applications/)
- Bedrock Knowledge Bases: [概要](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html)、[Build a managed knowledge base](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-build-managed.html)、[Supported Regions](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-regions.html)、[Vector stores](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-setup.html)、[Data source connectors](https://docs.aws.amazon.com/bedrock/latest/userguide/data-source-connectors.html)、[Custom data source](https://docs.aws.amazon.com/bedrock/latest/userguide/custom-data-source-connector.html)、[Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
- 埋め込み: [Amazon Titan Text Embeddings models](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html)、[リクエストとレスポンス](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-titan-embed-text.html)、[Model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-titan-text-embeddings-v2.html)
- ストリーム: [Change data capture for DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)、[Using AWS Lambda with Amazon DynamoDB](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html)、[パラメーター](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-params.html)、[Partial batch response](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-batchfailurereporting.html)、[Event filtering](https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventfiltering.html)
- 料金: [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/)、[DynamoDB on-demand pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/)、AWS Price List bulk API の [S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json)、[OpenSearch Service](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonES/current/ap-northeast-1/index.json)、[Bedrock](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-northeast-1/index.json)。S3 の料金ページの計算例はバージニア北部の単価です。この章の単価は Price List の東京の行です
- Cloudflare: [Vectorize の料金](https://developers.cloudflare.com/vectorize/platform/pricing/)、[Vectorize の上限](https://developers.cloudflare.com/vectorize/platform/limits/)、[Vectorize のメタデータの絞り込み](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/)、[AI Search](https://developers.cloudflare.com/ai-search/)、[AI Search の上限と料金](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)
- Vercel: [Vercel Storage overview](https://vercel.com/docs/storage)
- 導入した配布物: [@aws-sdk/client-s3vectors 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-s3vectors/v/3.1149.0)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
