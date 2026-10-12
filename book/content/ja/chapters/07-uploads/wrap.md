---
title: "07 File Upload: 費用、注意点、片付け"
---

# 07 File Upload: 費用、注意点、片付け

## R2 から来た人へ

Cloudflare R2 にも presigned URL があります。R2 の公式ドキュメントによると、対応する操作は `GET`、`HEAD`、`PUT`、`DELETE` で、HTML form による POST のアップロードには、いまのところ対応していません。つまり、この章の `content-length-range` を使うやり方は、R2 にはそのまま持っていけません。同じドキュメントは、presigned URL が S3 API のドメインでだけ動いて、custom domain では使えないこと、bearer token として扱うべきことも書いています。

Workers から R2 を使うなら、presigned URL を使わずに、binding で Worker の中から読み書きする構成も多いと思います。その場合、画像は Worker を通ります。この章が避けた「関数を通す」やり方ですが、Worker と Lambda では、通したときの制約も料金も違います。そちらの制約と料金は、確認していません。

## お金の話

金額は USD、東京リージョン、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

S3 でかかるのは、3 つです。保存している量（最初の 50 TB まで、1 GB あたり月 USD 0.025）。リクエストの数（PUT、POST、LIST は 1,000 件あたり USD 0.0047、GET などは 10,000 件あたり USD 0.0037）。そして、S3 からインターネットへ出ていくデータの量（最初の 10 TB まで、1 GB あたり USD 0.114）。インターネットから S3 へ入るデータは、USD 0 です。

例を 1 つ。月に 10,000 枚、1 枚 1 MB の画像がアップロードされて、画像が 100,000 回表示される場合です。06章のアプリの料金に上乗せされる分だけを数えます。

| 対象 | 定価 |
| --- | --- |
| S3 の保存（10 GB） | 0.25 |
| S3 のリクエスト（POST 10,000、HEAD 10,000、GET 100,000） | 0.09 |
| S3 からのデータ転送（約 97.7 GB） | 11.13 |
| API の側（API Gateway、Lambda、ログ、DynamoDB の 120,000 リクエスト分） | 0.29 |
| 小計 | **11.76** |

見てのとおり、ほとんどがデータ転送です。画像は、置くより配るほうにお金がかかります。この計算は、ブラウザの cache がまったく効かないと仮定しています。presigned URL は毎回違うので、同じ画像でも URL が変わると、ブラウザは読み直します。表示が多いアプリでは、CloudFront を前に置く構成を検討してください。

毎月の無料枠を引いた後の小計は 11.67 です。ただ、引いているのは Lambda とログの無料枠で、これは 06章の利用分と共有です。06章の例のように月 100 万リクエストを使っていれば、Lambda の無料枠はもう残っていません。データ転送の単価には「無料枠を超えた分」という説明が付いていますが、その無料枠の大きさは確認できていないので、何も引いていません。S3 の無料枠も同じ扱いです。

tag の保存にも料金がありますが、tag が付いているのは完了するまでの間だけなので、計算に入れていません。tag を外すリクエストは、公式ドキュメントによると請求されません。

**誰も使わない月でも、置いてある画像の保存料金はかかります。** 10 GB なら月 USD 0.25 です。孤立した object も同じ単価で数えられます。掃除が要るのは、このためです。

stack を消すと、bucket も中の画像も消えます。残るものは「片付け」に書いたとおりです。

### 叩かれたら

API の側は、06章と同じです。サインインしていない相手に届くのは `/health` だけ。stage の throttle は 1 秒 10 リクエストで、table には request unit の上限があります。06章の「叩かれたら」の表（月 USD 182.83）が、そのままこの章の API の天井です。足されるのは、完了の呼び出しが 1 回ずつ送る `HeadObject` で、2,592 万回すべてがそれでも USD 9.59 です。

この章で増えたのは、API を通らない道です。許可証と表示用の URL は、S3 に直接届きます。API Gateway の throttle は、そこには効きません。順に見ます。

- **置かれる量。** 上限があります。未完了の object は、1 人 1 日 100 個、500 MB まで。1 日後に消えるので、毎日上限まで続けられても、置かれているのは 0.5 GB 前後、月 USD 0.01 ほどです（S3 の削除が遅れれば、そのぶん増えます）。添付まで済んだ画像は、1 人につきノート 100 件 × 10 枚 × 5 MB で、約 4.9 GB、月 USD 0.12 までです
- **アップロードの回数。** 上限がありません。許可証は 5 分間、何度でも使えます。同じ key への上書きなので量は増えませんが、S3 への POST は 100 万回あたり USD 4.70 です。S3 が 1 秒に何回まで受け付けるかは、この本では確かめていません
- **画像の読み出し。** 上限がありません。表示用の URL は、5 分間、持っている人なら誰でも、何度でも読めます。かかるのはデータ転送で、5 MB の画像 1 枚を 1 万回読まれると 48.8 GB、USD 5.57。この章でいちばん大きくなりうるのは、ここです

