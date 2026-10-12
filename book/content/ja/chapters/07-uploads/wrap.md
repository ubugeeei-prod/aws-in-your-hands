---
title: "07 File Upload: 費用、注意点、片付け"
---

# 07 File Upload: 費用、注意点、片付け

この章の最後のページです。Cloudflare R2 との違い、料金、つまずきやすいところ、本番に進めるときに変えることをまとめ、作ったものを片付けます。

## R2 から来た人へ

Cloudflare R2 にも署名付き URL があります。R2 の公式ドキュメントによると、対応する操作は `GET`、`HEAD`、`PUT`、`DELETE` で、HTML のフォームによる POST のアップロードには、いまのところ対応していません。そのため、この章の `content-length-range` を使う方法は、R2 にはそのまま持っていけません。同じドキュメントには、署名付き URL が S3 API のドメインでだけ動き、custom domain では使えないことと、ベアラートークンとして扱うべきことも書いてあります。

Workers から R2 を使う場合は、署名付き URL を使わず、binding で Worker の中から読み書きする構成も多いと思います。その場合、画像は Worker を通ります。これはこの章が避けた、関数を通す方法にあたりますが、Worker と Lambda では、通したときの制約も料金も違います。Worker の側の制約と料金は、確認していません。

## 料金

金額は USD、東京リージョン、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

S3 で料金がかかるのは、次の 3 つです。1 つ目は保存している量で、最初の 50 TB までは 1 GB あたり月 USD 0.025 です。2 つ目はリクエストの数で、PUT、POST、LIST は 1,000 件あたり USD 0.0047、GET などは 10,000 件あたり USD 0.0037 です。3 つ目は S3 からインターネットへ出ていくデータの量で、最初の 10 TB までは 1 GB あたり USD 0.114 です。インターネットから S3 へ入るデータは USD 0 です。

例として、月に 10,000 枚、1 枚 1 MB の画像がアップロードされ、画像が 100,000 回表示される場合を計算します。数えるのは、06章のアプリの料金に上乗せされるぶんだけです。

| 対象 | 定価 |
| --- | --- |
| S3 の保存（10 GB） | 0.25 |
| S3 のリクエスト（POST 10,000、HEAD 10,000、GET 100,000） | 0.09 |
| S3 からのデータ転送（約 97.7 GB） | 11.13 |
| API の側（API Gateway、Lambda、ログ、DynamoDB の 120,000 リクエスト分） | 0.29 |
| 小計 | **11.76** |

ほとんどがデータ転送です。画像は、置くことより配ることに料金がかかります。この計算は、ブラウザのキャッシュがまったく働かないと仮定しています。署名付き URL は毎回違うので、同じ画像でも URL が変わると、ブラウザは読み直します。表示が多いアプリでは、CloudFront を前に置く構成を検討してください。

毎月の無料枠を引いた後の小計は 11.67 です。ただし、引いているのは Lambda とログの無料枠で、この枠は 06章の利用分と共有です。06章の例のように月 100 万リクエストを使っていれば、Lambda の無料枠はもう残っていません。データ転送の単価には、無料枠を超えたぶんという説明が付いていますが、その無料枠の大きさは確認できていないので、何も引いていません。S3 の無料枠も同じ扱いです。

タグの保存にも料金がありますが、タグが付いているのは完了するまでの間だけなので、計算に入れていません。タグを外すリクエストは、公式ドキュメントによると請求されません。

**誰も使わない月でも、置いてある画像の保存料金はかかります。** 10 GB なら月 USD 0.25 です。記録のないまま残ったオブジェクトも、同じ単価で数えられます。掃除が要るのは、このためです。

スタックを消すと、バケットも中の画像も消えます。残るものは「片付け」に書いたとおりです。

### 叩かれたら

API の側は、06章と同じです。サインインしていない相手に届くのは `/health` だけです。ステージのスロットリングは 1 秒 10 リクエストで、テーブルにはリクエストユニットの上限があります。06章の「叩かれたら」の表（月 USD 182.83）が、そのままこの章の API の上限になります。この章で足されるのは、完了の呼び出しが 1 回ずつ送る `HeadObject` で、2,592 万回すべてが完了の呼び出しだったとしても USD 9.59 です。

この章で増えたのは、API を通らない経路です。許可証と表示用の URL を使ったリクエストは S3 に直接届くので、API Gateway のスロットリングは働きません。この経路を、置かれる量、アップロードの回数、画像の読み出しの順に見ます。

