---
title: "09 SSR: 費用、注意点、片付け"
---

# 09 SSR: 費用、注意点、片付け

[デプロイ](/ja/chapters/09-ssr/deploy.md)の手順まで進みました。この章の最後のページでは、Cloudflare Workers との違い、料金、つまずきやすい点、本番に向けて足すもの、片付けをまとめます。

## Workers から来た人へ

<!-- section: 09.workers -->

Nuxt を Cloudflare Workers にデプロイしたことがある人には、この章の手順は遠回りに見えたはずです。違いを表にまとめます。

| | Cloudflare Workers | この章（CloudFront と Lambda） |
| --- | --- | --- |
| ビルド | Nitro の Cloudflare 向けプリセット | Nitro の `aws-lambda` プリセット |
| デプロイ | `wrangler deploy` が Nuxt を検出して、`.output/server/index.mjs` と `.output/public` を設定する | アセットを S3 に置くタスクと、関数とディストリビューションを作るスタックを、自分で用意する |
| HTML を作る場所 | Cloudflare のネットワーク上の Worker | 東京リージョンの Lambda。エッジではない |
| 静的アセットとの振り分け | 設定の `assets` にディレクトリを書く | ディストリビューションのビヘイビアをパスごとに自分で書く |
| 他のサービスとの接続 | binding | AWS SDK と実行ロール |

AWS のほうが、自分で決めることが多くなります。この章で書いたキャッシュポリシー、ビヘイビア、OAC、アセットを置く順番は、Workers なら大部分をプラットフォームが決めます。

そのかわり、決めたことはすべてコードに残っています。どのパスに cookie が届くのか、何秒キャッシュされるのか、関数を直接呼べるのは誰かは、スタックとテストを読めばわかります。

どちらでも変わらないことが 1 つあります。ログイン中のページを共有キャッシュに載せないようにするのは、どのプラットフォームでもアプリを書く人の仕事です。なお、Workers の静的アセットがどうキャッシュされ、どう課金されるかは、この章のためには読んでいません。

## 料金

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**誰も来ない月は、ほぼ 0 です。** かかるのは S3 に置いたアセットの保存料金だけで、5 MB なら USD 0.000125、四捨五入すると USD 0.00 です。function URL に追加料金はなく、Lambda も CloudFront も、リクエストがなければ請求されません。

月 10 万ページビューの場合は、次の表のとおりです。1 ページビューあたり CloudFront へ 4 リクエストで合計 100 KB、HTML と API のリクエストの半分がキャッシュに当たって残りの 5 万件が Lambda に届く、Lambda は平均 200 ミリ秒・512 MB・arm64、という仮定で計算しています。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| CloudFront の HTTPS リクエスト | 40 万件 | 0.48 | 0 |
| CloudFront のデータ転送 | 9.537 GB | 1.09 | 0 |
| Lambda のリクエスト | 5 万件 | 0.01 | 0 |
| Lambda の実行時間 | 5,000 GB 秒 | 0.07 | 0 |
| CloudWatch Logs の取り込みと保存 | 0.014 GB | 0.01 | 0 |
| S3 の GET、PUT、保存 | 3 万件、200 件、0.005 GB 月 | 0.01 | 0.01（無料枠は確認できず、引いていない） |
| 小計 | | **1.67** | **0.01** |

この表の金額を最も大きく左右するのは、キャッシュに当たる割合です。半分というのは仮定で、根拠のある値ではありません。割合が 0 なら Lambda の行は 2 倍になり、ほとんど当たるなら 0 に近づきます。実際の値は、デプロイして計るしかありません。

200 ミリ秒という実行時間も仮定で、計測していません。あなたの関数の値は、04章と同じく、ログの `REPORT` 行でわかります。

Lambda から CloudFront へのデータ転送は、この表に入れていません（0 という意味ではなく、未算入です）。ストリーミングを使う場合の料金は、[しくみと実装](/ja/chapters/09-ssr/build.md)の「buffered を既定にした理由」に書いたとおりで、buffered のままなら発生しません。

### 叩かれたら

このディストリビューションは、URL を知っていれば誰でも呼べて、サインインも要りません。ボットが大量にリクエストを送ってきたときに何が関数を守り、何が守らないのかを、順に確かめます。

公開ページを守るのはキャッシュです。キャッシュキーはパスだけで、cookie も、ヘッダーも、クエリ文字列も入っていません。そのため、同じページに何回リクエストが来ても、`?x=<乱数>` を付けられても、関数が動くのはキャッシュが切れたとき（60 秒に 1 回）だけです。`/feed` は行と行のあいだで 300 ミリ秒待つので 3 行で 0.6 秒かかり、この章でいちばん重いルートですが、200 を返す公開の GET なので同じようにキャッシュされます。

