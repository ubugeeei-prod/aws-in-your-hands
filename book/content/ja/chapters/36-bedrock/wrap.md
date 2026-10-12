---
title: "36 Bedrock: 費用、注意点、片付け"
---

# 36 Bedrock: 費用、注意点、片付け

この章の最後のページです。Cloudflare と Vercel の同じ役目のもの、料金、つまずきやすいところ、本番で足すこと、片付けをまとめます。

## Cloudflare と Vercel から来た人へ

<!-- section: 36.compare -->

この章で作ったものの多くは、Cloudflare と Vercel にも、別の名前で用意されています。どちらも 2026-10-13 に公式ドキュメントで確かめた範囲の内容です。

| この章 | Cloudflare | Vercel |
| --- | --- | --- |
| ツールとループ | Workers AI の function calling。`@cloudflare/ai-utils` の `runWithTools` は、関数の実行までまとめて行う | AI SDK の `tools`。`stopWhen: isStepCount(5)` のように書くと、SDK がループを回して回数で止める |
| JSON を受け取る | Workers AI の JSON Mode。`response_format` に JSON Schema を渡す。対応モデルは一覧にある | AI SDK の `Output.object({ schema })`。Zod、Valibot、JSON Schema で書け、SDK が検証する |
| ガードレール | AI Gateway の Guardrails。Workers AI の Llama Guard で判定する | AI Gateway には同じ役目の機能を確認していない |
| 先頭の使い回し | Workers AI の prompt caching。対応モデルでは既定で有効 | AI SDK の Bedrock 用プロバイダーから、cache point を渡せる |
| 利用量の制限と記録 | AI Gateway の rate limiting、analytics、logging | AI Gateway の budgets（超えると新しいリクエストを断る）と request logs |
| 急がない仕事 | Workers AI の Asynchronous Batch API | 確認していない |
| エージェントの実行環境 | Cloudflare Agents | 確認していない |

同じ考え方のものが多いので、違いだけを書きます。

**ループを誰が書くか。** AI SDK と `runWithTools` は、ループを書いてくれます。回数の上限も引数 1 つです。この章が 100 行かけて書いたものが、数行で済みます。その代わり、途中で切れた応答をやり直すかどうか、断られたツールを何回まで許すか、といった判断は、ライブラリが決めます。この章は、その判断を自分のコードに置いて、テストで固定しました。どちらがよいかは、その判断にどこまでこだわる必要があるかで決まります。

AI SDK は Node.js で動く TypeScript のライブラリで、Bedrock 用のプロバイダーがあり、ガードレールの設定も渡せます。Lambda の中で AI SDK を使う、という組み合わせもできます。この章がそうしなかったのは、Converse のイベントとリクエストを直接見せたかったからで、AI SDK を避ける理由があるわけではありません。

**ゲートウェイという置き場所。** Cloudflare の AI Gateway と Vercel の AI Gateway は、アプリとモデルの提供元のあいだに置くプロキシです。記録、制限、提供元の切り替えを、アプリのコードの外に出せます。Bedrock には、これにあたる単独の製品がありません。この章は、予算を DynamoDB に、記録を自分のログに、再試行を自分のループに書きました。

Cloudflare の AI Gateway は、Amazon Bedrock を提供元の 1 つとして扱えます。AWS の認証情報を預けると、ゲートウェイが SigV4 の署名を付けます。モデルは Bedrock のまま、記録と制限だけをゲートウェイに任せる構成も組めます。認証情報を AWS の外に置くことになるので、そこは判断が要ります。

**キャッシュという言葉。** AI Gateway の caching は、同じリクエストに同じレスポンスを返す機能で、モデルを呼びません。この章の prompt caching は、モデルは毎回呼び、入力の先頭の処理だけを使い回します。名前は似ていますが、別のものです。

**ガードレールとストリーム。** Cloudflare の Guardrails は、ドキュメントによると、ストリームのレスポンスを途中で止めません。ゲートウェイのエンドポイントでは、レスポンスを最後まで溜めてから検査し、まとめて返します。対応言語の一覧に日本語はありません。Bedrock のガードレールは、ストリームの断片ごとに検査でき、日本語は Standard の段階で対応しています。その代わり、Standard は文章を東京の外へ出すことがあります。

