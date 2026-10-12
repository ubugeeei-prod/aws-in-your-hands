---
title: "04 HTTP API: 費用、注意点、片付け"
---

# 04 HTTP API: 費用、注意点、片付け

## Workers から来た人へ

<!-- section: 04.workers -->

Cloudflare Workers で API を書いたことがあるなら、ここまでの流れは見覚えがあると思います。違うところだけ並べますね。

| | Cloudflare Workers | この章（Lambda と API Gateway） |
| --- | --- | --- |
| 手元での実行 | `wrangler dev` か Vite plugin。Miniflare が本番と同じ runtime（workerd）で動かす | `vp run dev:api` は Node.js の HTTP サーバー。Lambda の runtime ではない。寄せるなら `dev:api:cdkd`（Docker が必要） |
| 他のサービスとの接続 | binding。設定に書くと `env` に現れる。手元では既定でローカルの模擬につながる | AWS SDK で呼ぶ。接続先は環境変数、権限は実行 role。手元の模擬は付いてこない |
| 権限 | binding を宣言したものに触れる | IAM。role に書いた操作だけが通る。手元とデプロイ後で権限が別 |
| 実行場所 | Cloudflare のネットワーク上 | 1 つのリージョン（この本では東京） |
| 入口 | Worker 自体が HTTP を受ける | API Gateway が受けて Lambda に渡す。別のリソースで、料金も別 |
| デプロイ | `wrangler deploy` | synth して template にして、cdkd（または CloudFormation）が反映する |

AWS のほうが部品が多いのは、そのとおりです。入口、関数、role、log group を、それぞれ自分で定義します。そのぶん、部品ごとに設定を選べます。どちらがいいかは作るもの次第で、この本は Workers をやめようとは言いません。

名前が似ている CloudFront Functions（03章）は、Workers の仲間ではありません。ネットワークにもファイルシステムにも触れない、URL やヘッダーを書き換えるための小さな環境です。

## お金の話

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**誰も呼ばない月は 0 です。** HTTP API にも Lambda にも、置いてあるだけでかかる料金はありません。ログは 7 日で消えます。

呼ばれると、こうなります。月 100 万リクエスト、平均 50 ミリ秒、256 MB、arm64、1 リクエストあたりログ 0.5 KB（アプリの 1 行と、Lambda が書く `START`、`END`、`REPORT` の行の合計）という仮定です。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| API Gateway HTTP API のリクエスト | 100 万件 | 1.29 | 1.29（無料枠は確認できず、引いていない） |
| Lambda のリクエスト | 100 万件 | 0.20 | 0 |
| Lambda の実行時間 | 12,500 GB 秒 | 0.17 | 0 |
| CloudWatch Logs の取り込み | 0.477 GB | 0.36 | 0 |
| CloudWatch Logs の保存 | 0.111 GB 月 | 0.00 | 0 |
| 小計 | | **2.02** | **1.29** |

無料枠は、Lambda が月 100 万リクエストと 40 万 GB 秒、CloudWatch Logs が 5 GB。アカウント全体で共有です。Lambda の料金ページには、この枠に期限があるかどうかは書かれていません。

応答をインターネットへ送るデータ転送の料金は、この表に入れていません（0 という意味ではなく、未算入です）。50 ミリ秒という実行時間も仮定で、あなたの関数の実際の値はログの `REPORT` 行でわかります。

### 叩かれ続けたら

URL を知っていれば、誰でも、何回でも呼べます。止めるものは 2 つです。stage の throttling（API 全体で 1 秒に 10 件）と、ノートの件数の上限（実行環境ごとに 100 件）。

その 1 秒 10 件が、30 日続いたとしましょう。2,592 万件です。上の表と同じ仮定で、定価はこうなります。

| 対象 | 定価 |
| --- | --- |
| API Gateway HTTP API のリクエスト（2,592 万件） | 33.44 |
| Lambda のリクエストと実行時間（324,000 GB 秒） | 9.50 |
| CloudWatch Logs（12.36 GB） | 9.49 |
| 合計 | **52.43** |

月に USD 52 ほど。01章の予算の通知は、この途中で届きます。

ただ、これは「件数」の天井です。入っていないものを、正直に書いておきますね。

いちばん大きいのは、応答のデータ転送です。throttling が数えるのは件数で、大きさではありません。`GET /notes` は持っているノートを全部返します。1 件は 64 KiB のリクエストに収まる大きさなので、100 件で最大 6 MB ほど。それを 1 秒に 10 回、30 日返し続けると約 158,000 GB です。東京リージョンからインターネットへの転送の単価（最初の 10 TB が 1 GB あたり USD 0.114）を当てはめると、USD 14,000 ほどになります。桁が違いますよね。そこまで大きな応答が実際に通るのか、この単価が API Gateway の応答にそのまま当てはまるのかは、確かめていません。でも、件数の蓋だけでは塞がらない穴があることは、覚えておいてください。

実行時間も仮定です。50 ミリ秒と置きましたが、設定の上での天井は timeout の 10 秒で、全部がそこまで動くと Lambda の実行時間だけで USD 864 になります。この章のアプリに、そこまで遅くなる処理はありません。

throttling が断った 429 に API Gateway の料金がかかるかどうかも、確かめていません。

本物の利用者を迎える前に足すのは、まず認証（06章）。それから、一覧を小さくすること（ページに分ける、本文を載せない）。IP アドレスごとに止めたいなら AWS WAF ですが、HTTP API には付けられないので、手前に CloudFront を置く構成になります。[21章](/ja/chapters/21-security.md)の web ACL は月 USD 8.00 と、リクエスト 100 万件あたり USD 0.60。その構成は、この本では作っていません。

