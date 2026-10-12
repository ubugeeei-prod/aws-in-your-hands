---
title: "56 Nova: 費用、注意点、片付け"
---

# 56 Nova: 費用、注意点、片付け

[デプロイ](/ja/chapters/56-nova/deploy.md)まで終えたところで、Cloudflare や Vercel で同じことをする場合との違いと料金を整理し、作ったものを片付けます。

## Workers AI と Vercel から来た人へ

<!-- section: 56.compare -->

Cloudflare の Workers AI のモデルの一覧には、2026-10-13 の時点で、画像から文章を作るモデル、文章から画像を作るモデル、文章の読み上げ、音声の文字起こしの分類があり、画像を受け取れる文章生成のモデルも載っています。動画を生成する分類は見当たりませんでした。呼び方は 17章で比べたとおりで、binding を 1 行書けば、権限もリージョンも考えずに呼べます。

Vercel は、自分ではモデルを動かしません。AI Gateway が、モデルの提供元へリクエストを取り次ぎます。ドキュメントは、扱える種類として、文章、画像の生成、動画の生成、音声、文字起こし、リアルタイム、埋め込みを挙げています。

画像を生成したいだけなら、いまは Bedrock の Nova を選ぶ理由がありません。Nova には生成のモデルがなく、Workers AI の一覧にはあります。すでにそちらで動いているアプリなら、そのまま使うのが自然です。

Bedrock の Nova を選ぶ理由になるのは、まわりの決まりごとです。関数が呼べるモデルを ARN で 1 つに絞れます。推論を東京だけ、あるいは日本の中だけで処理するように選べます。S3 にある画像を、関数を経由させずに、関数のロールの権限でモデルに読ませることができます。生成したものを置く先が、条件付きの書き込みを受け付けるので、「1 つだけ保存する」をキューやテーブルなしで書けます。その代わり、どの ID を呼べるか、どのリージョンで処理されるか、いつまで使えるかを、自分で追い続けることになります。この章のコードの半分は、そのためのものでした。

## 料金

<!-- section: 56.cost -->

金額は USD、東京リージョン、従量課金、税別です。計算の詳細は[料金の計算](/ja/reference/pricing.md)にあります。

**誰も呼ばない月の料金は 0 です。** function URL、Lambda、Bedrock の従量課金のどれにも、置いてあるだけでかかる料金はありません。バケットは、中のオブジェクトの分だけ課金されます。説明文は 1 件が 1 KB に満たないので、1,000 件を保存しても 1 MB ほどで、S3 の保存料金は月 USD 0.0001 に届きません。ログは 7 日で消えます。

呼ばれたときの料金を、月 1,000 枚の画像を 1 回ずつ説明する、という仮定で計算します。入力は 1 枚あたり 320 トークン、出力は 60 トークンと置きました。入力のうち 230 は画像 1 枚の定額で、残りの 90 は 2 つのプロンプトの見積もりです。実際の値は、ログの `describe` 行の `billed` で確かめてください。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| Nova 2 Lite の入力 | 32 万トークン | 0.13 | 0.13（無料枠は確認できず、引いていない） |
| Nova 2 Lite の出力 | 6 万トークン | 0.20 | 0.20（同上） |
| Lambda のリクエスト | 1,000 件 | 0.00 | 0 |
| Lambda の実行時間 | 750 GB 秒 | 0.01 | 0 |
| S3 の書き込み | 2,000 件 | 0.01 | 0.01 |
| S3 の読み出し | 3,000 件 | 0.00 | 0.00 |
| CloudWatch Logs の取り込み | 0.001 GB | 0.00 | 0 |
| 小計 | | **0.35** | **0.34** |

Lambda の実行時間は、1 枚あたり平均 3 秒と仮定しました。推論を待っている間も関数は動いていて、課金されます。S3 のリクエストは、1 枚につき書き込み 2 回（claim と説明文）、読み出し 3 回と数えました。読み出しのうち 1 回は、Bedrock が画像を取りに行く分を 1 回と仮定したものです。実際に何回で、誰に課金されるかは確かめていません。データ転送の料金は、この表に入れていません。0 という意味ではなく、未算入です。

同じ画像について 2 回目以降に PUT を送っても、モデルは呼ばれません。かかるのは Lambda の 1 回分と、S3 の読み出し 1 回分です。

上限も計算できます。出力は 1 枚あたり最大 300 トークンなので、1,000 枚すべてが上限まで書いたとしても、推論の料金は USD 1.12 です。1 回の呼び出しでは、最悪でも推論が USD 0.0011、40 秒で止まる Lambda が USD 0.00013 です。