**そのまま使い続けてよい場合。** Workers や Vercel の上でアプリが動いていて、モデルの置き場所に決まりがなく、ループの細部にこだわる理由がないなら、AI SDK か Workers AI を使い続けるほうが、書くコードも管理するものも少なく済みます。Bedrock を選ぶ理由になるのは、推論を決めたリージョンの中に収めたい、モデルを呼べる相手を IAM で絞りたい、ほかのデータが AWS にある、といった条件です。

## 料金

<!-- section: 36.cost -->

金額は USD、東京リージョン、従量課金、税別です。計算の詳細は[料金の計算](/ja/reference/pricing.md)にあります。

**誰も呼ばない月の料金は 0 です。** function URL、Lambda、on-demand の DynamoDB のテーブル、ガードレールのどれにも、置いてあるだけでかかる料金はありません。ガードレールの課金は、調べた文章の量に対してだけです。ログは 7 日で消えます。

呼ばれたときの料金を、月 1,000 問で計算します。1 問でモデルを 3 回呼び、入力は 3 回の合計で 4,000 トークン、出力は合計 200 トークンという仮定です。17章の要約（入力 2,000 トークン）より入力が多いのは、往復のたびに会話を送り直すからです。

| 対象 | 数量 | 定価 |
| --- | --- | --- |
| Nova 2 Lite の入力 | 400 万トークン | 1.58 |
| Nova 2 Lite の出力 | 20 万トークン | 0.66 |
| ガードレール（sensitive information filters） | 6,000 text unit | 0.60 |
| Lambda のリクエストと実行時間 | 1,000 件、2,000 GB 秒 | 0.03 |
| DynamoDB の読み書き | 書き込み 2,000、読み込み 3,000 | 0.00 |
| CloudWatch Logs の取り込み | 0.001 GB | 0.00 |
| 小計 | | **2.88** |

毎月の無料枠を引くと、Lambda の分が 0 になり、小計は USD 2.85 です。Bedrock とガードレールの無料枠は確認できなかったので、引いていません。

ガードレールが、出力のトークンと同じくらいの額になっています。text unit は文字数で数え、短い質問でも 1 unit です。1 問あたり 6 unit という数字は、3 回の呼び出しのそれぞれで、入力と出力が 1 unit ずつ調べられると仮定したものです。往復のある呼び出しで、同じ質問が何度数えられるかは、ドキュメントでは確認できませんでした。単価は、sensitive information filters が 1,000 unit あたり USD 0.10、content filters が USD 0.15 です。正規表現だけの sensitive information filters と、word filters は無料です。

利用者ごとの上限は、設定から計算できます。既定の予算は 1 人 1 日 USD 0.50 なので、1 人が毎日上限まで使っても、30 日で USD 15.00 です。これは推論の見積もりの額に対する上限で、Lambda とガードレールの料金は含みません。利用者の数には上限がないので、全体の上限にもなりません。17章の予約済み同時実行数や、01章の予算の通知と組み合わせてください。

prompt caching と batch inference の損得は、[実装のつづき](/ja/chapters/36-bedrock/more.md)で計算しました。

確かめられなかったこともあります。Bedrock とガードレールに無料枠があるかどうか、途中で失敗した呼び出しがどこまで課金されるか、ガードレールが止めた呼び出しでモデルの料金がどうなるか、です。ドキュメントの例では、入力で止められたときのトークン数は 0 でしたが、出力で止められた場合については、確認できていません。

スタックを消せば、この章の分の料金は止まります。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `dev:bedrock` が `Invalid environment` で止まる | `examples/36-bedrock/.env` があるかを確かめます。`BEDROCK_MODEL_ID: is not in src/models.ts` なら、その ID の行を `src/models.ts` に足すのが先です |
| 401 が返る | 手元ではトークンが期限切れかもしれません。サーバーを起動し直すと、新しいトークンが表示されます。デプロイ先では、function URL の認証が `AWS_IAM` になっているかを確かめます |
| 429 で `code` が `budget_exceeded` | その人の 1 日の予算を、確保の額が超えます。翌日（UTC）に戻ります。`DAILY_BUDGET_MICRO_USD` が、1 回の確保の額（Nova 2 Lite の既定で 66,220）より小さいと、1 回も通りません |
| 429 で `code` が `throttled` | アカウントのクォータです。Service Quotas で、そのモデルの値を見ます。`maxTokens` が大きすぎないかも確かめます |
| `done` の `stopReason` が `turn_limit` | モデルがツールを求め続けました。ログの `toolCalls` と `toolErrors` を見ます。`toolErrors` が多ければ、ツールの説明か入力のスキーマが、モデルに伝わっていません |
| 最後が `error` で `bad_output` | 断られたツールの要求が多すぎたか、`stopReason` が `malformed_tool_use` でした。JSON の取り出しなら、直させても検証を通りませんでした |
| `blocked` が届く | ガードレールが止めました。どのフィルターかを知るには、`trace` を `enabled` にします。この章は `disabled` にしています |
| `ValidationException` | モデルが対応しないフィールドを送った可能性があります。structured outputs、`toolChoice`、キャッシュの寿命の指定は、モデルごとに違います。ガードレールに対応しないモデルでは、`Guardrail is not supported with the chosen model` というメッセージになります |
| デプロイ先で 500、`code` が `misconfigured` | 実行ロールが、モデルかガードレールを使えません。Standard の設定なら、ガードレールの profile の行き先が IAM に全部あるかを確かめます |
| 日本語の攻撃的な入力が素通りする | Classic の content filters は日本語に対応していません |