キャッシュで守れないリクエストは 2 種類あります。

- `/me` と `/me/*`。キャッシュを無効にしてあるので、1 回ごとに関数が動きます
- 存在しないパス。404 には `no-store` を付けて返すので、`/a1`、`/a2`、… とパスを変えてリクエストされると、毎回関数が動きます（CloudFront が 404 をどのくらい保持するかは、確かめていません）

この 2 種類には、既定では上限がありません。歯止めになるのは、アカウント全体の Lambda の同時実行数の上限だけです（あなたのアカウントの値は Service Quotas で見られます。この本では確かめていません）。同時実行 1 つが 1 か月動き続けると、512 MB なので 129.6 万 GB 秒、USD 17.28 です。上限が 100 なら USD 1,728、1,000 なら USD 17,280 になります。この金額は実行時間だけを数えた最悪の場合で、リクエスト料金とログの料金がさらに加わります。

`-c reservedConcurrency=5` を付けると、関数が同時に動く数は 5 までになり、料金にも上限ができます。

| 対象 | 数量（1 か月、5 つがずっと動き続けた場合） | 定価 |
| --- | --- | --- |
| Lambda の実行時間 | 5 × 0.5 GB × 2,592,000 秒 = 648 万 GB 秒 | 86.40 |
| Lambda のリクエスト | 1 回 200 ミリ秒として 6,480 万件 | 12.96 |
| CloudWatch Logs の取り込みと保存 | 1 回 0.3 KB として 18.54 GB | 14.23 |
| 小計 | | **113.59** |

200 ミリ秒と 0.3 KB は、月 10 万ページビューの表と同じ仮定です。上限ができるのは Lambda の側だけで、CloudFront のリクエスト料金（100 万回あたり USD 1.20）には上限がありません。断られたリクエストにも CloudFront の料金はかかります。

上限に当たっているあいだは、キャッシュにないページが本物の読者にもエラーになります。予約済み同時実行数で守れるのは料金で、サイトの可用性は守れません。大量のリクエストが止まれば、元に戻ります。

予約済み同時実行数を付けるのは、URL を人に教える前と、スタックを数日以上残しておくときです。試してすぐ消すなら、付けなくてもかまいません。デプロイが同時実行数のエラーで失敗したら、あなたのアカウントの枠が足りていないので、外してデプロイし直してください。

さらに足せる対策は、10章の「叩かれたら」と同じです。AWS WAF のレートベースのルール（[21章](/ja/chapters/21-security.md)。web ACL が月 USD 5、ルール 1 つにつき月 USD 1、検査 100 万回あたり USD 0.60。21章の構成はルールが 3 つなので、月 USD 8.00 から）は、同じ IP アドレスからのリクエストの回数を、関数に届く前に絞ります。function URL は直接呼べなくしてあるので、WAF を迂回されることもありません。CloudFront の定額プラン（月 USD 0、15、200、1,000）は、何が含まれるかを確認していません。

## つまずきやすいところ

この表は、設定と一次情報から「こうなるはず」と読めるものをまとめたもので、実機で起こして確かめたものではありません。

| こうなったら | ここを見る |
| --- | --- |
| `ssr:infra:synth` が `.output is missing` で止まる | 先に `vp run build:ssr` を実行します。スタックはビルドの出力をデプロイします |
| デプロイ後、すべてのページが 403 になる | function URL のリソースポリシーに、ディストリビューションからの 2 つの許可があるかを見ます。`ssr:infra:drift` で差を確認できます |
| HTML は出るのに画面が動かない。`/_nuxt/` のファイルが 404 になる | `ssr:assets:publish` を実行したかを確かめます。関数だけが新しくなっています |
| `/me` をいつ開いてもサインインしていない | デプロイした環境では正しい動きです。練習用のサインインは手元でしか使えません |
| 公開ページに足した「ログイン中の名前」が、デプロイすると出ない | 公開側のビヘイビアは cookie を Lambda に届けません。人によって変わる表示は `/me` の下に置くか、ブラウザから `/me/` の API を呼んで出します |
| フォームを足したら、送信が 403 になる | ディストリビューションは GET と HEAD だけを通します。OAC と POST の制約は、[しくみと実装](/ja/chapters/09-ssr/build.md)の「function URL を公開のままにしない」にあります |
| `ssr:infra:deploy -c reservedConcurrency=5` が、同時実行数についてのエラーで失敗する | アカウントの同時実行数の枠が小さく、取り分けられません。`-c reservedConcurrency` を外してデプロイし、Service Quotas で枠を確認します |
| `-c reservedConcurrency=...` で synth が止まる | 値が 1 以上の整数かを確かめます。0 は関数を止めてしまうので受け付けません |
| 人が増えた時間帯に、キャッシュにないページだけエラーになる | 予約済み同時実行数の上限に当たっています。ログとメトリクスでスロットリングを確認し、数を上げるか、キャッシュする時間を延ばします |
| 直したのに、古いページが出る | 60 秒待つか、無効化（invalidation）を実行します。切り替わる時刻はエッジごとに違います |
| ストリーミングに切り替えたのに、少しずつ届かない | `.output/nitro.json` の `streaming` と、テンプレートの `InvokeMode` を見比べます。合っていれば、次に疑うのは CloudFront です（まだ確かめられていない区間） |