stack を消せば、この章のぶんの料金は止まります。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:api` が `Invalid environment` で止まる | `examples/04-http-api/.env` はありますか。メッセージに出た変数名を確認 |
| デプロイ後、全部の応答が 500 で、`x-request-id` ヘッダーが無い | 関数が初期化でコケています。`vp run api:logs` で `Invalid environment` や import のエラーを探す |
| `{"message":"Not Found"}` が返る | これは API Gateway の応答。stack に無い path を呼んでいます。この本のエラーの形（`error.code`）じゃないので見分けられます |
| 一部の応答だけ、`x-request-id` ヘッダーの無いエラーになる | 関数が timeout したか、途中で落ちています。ログの `REPORT` 行で実行時間を確認 |
| ブラウザから呼ぶと CORS のエラー | デプロイ時の `allowedOrigin` が、呼び出し元の origin（scheme とポートまで）と完全に一致していますか |
| 作ったノートが `GET /notes` に出ない | 別の箱が応答しました。「ノートはどこにある？」のとおりで、この章の仕様です |
| `{"message":"Too Many Requests"}` のような 429 が返る | stage の throttling です。API 全体で 1 秒に 10 件を超えました。自分が叩いていなくても、ほかの誰かのぶんで起きます |
| `POST /notes` が 409 と `quota_exceeded` | 応答した実行環境が、もう 100 件持っています。1 件消すと空きます |
| 新しいアカウントで同時実行のエラー | 新しいアカウントは、Lambda の同時実行数の上限が低めです。Service Quotas で確認 |

コツを 1 つ。エラーが返ってきたら、まず `x-request-id` ヘッダーがあるかを見てください。あれば、あなたのアプリまで届いています。なければ、その手前（API Gateway か、関数の起動）です。これだけで探す場所が半分になります。

## 本番にするなら

- **認証と認可を足す。** いまは誰でも呼べます（06章）
- **データを保存する。** いまは消えます（05章）
- **流量の上限を、自分の API に合わせる。** 1 秒に 10 件は練習用の値です。そして throttling は相手を選ばないので、呼ぶ人ごとに止めたいなら、認証か、CloudFront と AWS WAF が要ります
- **応答の大きさに上限を付ける。** 件数を絞っても、1 件が大きければ転送量は増えます
- **アラームを付ける。** 5xx の割合と、応答の遅さを見張ります。このアプリは例外を捕まえて 500 を返すので、Lambda の `Errors` は増えません。見るのは API Gateway の `5xx` と `Latency` です（[19章](/ja/chapters/19-observability.md)）
- **ログの保持期間を決める。** 7 日は学習用の値です
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです
- **同時実行数の上限を確かめる。** 既定はリージョンごとに 1,000 で、アカウント内の全関数で共有。新しいアカウントは、それより低い値から始まります

## 片付け

<!-- section: 04.cleanup -->

```bash
vp run api:infra:destroy
```

関数、role、API、log group が消えます。ログも一緒です。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** アプリ、client、インフラのユニットテスト。型検査。synth（esbuild の bundle 込み）。`dev:api` を起動して、本文の `curl` を実行。ノートの上限（101 件目が 409、1 件消すと入る）と、template の stage に throttling の値が入っていることは、テストで固定しました。

**まだ確かめていないこと。** `dev:api:cdkd`、`api:infra:deploy`、`api:smoke`、`api:logs`、`api:infra:drift`、`api:infra:destroy` は、実際の AWS では動かしていません。とくに、Node.js 24 の Lambda runtime で bundle が動くこと、API Gateway が返すエラーの状態コードと本文（「ハマりどころ」の `Not Found` など）、関数が timeout したときに呼び出し側へ返る応答、箱が複数になったときの `api:smoke` の表示は、実環境での確認待ちです。stage の throttling も同じです。固定した版の cdkd（0.296.28）のソースが `DefaultRouteSettings` を API Gateway に渡していることは読みましたが、実際に反映されること、429 の本文の形、429 に料金がかかるかどうかは確かめていません。「叩かれ続けたら」の金額は、単価と設定から計算しただけで、負荷をかけて測った値ではありません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| まず契約から | `examples/04-http-api/src/contract.ts` | `test:unit` |
| アプリを書く | `examples/04-http-api/src/app.ts`、`src/notes.ts`、`src/compose.ts`、`src/log.ts` | `test:unit` |
| 設定は起動時に確かめる | `examples/04-http-api/src/env.ts`、`test/env.test.ts`、`.env.example` | `test:unit` |
| 手元で動かす | `examples/04-http-api/src/dev.ts` | `dev:api`、`dev:api:cdkd` |
| テスト | `examples/04-http-api/test/app.test.ts`、`test/client.test.ts`、`src/client.ts` | `test:unit` |
| ノートはどこにある？ | `examples/04-http-api/src/lambda.ts`、`src/notes.ts`、`scripts/smoke.ts` | `api:smoke` |
| AWS にのせる準備 | `examples/04-http-api/infra/lib/http-api-stack.ts`、`infra/bin/app.ts`、`infra/test/http-api-stack.test.ts`、`cdk.json` | `api:infra:synth`、`test:unit` |
| デプロイして呼ぶ | `tools/src/infra/`、`examples/04-http-api/scripts/smoke.ts` | `api:infra:diff`、`api:infra:deploy`、`api:smoke` |
| ログを見る | `examples/04-http-api/src/log.ts`、`scripts/logs.ts` | `api:logs`、`api:infra:drift` |
| 片付け | `tools/src/infra/` | `api:infra:destroy` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-11）

- [Choose between REST APIs and HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)
- [Quotas for HTTP APIs in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)、[API Gateway](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/ap-northeast-1/index.json)、[CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json)
- [Cloudflare Workers: Local development](https://developers.cloudflare.com/workers/local-development/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