**回数には上限がありません。** この URL を呼べるのは署名できる相手だけですが、その相手が、違う画像を次々にアップロードして説明させれば、その回数だけ払うことになります。説明文を消してから作り直すことを繰り返しても同じです。止めるには、利用者ごとの上限が要ります。作り方は 36章にあります。

モデルを替えたときの比較は、「しくみと実装」の「安いモデルに替える」に書きました。17章と同じ月 1,000 件の要約なら、推論の料金は Nova 2 Lite で USD 1.29、Nova Lite で USD 0.19、Nova Micro で USD 0.11 です。

確かめられなかったこともあります。Bedrock に無料枠があるかどうかと、途中で中止した呼び出しにどこまで課金されるかです。どちらも一次情報で確認できていないので、不明としています。

スタックを消せば、この章の分の料金は止まります。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `dev:nova` が `Invalid environment` で止まる | `examples/56-nova/.env` があるかを確認します。`NOVA_BACKEND` に既定値はありません。`DESCRIBE_MODEL_ID` の行が出ていれば、その ID は一覧にないか、終了しています |
| synth が `describeModel` で止まる | 渡した ID が、東京から画像を説明できる経路ではありません。`vp run nova:catalog` の最後の一覧から選びます |
| PUT が 404 で `attachment_missing` | 自分の接頭辞の下にアップロードがありません。`GET /me` が返す値を使って、キーが `u/<owner>/<note>/<attachment>` になっているかを確認します |
| PUT が 422 で `unsupported_image` | 形式が PNG、JPEG、GIF、WebP のどれでもないか、5 MB を超えています。S3 に入っている `Content-Type` を確認します |
| PUT が 202 のまま変わらない | 前の実行が claim を残して止まった可能性があります。リースの 60 秒が過ぎれば、次の PUT が引き継ぎます |
| PUT が 500 で `misconfigured` | ロールがそのモデルを呼べないか、モデル ID が見つかりません。`vp run nova:models` で、その経路がまだあるかを確かめます。終了したモデルを呼んだときにどのエラーが返るかは、確かめていません |
| PUT が 502 で `bad_output` | 答えが途中で切れたか、空でした。ログの `billed` を見ると、どこまで書いたかがわかります。続くようなら `MAX_OUTPUT_TOKENS` を見直します |
| PUT が 429 で `throttled` | アカウントのクォータを超えました。少し待って同じ PUT を送ります |
| function URL が 403 | 署名がないか、呼んでいる人に `lambda:InvokeFunctionUrl` と `lambda:InvokeFunction` がありません |

モデルが S3 の画像を読めなかったときに、Bedrock がどのエラーを返すかは確かめていません。ロールの `s3:GetObject` を外して試せばわかるはずですが、この章はそこまで実行していません。

## 本番にするなら

- 持ち主を、06章のサインインで得た利用者の ID にします。この章の function URL は、署名できる AWS の利用者しか呼べません。ブラウザから使うには、07章の API と同じ authorizer の後ろに置き、バケットも 07章のものを使います
- 利用者ごとの上限を作ります。いまある上限は、1 回あたりの出力の上限だけです
- アップロードを消すときに、説明文も消します。08章の housekeeping は、どのレコードからも指されていないアップロードを片付けています。同じ場所で `g/` も見るようにします
- モデルの終了を追います。20章には、ドリフトを定期的に調べるワークフローがあります。そこに `vp run nova:models` を足せば、一覧にある経路が消えたときに失敗で気づけます。Nova Canvas と Nova Reel は、予告から終了まで 6 か月でした
- モデルやプロンプトを替えたときに、古い説明文をどうするかを決めます。保存した記録に `modelId` と `promptVersion` があるので、作り直す対象は選べます。作り直すなら、その枚数分の料金がかかります
- 出力を人に見せる前の確認を決めます。Nova のガイドは、出力を評価してから利用者に見せるよう勧めています。この章は、長さしか見ていません
- データの行き先を決めます。`jp.` の profile は日本の中、`apac.` は 6 つのリージョン、`global.` は世界中で処理されます。添付の画像には、ノートの本文より個人的なものが写ることがあります
- バケットの削除の設定を `RETAIN` に変えます。練習用の `DESTROY` のままでは、スタックを消すと説明文も消えます
- 反映の経路を AWS CDK CLI と CloudFormation にします。02章で説明したとおりです

## 片付け

<!-- section: 56.cleanup -->

固定した版の cdkd は、中身のあるバケットを消しません。先にバケットを空にします。

