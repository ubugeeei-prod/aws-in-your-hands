---
title: "04 HTTP API: 費用、注意点、片付け"
---

# 04 HTTP API: 費用、注意点、片付け

この章の最後のページです。Cloudflare Workers との違い、料金、つまずきやすいところ、本番に進めるときに変えることをまとめ、作ったものを片付けます。

## Workers から来た人へ

<!-- section: 04.workers -->

Cloudflare Workers で API を書いたことがあれば、ここまでの流れには見覚えがあると思います。違うところを表にしました。

| | Cloudflare Workers | この章（Lambda と API Gateway） |
| --- | --- | --- |
| 手元での実行 | `wrangler dev` か Vite plugin。Miniflare が本番と同じランタイム（workerd）で動かす | `vp run dev:api` は Node.js の HTTP サーバーで、Lambda のランタイムではない。近づけるなら `dev:api:cdkd`（Docker が必要） |
| 他のサービスとの接続 | binding。設定に書くと `env` に現れる。手元では既定でローカルの模擬につながる | AWS SDK で呼ぶ。接続先は環境変数、権限は実行ロールで決まる。手元の模擬は付いてこない |
| 権限 | binding を宣言したものに触れる | IAM。ロールに書いた操作だけが通る。手元とデプロイ後で権限が別 |
| 実行場所 | Cloudflare のネットワーク上 | 1 つのリージョン（この本では東京） |
| 入口 | Worker 自体が HTTP を受ける | API Gateway が受けて Lambda に渡す。別のリソースで、料金も別 |
| デプロイ | `wrangler deploy` | synth してテンプレートにし、cdkd（または CloudFormation）が反映する |

AWS のほうが部品は多く、入口、関数、ロール、ロググループをそれぞれ自分で定義します。そのぶん、部品ごとに設定を選べます。どちらが合うかは作るもの次第で、この本は Workers をやめることを勧めません。

名前が似ている CloudFront Functions（03章）は、Workers にあたるものではありません。ネットワークにもファイルシステムにも触れず、URL やヘッダーを書き換えるための小さな環境です。

## 料金

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**誰も呼ばない月の料金は 0 です。** HTTP API にも Lambda にも、置いてあるだけでかかる料金はありません。ログは 7 日で消えます。

呼ばれた月の料金を、次の仮定で計算します。月 100 万リクエスト、平均 50 ミリ秒、256 MB、arm64 で、1 リクエストあたりのログは 0.5 KB（アプリの 1 行と、Lambda が書く `START`、`END`、`REPORT` の行の合計）です。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| API Gateway HTTP API のリクエスト | 100 万件 | 1.29 | 1.29（無料枠は確認できず、引いていない） |
| Lambda のリクエスト | 100 万件 | 0.20 | 0 |
| Lambda の実行時間 | 12,500 GB 秒 | 0.17 | 0 |
| CloudWatch Logs の取り込み | 0.477 GB | 0.36 | 0 |
| CloudWatch Logs の保存 | 0.111 GB 月 | 0.00 | 0 |
| 小計 | | **2.02** | **1.29** |

無料枠は、Lambda が月 100 万リクエストと 40 万 GB 秒、CloudWatch Logs が 5 GB で、アカウント全体で共有します。Lambda の料金ページには、この枠に期限があるかどうかは書かれていません。

レスポンスをインターネットへ送るデータ転送の料金は、この表に入れていません。0 という意味ではなく、算入していないということです。50 ミリ秒という実行時間も仮定で、あなたの関数の実際の値はログの `REPORT` 行でわかります。

### 叩かれたら

URL を知っていれば、誰でも、何回でもこの API を呼べます。それを止めるものは 3 つあります。ステージのスロットリング（API 全体で 1 秒に 10 件）、ノートの件数の上限（実行環境ごとに 100 件）、レスポンスの大きさの上限（一覧は 20 KiB まで、ノート 1 件は 64 KiB まで）です。

1 秒 10 件のリクエストが 30 日続くと、2,592 万件になります。上の表と同じ仮定で、定価は次のとおりです。

| 対象 | 定価 |
| --- | --- |
| API Gateway HTTP API のリクエスト（2,592 万件） | 33.44 |
| Lambda のリクエストと実行時間（324,000 GB 秒） | 9.50 |
| CloudWatch Logs（12.36 GB） | 9.49 |
| 合計 | **52.43** |

