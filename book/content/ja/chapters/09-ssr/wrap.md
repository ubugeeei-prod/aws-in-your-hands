---
title: "09 SSR: 費用、注意点、片付け"
---

# 09 SSR: 費用、注意点、片付け

## Workers から来た人へ

<!-- section: 09.workers -->

Nuxt を Cloudflare Workers に出したことがあるなら、この章は遠回りに見えたはずです。違いを並べます。

| | Cloudflare Workers | この章（CloudFront と Lambda） |
| --- | --- | --- |
| ビルド | Nitro の Cloudflare 向け preset | Nitro の `aws-lambda` preset |
| デプロイ | `wrangler deploy` が Nuxt を検出して、`.output/server/index.mjs` と `.output/public` を設定する | asset を S3 に置くタスクと、関数と distribution を作る stack を、自分で用意する |
| HTML を作る場所 | Cloudflare のネットワーク上の Worker | 東京リージョンの Lambda。edge ではない |
| 静的 asset との振り分け | 設定の `assets` に directory を書く | distribution の behavior を path ごとに自分で書く |
| 他のサービスとの接続 | binding | AWS SDK と実行 role |

AWS のほうが、自分で決めることが多いです。この章で書いた cache policy、behavior、OAC、publish の順番は、Workers なら大部分をプラットフォームが決めてくれます。

そのかわり、決めたことは全部コードに残っています。どの path に cookie が届くのか、何秒 cache されるのか、関数を直接呼べるのは誰か。stack とテストを読めばわかります。

1 つ、同じことがあります。「ログイン中のページを共有 cache に載せない」は、どのプラットフォームでも、アプリを書く人の仕事です。Workers の静的 asset がどう cache されて、どう課金されるかは、この章のためには読んでいません。

## お金の話

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**誰も来ない月は、ほぼ 0 です。** かかるのは S3 に置いた asset の保存料金だけで、5 MB なら USD 0.000125。四捨五入すると USD 0.00 です。function URL に追加料金はなく、Lambda も CloudFront も、リクエストがなければ請求されません。

月 10 万ページビューだと、こうなります。1 ページビューあたり CloudFront へ 4 リクエストで合計 100 KB、HTML と API のリクエストの半分が cache に当たって残りの 5 万件が Lambda に届く、Lambda は平均 200 ミリ秒・512 MB・arm64、という仮定です。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| CloudFront の HTTPS リクエスト | 40 万件 | 0.48 | 0 |
| CloudFront のデータ転送 | 9.537 GB | 1.09 | 0 |
| Lambda のリクエスト | 5 万件 | 0.01 | 0 |
| Lambda の実行時間 | 5,000 GB 秒 | 0.07 | 0 |
| CloudWatch Logs の取り込みと保存 | 0.014 GB | 0.01 | 0 |
| S3 の GET、PUT、保存 | 3 万件、200 件、0.005 GB 月 | 0.01 | 0.01（無料枠は確認できず、引いていない） |
| 小計 | | **1.67** | **0.01** |

この表でいちばん効いているのは、cache に当たる割合です。半分というのは仮定で、根拠のある数字ではありません。0 なら Lambda の行が 2 倍になり、ほとんど当たるなら 0 に近づきます。実際の値は、デプロイして計るしかありません。

200 ミリ秒という実行時間も仮定で、計測していません。あなたの関数の値は、04章と同じく、ログの `REPORT` 行でわかります。

Lambda から CloudFront へのデータ転送は、この表に入れていません（0 という意味ではなく、未算入です）。streaming を使う場合の料金は、「streaming は経路ぜんぶの話」に書いたとおりで、buffered のままなら発生しません。

## ハマりどころ

ここに書くのは、設定と一次情報から「こうなるはず」と読めるものです。実機で踏んで確かめたものではありません。

