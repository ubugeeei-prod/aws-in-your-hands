---
title: "17 AI: 費用、注意点、片付け"
---

# 17 AI: 費用、注意点、片付け

[デプロイ](/ja/chapters/17-ai/deploy.md)まで終えたところで、Workers AI との違いと料金を整理し、作ったものを片付けます。

## Workers AI から来た人へ

<!-- section: 17.workers-ai -->

Workers AI と違うところを表にまとめます。Cloudflare 側は、公式ドキュメントで確かめた範囲の内容です。

| | Cloudflare Workers AI | この章（Bedrock） |
| --- | --- | --- |
| 呼び方 | binding。設定に書くと `env.AI` に現れるので、`env.AI.run(model, options)` を呼ぶ | AWS SDK のクライアント。`ConverseCommand` か `ConverseStreamCommand` を送る |
| 権限 | binding を宣言した Worker が呼べる | IAM。実行ロールに、モデルと inference profile の ARN を書く |
| モデルの指定 | `@cf/meta/llama-3.1-8b-instruct` のような名前 | モデル ID か inference profile の ID。リージョンと経路によって、使えるものが変わる |
| 動く場所 | Cloudflare のネットワーク | profile が決めるリージョンのどれか |
| ストリーミング | `stream: true` を渡すと `text/event-stream` で返る。そのままレスポンスにできる | イベントの列が SDK の async iterable で返る。SSE にするのは自分のコード |
| 課金の単位 | Neurons。1 日 10,000 まで無料、超えた分は 1,000 Neurons あたり USD 0.011。モデルごとのトークン単価も載っている | モデルとリージョンごとの、入力と出力のトークン単価 |
| 手元の開発 | 模擬はない。常に remote で動いて、課金される | 模擬はない。常に remote で動いて、課金される |

始めるまでの手順は、Workers AI のほうが短く済みます。binding を 1 行書けば、権限もモデルの置き場所も考えずに呼べますし、ストリーミングも、返ってきたものをそのまま `Response` に渡せば終わります。

Bedrock では、どの ARN を許すか、どのリージョンで処理されるか、ストリームをどういう形で外に出すかを、すべて自分で決めます。手間は増えますが、「この関数はこのモデルしか呼べない」「推論は日本の中で処理される」といったことを、設定として書けます。どちらが合うかは、作るものと、守らなければならない決まりによります。

表の最後の行だけは同じです。どちらも、API を手元で動かしていても、推論はサービスの側で動いて課金されます。

## 料金

金額は USD、東京リージョン、従量課金、税別です。計算の詳細は[料金の計算](/ja/reference/pricing.md)にあります。

**誰も呼ばない月の料金は 0 です。** function URL にも Lambda にも、置いてあるだけでかかる料金はありません。Bedrock の従量課金は、呼び出したトークンの分だけです。ログは 7 日で消えます。

呼ばれたときの料金を、月 1,000 件の要約、1 件あたり入力 2,000 トークン、出力 150 トークンという仮定で計算します。トークン数は仮定なので、あなたのノートでの実際の値は、ログの `summary` 行の `usage` で確かめてください。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| Nova 2 Lite の入力 | 200 万トークン | 0.79 | 0.79（無料枠は確認できず、引いていない） |
| Nova 2 Lite の出力 | 15 万トークン | 0.50 | 0.50（同上） |
| Lambda のリクエスト | 1,000 件 | 0.00 | 0 |
| Lambda の実行時間 | 1,000 GB 秒 | 0.01 | 0 |
| CloudWatch Logs の取り込み | 0.001 GB | 0.00 | 0 |
| 小計 | | **1.30** | **1.29** |

Nova 2 Lite の単価は、入力 1,000 トークンあたり USD 0.000396、出力 1,000 トークンあたり USD 0.003311 です（AWS Price List、2026-10-11 確認）。出力の単価は入力の 8 倍以上なので、`maxTokens` を決めておくことに意味があります。

Lambda の実行時間は、1 件あたり平均 4 秒と仮定しました。推論を待っている間も関数は動いていて、課金されます。レスポンスをインターネットへ送るデータ転送の料金は、この表に入れていません。0 という意味ではなく、未算入です。

上限も計算できます。出力は 1 件あたり最大 400 トークンなので、1,000 件すべてが上限まで書いたとしても、出力の料金は USD 1.32 です。入力は文字数でしか抑えていないので、同じようには言い切れません。