月に USD 52 ほどです。01章で設定した予算の通知は、この途中で届きます。

ただし、この金額は件数だけから出した上限で、次のものが入っていません。

1 つ目は、レスポンスのデータ転送です。スロットリングが数えるのは件数で、大きさではないので、大きさはアプリの側で決めてあります。`GET /notes` が返すのは新しい 20 件の要約だけで、いちばん大きくなる題名を並べても 20 KiB を超えないことを、テストで固定しました。その一覧を 1 秒に 10 回、30 日返し続けると約 494 GB です。東京リージョンからインターネットへの転送の単価は、最初の 10 TB が 1 GB あたり USD 0.114 なので、USD 56 ほどになります。

この API でいちばん大きいレスポンスは、一覧ではなくノート 1 件のほうです。ノートは 64 KiB のリクエストに収まる大きさなので、`GET /notes/:id` のレスポンスも 64 KiB ほどまでになります。2,592 万件がすべてその大きさだったとすると約 1,582 GB で、USD 180 ほどです。上の表と合わせると、月に USD 230 ほどになります。この単価が API Gateway のレスポンスにそのまま当てはまるかどうかは、確かめていません。

2 つ目は、実行時間です。表では 50 ミリ秒と仮定しましたが、設定の上での上限は `timeout` の 10 秒で、すべてのリクエストがそこまで動くと Lambda の実行時間だけで USD 864 になります。この章のアプリに、そこまで遅くなる処理はありません。

スロットリングが断った 429 に API Gateway の料金がかかるかどうかも、確かめていません。

本物の利用者を迎える前に足すものは、まず認証です（06章）。IP アドレスごとに止めたいなら AWS WAF を使いますが、HTTP API には付けられないので、手前に CloudFront を置く構成になります。[21章](/ja/chapters/21-security.md)の web ACL は月 USD 8.00（web ACL に USD 5、3 つのルールに USD 1 ずつ）と、検査したリクエスト 100 万件あたり USD 0.60 です。その構成は、この本では作っていません。

スタックを消せば、この章のぶんの料金は止まります。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `dev:api` が `Invalid environment` で止まる | `examples/04-http-api/.env` があるかを確かめます。メッセージに出た変数名も確認してください |
| デプロイ後、すべてのレスポンスが 500 で、`x-request-id` ヘッダーがない | 関数が初期化で失敗しています。`vp run api:logs` で `Invalid environment` や import のエラーを探します |
| `{"message":"Not Found"}` が返る | API Gateway が返したレスポンスです。スタックにないパスを呼んでいます。この本のエラーの形（`error.code`）ではないので見分けられます |
| 一部のレスポンスだけ、`x-request-id` ヘッダーのないエラーになる | 関数がタイムアウトしたか、途中で落ちています。ログの `REPORT` 行で実行時間を確認します |
| ブラウザから呼ぶと CORS のエラーになる | デプロイ時の `allowedOrigin` が、呼び出し元のオリジンと scheme やポートまで完全に一致しているかを確かめます |
| 作ったノートが `GET /notes` に出ない | 別の実行環境が答えました。[ノートの置き場所](/ja/chapters/04-http-api/local.md)で説明した、この章の仕様どおりの動きです |
| ノートが 21 件以上あるのに、`GET /notes` が 20 件しか返さない | 一覧は新しい順に 20 件までで、本文も載りません。古いノートは `GET /notes/:id` で読めます |
| `{"message":"Too Many Requests"}` のような 429 が返る | ステージのスロットリングです。API 全体で 1 秒に 10 件を超えました。自分が呼んでいなくても、ほかの誰かのリクエストで起きます |
| `POST /notes` が 409 と `quota_exceeded` を返す | 答えた実行環境が、すでに 100 件持っています。1 件消すと空きます |
| 新しいアカウントで同時実行のエラーが出る | 新しいアカウントは、Lambda の同時実行数の上限が低めです。Service Quotas で確認します |

エラーが返ってきたら、まず `x-request-id` ヘッダーがあるかどうかを見てください。あれば、リクエストはあなたのアプリまで届いています。なければ、原因はその手前の API Gateway か、関数の起動にあります。これだけで、探す場所が半分になります。

## 本番にするなら

