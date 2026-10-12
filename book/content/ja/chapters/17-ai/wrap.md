---
title: "17 AI: 費用、注意点、片付け"
---

# 17 AI: 費用、注意点、片付け

## Workers AI から来た人へ

<!-- section: 17.workers-ai -->

違うところを並べます。Cloudflare 側は、公式ドキュメントで確かめた範囲です。

| | Cloudflare Workers AI | この章（Bedrock） |
| --- | --- | --- |
| 呼び方 | binding。設定に書くと `env.AI` に現れて、`env.AI.run(model, options)` | AWS SDK の client。`ConverseCommand` か `ConverseStreamCommand` を送る |
| 権限 | binding を宣言した Worker が呼べる | IAM。実行 role に、モデルと inference profile の ARN を書く |
| モデルの指定 | `@cf/meta/llama-3.1-8b-instruct` のような名前 | モデル ID か inference profile の ID。リージョンと経路で使えるものが変わる |
| 動く場所 | Cloudflare のネットワーク | profile が決めるリージョンのどれか |
| streaming | `stream: true` を渡すと `text/event-stream` で返る。そのまま応答にできる | イベントの列が SDK の async iterable で返る。SSE にするのは自分 |
| 課金の単位 | Neurons。1 日 10,000 まで無料、超えた分は 1,000 Neurons あたり USD 0.011。モデルごとの token 単価も載っている | モデルとリージョンごとの、入力と出力の token 単価 |
| 手元の開発 | 模擬はない。常に remote で動いて、課金される | 模擬はない。常に remote で動いて、課金される |

Workers AI のほうが、始めるまでが短いです。binding を 1 行書けば、権限もモデルの置き場所も考えずに呼べます。streaming も、返ってきたものをそのまま `Response` に渡せば終わりです。

Bedrock は、そこを全部自分で決めます。どの ARN を許すか、どのリージョンで処理されるか、stream をどういう形で外に出すか。手間は増えますが、「この関数はこのモデルしか呼べない」「推論は日本の中で処理される」を、設定として書けます。どちらがいいかは、作るものと、守らないといけない決まり次第です。

最後の行は同じでした。どちらも、手元で API を動かしていても、推論は向こうで動いて課金されます。

## お金の話

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**誰も呼ばない月は 0 です。** function URL にも Lambda にも、置いてあるだけでかかる料金はありません。Bedrock の従量課金は、呼んだ token のぶんだけです。log は 7 日で消えます。

呼ばれると、こうなります。月 1,000 件の要約で、1 件あたり入力 2,000 token、出力 150 token という仮定です。token 数は仮定で、あなたのノートでの実際の値は、log の `summary` 行の `usage` でわかります。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| Nova 2 Lite の入力 | 200 万 token | 0.79 | 0.79（無料枠は確認できず、引いていない） |
| Nova 2 Lite の出力 | 15 万 token | 0.50 | 0.50（同上） |
| Lambda のリクエスト | 1,000 件 | 0.00 | 0 |
| Lambda の実行時間 | 1,000 GB 秒 | 0.01 | 0 |
| CloudWatch Logs の取り込み | 0.001 GB | 0.00 | 0 |
| 小計 | | **1.30** | **1.29** |

単価は、Nova 2 Lite が入力 1,000 token あたり USD 0.000396、出力 1,000 token あたり USD 0.003311 です（AWS Price List、2026-10-11 確認）。出力は入力の 8 倍以上します。`maxTokens` を決める意味が、ここにあります。

Lambda の実行時間は、1 件あたり平均 4 秒と仮定しました。推論を待っている間も、関数は動いていて課金されます。応答をインターネットへ送るデータ転送の料金は、この表に入れていません（0 という意味ではなく、未算入です）。

上限の話もしておきます。出力は 1 件あたり最大 400 token なので、1,000 件すべてが上限まで書いたとしても、出力のぶんは USD 1.32 です。入力のほうは、さっき書いたとおり文字数でしか抑えていないので、こういう言い切りはできません。

**権限を持った script が loop に入ったら。** この URL を呼べるのは、署名できる相手だけです。知らない人は、Lambda が関数の手前で断ります。心配するのは、自分の側の暴走です。

1 回の呼び出しの最悪は、言えます。出力は 400 token までなので、Nova 2 Lite で USD 0.0013（400 × 0.003311 ÷ 1,000）。関数は 40 秒で止まるので、Lambda は USD 0.00013。入力は 10,000 文字までですが、1 文字がいくらになるかは、この本ではわかりません。

回数のほうには、既定では上限がありません。あるのはアカウントの Bedrock の quota だけで、その値は確かめていません。`-c reservedConcurrency=2` を付けると、同時に動くのが 2 件になります。これで言い切れるのは Lambda の実行時間で、2 件が 30 日動き続けても USD 17.28 です。