**権限を持ったスクリプトがループに入った場合。** この URL を呼べるのは署名できる相手だけで、知らない人は、Lambda が関数の手前で断ります。心配しなければならないのは、自分の側の暴走です。

1 回の呼び出しの最悪の料金は、計算できます。出力は 400 トークンまでなので、Nova 2 Lite で USD 0.0013（400 × 0.003311 ÷ 1,000）です。関数は 40 秒で止まるので、Lambda は USD 0.00013 です。入力は 10,000 文字までですが、1 文字がいくらになるかは、この本ではわかりません。

回数には、既定では上限がありません。あるのはアカウントの Bedrock のクォータだけで、その値は確かめていません。`-c reservedConcurrency=2` を付けると、同時に動くのは 2 件になります。これで言い切れるようになるのは Lambda の実行時間の料金で、2 件が 30 日動き続けても USD 17.28 です。

推論の料金は、言い切れません。同時 2 件で、1 件が 4 秒（上の表の仮定）なら、30 日で 129.6 万件になります。全部が上限まで書けば、出力だけで USD 1,716.42 です。入力が 2,000 トークンずつなら、さらに USD 1,026.43 かかります。予約済み同時実行数は同時に動く件数の歯止めで、予算ではありません。回数を止めるには、「本番にするなら」に書いた、利用者ごとの上限が必要です。

モデルを替えると、単価が変わります。同じトークン数を Claude Haiku 4.5（東京、入力 100 万トークンあたり USD 1.10、出力 USD 5.50）で計算すると、推論の分だけで USD 3.03 になり、Nova 2 Lite の 2 倍以上です。ただし、トークンの数え方はモデルごとに違うので、同じ文章が同じトークン数になるわけではありません。単価の比較として見てください。

確かめられなかったこともあります。Bedrock に無料枠があるかどうかと、途中で中止した呼び出しに、どこまでのトークンが課金されるかです。どちらも一次情報で確認できていないので、不明としています。

スタックを消せば、この章の分の料金は止まります。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `dev:ai` が `Invalid environment` で止まる | `examples/17-ai/.env` があるかを確認します。`AI_BACKEND` に既定値はありません |
| `ai:hello` が `AccessDeniedException` | モデルが有効になっていないか、あなたの権限が足りません。Marketplace 経由のモデルは、最初の呼び出しから最大 15 分かかることがあります。Anthropic のモデルは、用途のフォームの提出が先です |
| `ai:hello` が `ValidationException` や `ResourceNotFoundException` | `BEDROCK_MODEL_ID` を確認します。東京から呼べない ID を渡しているか、inference profile が必須のモデルに素のモデル ID を渡している可能性があります |
| function URL が 403 | 署名がないか、呼んでいる人に `lambda:InvokeFunctionUrl` と `lambda:InvokeFunction` がありません |
| API が 500 で `code` が `misconfigured` | 実行ロールがそのモデルを呼べません。`BEDROCK_MODEL_ID` と、`infra/lib/models.ts` の行き先が合っているかを確認します。ログは `vp run ai:logs` で見られます |
| API が 429 で `code` が `throttled` | アカウントのクォータを超えました。Service Quotas で、そのモデルの上限を確認します |
| 最後のイベントが `error` で `interrupted` | ストリームが途中で切れました。`retryable` が `true` なら、同じリクエストをもう一度送れます |
| レスポンスが最後にまとめて届く | URL の `InvokeMode` が `RESPONSE_STREAM` かを確認します。間にプロキシを置いているなら、プロキシが溜めていないかも確認します。`ai:smoke` が表示する時刻が手がかりになります |

## 本番にするなら