下の 2 つを使えるのは、サインインした利用者と、その利用者から URL や form を受け取った人だけです。そして利用者は、あなたが作った人だけ。知らない相手が、いきなりここに届くことはありません。それでも、利用者を広く受け入れるアプリにするなら、閉じておきたい道です。画像を CloudFront から配れば、cache が効いて、AWS WAF も付けられます（[21章](/ja/chapters/21-security.md)。web ACL が月 USD 5、rule 1 つにつき月 USD 1、検査 100 万回あたり USD 0.60）。この本では、画像を CloudFront から配る構成は実装していません。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:uploads:api` が `UPLOADS_STORE` と言って止まる | `examples/07-uploads/.env` はありますか。`.env.example` をコピーしてください |
| 画面に「The upload was refused (HTTP 403)」と出る | 許可証をもらってから 5 分以上たっていませんか。もう一度ファイルを選んでください |
| S3 への POST が 403 を返す | form の欄の値が policy と違うと、条件を満たしません。SDK が返した `fields` をそのまま、`file` の欄を最後にして送っていますか。S3 が実際に返す応答の中身は、まだ確かめていません |
| S3 への POST が、ブラウザのコンソールでは CORS のエラーになる | SPA の origin が、bucket の CORS の `AllowedOrigins` と完全に一致していますか。まず `curl` で状態コードを見てください |
| 完了の呼び出しが 409 `upload_missing` を返す | S3 への POST は 204 を返しましたか。返していなければ、object はありません |
| 完了の呼び出しが 500 を返し、ログに 403 がある | 実行 role に `s3:ListBucket` がないと、存在しない key への `HeadObject` は 403 になります |
| 許可証の依頼が 429 `upload_quota_exceeded` を返す | その利用者が、今日（UTC）すでに 100 枚の許可証を受け取っています。使わなかったものも数えます。日付が変わると通ります |
| 完了の呼び出しが 409 `upload_rejected` を返す | 送ってから 15 分以上たっています。もう一度送ってください |
| 画像がしばらくすると表示されなくなる | URL の期限（5 分）です。画面は一覧を取り直します。直らなければ、object が消えています |
| S3 が `ExpiredToken` を返す | URL に署名した認証情報が失効しています。一覧を取り直すと、新しい認証情報で署名した URL が返ります |

## 本番にするなら

- **同じ form の再送を閉じる。** 「この設計に残る穴」のとおりです
- **掃除を定期的に動かす。** 手で実行するタスクのままでは、いつか忘れます（[08章](/ja/chapters/08-async.md)）
- **中身を確かめる。** S3 は、ファイルが本当に画像かどうかを見ません。アップロードの後で検査する処理を足します
- **配り方を見直す。** 表示が多いなら CloudFront を前に置きます。データ転送の料金と、cache の効き方が変わります
- **bucket を守る。** `removalPolicy` を `RETAIN` にして、versioning を検討します。versioning を有効にすると、lifecycle rule の動きも変わります
- **上限の数字を決め直す。** ノート 1 つに 10 枚、1 人 100 ノート、許可証は 1 人 1 日 100 枚。どれも練習用に置いた数字です。あなたのアプリの使われ方から決めます。日付ごとの許可証の数は、table の TTL で消します
- **S3 に直接届く道を閉じる。** 「叩かれたら」のとおり、アップロードの回数と画像の読み出しには上限がありません
- **手元の origin を外す。** bucket の CORS と API の CORS から `http://localhost:5173` を消します
- **アクセスの記録を取る。** presigned URL が誰に使われたかは、API のログには残りません。S3 の側の記録が要ります（この本では扱っていません）

## 片付け

<!-- section: 07.cleanup -->

```bash
vp run uploads:empty --yes
vp run uploads:unpublish --yes
vp run uploads:infra:destroy
```

固定した版の cdkd は、空でない bucket を消しません。先に 2 つの bucket を空にします。`uploads:empty` はアップロードされた画像を、`uploads:unpublish` は SPA のファイルを消します。どちらも、`--yes` を付けなければ、数を数えるだけです。