- 置かれる量には上限があります。未完了のオブジェクトは、1 人 1 日 100 個、500 MB までです。1 日後に消えるので、毎日上限まで続けられても、置かれているのは 0.5 GB 前後で、月 USD 0.01 ほどです（S3 の削除が遅れれば、そのぶん増えます）。添付まで済んだ画像は、1 人につきノート 100 件 × 10 枚 × 5 MB で、約 4.9 GB、月 USD 0.12 までです
- アップロードの回数には上限がありません。許可証は 5 分間、何度でも使えます。同じキーへの上書きなので量は増えませんが、S3 への POST は 100 万回あたり USD 4.70 です。S3 が 1 秒に何回まで受け付けるかは、この本では確かめていません
- 画像の読み出しには上限がありません。表示用の URL は 5 分間、持っている人なら誰でも、何度でも読めます。かかるのはデータ転送で、5 MB の画像 1 枚を 1 万回読まれると 48.8 GB、USD 5.57 です。この章でいちばん大きくなりうるのは、この料金です

上限のない 2 つを使えるのは、サインインした利用者と、その利用者から URL やフォームを受け取った人だけです。利用者はあなたが作った人だけなので、知らない相手がいきなりこの経路に届くことはありません。それでも、利用者を広く受け入れるアプリにするなら、閉じておきたい経路です。画像を CloudFront から配れば、キャッシュが働き、AWS WAF も付けられます（[21章](/ja/chapters/21-security.md)。web ACL が月 USD 5、ルール 1 つにつき月 USD 1、検査 100 万回あたり USD 0.60。21章の構成はルールが 3 つなので、月 USD 8.00 から）。この本では、画像を CloudFront から配る構成は実装していません。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `dev:uploads:api` が `UPLOADS_STORE` を示して止まる | `examples/07-uploads/.env` があるかを確かめます。なければ `.env.example` をコピーしてください |
| 画面に「The upload was refused (HTTP 403)」と出る | 許可証を受け取ってから 5 分以上たっていないかを確かめます。たっていたら、もう一度ファイルを選んでください |
| S3 への POST が 403 を返す | フォームの欄の値がポリシーと違うと、条件を満たしません。SDK が返した `fields` をそのまま、`file` の欄を最後にして送っているかを確かめます。S3 が実際に返すレスポンスの中身は、まだ確かめていません |
| S3 への POST が、ブラウザのコンソールでは CORS のエラーになる | SPA のオリジンが、バケットの CORS の `AllowedOrigins` と完全に一致しているかを確かめます。まず `curl` で状態コードを見てください |
| 完了の呼び出しが 409 `upload_missing` を返す | S3 への POST が 204 を返したかを確かめます。返していなければ、オブジェクトはありません |
| 完了の呼び出しが 500 を返し、ログに 403 がある | 実行ロールに `s3:ListBucket` がないと、存在しないキーへの `HeadObject` は 403 になります |
| 許可証の依頼が 429 `upload_quota_exceeded` を返す | その利用者が、今日（UTC）すでに 100 枚の許可証を受け取っています。使わなかったものも数えます。日付が変わると通ります |
| 完了の呼び出しが 409 `upload_rejected` を返す | 送ってから 15 分以上たっています。もう一度送ってください |
| 画像がしばらくすると表示されなくなる | URL の期限（5 分）が切れています。画面は一覧を取り直します。それでも直らなければ、オブジェクトが消えています |
| S3 が `ExpiredToken` を返す | URL に署名した認証情報が失効しています。一覧を取り直すと、新しい認証情報で署名した URL が返ります |

## 本番にするなら

- 同じフォームの再送を防ぎます。理由は[この設計に残る穴](/ja/chapters/07-uploads/build.md)に書いたとおりです
- 掃除を定期的に動かします。手で実行するタスクのままでは、いつか実行し忘れます（[08章](/ja/chapters/08-async.md)）
- 中身を確かめます。S3 は、ファイルが本当に画像かどうかを見ません。アップロードの後で検査する処理を足します
- 配り方を見直します。表示が多いなら CloudFront を前に置きます。データ転送の料金と、キャッシュの働き方が変わります
- バケットを守ります。`removalPolicy` を `RETAIN` にして、バージョニングを検討します。バージョニングを有効にすると、ライフサイクルルールの動きも変わります
- 上限の数字を決め直します。ノート 1 つに 10 枚、1 人 100 ノート、許可証は 1 人 1 日 100 枚という数字は、どれも練習用に置いたものです。あなたのアプリの使われ方から決めてください。日付ごとの許可証の数は、テーブルの TTL で消します
- S3 に直接届く経路を閉じます。「叩かれたら」に書いたとおり、アップロードの回数と画像の読み出しには上限がありません
- 手元のオリジンを外します。バケットの CORS と API の CORS から `http://localhost:5173` を消します
- アクセスの記録を取ります。署名付き URL が誰に使われたかは、API のログには残りません。S3 の側の記録が要ります（この本では扱っていません）