- ブラウザから呼べるようにするには、function URL の前に CloudFront を置き、origin access control で CloudFront に署名させる方法が、公式ドキュメントにあります。URL の認証は `AWS_IAM` のままです。ただし、それだけでは CloudFront の URL を知っている人なら誰でも呼べるので、アプリの中で 06章のアクセストークンを確かめる処理が必要です。POST のときは、本文の SHA-256 を `x-amz-content-sha256` ヘッダーで送る必要がある、とも書かれています。この章ではどれも作っていません
- 利用者ごとの上限を作ります。いまある上限は、1 回あたりの上限と、指定すれば付く同時実行数の上限だけです。同じ人が 1 万回呼べば、1 万回分を払うことになります。回数に上限を付けるには、利用者を区別できる認証と、回数を数える場所が必要です。利用者ごとの 1 日の予算は、[36章](/ja/chapters/36-bedrock.md)で作ります
- アカウントのクォータを確かめます。推論には、モデルごとにトークン使用量の上限があります。ドキュメントによると、アカウントに実際に適用される値は、公開されている既定値より低いことがあります。Service Quotas で自分の値を見てください（この章では値を確かめていません）
- 予算の通知を付けます。01章の Budgets です。通知は支出を止めません。支出を止めるのは、上に挙げた上限です
- データの行き先を決めます。`jp.` の profile は日本の中、`global.` は世界中で処理されます。データを処理してよい場所を、モデルを選ぶ前に決めておきます
- モデルの終了日を追います。モデルカードには、モデルごとに終了の目安が載っています。たとえば Claude Haiku 4.5 は「2026-10-16 より前には終了しない」とされています。2026-10-13 に[モデルカード](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html)を読み直した時点では、状態は Active で、終了日は決まっていません。同じ日に読んだ [Claude Haiku 5.5 のモデルカード](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html)には、東京から呼べる `jp.anthropic.claude-haiku-5-5`（行き先は東京と大阪）があり、「2027-10-07 より前には終了しない」とあります。この profile は、まだ一覧に入れていません。[36章](/ja/chapters/36-bedrock.md)がモデルごとの単価と制限の表を同じ一覧に合わせて持っていて、両方を一緒に直す必要があるからです。一覧は見直しが要る状態です。モデル ID を環境変数にしてあるのは、いずれ替える日が来るからです
- 反映の経路を AWS CDK CLI と CloudFormation にします。02章で説明したとおりです

## 片付け

<!-- section: 17.cleanup -->

```bash
vp run ai:infra:destroy
```

関数、function URL、ロール、ロググループが消え、ログも一緒に消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルです。Bedrock の側には、この章が作ったリソースはありません。ただし、Marketplace 経由のモデルを一度でも呼んだ場合、そのサブスクリプションはアカウントに残ります。呼ばなければ料金はかかりませんが、消えたわけではありません。

::: details この章の検証メモ

**手元で確かめたこと。** 中継、アプリ、クライアント、インフラのユニットテスト（59 件）、型検査、synth（esbuild のバンドル込み、5 リソース）を実行しました。`dev:ai` を `AI_BACKEND=fixture` で起動し、本文の `curl` も実行しています。途中で切断したときに `cancelled` のログが出ることと、`AI_FIXTURE=truncated` で `error` イベントで終わることも確認しました。npm の配布物では、次の 2 点を確かめました。固定した版の `@types/aws-lambda`（8.10.164）が `awslambda.streamifyResponse` と `HttpResponseStream.from` を宣言していること。固定した版の cdkd（0.296.28）が、このスタックの 5 種類のリソース（`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Url`、`AWS::Logs::LogGroup`）すべてに専用の実装を持ち、`AWS::Lambda::Url` の `InvokeMode` と `AuthType` を扱うこと。

**まだ確かめていないこと。** この章は、実際の Bedrock を一度も呼んでいません。AWS へのデプロイもしていません。`ai:hello`、`ai:test:live`、`AI_BACKEND=bedrock` での `dev:ai`、`ai:infra:deploy`、`ai:smoke`、`ai:logs`、`ai:infra:drift`、`ai:infra:destroy` は未実行です。とくに次の点は、実環境での確認を待っています。

