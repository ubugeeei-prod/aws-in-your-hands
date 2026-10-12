---
title: "32 Limits: 費用、注意点、片付け"
---

# 32 Limits: 費用、注意点、片付け

## 料金

<!-- section: 32.cost -->

このページでは、この章で足したものにいくらかかるかを見ます。金額は USD、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**誰も呼ばない月は、定価で 0.10、無料枠の適用後は 0 です。** かかるのはアラーム 1 つぶんで、参照するメトリクス 1 つにつき月 0.10 です。CloudWatch の無料枠（アラームのメトリクス 10 個ぶん）に入れば 0 になりますが、この枠はアカウント全体で共有します。

この章で足したほかの設定には、料金がかかりません。予約済み同時実行数は、ドキュメントに追加の料金はかからないとあります。予算は、Price List の単価が 0 で、料金ページにも監視と通知は無料とあります。ステージとルートのスロットリング、テーブルの request unit の上限、タグは設定であって、使用量ではありません。

API、Lambda、DynamoDB、ログの料金は、リクエスト 1 件あたりで 05章と同じです。金額は [05章の料金の節](/ja/chapters/05-dynamodb/wrap.md)にあります。上限に張り付いたときの計算も、入口が同じ毎秒 10 件なので、05章と [19章](/ja/chapters/19-observability/wrap.md)のものがそのまま当てはまります。違いは、ノートを作るルートが毎秒 2 件で止まることだけです。

費用を見ることにも、費用がかかります。`vp run limits:cost` は 1 回 0.01 で、毎日 1 回、30 日動かすと **0.30** です。ダッシュボードに組み込んで 1 分ごとに呼ぶと、同じ計算で月に 432 になります。Cost Explorer のデータの更新はそれほど頻繁ではないので、1 日 1 回で足ります。更新の頻度そのものは、この章では確かめていません。

スタックを消せば、アラームの料金は止まります。

## Workers や Vercel から来た人へ

<!-- section: 32.compare -->

Cloudflare と Vercel にも上限はあります。違うのは、数と、決まり方です。以下は 2026 年 10 月 12 日に公式ドキュメントで読んだ内容です。

| | Cloudflare Workers | Vercel | この章（AWS） |
| --- | --- | --- | --- |
| 上限の決まり方 | プランごと。Free は 1 日 10 万リクエストまでで、超えるとエラー 1027。Paid には 1 日の上限が無い | プランごと（Hobby、Pro、Enterprise） | サービスごと、アカウントごと、リージョンごとのクォータ |
| 毎秒のリクエスト数 | Workers 全般の上限は書かれていない | この章では確認していません | API Gateway が毎秒 10,000 件、Lambda の同時実行数が 1,000 |
| 引き上げ | 上限の引き上げを申請するフォームがある | Enterprise は担当者、Pro は営業、Hobby はプランの変更 | Service Quotas で申請。小さなものは自動で承認 |
| 自分で置くレート制限 | Rate Limiting binding。期間は 10 秒か 60 秒。Cloudflare の拠点ごとに数える | この章では確認していません | ステージのスロットリング、14章のレート制限、21章の WAF |
| 使いすぎの歯止め | この章では確認していません | Spend Management。決めた金額で通知、webhook、本番デプロイの一時停止 | 予算は通知だけ。止めるのは自分で置いた上限 |

Workers の limits のページに並んでいるのは、プランごとの値です。調べる場所が 1 つで済むので、この章の前半にあたる作業は、ほとんど要りません。Rate Limiting binding については、ドキュメントが正確な数え方ではないと断っています。許容の側に倒してあり、結果整合で、正確な会計の仕組みとして使うものではない、という説明です。拠点ごとに数えるので、同じキーでも拠点が違えば別の枠になります。API Gateway のスロットリングが best-effort なのと、同じ種類の割り切りです。

Vercel の Spend Management は、AWS の予算には無いことをします。決めた金額に達したら、本番のデプロイを止められます。ただし、ドキュメントには注意もあります。金額を設定しただけでは止まらず、一時停止を有効にする必要があります。使用量の確認は数分おきなので、止まるまでに数分ぶん超えることがあります。止まったプロジェクトは 503 を返し、再開は 1 つずつ手作業です。

AWS の予算にも、アクションを付けた予算という項目が料金ページにあります。何ができるかは、この章では読んでいません。

上限が少なく、プランの中で足りているなら、そのままそこにいるのが楽です。AWS で手に入るのは、上限をサービスごとに自分で決められることと、引き上げを頼めることです。その代わり、どこに何の上限があるかを自分で知っておくことになります。この章の表がその出発点です。