- 認証と認可を足します。いまは誰でも呼べます（06章）
- データを保存します。いまは消えます（05章）
- スロットリングの値を、自分の API に合わせます。1 秒に 10 件は練習用の値です。スロットリングは呼ぶ相手を区別しないので、相手ごとに止めたいなら、認証か、CloudFront と AWS WAF が要ります
- レスポンスの大きさの上限を、自分のデータに合わせます。いまは一覧が要約 20 件、ノート 1 件が 64 KiB までです。項目を足すときは、いちばん大きいレスポンスが何バイトになるかを先に計算します
- アラームを付けて、5xx の割合とレスポンスの遅さを見張ります。このアプリは例外を捕まえて 500 を返すので、Lambda の `Errors` は増えません。見るのは API Gateway の `5xx` と `Latency` です（[19章](/ja/chapters/19-observability.md)）
- ログの保持期間を決めます。7 日は学習用の値です
- 反映の経路を AWS CDK CLI と CloudFormation にします。理由は 02章で説明したとおりです
- 同時実行数の上限を確かめます。既定はリージョンごとに 1,000 で、アカウント内のすべての関数で共有します。新しいアカウントは、それより低い値から始まります

## 片付け

<!-- section: 04.cleanup -->

```bash
vp run api:infra:destroy
```

関数、ロール、API、ロググループが消え、ログも一緒に消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** アプリ、クライアント、インフラのユニットテストと、型検査、synth（esbuild のバンドルを含む）を実行しました。`dev:api` を起動して、本文の `curl` も実行しています。ノートの上限（101 件目が 409 になり、1 件消すと入ること）と、テンプレートのステージにスロットリングの値が入っていることは、テストで固定しました。一覧が本文を返さないこと、20 件で止まること、いちばん大きい題名を並べても 20 KiB を超えないことも、テストで固定しています。

**まだ確かめていないこと。** `dev:api:cdkd`、`api:infra:deploy`、`api:smoke`、`api:logs`、`api:infra:drift`、`api:infra:destroy` は、実際の AWS では動かしていません。とくに次の 4 点は、実環境での確認を待っています。Node.js 24 の Lambda ランタイムでバンドルが動くこと、API Gateway が返すエラーの状態コードと本文（「つまずきやすいところ」の `Not Found` など）、関数がタイムアウトしたときに呼び出し側へ返るレスポンス、実行環境が複数になったときの `api:smoke` の表示です。ステージのスロットリングも同じ状態です。固定した版の cdkd（0.296.28）のソースが `DefaultRouteSettings` を API Gateway に渡していることは読みましたが、実際に反映されること、429 の本文の形、429 に料金がかかるかどうかは確かめていません。「叩かれたら」の金額は、データ転送のぶんも含めて、単価と設定から計算しただけで、負荷をかけて測った値ではありません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 契約を先に決める | `examples/04-http-api/src/contract.ts` | `test:unit` |
| アプリを書く | `examples/04-http-api/src/app.ts`、`src/notes.ts`、`src/compose.ts`、`src/log.ts` | `test:unit` |
| 設定は起動時に確かめる | `examples/04-http-api/src/env.ts`、`test/env.test.ts`、`.env.example` | `test:unit` |
| 手元で動かす | `examples/04-http-api/src/dev.ts` | `dev:api`、`dev:api:cdkd` |
| テスト | `examples/04-http-api/test/app.test.ts`、`test/client.test.ts`、`src/client.ts` | `test:unit` |
| ノートの置き場所 | `examples/04-http-api/src/lambda.ts`、`src/notes.ts`、`scripts/smoke.ts` | `api:smoke` |
| AWS にのせる準備 | `examples/04-http-api/infra/lib/http-api-stack.ts`、`infra/bin/app.ts`、`infra/test/http-api-stack.test.ts`、`cdk.json` | `api:infra:synth`、`test:unit` |
| デプロイして呼ぶ | `tools/src/infra/`、`examples/04-http-api/scripts/smoke.ts` | `api:infra:diff`、`api:infra:deploy`、`api:smoke` |
| ログを見る | `examples/04-http-api/src/log.ts`、`scripts/logs.ts` | `api:logs`、`api:infra:drift` |
| 片付け | `tools/src/infra/` | `api:infra:destroy` |
| 料金 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-11）

- [Choose between REST APIs and HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)
- [Quotas for HTTP APIs in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)、[API Gateway](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/ap-northeast-1/index.json)、[CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json)
- [Cloudflare Workers: Local development](https://developers.cloudflare.com/workers/local-development/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