- モデル ID（`jp.amazon.nova-2-lite-v1:0` など）が東京から実際に呼べること。モデルカードで読んだだけです
- 実際の `ConverseStream` のイベントが、この章のスキーマとフィクスチャの形に合うこと。フィクスチャは公式ドキュメントから手で書いたもので、実際の推論から採取したものではありません
- この章のアダプター（`streamFunctionUrl`）のレスポンスが、Node.js 24 の Lambda と function URL を通して、少しずつ届くこと。`awslambda` の代わりのオブジェクトでテストしただけです。`HttpResponseStream.from` に渡すキーの名前（`statusCode`、`headers`、`cookies`）と、本文のないレスポンスで空の書き込みをすることは、Lambda のドキュメントでは確認できず、hono 4.13.13 の Lambda 用アダプターのソースに合わせました
- 署名なしのリクエストに function URL が 403 を返すこと
- inference profile に絞った IAM ポリシー（`bedrock:InferenceProfileArn` の条件つき）で `ConverseStream` が通ること
- Lambda の上で、呼び出し元が切断したあとの関数とモデルの振る舞い。ドキュメントを読んだ結論で、観察はしていません。切断でレスポンスストリームへの書き込みが失敗するかどうかも未確認です
- 途中で中止した呼び出しの課金、Bedrock の無料枠、東京リージョンでのクォータの既定値
- `-c reservedConcurrency=N` を付けたデプロイが通ること、上限を超えた呼び出しに function URL が返すレスポンス。確かめたのは、テンプレートに値が入ることと、cdkd 0.296.28 のソースがそれを Lambda の API に渡していることだけです

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/17-ai/infra/lib/ai-stack.ts` | |
| 数行でモデルを呼ぶ | `examples/17-ai/scripts/hello.ts`、`src/converse-stream.ts` | `ai:hello` |
| モデルを選ぶ | `examples/17-ai/infra/lib/models.ts`、`infra/bin/app.ts` | `test:unit` |
| 入力の上限と、返すイベントの形 | `examples/17-ai/src/contract.ts`、`src/prompt.ts` | `test:unit` |
| ストリームを読む | `examples/17-ai/src/converse-stream.ts`、`src/summarize.ts`、`src/bedrock.ts` | `test:unit` |
| 止める、待つ、やり直す | `examples/17-ai/src/failure.ts`、`src/summarize.ts`、`test/failure.test.ts` | `test:unit` |
| API にする | `examples/17-ai/src/app.ts`、`src/sse.ts`、`src/compose.ts`、`src/env.ts` | `test:unit` |
| 手元で動かす | `examples/17-ai/src/dev.ts`、`src/fixture-gateway.ts`、`src/fixtures.ts`、`fixtures/converse-stream/`、`.env.example` | `dev:ai` |
| テスト | `examples/17-ai/test/`、`infra/test/ai-stack.test.ts`、`scripts/live.ts` | `test:unit`、`ai:test:live` |
| 途中で切れたとき | `examples/17-ai/src/client.ts`、`test/client.test.ts` | `test:unit` |
| AWS にのせる準備 | `examples/17-ai/infra/lib/ai-stack.ts`、`src/lambda.ts`、`src/function-url.ts`、`test/function-url.test.ts`、`infra/test/ai-stack.test.ts`、`cdk.json` | `ai:infra:synth`、`test:unit` |
| デプロイして呼ぶ | `examples/17-ai/scripts/smoke.ts`、`scripts/sign.ts`、`scripts/logs.ts`、`tools/src/infra/` | `ai:infra:diff`、`ai:infra:deploy`、`ai:smoke`、`ai:logs`、`ai:infra:drift` |
| 片付け | `tools/src/infra/` | `ai:infra:destroy` |
| 料金 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-11）

- [Inference using Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)、[ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html)、[MessageStopEvent](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_MessageStopEvent.html)
- [Request access to models](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)
- [Cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html)、[Supported Regions and models for inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html)、[Prerequisites for inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html)
- Model card: [Nova 2 Lite](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html)、[Claude Haiku 4.5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html)
- [Troubleshooting Amazon Bedrock API Error Codes](https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes.html)、[Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html)
- [Response streaming for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html)、[Writing response streaming-enabled Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-write-functions.html)、[Control access to Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)
- [Stream the integration response for your proxy integrations in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html)
- [Restrict access to an AWS Lambda function URL origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- AWS Price List bulk API: [Bedrock](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-northeast-1/index.json)、[Bedrock の Marketplace 経由のモデル](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/ap-northeast-1/index.json)。Price List には `jp.` の profile 専用の行がなく、global 用の行と、何も付かない行の 2 つがあります。この章は、「料金は呼び出したリージョンのもの」というユーザーガイドの記述に従って、何も付かない行を `jp.` の profile に当てはめています
- Cloudflare Workers AI: [Get started](https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/)、[Bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/)、[Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)、[Supported bindings per development mode](https://developers.cloudflare.com/workers/development-testing/bindings-per-env/)
- [@types/aws-lambda 8.10.164](https://www.npmjs.com/package/@types/aws-lambda/v/8.10.164)、[hono 4.13.13](https://www.npmjs.com/package/hono/v/4.13.13)（この章のコードは使っていない。Lambda 用アダプターのソースだけを読んだ）、[@aws-sdk/client-bedrock-runtime 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-bedrock-runtime/v/3.1149.0)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（いずれも導入した配布物の型定義とソースを読んだ）

:::
