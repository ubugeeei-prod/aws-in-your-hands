---
title: "03 Static Hosting: 費用、注意点、片付け"
---

# 03 Static Hosting: 費用、注意点、片付け

この章の締めくくりとして、料金、つまずきやすいところ、本番に向けて変えること、片付け方をまとめます。最後に、同じ構成で配信しているこの本のサイトとの違いにも触れます。

## 料金

料金は 3 つの状態に分けて考えます。金額は USD で、東京リージョンの S3 と日本のエッジの CloudFront を従量課金で使った場合の税別の値です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

使われていないとき、ディストリビューションには存在するだけでかかる料金がありません。かかるのは S3 に保存している量の料金だけです。ビルドの出力は 1 MB に満たないので、定価でも月 USD 0.01 未満です。

使われたときは、次のものに比例して料金がかかります。

| 対象 | 単価（定価） | 毎月の無料枠 |
| --- | --- | --- |
| CloudFront から読者への転送量 | 1 GB あたり USD 0.114（最初の 10 TB） | 1 TB |
| CloudFront への HTTPS リクエスト | 1 万件あたり USD 0.012 | 1,000 万件 |
| CloudFront Functions の実行 | 100 万回あたり USD 0.10 | 200 万回 |
| S3 への GET（キャッシュに無かったとき） | 1 万件あたり USD 0.0037 | 確認できず。0 として扱わない |

CloudFront の無料枠は従量課金の場合のもので、アカウント全体で共有されます。S3 から CloudFront への転送には料金がかかりません。

同じ構成の本のサイトについて、月 2 万ページビューを仮定した計算例が[料金の計算](/ja/reference/pricing.md)にあります。定価で月 USD 0.50 前後、CloudFront の無料枠を引くと USD 0.03 前後です。この金額は仮定を置いた例であり、自分のアプリの見積もりにはなりません。

公開するときにも少し料金がかかります。S3 への PUT は 1,000 件あたり USD 0.0047 です。invalidation は月 1,000 パスまで無料で、それを超えると 1 パスあたり USD 0.005 かかります。

この計算に入っていないものもあります。アクセスログ、AWS WAF、独自ドメイン（Route 53）は、使っていないので 0 です。足せば料金が発生します。

CloudFront には、従量課金のほかに月額固定のプランもあります。確認日の時点では Free、Pro、Business、Premium の 4 つです。プランごとに使える機能が違い、CDK からの指定方法も確認していないので、この本のサンプルは従量課金のままにしています。

## つまずきやすいところ

| 症状 | 確かめること |
| --- | --- |
| 開くと `AccessDenied` の XML が出る | バケットが空ではないか（`spa:publish` を実行したか）。ディストリビューションの反映は終わっているか |
| 新しい版を公開したのに古い画面が出る | `spa:smoke` のリビジョンが一致するか。一致するなら、ブラウザ側のキャッシュが原因。`index.html` に `max-age=0` が付いているかも確認する |
| `/notes/abc` を直接開くとエラーになる | ディストリビューションにフォールバックの関数が付いているか（`spa:infra:diff` で差が無いか） |
| 画面が真っ白で、コンソールに JavaScript の構文エラーが出る | アセットの要求に HTML が返っていないか。`spa:smoke` の「missing asset」の検査を見る |
| `spa:publish` がバケット名を取得できない | `spa:infra:deploy` は成功しているか。別のアカウントやリージョンを見ていないか |

## 本番にするなら

- 独自ドメインと証明書を付ける。Route 53 と ACM を使います。証明書は `us-east-1` に作る必要があります。この本ではまだ扱っていません
- アクセスログを残す。誰がいつ何を要求したかの記録です。保存する量に料金がかかります（ログの料金と保持期間の考え方は [19章](/ja/chapters/19-observability.md)）
- AWS WAF を検討する。料金がかかるので、守るものができてからで構いません（[21章](/ja/chapters/21-security.md)）
- Content-Security-Policy を設定する。管理ポリシーの `SECURITY_HEADERS` には含まれないので、アプリに合わせたレスポンスヘッダーポリシーを自分で定義します
- 反映の経路を AWS CDK CLI と CloudFormation にする。理由は 02章に書いたとおりです
- 公開を CI から実行する。人の端末からではなく、期限の短い認証情報で実行します（鍵を置かずに CI から AWS に入る方法は [20章](/ja/chapters/20-shipping.md)）