再試行、バックオフ、ジッター、予算の話は、どの基盤でも同じです。Worker から外部の API を呼ぶコードにも、[しくみと実装](/ja/chapters/32-limits/build.md)の `sendWithRetry` はそのまま使えます。使っているのは `fetch` と `Response` だけです。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `-c reservedConcurrency` を付けたデプロイが断られる | アカウントの同時実行数のクォータです。予約できるのは、クォータから 100 を引いた数までです。`vp run limits:quotas --service lambda` で値を見ます |
| 429 が返るが、どの制限かわからない | `retry-after` が付いていれば、呼び出し元ごとの制限です。付いていなければ、ステージのスロットリングの可能性が高いです。ただし、API Gateway が `Retry-After` を付けないことは確かめていません |
| `POST /notes` だけ、ほかより早く 429 になる | ルートごとのスロットリング（毎秒 2 件、バースト 4）です |
| 500 が返り、ログに `ProvisionedThroughputExceededException` や `ThrottlingException` がある | テーブルの上限です。SDK は 3 回試して諦めています。`TABLE_CAP` と流量を見直します |
| 再試行を入れたら、障害のときに悪化した | ジッターが無いか、予算が無いか、複数の層がそれぞれ再試行しています。再試行する層を 1 つに決めます |
| 関数がタイムアウトする | SDK の再試行の待ち時間が、関数のタイムアウトを超えていませんか。`AWS_NEW_RETRIES_2026` を設定すると、待ち時間の基準が 2 倍になります |
| `limits:cost` の結果が、すべて `(no tag)` | タグのキーが有効になっていません。有効にしてから反映まで、最大 24 時間かかります |
| `Cost allocation tags` の画面に `project` が出ない | タグを付けてから最大 24 時間かかります。Organizations のメンバーアカウントでは、この画面を操作できません |
| 予算の実績が 0 のまま | タグが有効になっていないか、フィルターのキーの書き方が違います。コンソールで予算のフィルターを確かめます |
| `limits:load` が `refusing to send load` で止まる | 仕様です。送り先は `http://localhost` だけです |

## 本番にするなら

- クォータを、流量の見込みから逆算して確かめます。[最初に当たる上限](/ja/chapters/32-limits/build.md)の計算に、自分のサービスの数字（1 件にかかる時間、1 件が使う unit）を入れます。足りなければ、必要になる前に引き上げを申請します
- 上限の数字を、自分のサービスのものに直します。毎秒 10 件、毎秒 2 件、テーブルの 150 と 40 は、練習用の歯止めです
- テーブルのスロットリングを、500 ではなく 503 で返します。05章のアプリは例外をすべて 500 にするので、呼び出し元は、待てば通るのかどうかを区別できません。スロットリングの例外を見分けて、`retry-after` を付けた 503 を返すように、アプリの側を変えます。この章ではアプリを変えていないので、実装していません
- 再試行する層を 1 つに決めます。ブラウザ、BFF、関数、SDK がそれぞれ 3 回ずつ試すと、いちばん下には 81 倍が届きます。この章の構成では、ブラウザのクライアントと SDK の 2 層があります
- 作成を冪等にします。`POST /notes` は、429 なら安全に送り直せますが、タイムアウトのあとは送り直せません。08章の冪等性の鍵（idempotency key）を呼び出し側が送り、サーバーがその値で条件付きの書き込みをすれば、タイムアウトのあとの再試行も安全になります
- クォータの使用率にアラームを付けます。Service Quotas には、使用量を見張って通知する機能があります。この章では設定していません
- タグの決まりをアカウント全体でそろえます。キーの綴りが `project` と `Project` に分かれると、集計も分かれます
- 実環境の負荷試験は、本番とは別のアカウントで行います。クォータはアカウントごとなので、試験が本番の枠を使い切ることがなくなります。ただし、別のアカウントのクォータは、本番と同じ値とは限りません
- 反映の経路を AWS CDK CLI と CloudFormation にします。理由は 02章に書いたとおりです

## 片付け

<!-- section: 32.cleanup -->

```bash
vp run limits:infra:destroy
```

テーブル、関数、API、ロググループ、アラーム、予算が消えます。ノートもログも一緒に消えます。

スタックと一緒に消えないものが 1 つあります。コスト配分タグの有効化です。有効にしたのはアカウントの設定で、スタックのリソースではありません。要らなければ、有効にしたのと同じ画面で無効に戻します。引き上げを申請したクォータがあれば、その値もスタックとは関係なく残ります。

ほかに残るのは、cdkd の bootstrap で作った保存場所（02章）だけです。

## 分散システムとして見ると