## 本番にするなら

- 入口を、利用者の認証に合わせます。この章の利用者は、AWS の認証情報で署名できる人です。ブラウザの利用者には、06章のアクセストークンを確かめる `authenticate` と、17章に書いた入口が要ります
- モデルの終了日を、暦に入れます。`src/models.ts` の日付は、モデルカードから手で写したものです。Legacy になったという通知を受け取る人を決め、替える手順（表に足す、評価を回す、環境変数を変える）を、一度は練習しておきます
- 評価のケースを増やします。4 つは、仕組みを見せるための数です。実際の質問から、失敗した例を足していきます
- ガードレールの設定を、自分の用途で決めます。この章の既定は、鍵を止めるだけです。どのフィルターを付けるかは、扱う内容と、文章を出してよいリージョンで決まります。付けたら、止めるはずの入力と、止めてはならない入力の両方で試します
- 表示する側で、答えを信用しません。文章として表示し、HTML として解釈させません
- 予算の単価を、Price List と照らします。`src/models.ts` の単価が古くなると、予算は静かにずれます
- スロットリングをアラームにします。ログの `outcome` が `throttled` の行を数えるメトリクスフィルターを、19章の方法で作ります
- モデルの呼び出しの記録（model invocation logging）を有効にするかを決めます。有効にすると、ノートの本文が保存されます
- 反映の経路を AWS CDK CLI と CloudFormation にします。02章で説明したとおりです

## 片付け

<!-- section: 36.cleanup -->

```bash
vp run bedrock:infra:destroy
```

関数、function URL、ロール、ロググループ、テーブル 2 つ、ガードレールとそのバージョンが消えます。ノートのテーブルに書いたフィクスチャのノートと、使用量の記録も一緒に消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルです。Marketplace 経由のモデルを呼んだ場合は、17章と同じく、そのサブスクリプションがアカウントに残ります。model invocation logging を自分で有効にした場合は、その設定と保存先のログが残ります。この章のスタックは、それを作りも消しもしません。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（110 件）、型検査、synth（esbuild のバンドル込み、9 リソース）を実行しました。`dev:bedrock` を `AI_BACKEND=scripted` で起動し、本文の `curl` を実行して、401、SSE のイベント、JSON の答え、ログの 2 行を確かめています。`AI_TRANSCRIPT=runaway-tools` で `turn_limit` で終わることも見ました。`bedrock:eval` は 4 件が通り、`bedrock:batch:plan` は 100 件で通って 40 件で止まります。料金の小計は `tools/src/pricing/calc.ts` で計算した値です。固定した版の cdkd（0.296.28）の配布物では、このスタックの 8 種類のうち 6 種類に専用の実装があり、`AWS::Bedrock::Guardrail` と `AWS::Bedrock::GuardrailVersion` には無いことを確かめました。固定した版の `@aws-sdk/client-bedrock-runtime`（3.1149.0）の型が、`outputConfig`、`strict`、`cachePoint`、`streamProcessingMode` を宣言していることも確かめています。

**まだ確かめていないこと。** この章は、実際の Bedrock を一度も呼んでいません。AWS へのデプロイもしていません。`bedrock:eval:live`、`AI_BACKEND=bedrock` での `dev:bedrock`、`bedrock:infra:deploy`、`bedrock:smoke`、`bedrock:logs`、`bedrock:infra:drift`、`bedrock:infra:destroy` は未実行です。とくに次の点は、実環境での確認を待っています。