## 片付け

<!-- section: 03.cleanup -->

```bash
vp run spa:unpublish --yes
vp run spa:infra:destroy
```

固定した版の cdkd は、空でないバケットを消せずに失敗するので、先にバケットを空にします。`--yes` を付けずに実行すると、消す対象の数を表示するだけで、何も消しません。

ディストリビューションの削除には時間がかかります。削除の前に、すべてのエッジで配信を止める必要があるからです。

消したあとに残るのは、02章の bootstrap で作った cdkd の 3 つの保存場所と、そこに置かれたデプロイ用のファイルだけです。この章のスタックはログを作らないので、ほかには何も残りません。

## 本のサイトとの違い

<!-- section: 03.book-site -->

この本のサイトも、同じ「非公開の S3 と CloudFront」の構成で配信しています。ただし、URL の扱いが違います。

| | この章の SPA | 本のサイト |
| --- | --- | --- |
| HTML の数 | 1 つ（`index.html`） | ページごとに 1 つ |
| ファイルに対応しない URL | `index.html` を返す | 404 のページを 404 として返す |
| 関数がすること | クライアント側の URL を `/index.html` に書き換える | `/ja/chapters/03-spa/` を `/ja/chapters/03-spa/index.html` に書き換える |

本のサイトに SPA フォールバックを使うと、リンク切れがすべてトップページとして表示され、壊れていることに気づけなくなります。同じ部品を使っていても、何を配信するかによって正しい設定は変わります。本のサイトの実装は[本のサイトを再現する](/ja/reference/book-site.md)にあります。

::: details この章の検証メモ

**手元で確かめたこと。** SPA の起動、型検査、ユニットテスト、ビルド、CDK の synth と assertion、公開の計画と smoke の検査の定義に対するテスト。

**まだ確かめていないこと。** `spa:infra:deploy`、`spa:publish`、`spa:smoke`、`spa:infra:drift`、`spa:unpublish`、`spa:infra:destroy` は、実際の AWS アカウントでは実行していません。とくに、cdkd が `AWS::CloudFront::Function` を作成・読み戻しできること、`cdkd state show` の出力からスタックの output を読む処理が実際の出力の形に合っていることは、実環境での確認待ちです。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 手元で動かす | `examples/03-spa/src/`、`examples/03-spa/index.html`、`examples/03-spa/vite.config.ts` | `dev:spa`、`lint:vue`、`typecheck:vue`、`test:unit`、`build:spa`、`preview:spa` |
| バケットは非公開のまま、ディストリビューションを定義する | `examples/03-spa/infra/lib/spa-stack.ts`、`examples/03-spa/infra/bin/app.ts`、`examples/03-spa/infra/test/spa-stack.test.ts`、`examples/03-spa/cdk.json` | `spa:infra:synth`、`test:unit` |
| /notes/abc を直接開いたとき | `examples/03-spa/infra/functions/spa-fallback.js`、`examples/03-spa/infra/test/spa-fallback.test.ts` | `test:unit` |
| デプロイする | `tools/src/infra/` | `spa:infra:diff`、`spa:infra:deploy`、`spa:infra:drift` |
| 公開する | `tools/src/site/plan.ts`、`tools/src/site/plan.test.ts`、`tools/src/site/publish.ts`、`tools/src/site/bucket.ts`、`tools/src/site/revision.ts`、`tools/src/site/invalidate.ts`、`tools/src/infra/outputs.ts` | `spa:publish:plan`、`spa:publish`、`spa:invalidate` |
| 届いたことを確かめる | `tools/src/site/smoke-spec.ts`、`tools/src/site/smoke-spec.test.ts`、`tools/src/site/smoke.ts` | `spa:smoke` |
| 片付け | `tools/src/site/unpublish.ts` | `spa:unpublish`、`spa:infra:destroy` |
| 料金 | `data/pricing/`、`tools/src/pricing/` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-11）

- [Restrict access to an Amazon S3 origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [Amazon S3 API: GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)
- [Restrictions on CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html)
- [Amazon CloudFront pay-as-you-go pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)、[Amazon CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/)
- AWS Price List bulk API: [CloudFront](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json)、[S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