## 片付け

<!-- section: 07.cleanup -->

```bash
vp run uploads:empty --yes
vp run uploads:unpublish --yes
vp run uploads:infra:destroy
```

固定した版の cdkd は、空でないバケットを消さないので、先に 2 つのバケットを空にします。`uploads:empty` はアップロードされた画像を、`uploads:unpublish` は SPA のファイルを消します。どちらも、`--yes` を付けなければ、数を数えるだけです。

`uploads:infra:destroy` で、バケット、テーブル、ユーザープール、関数、API、ディストリビューションが消えます。画像も、ノートも、利用者も、元には戻せません。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** 次のテストと検査を実行しました。API のテスト（認可、許可証の中身、完了、期限、上限）、途中で止めるテスト（[途中で止めるテスト](/ja/chapters/07-uploads/build.md)の表の 6 行と、掃除、同じフォームの再送）、キーの組み立て、SDK が作る POST ポリシーと署名付きの GET の中身（偽の認証情報で署名しただけで、S3 には送っていません）、DynamoDB へのリクエストの形、インフラのアサーション、型検査、SPA のビルド、synth です。また、`dev:uploads:api` と `dev:uploads:web` を起動し、ブラウザを自動操作して次のことを確かめました。サインインできること、ノートを作成できること、ファイルを選ぶと画像が表示されること、別の利用者からの許可・一覧・完了が 404 になること、大きすぎるファイル・違う種類・違うキーが拒否されること、完了を 2 回呼んでも同じ結果になること、削除とノートの削除の後に画像の URL が読めなくなることです。今回足した上限は、テストで確かめました。1 人の 101 枚目の許可証が 429 になり、ほかの利用者には影響せず、日付が変わると戻り、ほかの理由で断ったリクエストは数えないことと、101 件目のノートが 409 になることです（どちらも `composeApp` を通して確かめました）。テンプレートのステージにスロットリングが、テーブルにリクエストユニットの上限があることも確かめています。アプリを、`Request` を受けて `Response` を返す関数に書き直したあとは、テスト、型検査、SPA の型検査と lint とビルドをやり直しました。足したテストは、1 KiB を超えるボディが 413 になること、JSON でないボディが CORS のヘッダーとリクエスト ID の付いた 400 になること、手元のバケットの代わりが、終わらないボディを上限で読むのをやめて 413 を返すことです。そのうえで `dev:uploads:api` と同じ入口を起動し、`curl` で次のことを確かめました。開発用サインインでトークンを受け取れること、トークンなしが 401 になること、SVG の許可が 400 になること、許可証を受け取ってフォームを送ると 204 が返ること、6 MB のファイルが 413 になること、完了と一覧、署名付きの URL から同じバイト列を読めること、削除の後はその URL が 403 になることです。このとき、ブラウザでの確認はやり直していません。Lambda の入口は、インフラのテストがバンドルするところまでで、イベントを渡して動かしてはいません。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`uploads:infra:deploy`、`uploads:user:create`、`uploads:publish`、`uploads:smoke:web`、`uploads:smoke:api`、`uploads:sweep`、`uploads:infra:drift`、`uploads:empty`、`uploads:unpublish`、`uploads:infra:destroy` のどれも実行していません。したがって、次のことは実物の S3 で確かめていません。`tagging` の欄を含む署名付きの POST を S3 が受け付けること、`content-length-range` と `Content-Type` の条件で S3 が拒否することと、そのときのレスポンス、ブラウザからの POST がバケットの CORS の規則で通ること、POST の直後の `HeadObject` がオブジェクトを見つけること（強い整合性の説明は PUT と DELETE を名指ししていて、POST Object は名指ししていません）、ライフサイクルルールが pending のオブジェクトを消すこと、`DeleteObjectTagging` の後は消されないことです。DynamoDB 用の実装（`dynamodb-attachment-repository.ts`）は、リクエストの形をテストで固定しただけで、DynamoDB Local にも実物にも送っていません。実行ロールの認証情報の寿命は、公式ドキュメントで確認できませんでした。S3 互換のローカル実装は使っていません（Docker のデーモンが動いていませんでした）。上限についても、実物では確かめていません。許可証を数える条件付きの更新（`permit-ledger.ts`）は、リクエストの形をテストで固定しただけです。cdkd 0.296.28 がステージの `DefaultRouteSettings` とテーブルの `OnDemandThroughput` を反映するかどうかと、スロットリングが API 全体で数えられるのかルートごとなのか（この章は 11 ルート）も、06章と同じく未確認です。S3 が 1 つのキーへの POST を 1 秒に何回受け付けるかは調べていません。「叩かれたら」の金額は、単価と仮定からの計算です。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 許可証を作る | `examples/07-uploads/api/src/contract.ts`、`api/src/object-store.ts`、`api/src/s3-object-store.ts`、`api/test/s3-object-store.test.ts` | `test:unit` |
| キーは API が決める | `examples/07-uploads/api/src/keys.ts`、`api/src/attachments.ts`、`api/src/app.ts`、`api/src/permit-ledger.ts`、`api/test/keys.test.ts`、`api/test/app.test.ts`、`api/test/permit-ledger.test.ts`、`api/test/compose.test.ts` | `test:unit` |
| 2 つの置き場所、1 つの順序 | `examples/07-uploads/api/src/attachments.ts`、`api/src/attachment-repository.ts`、`api/src/dynamodb-attachment-repository.ts`、`api/src/client.ts`、`api/test/partial-failure.test.ts`、`api/test/harness.ts` | `test:unit` |
| 残ったものを片付ける | `examples/07-uploads/api/src/sweep.ts`、`scripts/sweep.ts`、`infra/lib/uploads-stack.ts` | `test:unit`、`uploads:sweep` |
| 画像を見せる | `examples/07-uploads/api/src/s3-object-store.ts`、`api/src/attachments.ts`、`api/src/lambda.ts` | `test:unit` |
| 手元で動かす | `examples/07-uploads/api/src/dev.ts`、`api/src/memory-object-store.ts`、`api/src/local-store-http.ts`、`api/src/compose.ts`、`api/src/env.ts`、`.env.example`、`web/` | `dev:uploads:api`、`dev:uploads:web`、`typecheck:uploads:web`、`lint:uploads:web`、`build:uploads:web` |
| AWS にのせる準備 | `examples/07-uploads/infra/lib/uploads-stack.ts`、`infra/bin/app.ts`、`infra/test/uploads-stack.test.ts`、`cdk.json` | `uploads:infra:synth`、`test:unit` |
| デプロイする | `examples/07-uploads/scripts/write-config.ts`、`scripts/user.ts`、`scripts/smoke.ts`、`tools/src/site/`、`tools/src/infra/` | `uploads:infra:diff`、`uploads:infra:deploy`、`uploads:user:create`、`uploads:publish`、`uploads:smoke:web`、`uploads:smoke:api`、`uploads:infra:drift` |
| 片付け | `examples/07-uploads/scripts/empty-uploads.ts`、`scripts/user.ts`、`tools/src/site/unpublish.ts` | `uploads:empty`、`uploads:unpublish`、`uploads:infra:destroy`、`uploads:user:delete` |
| 料金 | `data/pricing/` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-11）

- [Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)、[Uploading objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [POST Policy](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-HTTPPOSTConstructPolicy.html)、[POST Object](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/RESTObjectPOST.html)、[Authenticating Requests: Using Query Parameters](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-query-string-auth.html)。この 3 つは、確認日の時点で `/AmazonS3/latest/API/` の下の以前の URL が目次へリダイレクトされたので、`/developerguide/` の下で読みました
- [How to prevent object overwrites with conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)
- [Working with Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)、[Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [Expiring objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html)、[Configuring a bucket lifecycle configuration to delete incomplete multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html)、[Tagging your objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-tagging.html)
- [Using cross-origin resource sharing (CORS)](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html)、[Elements of a CORS configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html)、[Blocking public access to your Amazon S3 storage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)（強い整合性）
- AWS Price List bulk API: [S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json)、[Data Transfer](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json)
- [@aws-sdk/s3-presigned-post 3.1149.0](https://www.npmjs.com/package/@aws-sdk/s3-presigned-post/v/3.1149.0)（型定義とソース）
- [Cloudflare R2: Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