## 本番にするなら

- 本物のサインインを足します。セッションを DynamoDB に置き、06章の認可コードを BFF でトークンに交換します。POST の入口は、API Gateway を挟むか、ブラウザ側で本文のハッシュを付けるかのどちらかを選びます
- セッション cookie には必ず `Secure` を付けます。練習用のコードは、手元の `http://localhost` で動かすために、プロトコルを見て切り替えています
- キャッシュする時間をページごとに決めます。全ページ 60 秒は学習用の値です。ほとんど変わらないページはもっと長くし、在庫のように古いと困るものはキャッシュしません
- WAF を CloudFront に付けます。function URL を直接呼べなくしてあるので、CloudFront に付けた WAF は迂回されません。レートベースのルールを使うと、`/me` と 404 への大量のリクエストを関数の手前で絞れます
- 同時実行数を決めて、監視します。`-c reservedConcurrency=N` の N は、実際のトラフィックから決めます。関数の同時実行数が上限に達すると、超えたリクエストは関数を動かさずに断られます。そのとき function URL と CloudFront が返すステータスは、このページの検証メモに書いたとおり、確かめていません。キャッシュに当たらないページへのアクセスが急に増えると、この上限に届きます。スロットリングのメトリクスにアラームを付けておきます（[19章](/ja/chapters/19-observability.md)）
- 404 を短くキャッシュします。いまは `no-store` なので、存在しないパスへのリクエストは毎回関数を動かします。数秒でもキャッシュすれば、同じパスに続けて来るリクエストでは、そのあいだ関数が動きません。パスを変えられると効かないので、WAF の代わりにはなりません
- エラーページを用意します。Lambda が落ちているときに CloudFront が返すページは、カスタムエラーレスポンス（custom error response）で決められます
- 反映の経路を AWS CDK CLI と CloudFormation にします。理由は 02章で説明したとおりです

## 片付け

<!-- section: 09.cleanup -->

```bash
vp run ssr:unpublish --yes
vp run ssr:infra:destroy
```

cdkd は中身のあるバケットを消せないので、先にアセットを消してバケットを空にします。そのあとで、関数、function URL、ロール、ロググループ、バケット、ディストリビューション、キャッシュポリシー、レスポンスヘッダーポリシーが消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。手元の `.output`、`.nuxt`、`cdk.out` は git の管理外なので、消してかまいません。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテストと CDK のアサーション（`test:unit`）。TypeScript の型検査（`typecheck`）と、Vize による `.vue` の型検査と lint（`typecheck:ssr`、`lint:ssr`）。わざと型エラーを入れると `vize check` が失敗することも確認しました。`build:ssr` と `build:ssr:stream`（Nuxt 4.6.1、nitropack 2.13.4、`@vizejs/nuxt` 0.443.0）。ビルドしたハンドラーを呼ぶ検査（`ssr:check:output` と `ssr:check:output:stream`）。buffered では `/feed` が 1 回で、ストリーミングでは 3 回（約 300 ミリ秒おき）に分けて書かれ、HTML はどちらでも 1 回で書かれました。`ssr:infra:synth`。`dev:ssr` を起動し、公開ページ、404、`/me`、サインイン、サインアウト、別のサイトからの POST の拒否、`/feed` が少しずつ届くことを HTTP で確認しました。キャッシュポリシーがクエリ文字列をキャッシュキーに入れないこと、`reservedConcurrency` を渡さなければテンプレートに同時実行数の設定が出ず、渡せばその数が出ること、0 や整数でない値で synth が止まることは、CDK のアサーションで確認しました。

**まだ確かめていないこと。** AWS には何もデプロイしていません。`ssr:infra:diff`、`ssr:infra:deploy`、`ssr:assets:plan`、`ssr:assets:publish`、`ssr:smoke`、`ssr:infra:drift`、`ssr:unpublish`、`ssr:infra:destroy` は未実行です。とくに次の点は、実環境での確認待ちです。