```bash
vp run nova:empty
vp run nova:empty --yes
vp run nova:infra:destroy
```

1 行目はオブジェクトを数えるだけで、何も消しません。2 行目が、アップロード、説明文、claim をすべて消します。3 行目で、バケット、関数、function URL、ロール、ロググループが消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルです。Bedrock の側には、この章が作ったリソースはありません。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（98 件。一覧、料金の計算、リクエストの組み立てと上限、説明文を作る処理の重なり方、アプリ、S3 に送るリクエストの形、スタック）、型検査、synth（esbuild のバンドル込み、7 リソース）を実行しました。`dev:nova` を `NOVA_BACKEND=scripted` で起動し、本文の `curl` と同じ操作をして、202、200、`reused` の応答とログを確かめています。`nova:catalog` の出力も、実行したものを載せています。npm の配布物では、次の 2 点を確かめました。固定した版の `@aws-sdk/client-bedrock-runtime`（3.1149.0）が、画像のブロックの `format` と `source`、`bytes` と `s3Location`、`bucketOwner` を宣言していること。固定した版の cdkd（0.296.28）が、このスタックの 7 種類のリソース（`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Url`、`AWS::Logs::LogGroup`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy`）すべてに専用の実装を登録していること。

**まだ確かめていないこと。** この章は、実際の Bedrock を一度も呼んでいません。AWS へのデプロイもしていません。`nova:models`、`nova:hello`、`NOVA_BACKEND=bedrock` での `dev:nova`、`nova:infra:deploy`、`nova:smoke`、`nova:infra:drift`、`nova:empty`、`nova:infra:destroy` は未実行です。とくに次の点は、実環境での確認を待っています。

- `src/catalog.ts` の内容が、アカウントから見える内容と合っていること。モデルカードとライフサイクルのページを読んだだけです。Nova Micro を東京から呼ぶ ID は、モデルカードの表と ID の一覧が食い違っていて、確認できていません
- Price List にだけ行がある Nova 2.0 Pro、Nova 2.0 Omni、Nova 2.5 Sonic が呼べるのかどうか
- `jp.amazon.nova-2-lite-v1:0` が、S3 の URI で渡した画像を読めること。推論が大阪で処理されたときに、東京のバケットの画像を読めるかどうかは、ドキュメントでも確認できませんでした
- 実際の `Converse` の応答が、この章のフィクスチャの形に合うこと。画像 1 枚が `usage` に 230 トークンとして現れること
- モデルが画像を断るときの応答。`stopReason` が `content_filtered` になるのか、別の形なのかは、ドキュメントで確認できませんでした
- S3 の条件付きの書き込みが、この章のロールの権限で通ること。同時のリクエストで claim が 1 つしか作られないこと。メモリ上の代役でしか試していません
- function URL のイベントの `requestContext.authorizer.iam.userId` が、引き受けたロールでどういう値になるか
- Bedrock が画像を取りに行く S3 のリクエストの回数と課金先、途中で中止した呼び出しの課金、Bedrock の無料枠
- Nova 2 Sonic については、何も実行していません。書いたのは、モデルカード、ガイド、API リファレンス、Price List の内容だけです
- Workers AI のモデルの一覧は、ページを要約して読んだもので、1 行ずつ確かめてはいません

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| Nova の顔ぶれ、終了したモデル | `examples/56-nova/src/catalog.ts`、`test/catalog.test.ts` | `test:unit`、`nova:catalog` |
| 全体像 | `examples/56-nova/infra/lib/nova-stack.ts`、`src/app.ts` | |
| 一覧をコードに持つ | `examples/56-nova/src/catalog.ts`、`scripts/catalog.ts`、`scripts/models.ts` | `nova:catalog`、`nova:models` |
| 画像をモデルに渡す | `examples/56-nova/src/image.ts`、`scripts/hello.ts`、`test/image.test.ts` | `test:unit`、`nova:hello` |
| 1 回だけ作る | `examples/56-nova/src/describe.ts`、`src/media.ts`、`src/s3-media.ts`、`test/describe.test.ts` | `test:unit` |
| 保存するもの | `examples/56-nova/src/describe.ts`、`src/model.ts`、`src/bedrock.ts` | `test:unit` |
| 持ち主の場所 | `examples/56-nova/src/identity.ts`、`src/app.ts`、`src/contract.ts`、`test/app.test.ts`、`test/adapters.test.ts` | `test:unit` |
| 安いモデルに替える | `examples/56-nova/src/cost.ts`、`src/catalog.ts`、`test/cost.test.ts` | `test:unit`、`nova:catalog` |
| 手元で動かす | `examples/56-nova/src/dev.ts`、`src/scripted-model.ts`、`src/fixtures.ts`、`fixtures/converse/`、`src/env.ts`、`src/compose.ts`、`.env.example` | `dev:nova` |
| テスト | `examples/56-nova/test/`、`src/memory-media.ts`、`infra/test/nova-stack.test.ts` | `test:unit` |
| スタック | `examples/56-nova/infra/lib/nova-stack.ts`、`infra/bin/app.ts`、`src/lambda.ts`、`cdk.json` | `nova:infra:synth`、`test:unit` |
| デプロイして呼ぶ | `examples/56-nova/scripts/smoke.ts`、`scripts/sign.ts`、`scripts/models.ts`、`tools/src/infra/` | `nova:infra:diff`、`nova:infra:deploy`、`nova:models`、`nova:smoke`、`nova:infra:drift` |
| 片付け | `examples/56-nova/scripts/empty.ts`、`tools/src/infra/` | `nova:empty`、`nova:infra:destroy` |
| 料金 | `data/pricing/`、`examples/56-nova/src/cost.ts` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-13）

- [Models at a glance](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html)。Model card: [Nova 2 Lite](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html)、[Nova Lite](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html)、[Nova Pro](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-pro.html)、[Nova Micro](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-micro.html)、[Nova 2 Sonic](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-sonic.html)、[Nova Multimodal Embeddings](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-amazon-nova-multimodal-embeddings.html)、[Nova Canvas](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-canvas.html)、[Nova Reel](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-reel.html)
- [Model lifecycle](https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html)、[Model lifecycle (Legacy)](https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle-legacy.html)。終了したモデルの表は後者にあります
- Nova 2 のガイド: [What is Amazon Nova 2?](https://docs.aws.amazon.com/nova/latest/nova2-userguide/what-is-nova-2.html)、[Multimodal understanding](https://docs.aws.amazon.com/nova/latest/nova2-userguide/using-multimodal-models.html)、[Prompting multimodal inputs](https://docs.aws.amazon.com/nova/latest/nova2-userguide/prompting-multimodal.html)、[Using Amazon Nova embeddings](https://docs.aws.amazon.com/nova/latest/nova2-userguide/embeddings.html)、[Speech-to-Speech](https://docs.aws.amazon.com/nova/latest/nova2-userguide/using-conversational-speech.html)、[Language support](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-language-support.html)、[Release notes](https://docs.aws.amazon.com/nova/latest/nova2-userguide/release-notes.html)、[Responsible use](https://docs.aws.amazon.com/nova/latest/nova2-userguide/responsible-use.html)。入口の [Amazon Nova Documentation](https://docs.aws.amazon.com/nova/)
- Nova の最初の版のガイド: [Image understanding](https://docs.aws.amazon.com/nova/latest/userguide/modalities-image.html)、[Generating images with Amazon Nova Canvas](https://docs.aws.amazon.com/nova/latest/userguide/image-generation.html)、[Video generation access and usage](https://docs.aws.amazon.com/nova/latest/userguide/video-gen-access.html)。あとの 2 つは、終了したモデルのページがそのまま公開されているものです
- [Inference using Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)。S3 の URI で渡すときの権限と `bucketOwner` はここにあります
- API リファレンス: [Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html)、[ImageBlock](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ImageBlock.html)、[S3Location](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_S3Location.html)、[MessageStopEvent](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_MessageStopEvent.html)、[StartAsyncInvoke](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_StartAsyncInvoke.html)、[GetAsyncInvoke](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_GetAsyncInvoke.html)、[InvokeModelWithBidirectionalStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModelWithBidirectionalStream.html)
- [Prerequisites for inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html)、[Supported Regions and models for inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html)
- [How to prevent object overwrites with conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [Invoking Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html)
- AWS Price List bulk API: [Bedrock](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-northeast-1/index.json)（公開日 2026-10-10）。終了した Nova Canvas と Nova Reel の行も、モデルカードのないモデルの行も残っています
- Cloudflare: [Workers AI Models](https://developers.cloudflare.com/workers-ai/models/)。Vercel: [AI Gateway](https://vercel.com/docs/ai-gateway)
- [@aws-sdk/client-bedrock-runtime 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-bedrock-runtime/v/3.1149.0)、[@aws-sdk/client-bedrock 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-bedrock/v/3.1149.0)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（導入した配布物の型定義とソースを読んだ）

:::