| こうなったら | ここを見る |
| --- | --- |
| `ssr:infra:synth` が `.output is missing` で止まる | `vp run build:ssr` を先に。stack はビルドの出力をデプロイします |
| デプロイ後、全部のページが 403 | function URL の resource policy に、distribution からの 2 つの許可がありますか。`ssr:infra:drift` で差を確認 |
| HTML は出るのに、画面が動かない。`/_nuxt/` のファイルが 404 | `ssr:assets:publish` を実行しましたか。関数だけ新しくなっています |
| `/me` にいつ行ってもサインインしていない | デプロイした環境では、それが正しい動きです。練習用のサインインは手元だけ |
| 公開ページに足した「ログイン中の名前」が、デプロイすると出ない | 公開側の behavior は cookie を Lambda に届けません。個人ごとの表示は `/me` の下か、ブラウザから `/me/` の API を呼んで出します |
| form を足したら、送信が 403 | distribution は GET と HEAD だけを通します。OAC と POST の制約は「function URL を公開のままにしない」に |
| 直したのに、古いページが出る | 60 秒待つか、invalidation を。edge ごとに切り替わる時刻は違います |
| streaming に切り替えたのに、少しずつ届かない | `.output/nitro.json` の `streaming` と、template の `InvokeMode` を見比べる。合っていれば、次に疑うのは CloudFront です（まだ確かめられていない区間） |

## 本番にするなら

- **本物のサインインを足す。** session を DynamoDB に置き、06章の認可コードを BFF で token に交換します。POST の入口は、API Gateway を挟むか、ブラウザ側で本文の hash を付けるか、どちらかを選びます
- **session cookie に `Secure` を必ず付ける。** 練習用のコードは、手元の `http://localhost` で動かすために、プロトコルを見て切り替えています
- **cache する時間を、ページごとに決める。** 全部 60 秒は学習用の値です。ほとんど変わらないページはもっと長く、在庫のように古いと困るものは cache しない
- **WAF を CloudFront に付ける。** function URL を直接呼べなくしてあるので、CloudFront に付けた WAF を迂回されません
- **同時実行数を見る。** function URL は、関数の同時実行数の上限に達すると 429 を返します。cache に当たらないページへのアクセスが急に増えると、ここに届きます
- **エラーページを用意する。** Lambda が落ちているときに CloudFront が返すページを、custom error response で決められます
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです

## 片付け

<!-- section: 09.cleanup -->

```bash
vp run ssr:unpublish --yes
vp run ssr:infra:destroy
```

cdkd は中身のある bucket を消せないので、先に asset を空にします。そのあと、関数、function URL、role、log group、bucket、distribution、cache policy、response headers policy が消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。手元の `.output`、`.nuxt`、`cdk.out` は git の管理外なので、消してかまいません。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテストと CDK の assertion（`test:unit`）。TypeScript の型検査（`typecheck`）と、Vize による `.vue` の型検査と lint（`typecheck:ssr`、`lint:ssr`）。わざと型エラーを入れて、`vize check` が失敗することも確認。`build:ssr` と `build:ssr:stream`（Nuxt 4.6.1、nitropack 2.13.4、`@vizejs/nuxt` 0.443.0）。ビルドした handler を呼ぶ検査（`ssr:check:output` と `ssr:check:output:stream`）。buffered では `/feed` が 1 回、streaming では 3 回（約 300 ミリ秒おき）に分けて書かれ、どちらでも HTML は 1 回で書かれた。`ssr:infra:synth`。`dev:ssr` を起動して、公開ページ、404、`/me`、サインイン、サインアウト、よそからの POST の拒否、`/feed` が少しずつ届くことを HTTP で確認。

**まだ確かめていないこと。** AWS には何もデプロイしていません。`ssr:infra:diff`、`ssr:infra:deploy`、`ssr:assets:plan`、`ssr:assets:publish`、`ssr:smoke`、`ssr:infra:drift`、`ssr:unpublish`、`ssr:infra:destroy` は未実行です。とくに次の点は、実環境での確認待ちです。

- Nitro の handler が、Node.js 24 の Lambda runtime と function URL で動くこと
- OAC の署名付きリクエストを function URL が受け入れ、直接のリクエストを 403 で断ること
- cache policy が意図どおりに働くこと（公開ページが cache され、`/me` がされないこと）。`x-cache` と `age` ヘッダーでそれを判定できること
- `minTtl` と `defaultTtl` が 0、`maxTtl` が 60 の cache policy で、圧縮の設定を有効にできること
- response headers policy による `Set-Cookie` の除去
- CloudFront が許可していない method（POST）に返す status
- streaming の経路全体。function URL の `RESPONSE_STREAM`、CloudFront が stream を少しずつ流すこと、stream した応答が圧縮されないこと
- handler の形と `InvokeMode` が食い違ったときの応答
- 404 に `no-store` を付けたときの、CloudFront の error caching の動き
- cdkd 0.296.28 が、`AWS::CloudFront::CachePolicy` と `AWS::CloudFront::ResponseHeadersPolicy` を Cloud Control API 経由で作成・更新・削除できること