- 実際の `ConverseStream` が、ツールの要求をこの章のスキーマとフィクスチャの形で返すこと。フィクスチャは公式ドキュメントから手で書いたもので、実際の推論から採取したものではありません
- 実際のモデルの振る舞いの全部。ツールをいつ呼ぶか、断られたあとに求め直すか、ノートに書かれた指示に従うか、名指ししたツールの入力がスキーマに合うか。評価の 4 つのケースが通るかどうかも含みます
- 入力が JSON として読めなかったツールの要求を、`input` を空にして繰り返したときに、API が受け付けること
- Nova 2 Lite に `toolChoice` の名指しが通ること、Claude Haiku 4.5 に `outputConfig.textFormat` が `jp.` の profile 経由で通ること
- ガードレールを付けた `ConverseStream` が、`bedrock:ApplyGuardrail` を自分のガードレールに絞ったロールで通ること。sensitive information filters だけのガードレールが作れること。出力の途中で止められたときに、それより前の断片がどこまで届くか
- 往復のある呼び出しで、ガードレールの text unit がどう数えられるか。ガードレールが止めた呼び出しの、モデルの側の課金
- cache checkpoint を置いたリクエストが Nova 2 Lite で通ること、実際にキャッシュに当たること、Price List で USD 0 になっている書き込みが請求でどう数えられるか
- function URL のイベントの `requestContext.authorizer.iam.userId` が、引き受けたロールで署名したときにどういう値になるか。ドキュメントの例は IAM ユーザーのものです
- cdkd が、Cloud Control API 経由でガードレールとそのバージョンを作成、更新、削除できること。バージョンの `Version` 属性が関数の環境変数に入ること
- DynamoDB の条件付き更新が、同時のリクエストで予算を守ること。送るコマンドの形しか調べていません
- 東京リージョンで自分のアカウントに適用されているクォータの値
- batch inference のジョブの作成と、出力の実際の形。structured outputs が batch で使えるかどうかは、ドキュメントの 2 つのページが食い違っています
- Amazon Bedrock AgentCore は動かしていません。ドキュメントに書かれている構成を紹介しただけです

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/36-bedrock/src/app.ts`、`infra/lib/bedrock-stack.ts` | |
| モデルごとに違うこと | `examples/36-bedrock/src/models.ts`、`src/env.ts`、`infra/bin/app.ts` | `test:unit` |
| ツールを定義する | `examples/36-bedrock/src/tools.ts`、`test/tools.test.ts` | `test:unit` |
| ストリームからツールの要求を読む | `examples/36-bedrock/src/converse.ts`、`src/turn.ts`、`src/gateway.ts`、`src/bedrock.ts` | `test:unit` |
| ループを状態機械にする | `examples/36-bedrock/src/loop.ts`、`src/prompt.ts`、`test/loop.test.ts` | `test:unit` |
| ノートに書かれた指示 | `examples/36-bedrock/src/prompt.ts`、`fixtures/transcripts/injected.json`、`test/loop.test.ts` | `test:unit` |
| JSON を受け取る | `examples/36-bedrock/src/structured.ts`、`src/contract.ts`、`test/structured.test.ts` | `test:unit` |
| ガードレール | `examples/36-bedrock/src/prompt.ts`、`src/client.ts`、`infra/lib/guardrail.ts`、`infra/lib/bedrock-stack.ts` | `test:unit` |
| prompt caching | `examples/36-bedrock/src/prompt.ts`、`src/usage.ts`、`test/prompt.test.ts` | `test:unit` |
| 使用量、予算、クォータ | `examples/36-bedrock/src/usage.ts`、`src/budget.ts`、`src/dynamodb-ledger.ts`、`src/log-shape.ts`、`src/app.ts` | `test:unit` |
| 急がない仕事は batch に | `examples/36-bedrock/src/batch.ts`、`scripts/batch-plan.ts` | `bedrock:batch:plan`、`test:unit` |
| 手元で動かす | `examples/36-bedrock/src/dev.ts`、`src/scripted-model.ts`、`src/transcripts.ts`、`fixtures/`、`.env.example` | `dev:bedrock` |
| テストが守っていること | `examples/36-bedrock/test/`、`infra/test/bedrock-stack.test.ts` | `test:unit` |
| 回帰テストとしての評価 | `examples/36-bedrock/src/eval.ts`、`scripts/eval.ts`、`fixtures/eval/cases.json` | `bedrock:eval`、`bedrock:eval:live` |
| AWS にのせる準備 | `examples/36-bedrock/infra/`、`src/lambda.ts`、`src/function-url.ts`、`src/identity.ts` | `bedrock:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/36-bedrock/scripts/smoke.ts`、`scripts/sign.ts`、`scripts/logs.ts` | `bedrock:infra:diff`、`bedrock:infra:deploy`、`bedrock:smoke`、`bedrock:logs`、`bedrock:infra:drift` |
| 片付け | `tools/src/infra/` | `bedrock:infra:destroy` |
| 料金 | `data/pricing/`、`examples/36-bedrock/src/usage.ts` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-13）

- ツール: [Use a tool to complete an Amazon Bedrock model response](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html)、[Client-side tool use](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use-client-side.html)、[Server-side tool use](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use-server-side.html)、[Inference using Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)、[ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html)、[MessageStopEvent](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_MessageStopEvent.html)、[ToolSpecification](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolSpecification.html) とその周辺の型
- 構造化出力: [Get validated JSON results from models](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html)、[OutputConfig](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_OutputConfig.html)
- ガードレール: [Detect and filter harmful content by using Amazon Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html)、[Include a guardrail with the Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-use-converse-api.html)、[Configure streaming response behavior to filter content](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-streaming.html)、[GuardrailStreamConfiguration](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_GuardrailStreamConfiguration.html)、[Set up permissions to use Amazon Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-permissions.html)、[Supported Regions and models](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-supported.html)、[Safeguard tiers](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-tiers.html)、[Languages supported](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-supported-languages.html)、[Supported Regions for cross-Region guardrail inference](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-cross-region-support.html)、[sensitive information filters](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-sensitive-filters.html)、[Detect prompt attacks](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-prompt-attack.html)、[Prompt injection security](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-injection.html)
- prompt caching と使用量: [Prompt caching for faster model inference](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)、[TokenUsage](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_TokenUsage.html)
- モデルと経路: [Inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles.html)、[Prerequisites for inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html)、[Cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html)、Model card: [Nova 2 Lite](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html)、[Claude Haiku 4.5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html)、[Model lifecycle](https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html)
- クォータ: [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html)、[Amazon Bedrock endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/bedrock.html)、[How tokens are counted in Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-token-burndown.html)、[Service tiers](https://docs.aws.amazon.com/bedrock/latest/userguide/service-tiers-inference.html)、[Troubleshooting Amazon Bedrock API Error Codes](https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes.html)、[CountTokens](https://docs.aws.amazon.com/bedrock/latest/userguide/count-tokens.html)
- batch と処理能力: [Process multiple prompts with batch inference](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference.html)、[Format and upload your batch inference data](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference-data.html)、[Provisioned Throughput](https://docs.aws.amazon.com/bedrock/latest/userguide/prov-throughput.html)
- エージェント: [Automate tasks in your application using AI agents](https://docs.aws.amazon.com/bedrock/latest/userguide/agents.html)、[What is Amazon Bedrock AgentCore?](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)
- 記録と入口: [Monitor model invocation using CloudWatch Logs and Amazon S3](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html)、[Invoking Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html)
- インフラ: [AWS::Bedrock::Guardrail](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-bedrock-guardrail.html)、[Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)、[@aws-sdk/client-bedrock-runtime 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-bedrock-runtime/v/3.1149.0)（どちらも導入した配布物を読んだ）
- 料金: [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)、AWS Price List bulk API の [Bedrock](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-northeast-1/index.json) と [Marketplace 経由のモデル](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/ap-northeast-1/index.json)
- Cloudflare: [Function calling](https://developers.cloudflare.com/workers-ai/features/function-calling/)、[JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)、[Asynchronous Batch API](https://developers.cloudflare.com/workers-ai/features/batch-api/)、[Prompt caching](https://developers.cloudflare.com/workers-ai/features/prompt-caching/)、[AI Gateway](https://developers.cloudflare.com/ai-gateway/)、[Guardrails usage considerations](https://developers.cloudflare.com/ai-gateway/features/guardrails/usage-considerations/)、[Agents](https://developers.cloudflare.com/agents/)
- Vercel: [AI Gateway](https://vercel.com/docs/ai-gateway)、[AI Gateway pricing](https://vercel.com/docs/ai-gateway/pricing)、AI SDK の [Tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)、[Generating structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)、[Amazon Bedrock provider](https://ai-sdk.dev/providers/ai-sdk-providers/amazon-bedrock)

:::