上限は、分散システムの部品どうしが、互いを壊さないために交わす約束です。

- 状態の持ち主: 何件通したかを数えているのは、断る側です。ステージのバケットは API Gateway が、同時実行数は Lambda が、テーブルの unit は DynamoDB が持っています。呼び出す側は、断られてはじめて、上限に当たったことを知ります
- 不変条件（invariant）: 再試行は、相手に届くリクエストを、最初の試行の定数倍より多くしない。予算があれば、失敗が続くあいだの再試行は、予算の容量ぶんで止まります
- 不変条件を壊そうとするテスト: サービスが 3 秒間すべてを断る場面で、予算なしでは 2.9 倍を超え、予算ありでは最初の試行に 100 件を足した数で止まることを確かめています
- 重複: 429 のあとの再試行は重複を作りません。タイムアウトや 5xx のあとの再試行は作りえます。この章のクライアントは、繰り返せないメソッドを 5xx で送り直しません
- 数え方の正確さ: API Gateway のスロットリングは best-effort で、設定した値を超えて通ることがあります。上限は、それより少し上まで耐えられる前提で決めます
- 時間: 予算もバケットも、時刻で回復します。時計が戻っても壊れないことを、バケットのテストで確かめています

::: details この章の検証メモ

**手元で確かめたこと。** トークンバケット、バックオフとジッター、再試行の予算、再試行するクライアント、2 つのシミュレーション、開発サーバーの 2 つの制限、最初に当たる上限の計算、負荷の送り先の検査と集計、Cost Explorer の応答の読み取り、スタックのアサーション（12 ファイル、91 件）。導入済みの SDK が、スロットリングの応答に対して 3 回試行すること（偽の `requestHandler` に対して）。型検査。synth（esbuild のバンドル込み）。`vp run limits:simulate` の出力。`dev:limits` を起動して `limits:load` を 2 通りの設定で実行（本文の表はその出力で、ポート番号だけ書き直しています）。`limits:load` が `https://example.com` を断ること。`limits:cost:print` と `limits:quotas:book` の出力。AWS CLI 2.35.11 の `service-quotas list-service-quotas` と `ce get-cost-and-usage` のヘルプで、スクリプトが使う引数の名前。

**まだ確かめていないこと。** `limits:infra:deploy`、`limits:quotas`、`limits:cost`、`limits:infra:drift`、`limits:infra:destroy` は、実際の AWS では動かしていません。とくに次の点は、ドキュメントとソースから読み取っただけです。