- Nitro のハンドラーが、Node.js 24 の Lambda ランタイムと function URL で動くこと
- OAC の署名付きリクエストを function URL が受け入れ、直接のリクエストを 403 で断ること
- キャッシュポリシーが意図どおりに働くこと（公開ページがキャッシュされ、`/me` がされないこと）。`x-cache` と `age` ヘッダーでそれを判定できること
- `minTtl` と `defaultTtl` が 0、`maxTtl` が 60 のキャッシュポリシーで、圧縮の設定を有効にできること
- レスポンスヘッダーポリシーによる `Set-Cookie` の除去
- CloudFront が許可していないメソッド（POST）に返すステータス
- ストリーミングの経路全体。function URL の `RESPONSE_STREAM`、CloudFront がストリームを少しずつ流すこと、ストリームしたレスポンスが圧縮されないこと
- ハンドラーの形と `InvokeMode` が食い違ったときのレスポンス
- 404 に `no-store` を付けたときの、CloudFront の error caching の動き
- `QueryStringBehavior: none` のキャッシュポリシーで、クエリ文字列付きのリクエストが同じキャッシュに当たること。クエリ文字列が Lambda に届かないこと
- `ReservedConcurrentExecutions` を付けたデプロイが、作ったばかりのアカウントで通るかどうか。cdkd 0.296.28 がこのプロパティを反映すること。上限に当たったときに function URL と CloudFront が返すステータスと、そのレスポンスがキャッシュされないこと
- 「叩かれたら」の金額。単価と仮定からの計算で、請求で確かめたものではありません。アカウントの同時実行数の上限も確認していません
- cdkd 0.296.28 が、`AWS::CloudFront::CachePolicy` と `AWS::CloudFront::ResponseHeadersPolicy` を Cloud Control API 経由で作成・更新・削除できること

**cdkd が扱うリソースの種類。** npm の tarball（0.296.28）で専用の実装が登録されていることを確かめたものは、`AWS::CloudFront::Distribution`、`AWS::CloudFront::OriginAccessControl`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Lambda::Url`、`AWS::Logs::LogGroup`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy` です。専用の実装がなく Cloud Control API 経由になるものは、`AWS::CloudFront::CachePolicy` と `AWS::CloudFront::ResponseHeadersPolicy` です。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| Nuxt を Lambda の形にする | `examples/09-ssr/nuxt.config.ts`、`scripts/lambda-harness.ts` | `build:ssr`、`ssr:check:output` |
| 小さなアプリ | `examples/09-ssr/app/`、`server/api/`、`server/context.ts`、`core/notes.ts`、`core/seed.ts` | `dev:ssr`、`typecheck:ssr`、`lint:ssr` |
| CloudFront から Lambda へ | `examples/09-ssr/infra/lib/ssr-stack.ts`、`infra/bin/app.ts`、`infra/test/ssr-stack.test.ts`、`cdk.json` | `ssr:infra:synth`、`test:unit` |
| キャッシュの境界 | `examples/09-ssr/core/routes.ts`、`core/cache-control.ts`、`server/plugins/cache-control.ts`、`test/cache-control.test.ts`、`test/support/shared-cache.ts` | `test:unit`、`ssr:check:output` |
| BFF: トークンはサーバーに置く | `examples/09-ssr/core/session.ts`、`core/profile.ts`、`core/env.ts`、`server/routes/me/`、`test/session.test.ts` | `dev:ssr`、`test:unit` |
| ストリーミングは経路全体で決まる | `examples/09-ssr/server/routes/feed.get.ts`、`scripts/lambda-harness.ts` | `build:ssr:stream`、`ssr:check:output:stream` |
| 手元で動かす | `examples/09-ssr/scripts/check-output.ts`、`test/`、`.env.example` | `dev:ssr`、`test:unit`、`typecheck`、`ssr:check:output` |
| デプロイして確かめる | `examples/09-ssr/scripts/publish-assets.ts`、`scripts/asset-plan.ts`、`scripts/smoke.ts`、`scripts/smoke-spec.ts` | `ssr:infra:deploy`、`ssr:assets:publish`、`ssr:smoke`、`ssr:infra:drift` |
| 許容する古さ | `examples/09-ssr/core/cache-control.ts`、`scripts/asset-plan.ts` | `test:unit` |
| 片付け | `tools/src/site/unpublish.ts`、`tools/src/infra/` | `ssr:unpublish`、`ssr:infra:destroy` |
| 料金 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

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