**cdkd が扱うリソースの種類。** npm の tarball（0.296.28）で、専用の実装が登録されていることを確かめたもの: `AWS::CloudFront::Distribution`、`AWS::CloudFront::OriginAccessControl`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Lambda::Url`、`AWS::Logs::LogGroup`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy`。専用の実装がなく、Cloud Control API 経由になるもの: `AWS::CloudFront::CachePolicy`、`AWS::CloudFront::ResponseHeadersPolicy`。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| Nuxt を Lambda の形にする | `examples/09-ssr/nuxt.config.ts`、`scripts/lambda-harness.ts` | `build:ssr`、`ssr:check:output` |
| アプリは小さく | `examples/09-ssr/app/`、`server/api/`、`server/context.ts`、`core/notes.ts`、`core/seed.ts` | `dev:ssr`、`typecheck:ssr`、`lint:ssr` |
| CloudFront から Lambda へ | `examples/09-ssr/infra/lib/ssr-stack.ts`、`infra/bin/app.ts`、`infra/test/ssr-stack.test.ts`、`cdk.json` | `ssr:infra:synth`、`test:unit` |
| cache の境界 | `examples/09-ssr/core/routes.ts`、`core/cache-control.ts`、`server/plugins/cache-control.ts`、`test/cache-control.test.ts`、`test/support/shared-cache.ts` | `test:unit`、`ssr:check:output` |
| BFF: token はサーバーに置く | `examples/09-ssr/core/session.ts`、`core/profile.ts`、`core/env.ts`、`server/routes/me/`、`test/session.test.ts` | `dev:ssr`、`test:unit` |
| streaming は経路ぜんぶの話 | `examples/09-ssr/server/routes/feed.get.ts`、`scripts/lambda-harness.ts` | `build:ssr:stream`、`ssr:check:output:stream` |
| 手元で動かす | `examples/09-ssr/scripts/check-output.ts`、`test/`、`.env.example` | `dev:ssr`、`test:unit`、`typecheck`、`ssr:check:output` |
| デプロイして確かめる | `examples/09-ssr/scripts/publish-assets.ts`、`scripts/asset-plan.ts`、`scripts/smoke.ts`、`scripts/smoke-spec.ts` | `ssr:infra:deploy`、`ssr:assets:publish`、`ssr:smoke`、`ssr:infra:drift` |
| 誰に、どれだけ古いものを見せるか | `examples/09-ssr/core/cache-control.ts`、`scripts/asset-plan.ts` | `test:unit` |
| 片付け | `tools/src/site/unpublish.ts`、`tools/src/infra/` | `ssr:unpublish`、`ssr:infra:destroy` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-11）

- [Restrict access to an AWS Lambda function URL origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)
- [Control access to Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)、[Invoking Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html)
- [Response streaming for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html)、[Invoking a response streaming enabled function using Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-invoke-furls.html)
- [Select a method to invoke your Lambda function using an HTTP request](https://docs.aws.amazon.com/lambda/latest/dg/furls-http-invoke-decision.html)
- [Manage how long content stays in the cache (expiration)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)、[Understand cache policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cache-key-understand-cache-policy.html)
- [Cache content based on cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Cookies.html)、[Understand response headers policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/understanding-response-headers-policies.html)
- [Serve compressed files](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html)、[How CloudFront processes HTTP 4xx and 5xx status codes from your origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HTTPStatusCodes.html)、[Origin settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesOrigin.html)
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)、AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)
- [nuxt 4.6.1](https://www.npmjs.com/package/nuxt/v/4.6.1)、[nitropack 2.13.4](https://www.npmjs.com/package/nitropack/v/2.13.4)、[@vizejs/nuxt 0.443.0](https://www.npmjs.com/package/@vizejs/nuxt/v/0.443.0)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)
- [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [Cloudflare Workers: Nuxt](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/nuxt/)

:::