推論のほうは、言い切れません。同時 2 件で、1 件が 4 秒（上の表の仮定）なら、30 日で 129.6 万件。全部が上限まで書けば、出力だけで USD 1,716.42 です。入力が 2,000 token ずつなら、さらに USD 1,026.43。reserved concurrency は「同時に何件」の歯止めで、予算ではありません。回数を止めるには、「本番にするなら」に書いた、利用者ごとの上限が要ります。

モデルを替えると、単価が変わります。同じ token 数を Claude Haiku 4.5（東京、入力 100 万 token あたり USD 1.10、出力 USD 5.50）で計算すると、推論のぶんだけで USD 3.03。Nova 2 Lite の 2 倍以上です。ただし token の数え方はモデルごとに違うので、同じ文章が同じ token 数になるわけではありません。単価の比較として見てください。

確かめられなかったこともあります。Bedrock に無料枠があるか。途中で中止した呼び出しに、どこまでの token が課金されるか。どちらも一次情報で確認できていないので、不明としておきます。

stack を消せば、この章のぶんの料金は止まります。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:ai` が `Invalid environment` で止まる | `examples/17-ai/.env` はありますか。`AI_BACKEND` に既定値はありません |
| `ai:hello` が `AccessDeniedException` | モデルが有効になっていないか、あなたの権限が足りません。Marketplace 経由のモデルは、最初の呼び出しから最大 15 分かかることがあります。Anthropic のモデルは、用途のフォームが先です |
| `ai:hello` が `ValidationException` や `ResourceNotFoundException` | `BEDROCK_MODEL_ID` を確認。東京から呼べない ID や、inference profile が必須のモデルに素のモデル ID を渡していませんか |
| function URL が 403 | 署名がないか、呼んでいる人に `lambda:InvokeFunctionUrl` と `lambda:InvokeFunction` がありません |
| API が 500 で `code` が `misconfigured` | 実行 role がそのモデルを呼べません。`BEDROCK_MODEL_ID` と `infra/lib/models.ts` の行き先が合っているか。`vp run ai:logs` |
| API が 429 で `code` が `throttled` | アカウントの quota を超えました。Service Quotas で、そのモデルの上限を確認 |
| 最後のイベントが `error` で `interrupted` | stream が途中で切れました。`retryable` が `true` なら、同じリクエストをもう一度送れます |
| 応答が最後にまとめて届く | URL の `InvokeMode` が `RESPONSE_STREAM` か。間に proxy を置いていたら、それが溜めていないか。`ai:smoke` の時刻を見る |

## 本番にするなら

- **ブラウザから呼べるようにする。** function URL の前に CloudFront を置いて、origin access control で CloudFront に署名させる方法が、公式ドキュメントにあります。URL は `AWS_IAM` のままです。ただ、それだけだと CloudFront の URL を知っている人が誰でも呼べるので、アプリの中で 06章の access token を確かめる処理が要ります。POST のときは、本文の SHA-256 を `x-amz-content-sha256` ヘッダーで送る必要がある、とも書かれています。この章ではどれも作っていません
- **利用者ごとの上限を作る。** いまの上限は「1 回あたり」と、頼めば付く「同時に何件」だけです。同じ人が 1 万回呼べば、1 万回ぶん払います。回数の上限には、利用者を区別できる認証と、数える場所が要ります
- **アカウントの quota を確かめる。** 推論には、モデルごとに token の使用量の上限があります。ドキュメントによると、アカウントに実際に適用される値は、公開されている既定値より低いことがあります。Service Quotas で自分の値を見てください（この章では値を確かめていません）
- **予算の通知を付ける。** 01章の Budgets です。通知は支出を止めません。止めるのは、上に書いた上限のほうです
- **データの行き先を決める。** `jp.` の profile は日本の中、`global.` は世界中です。どこで処理してよいデータなのかを、モデルを選ぶ前に決めます
- **モデルの終了日を追う。** model card には、モデルごとに終了の目安が載っています。たとえば Claude Haiku 4.5 は「2026-10-16 より前には終了しない」。モデル ID を環境変数にしてあるのは、いずれ替える日が来るからです
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです

## 片付け

<!-- section: 17.cleanup -->

```bash
vp run ai:infra:destroy
```

関数、function URL、role、log group が消えます。log も一緒です。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルです。Bedrock の側に、この章が作ったリソースはありません。ただ、Marketplace 経由のモデルを一度呼んだなら、その subscription はアカウントに残ります。呼ばなければ料金はかかりませんが、「消えた」わけではないので、覚えておいてください。

::: details この章の検証メモ

**手元で確かめたこと。** 中継、アプリ、client、インフラのユニットテスト（51 件）。型検査。synth（esbuild の bundle 込み、5 リソース）。`dev:ai` を `AI_BACKEND=fixture` で起動して、本文の `curl` を実行。途中で切断したときに `cancelled` の log が出ること、`AI_FIXTURE=truncated` で `error` イベントで終わることも確認しました。固定した版の hono に `streamHandle` があること、固定した版の cdkd（0.296.28）が、この stack の 5 種類のリソース（`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Url`、`AWS::Logs::LogGroup`）すべてに専用の実装を持ち、`AWS::Lambda::Url` の `InvokeMode` と `AuthType` を扱うことは、npm の配布物で確かめました。

**まだ確かめていないこと。** この章は、実際の Bedrock を一度も呼んでいません。AWS へのデプロイもしていません。`ai:hello`、`ai:test:live`、`AI_BACKEND=bedrock` での `dev:ai`、`ai:infra:deploy`、`ai:smoke`、`ai:logs`、`ai:infra:drift`、`ai:infra:destroy` は未実行です。とくに次の点は、実環境での確認待ちです。

- モデル ID（`jp.amazon.nova-2-lite-v1:0` など）が東京から実際に呼べること。model card で読んだだけです
- 実際の `ConverseStream` のイベントが、この章の schema と fixture の形に合うこと。fixture は公式ドキュメントから手で書いたもので、実際の推論から採取したものではありません
- Hono の `streamHandle` と `streamSSE` の応答が、Node.js 24 の Lambda と function URL を通して、少しずつ届くこと。`streamSSE` が付ける `Transfer-Encoding` などのヘッダーを Lambda が受け付けるかも未確認です
- 署名なしのリクエストに function URL が 403 を返すこと
- inference profile に絞った IAM policy（`bedrock:InferenceProfileArn` の条件つき）で `ConverseStream` が通ること
- Lambda の上で、呼び出し元が切断したあとの関数とモデルの振る舞い。ドキュメントと Hono のソースを読んだ結論で、観察はしていません
- 途中で中止した呼び出しの課金、Bedrock の無料枠、東京リージョンでの quota の既定値
- `-c reservedConcurrency=N` を付けたデプロイが通ること、上限を超えた呼び出しに function URL が返す応答。確かめたのは、template に値が入ることと、cdkd 0.296.28 のソースがそれを Lambda の API に渡していることだけです

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/17-ai/infra/lib/ai-stack.ts` | |
| まず数行で呼んでみる | `examples/17-ai/scripts/hello.ts`、`src/converse-stream.ts` | `ai:hello` |
| モデルを選ぶ | `examples/17-ai/infra/lib/models.ts`、`infra/bin/app.ts` | `test:unit` |
| 入力の上限と、返すイベントの形 | `examples/17-ai/src/contract.ts`、`src/prompt.ts` | `test:unit` |
| stream を読む | `examples/17-ai/src/converse-stream.ts`、`src/summarize.ts`、`src/bedrock.ts` | `test:unit` |
| 止める、待つ、やり直す | `examples/17-ai/src/failure.ts`、`src/summarize.ts`、`test/failure.test.ts` | `test:unit` |
| API にする | `examples/17-ai/src/app.ts`、`src/compose.ts`、`src/env.ts` | `test:unit` |
| 手元で動かす | `examples/17-ai/src/dev.ts`、`src/fixture-gateway.ts`、`src/fixtures.ts`、`fixtures/converse-stream/`、`.env.example` | `dev:ai` |
| テスト | `examples/17-ai/test/`、`infra/test/ai-stack.test.ts`、`scripts/live.ts` | `test:unit`、`ai:test:live` |
| 途中で切れたら | `examples/17-ai/src/client.ts`、`test/client.test.ts` | `test:unit` |
| AWS にのせる準備 | `examples/17-ai/infra/lib/ai-stack.ts`、`src/lambda.ts`、`infra/test/ai-stack.test.ts`、`cdk.json` | `ai:infra:synth`、`test:unit` |
| デプロイして呼ぶ | `examples/17-ai/scripts/smoke.ts`、`scripts/sign.ts`、`scripts/logs.ts`、`tools/src/infra/` | `ai:infra:diff`、`ai:infra:deploy`、`ai:smoke`、`ai:logs`、`ai:infra:drift` |
| 片付け | `tools/src/infra/` | `ai:infra:destroy` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

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
- [hono 4.13.13](https://www.npmjs.com/package/hono/v/4.13.13)、[@aws-sdk/client-bedrock-runtime 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-bedrock-runtime/v/3.1149.0)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（いずれも導入した配布物の型定義とソースを読んだ）

:::