`uploads:infra:destroy` で、bucket、table、user pool、関数、API、distribution が消えます。画像も、ノートも、利用者も、元には戻せません。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** API のテスト（認可、許可証の中身、完了、期限、上限）、途中で止めるテスト（上の表の 6 行と、掃除、同じ form の再送）、key の組み立て、SDK が作る POST policy と presigned GET の中身（偽の認証情報で署名しただけで、S3 には送っていません）、DynamoDB へのリクエストの形、インフラの assertion、型検査、SPA のビルド、synth。それから、`dev:uploads:api` と `dev:uploads:web` を起動して、ブラウザを自動操作して次を確かめました。サインイン、ノートの作成、ファイルを選んで画像が表示されること、別の利用者からの許可・一覧・完了が 404 になること、大きすぎるファイル・違う種類・違う key が拒否されること、完了を 2 回呼んでも同じ結果になること、削除とノートの削除の後に画像の URL が読めなくなること。今回足した上限は、テストで確かめました。1 人の 101 枚目の許可証が 429 になり、ほかの利用者には影響せず、日付が変わると戻り、ほかの理由で断ったリクエストは数えないこと。101 件目のノートが 409 になること（どちらも `composeApp` を通して）。template の stage に throttle が、table に request unit の上限があること。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`uploads:infra:deploy`、`uploads:user:create`、`uploads:publish`、`uploads:smoke:web`、`uploads:smoke:api`、`uploads:sweep`、`uploads:infra:drift`、`uploads:empty`、`uploads:unpublish`、`uploads:infra:destroy` のどれもです。したがって、次は実物の S3 で確かめていません。`tagging` の欄を含む presigned POST を S3 が受け付けること。`content-length-range` と `Content-Type` の条件で S3 が拒否すること、そのときの応答。ブラウザからの POST が bucket の CORS の規則で通ること。POST の直後の `HeadObject` が object を見つけること（強い整合性の説明は PUT と DELETE を名指ししていて、POST Object は名指ししていません）。lifecycle rule が pending の object を消すこと。`DeleteObjectTagging` の後は消されないこと。DynamoDB 用の実装（`dynamodb-attachment-repository.ts`）は、リクエストの形をテストで固定しただけで、DynamoDB Local にも実物にも送っていません。実行 role の認証情報の寿命は、公式ドキュメントで確認できませんでした。S3 互換のローカル実装は使っていません（Docker の daemon が動いていませんでした）。上限まわりも、実物では確かめていません。許可証を数える条件付きの更新（`permit-ledger.ts`）は、リクエストの形をテストで固定しただけです。cdkd 0.296.28 が stage の `DefaultRouteSettings` と table の `OnDemandThroughput` を反映するか、throttle が API 全体で数えられるのか route ごとなのか（この章は 11 route）も、06章と同じく未確認です。S3 が 1 つの key への POST を 1 秒に何回受け付けるかは調べていません。「叩かれたら」の金額は、単価と仮定からの計算です。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 許可証を作る | `examples/07-uploads/api/src/contract.ts`、`api/src/object-store.ts`、`api/src/s3-object-store.ts`、`api/test/s3-object-store.test.ts` | `test:unit` |
| key は API が決める | `examples/07-uploads/api/src/keys.ts`、`api/src/attachments.ts`、`api/src/app.ts`、`api/src/permit-ledger.ts`、`api/test/keys.test.ts`、`api/test/app.test.ts`、`api/test/permit-ledger.test.ts`、`api/test/compose.test.ts` | `test:unit` |
| 2 つの置き場所、1 つの順序 | `examples/07-uploads/api/src/attachments.ts`、`api/src/attachment-repository.ts`、`api/src/dynamodb-attachment-repository.ts`、`api/src/client.ts`、`api/test/partial-failure.test.ts`、`api/test/harness.ts` | `test:unit` |
| 残ったものを片付ける | `examples/07-uploads/api/src/sweep.ts`、`scripts/sweep.ts`、`infra/lib/uploads-stack.ts` | `test:unit`、`uploads:sweep` |
| 画像を見せる | `examples/07-uploads/api/src/s3-object-store.ts`、`api/src/attachments.ts`、`api/src/lambda.ts` | `test:unit` |
| 手元で動かす | `examples/07-uploads/api/src/dev.ts`、`api/src/memory-object-store.ts`、`api/src/local-store-http.ts`、`api/src/compose.ts`、`api/src/env.ts`、`.env.example`、`web/` | `dev:uploads:api`、`dev:uploads:web`、`typecheck:uploads:web`、`lint:uploads:web`、`build:uploads:web` |
| AWS にのせる準備 | `examples/07-uploads/infra/lib/uploads-stack.ts`、`infra/bin/app.ts`、`infra/test/uploads-stack.test.ts`、`cdk.json` | `uploads:infra:synth`、`test:unit` |
| デプロイする | `examples/07-uploads/scripts/write-config.ts`、`scripts/user.ts`、`scripts/smoke.ts`、`tools/src/site/`、`tools/src/infra/` | `uploads:infra:diff`、`uploads:infra:deploy`、`uploads:user:create`、`uploads:publish`、`uploads:smoke:web`、`uploads:smoke:api`、`uploads:infra:drift` |
| 片付け | `examples/07-uploads/scripts/empty-uploads.ts`、`scripts/user.ts`、`tools/src/site/unpublish.ts` | `uploads:empty`、`uploads:unpublish`、`uploads:infra:destroy`、`uploads:user:delete` |
| お金の話 | `data/pricing/` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-11）

- [Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)、[Uploading objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [POST Policy](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-HTTPPOSTConstructPolicy.html)、[POST Object](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/RESTObjectPOST.html)、[Authenticating Requests: Using Query Parameters](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-query-string-auth.html)。この 3 つは、確認日の時点で `/AmazonS3/latest/API/` の下の以前の URL が目次へ redirect されたので、`/developerguide/` の下で読みました
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