- API Gateway の HTTP API が返す 429 のボディと、`Retry-After` ヘッダーの有無。手元の代役は `{"message":"Too Many Requests"}` を返し、ヘッダーを付けません
- ルートごとのスロットリング（`RouteSettings` の `POST /notes`）と `DependsOn` を、cdkd 0.296.28 が反映すること。ルートより先にステージを作ると失敗する、という前提も確かめていません
- Lambda が関数を断ったときに、HTTP API が呼び出し元へ返すステータス
- 本物の DynamoDB がテーブルの上限でスロットリングしたときの例外の名前と、SDK の再試行の様子。テストの偽物は `ProvisionedThroughputExceededException` を返しますが、オンデマンドのテーブルの上限では `ThrottlingException` が返る、とドキュメントにあります。どちらも SDK はスロットリングとして扱います
- タグで絞った予算。cdkd が作れること、キーを `project` と書くのか `user:project` と書くのか、有効化の前に作った予算が後から数え始めること
- このスタックの料金のうち、どれが `project` のタグを運ぶか
- 新しいアカウントの同時実行数が、実際にいくつから始まるか
- 引き上げの申請にかかる時間
- AWS の外から自分の API に負荷をかける試験に、申請や閾値があるかどうか。2 つのポリシーのページからは読み取れませんでした
- 429 で断られたリクエストに、API Gateway の料金がかかるかどうか
- Cost Explorer のデータが更新される頻度
- Amazon Builders' Library の記事、Cloudflare の limits のページは、ページの要約を通して読みました。本文の「利己的」「243 倍」「1027」は、その要約にあった内容です。Architecture Blog のジッターの記事は、式が画像の中にあり、読めていません。本文の式は SDK のリファレンスと導入済みのパッケージのものです

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/32-limits/infra/lib/limits-stack.ts` | `limits:infra:synth` |
| クォータ | `examples/32-limits/src/quotas.ts`、`test/quotas.test.ts`、`scripts/quotas.ts` | `test:unit`、`limits:quotas:book`、`limits:quotas` |
| 断る側の数え方 | `examples/32-limits/src/token-bucket.ts`、`src/throttle.ts`、`test/token-bucket.test.ts`、`test/throttle.test.ts` | `test:unit` |
| 断られた側の待ち方 | `examples/32-limits/src/retry.ts`、`src/backoff.ts`、`test/retry.test.ts`、`test/backoff.test.ts` | `test:unit` |
| 再試行が障害を大きくする | `examples/32-limits/src/simulation.ts`、`src/random.ts`、`src/retry-budget.ts`、`test/simulation.test.ts`、`test/retry-budget.test.ts`、`scripts/simulate.ts` | `test:unit`、`limits:simulate` |
| SDK の再試行 | `examples/32-limits/src/sdk-retry.ts`、`src/compose.ts`、`test/sdk-retry.test.ts` | `test:unit` |
| 自分で置く歯止め | `examples/32-limits/infra/lib/limits-stack.ts`、`infra/test/limits-stack.test.ts`、`src/lambda.ts` | `test:unit`、`limits:infra:synth` |
| 最初に当たる上限 | `examples/32-limits/src/ceilings.ts`、`test/ceilings.test.ts` | `test:unit` |
| 手元で動かす | `examples/32-limits/src/dev.ts`、`src/throttle.ts`、`.env.example` | `dev:limits`、`test:unit` |
| 手元で負荷をかける | `examples/32-limits/src/load.ts`、`test/load.test.ts`、`scripts/load.ts` | `limits:load`、`test:unit` |
| デプロイして確かめる | `examples/32-limits/infra/bin/app.ts`、`scripts/quotas.ts` | `limits:infra:diff`、`limits:infra:deploy`、`limits:quotas`、`limits:infra:drift` |
| 費用をタグで分ける | `examples/32-limits/src/cost.ts`、`test/cost.test.ts`、`scripts/cost.ts` | `test:unit`、`limits:cost:print`、`limits:cost` |
| 片付け | `tools/src/infra/` | `limits:infra:destroy` |

**cdkd（0.296.28）での扱い。** `src/provisioning/register-providers.ts` に専用の実装があるもの: `AWS::ApiGatewayV2::Api`、`AWS::ApiGatewayV2::Integration`、`AWS::ApiGatewayV2::Route`、`AWS::ApiGatewayV2::Stage`、`AWS::Budgets::Budget`、`AWS::CloudWatch::Alarm`、`AWS::DynamoDB::Table`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup`。このスタックに、Cloud Control API 経由になる種類はありません。

**一次情報**（確認日は、とくに書いていなければ 2026-10-12）

- [What is Service Quotas?](https://docs.aws.amazon.com/servicequotas/latest/userguide/intro.html)、[Requesting a quota increase](https://docs.aws.amazon.com/servicequotas/latest/userguide/request-quota-increase.html)
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)、[Configuring reserved concurrency for a function](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)、[Lambda scaling behavior](https://docs.aws.amazon.com/lambda/latest/dg/scaling-behavior.html)
- [Throttle requests to your HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html)、[Quotas for configuring and running an HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)、[Amazon API Gateway quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html)、[Usage plans and API keys for REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html)
- [Quotas in Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html)、[Error handling with DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html)
- [Retry behavior](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html)（AWS SDKs and Tools Reference Guide）、[@smithy/util-retry 4.6.2](https://www.npmjs.com/package/@smithy/util-retry/v/4.6.2)（導入済みのパッケージの `@smithy/core/dist-es/submodules/retry` と、`@aws-sdk/client-dynamodb` の `runtimeConfig.js` を読みました。2026-10-13）
- [Timeouts, retries, and backoff with jitter](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter)（Amazon Builders' Library）、[Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [Amazon EC2 Testing Policy](https://aws.amazon.com/ec2/testing/)、[AWS Customer Support Policy for Penetration Testing](https://aws.amazon.com/security/penetration-testing/)
- [Organizing and tracking costs using AWS cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html)、[Activating user-defined cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/activating-tags.html)、[Using user-defined cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/custom-tags.html)（最後の 1 つは 2026-10-13）
- [GetCostAndUsage](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html)、[AWS Cost Explorer pricing](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/)、[AWS Budgets pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/)、[AWS::Budgets::Budget BudgetData](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-budgets-budget-budgetdata.html)（最後の 1 つは 2026-10-13）
- AWS Price List bulk API: [Cost Explorer](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSCostExplorer/current/index.json)、[Budgets](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSBudgets/current/index.json)（2026-10-13）
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)（2026-10-13）
- [Cloudflare Workers: Limits](https://developers.cloudflare.com/workers/platform/limits/)、[Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Vercel: Limits](https://vercel.com/docs/limits)、[Spend Management](https://vercel.com/docs/spend-management)

:::
