---
title: "料金の計算"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/pricing/*.json (tools/src/book/generate.ts) -->

# 料金の計算

この本の料金の数値は、すべてここにある入力と単価から `tools/src/pricing/calc.ts` が計算したものです。通貨は USD、1 か月は 730 時間、プランは従量課金（on-demand / pay-as-you-go）、税は含みません。使用量は説明のための仮定であり、あなたのアプリの見積もりではありません。

「定価」は無料枠・credits・割引を一切引かない金額です。「毎月の無料枠適用後」は、一次情報で確認できた always-free 枠だけを数量から引いた金額で、同じアカウントの他の利用がその枠を使っていない場合に限ります。credits は反映していません。

## 本のサイト: 公開済みで誰も読まない月

ID: `book-site-idle` / 章: [03 SPA を公開する: private S3 origin と CloudFront](/ja/chapters/03-spa.md)

前提:

- 配信ゼロ、publish ゼロ
- bucket に 50 MB の build 出力

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3.standard.storage` | 0.05 | GB-Mo | 50 MB stored for the month, in GB-month | 0.001250 | - | 0.001250 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`

## 本のサイト: 月 2 万ページビュー

ID: `book-site-small` / 章: [03 SPA を公開する: private S3 origin と CloudFront](/ja/chapters/03-spa.md)

前提:

- 1 ページビューあたり HTML 1 + 初回のみ assets 7。平均 6 リクエスト、合計 150 KB と仮定
- すべて日本の edge から配信、HTTPS
- cache miss と再検証で origin へ 1/3 が届くと仮定
- publish は月 10 回、各 200 object を PUT
- CloudFront Function はページと assets の全リクエストで実行
- 標準ログ・WAF・独自ドメインなし

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 120,000 | Requests | 20,000 page views x 6 requests | 0.14 | 10,000,000 | 0 |
| `cloudfront.jp.transfer` | 2.861 | GB | 20,000 page views x 150 KB, in GB | 0.33 | 1,024 | 0 |
| `cloudfront.function.execution` | 120,000 | FunctionExecutions | one execution per viewer request | 0 | 2,000,000 | 0 |
| `s3.request.tier2` | 40,000 | Requests | one third of 120,000 requests reach S3 as GET | 0.01 | - | 0.01 |
| `s3.request.tier1` | 2,000 | Requests | 10 publishes x 200 PUTs | 0.01 | - | 0.01 |
| `s3.standard.storage` | 0.05 | GB-Mo | 50 MB, in GB-month | 0.001250 | - | 0.001250 |

- 定価の小計: **USD 0.50** / 月
- 毎月の無料枠適用後の小計: **USD 0.03** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `s3.request.tier1`, `s3.request.tier2`

## HTTP API: デプロイ済みで呼ばれない月

ID: `http-api-idle` / 章: [04 HTTP API を足す: Lambda と API Gateway HTTP API](/ja/chapters/04-http-api.md)

前提:

- リクエストゼロ
- log は 1 週間で失効し、保存量ゼロ

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## HTTP API: 月 100 万リクエスト

ID: `http-api-small` / 章: [04 HTTP API を足す: Lambda と API Gateway HTTP API](/ja/chapters/04-http-api.md)

前提:

- すべて Lambda に届く（API Gateway が拒否するリクエストはゼロと仮定）
- 平均実行時間 50 ms、256 MB、arm64
- 1 リクエストあたり log 0.5 KB（アプリの 1 行 + Lambda の START/END/REPORT 行）
- log の保持は 7 日。月平均の保存量を取込み量の 7/30 と仮定
- 応答のデータ転送料金は含めていない（未算入）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 1,000,000 | Requests | 1,000,000 requests | 1.29 | - | 1.29 |
| `lambda.request.arm` | 1,000,000 | Requests | one invocation per request | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 12,500 | Lambda-GB-Second | 1,000,000 x 0.05 s x 0.25 GB, in GB-seconds | 0.17 | 400,000 | 0 |
| `logs.ingest.standard` | 0.477 | GB | 1,000,000 x 0.5 KB, in GB | 0.36 | 5 | 0 |
| `logs.storage` | 0.111 | GB-Mo | 0.477 GB x 7/30, in GB-month | 0.003663 | 5 | 0 |

- 定価の小計: **USD 2.02** / 月
- 毎月の無料枠適用後の小計: **USD 1.29** / 月
- 無料枠を確認できず、何も引いていない単価: `apigw.http.request`

## ノート API と table: デプロイ済みで呼ばれない月

ID: `notes-idle` / 章: [05 ノートを保存する: DynamoDB](/ja/chapters/05-dynamodb.md)

前提:

- リクエストゼロ
- table に 10 MB のノート。point-in-time recovery は無効

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.storage` | 0.01 | GB-Mo | 10 MB stored, in GB-month | 0 | - | 0 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## ノート API と table: 月 100 万リクエスト

ID: `notes-small` / 章: [05 ノートを保存する: DynamoDB](/ja/chapters/05-dynamodb.md)

前提:

- 内訳: 一覧 70%、1 件の取得 20%、作成と更新 8%、削除 2%
- 一覧は 1 ページ 20 件、1 件 1 KB で合計 20 KB。結果整合の読み取りなので 4 KB あたり 0.5 read request unit、1 回 2.5 unit
- 1 件の取得は強整合で 1 unit。書き込みと削除は 1 KB 以下で 1 unit
- 競合で拒否された更新も write request unit を消費する。この計算では競合ゼロと仮定
- Lambda は平均 60 ミリ秒、256 MB、arm64。ログは 04章と同じ仮定
- table の保存量は 1 GB。応答のデータ転送料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 1,000,000 | Requests | 1,000,000 requests | 1.29 | - | 1.29 |
| `lambda.request.arm` | 1,000,000 | Requests | one invocation per request | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 15,000 | Lambda-GB-Second | 1,000,000 x 0.06 s x 0.25 GB, in GB-seconds | 0.20 | 400,000 | 0 |
| `logs.ingest.standard` | 0.477 | GB | 1,000,000 x 0.5 KB, in GB | 0.36 | 5 | 0 |
| `logs.storage` | 0.111 | GB-Mo | 0.477 GB x 7/30, in GB-month | 0.003663 | 5 | 0 |
| `dynamodb.read.on-demand` | 1,950,000 | ReadRequestUnits | 700,000 lists x 2.5 + 200,000 reads x 1 | 0.28 | - | 0.28 |
| `dynamodb.write.on-demand` | 100,000 | WriteRequestUnits | 80,000 creates and updates + 20,000 deletes | 0.07 | - | 0.07 |
| `dynamodb.storage` | 1 | GB-Mo | 1 GB stored, in GB-month | 0 | - | 0 |

- 定価の小計: **USD 2.41** / 月
- 毎月の無料枠適用後の小計: **USD 1.64** / 月
- 無料枠を確認できず、何も引いていない単価: `apigw.http.request`

## ノートアプリ（サインインあり）: 月 100 万リクエスト、100 MAU

ID: `notes-app-small` / 章: [06 ログインを足す: Cognito と認可](/ja/chapters/06-auth.md)

前提:

- API と table は「ノート API と table: 月 100 万リクエスト」と同じ仮定
- その月にサインインした利用者が 100 人。Essentials プラン
- メールの送信料金、SPA の配信（CloudFront と S3）は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 1,000,000 | Requests | 1,000,000 requests | 1.29 | - | 1.29 |
| `lambda.request.arm` | 1,000,000 | Requests | one invocation per request | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 15,000 | Lambda-GB-Second | 1,000,000 x 0.06 s x 0.25 GB, in GB-seconds | 0.20 | 400,000 | 0 |
| `logs.ingest.standard` | 0.477 | GB | 1,000,000 x 0.5 KB, in GB | 0.36 | 5 | 0 |
| `logs.storage` | 0.111 | GB-Mo | 0.477 GB x 7/30, in GB-month | 0.003663 | 5 | 0 |
| `dynamodb.read.on-demand` | 1,950,000 | ReadRequestUnits | 700,000 lists x 2.5 + 200,000 reads x 1 | 0.28 | - | 0.28 |
| `dynamodb.write.on-demand` | 100,000 | WriteRequestUnits | 80,000 creates and updates + 20,000 deletes | 0.07 | - | 0.07 |
| `dynamodb.storage` | 1 | GB-Mo | 1 GB stored, in GB-month | 0 | - | 0 |
| `cognito.essentials.mau` | 100 | CognitoUserPoolsMAU | 100 monthly active users | 1.50 | 10,000 | 0 |

- 定価の小計: **USD 3.91** / 月
- 毎月の無料枠適用後の小計: **USD 1.64** / 月
- 無料枠を確認できず、何も引いていない単価: `apigw.http.request`

## ライブ配信: 月 4 回 × 2 時間、各回 100 人が半分ずつ視聴

ID: `live-monthly-100` / 章: [18 ライブ配信のレシピ: IVS](/ja/chapters/18-live.md)

前提:

- BASIC の channel に 720p で配信。BASIC は rendition が 1 つなので、視聴はすべて HD で課金される
- 各回 100 人が、2 時間のうち平均 1 時間ずつ視聴（IVS のドキュメントの目安「平均で配信の 50% が届く」）
- 視聴者はすべて「Japan, Hong Kong, SEA」の単価で配信される
- EventBridge、Lambda、CloudWatch Logs、player ページの配信は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.basic` | 8 | hours | 4 streams x 2 hours of input | 1.60 | - | 1.60 |
| `ivs.output.hd.ap` | 400 | hours | 4 streams x 100 viewers x 1 hour watched | 36.80 | - | 36.80 |

- 定価の小計: **USD 38.40** / 月
- 毎月の無料枠適用後の小計: **USD 38.40** / 月
- 無料枠を確認できず、何も引いていない単価: `ivs.input.basic`

## ライブ配信: 同じ配信を、各回 1,000 人が視聴

ID: `live-monthly-1000` / 章: [18 ライブ配信のレシピ: IVS](/ja/chapters/18-live.md)

前提:

- 「月 4 回 × 2 時間、各回 100 人」と同じ仮定で、視聴者だけ 10 倍

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.basic` | 8 | hours | 4 streams x 2 hours of input | 1.60 | - | 1.60 |
| `ivs.output.hd.ap` | 4,000 | hours | 4 streams x 1,000 viewers x 1 hour watched | 368.00 | - | 368.00 |

- 定価の小計: **USD 369.60** / 月
- 毎月の無料枠適用後の小計: **USD 369.60** / 月
- 無料枠を確認できず、何も引いていない単価: `ivs.input.basic`

## 止め忘れ: BASIC の channel に 48 時間送り続けた

ID: `live-left-on-weekend` / 章: [18 ライブ配信のレシピ: IVS](/ja/chapters/18-live.md)

前提:

- 視聴者は 0 人。1 本の stream の上限である 48 時間、配信ソフトが送り続けた

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.basic` | 48 | hours | 48 hours of input | 9.60 | - | 9.60 |

- 定価の小計: **USD 9.60** / 月
- 毎月の無料枠適用後の小計: **USD 9.60** / 月
- 無料枠を確認できず、何も引いていない単価: `ivs.input.basic`

## 止め忘れ: BASIC の channel に 1 か月送り続けた

ID: `live-left-on-month-basic` / 章: [18 ライブ配信のレシピ: IVS](/ja/chapters/18-live.md)

前提:

- 視聴者は 0 人。配信ソフトが再接続を繰り返し、730 時間ずっと送り続けた

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.basic` | 730 | hours | 730 hours of input | 146.00 | - | 146.00 |

- 定価の小計: **USD 146.00** / 月
- 毎月の無料枠適用後の小計: **USD 146.00** / 月
- 無料枠を確認できず、何も引いていない単価: `ivs.input.basic`

## 止め忘れ: STANDARD の channel に 1 か月送り続けた

ID: `live-left-on-month-standard` / 章: [18 ライブ配信のレシピ: IVS](/ja/chapters/18-live.md)

前提:

- 視聴者は 0 人。channel の type が既定の STANDARD だった場合

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.standard` | 730 | hours | 730 hours of input | 1460.00 | - | 1460.00 |

- 定価の小計: **USD 1460.00** / 月
- 毎月の無料枠適用後の小計: **USD 1460.00** / 月

## ネットワーク: NAT Gateway を 1 つ足す

ID: `network-nat-single` / 章: [11 本当に必要なネットワーク: VPC、subnet、NAT、endpoint](/ja/chapters/11-network.md)

前提:

- `-c egress=nat`。NAT Gateway 1 つを 730 時間置いたまま
- NAT Gateway が持つ Elastic IP アドレス 1 つ
- NAT Gateway を通るデータは月 10 GB と仮定（コンテナ image の取得とログの送信くらい）
- インターネットへのデータ転送と AZ をまたぐデータ転送の料金は未算入
- VPC、subnet、route table、internet gateway、gateway endpoint には料金がない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `nat.gateway.hour` | 730 | Hrs | 1 NAT gateway x 730 hours | 45.26 | - | 45.26 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 Elastic IP address x 730 hours | 3.65 | - | 3.65 |
| `nat.gateway.data` | 10 | GB | 10 GB processed (assumption) | 0.62 | - | 0.62 |

- 定価の小計: **USD 49.53** / 月
- 毎月の無料枠適用後の小計: **USD 49.53** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`

## ネットワーク: NAT Gateway を AZ ごとに足す

ID: `network-nat-per-az` / 章: [11 本当に必要なネットワーク: VPC、subnet、NAT、endpoint](/ja/chapters/11-network.md)

前提:

- `-c egress=nat-per-az`。2 つの AZ に NAT Gateway を 1 つずつ、730 時間置いたまま
- それぞれが持つ Elastic IP アドレス、合わせて 2 つ
- NAT Gateway を通るデータは合わせて月 10 GB と仮定
- インターネットへのデータ転送の料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `nat.gateway.hour` | 1,460 | Hrs | 2 NAT gateways x 730 hours | 90.52 | - | 90.52 |
| `vpc.public-ipv4.in-use.hour` | 1,460 | Hrs | 2 Elastic IP addresses x 730 hours | 7.30 | - | 7.30 |
| `nat.gateway.data` | 10 | GB | 10 GB processed (assumption) | 0.62 | - | 0.62 |

- 定価の小計: **USD 98.44** / 月
- 毎月の無料枠適用後の小計: **USD 98.44** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`

## ネットワーク: interface endpoint を 3 つ足す

ID: `network-interface-endpoints` / 章: [11 本当に必要なネットワーク: VPC、subnet、NAT、endpoint](/ja/chapters/11-network.md)

前提:

- `-c interfaceEndpoints=ecr.api,ecr.dkr,logs`。3 つの endpoint を 2 つの AZ に、730 時間置いたまま
- endpoint を通るデータは合わせて月 10 GB と仮定
- S3 への通信は gateway endpoint を通り、料金がない
- NAT Gateway は無し

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `vpc.endpoint.interface.hour` | 4,380 | Hrs | 3 interface endpoints x 2 zones x 730 hours | 61.32 | - | 61.32 |
| `vpc.endpoint.interface.data` | 10 | GB | 10 GB processed (assumption) | 0.10 | - | 0.10 |

- 定価の小計: **USD 61.42** / 月
- 毎月の無料枠適用後の小計: **USD 61.42** / 月

## 要約 API: デプロイ済みで呼ばれない月

ID: `ai-idle` / 章: [17 Workers AI に親しんだ人の AI 開発: Bedrock](/ja/chapters/17-ai.md)

前提:

- リクエストゼロ
- log は 1 週間で失効し、保存量ゼロ

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## 要約 API: 月 1,000 件（Nova 2 Lite、jp. profile）

ID: `ai-summaries-nova-2-lite` / 章: [17 Workers AI に親しんだ人の AI 開発: Bedrock](/ja/chapters/17-ai.md)

前提:

- 月 1,000 件の要約
- 入力は 1 件あたり 2,000 token と仮定（system prompt とノート。実際の値は応答の usage でわかる）
- 出力は 1 件あたり 150 token と仮定（上限は 400）
- Lambda は 256 MB、arm64、1 件あたり平均 4 秒と仮定（推論を待つ時間も課金される）
- 1 件あたり log 1 KB と仮定
- データ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input` | 2,000 | 1K tokens | 1,000 summaries x 2,000 input tokens, in 1K tokens | 0.79 | - | 0.79 |
| `bedrock.nova-2-lite.output` | 150 | 1K tokens | 1,000 summaries x 150 output tokens, in 1K tokens | 0.50 | - | 0.50 |
| `lambda.request.arm` | 1,000 | Requests | one invocation per summary | 0.000200 | 1,000,000 | 0 |
| `lambda.duration.arm` | 1,000 | Lambda-GB-Second | 1,000 x 4 s x 0.25 GB | 0.01 | 400,000 | 0 |
| `logs.ingest.standard` | 0.001 | GB | 1,000 x 1 KB, in GB | 0.000725 | 5 | 0 |

- 定価の小計: **USD 1.30** / 月
- 毎月の無料枠適用後の小計: **USD 1.29** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.nova-2-lite.input`, `bedrock.nova-2-lite.output`

## 要約 API: 1,000 件すべてが出力の上限に達した場合の出力分

ID: `ai-output-ceiling-nova-2-lite` / 章: [17 Workers AI に親しんだ人の AI 開発: Bedrock](/ja/chapters/17-ai.md)

前提:

- 1,000 件すべてが maxTokens の 400 token まで出力
- 出力 token の分だけ。入力と Lambda は含まない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.output` | 400 | 1K tokens | 1,000 summaries x 400 output tokens, in 1K tokens | 1.32 | - | 1.32 |

- 定価の小計: **USD 1.32** / 月
- 毎月の無料枠適用後の小計: **USD 1.32** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.nova-2-lite.output`

## 要約 API: 同じ token 数を Claude Haiku 4.5 で（推論の分だけ）

ID: `ai-summaries-claude-haiku-4-5` / 章: [17 Workers AI に親しんだ人の AI 開発: Bedrock](/ja/chapters/17-ai.md)

前提:

- 月 1,000 件の要約
- 入力は 1 件あたり 2,000 token と仮定（system prompt とノート。実際の値は応答の usage でわかる）
- 出力は 1 件あたり 150 token と仮定（上限は 400）
- token の数え方はモデルごとに違うので、同じ文章でも token 数は同じにならない。単価の比較のための仮定
- 推論の分だけ。Lambda は含まない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.claude-haiku-4-5.input` | 2 | 1M tokens | 1,000 summaries x 2,000 input tokens, in 1M tokens | 2.20 | - | 2.20 |
| `bedrock.claude-haiku-4-5.output` | 0.15 | 1M tokens | 1,000 summaries x 150 output tokens, in 1M tokens | 0.82 | - | 0.82 |

- 定価の小計: **USD 3.03** / 月
- 毎月の無料枠適用後の小計: **USD 3.03** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.claude-haiku-4-5.input`, `bedrock.claude-haiku-4-5.output`

## 通知メール: デプロイ済みで 1 通も送らない月

ID: `email-idle` / 章: [15 メールを送る: SES](/ja/chapters/15-email.md)

前提:

- 送信ゼロ、イベントゼロ
- table に 10 MB の記録（送信停止の一覧と、期限前の通知の記録）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.storage` | 0.01 | GB-Mo | 10 MB stored, in GB-month | 0 | - | 0 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## 通知メール: 月 1 万通

ID: `email-small` / 章: [15 メールを送る: SES](/ja/chapters/15-email.md)

前提:

- 通知 1 件につき宛先 1 つ、添付なし。月 10,000 通
- 同じ通知の重複依頼が 1,000 件（送信はしないが、API と関数は動く）
- 1 通につき SES のイベントが 1 件（delivery、bounce、complaint のどれか）届く
- 送信の関数は平均 300 ミリ秒、イベントの関数は平均 50 ミリ秒。どちらも 256 MB、arm64
- DynamoDB の書き込みは 1 通あたり 3 回（先取り、送信済み、イベント）、重複依頼は 1 回。読み取りは依頼 1 件につき結果整合で 1 回、重複依頼ではさらに強い整合性で 1 回
- ログは依頼とイベントを合わせて 1 件あたり 0.5 KB
- インターネットへのデータ転送、専用 IP、Virtual Deliverability Manager は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ses.outbound.message` | 10,000 | Count | 10,000 messages x 1 recipient | 1.00 | - | 1.00 |
| `apigw.http.request` | 11,000 | Requests | 10,000 requests + 1,000 repeats | 0.01 | - | 0.01 |
| `lambda.request.arm` | 21,000 | Requests | 11,000 API invocations + 10,000 event invocations | 0.004200 | 1,000,000 | 0 |
| `lambda.duration.arm` | 950 | Lambda-GB-Second | (11,000 x 0.3 s + 10,000 x 0.05 s) x 0.25 GB, in GB-seconds | 0.01 | 400,000 | 0 |
| `sns.request` | 10,000 | Requests | one publish per SES event | 0 | - | 0 |
| `sns.delivery.lambda` | 10,000 | Notifications | one delivery to the function per event | 0 | - | 0 |
| `dynamodb.write.on-demand` | 31,000 | WriteRequestUnits | 10,000 x 3 writes + 1,000 refused claims | 0.02 | - | 0.02 |
| `dynamodb.read.on-demand` | 6,500 | ReadRequestUnits | 11,000 suppression checks x 0.5 + 1,000 consistent reads of an existing record x 1 | 0.000926 | - | 0.000926 |
| `dynamodb.storage` | 0.01 | GB-Mo | 10 MB stored, in GB-month | 0 | - | 0 |
| `logs.ingest.standard` | 0.01 | GB | 21,000 x 0.5 KB, in GB | 0.01 | 5 | 0 |
| `logs.storage` | 0.002 | GB-Mo | 0.01 GB x 7/30, in GB-month | 0.000076 | 5 | 0 |

- 定価の小計: **USD 1.06** / 月
- 毎月の無料枠適用後の小計: **USD 1.04** / 月
- 無料枠を確認できず、何も引いていない単価: `apigw.http.request`, `ses.outbound.message`

## edge の例: 月 100 万リクエスト

ID: `edge-small` / 章: [10 edge を理解する: CloudFront Functions、KeyValueStore、Lambda@Edge](/ja/chapters/10-edge.md)

前提:

- すべて日本の edge から配信、HTTPS、1 リクエスト平均 20 KB
- 内訳はトップページ 10%、その他のページ 20%、ファイル 70%。関数はそれぞれ KeyValueStore を 3 回、2 回、1 回読む
- CloudFront Function は全リクエストで実行
- cache miss と再検証で origin へ 1/3 が届くと仮定
- edge:kvs:sync を月 20 回（Describe 1、ListKeys 1、UpdateKeys 1）、edge:kvs:plan を月 10 回（Describe 1、ListKeys 1）
- Lambda@Edge は POST /digest の 1 万回だけ。128 MB、平均 50 ミリ秒と仮定
- Lambda@Edge のログ（CloudWatch Logs）、標準ログ、WAF、独自ドメインは含まない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 1,000,000 | Requests | 1,000,000 viewer requests | 1.20 | 10,000,000 | 0 |
| `cloudfront.jp.transfer` | 19.073 | GB | 1,000,000 requests x 20 KB, in GB | 2.17 | 1,024 | 0 |
| `cloudfront.function.execution` | 1,000,000 | FunctionExecutions | one execution per viewer request | 0 | 2,000,000 | 0 |
| `cloudfront.kvs.read` | 1,400,000 | EdgeReads | 100,000 x 3 + 200,000 x 2 + 700,000 x 1 reads | 0 | 2,000,000 | 0 |
| `cloudfront.kvs.api` | 80 | API Requests | 20 syncs x 3 calls + 10 dry runs x 2 calls | 0.08 | - | 0.08 |
| `lambdaedge.jp.request` | 10,000 | Request | 10,000 POST /digest requests | 0.01 | - | 0.01 |
| `lambdaedge.jp.duration` | 62.5 | Lambda-GB-Second | 10,000 x 0.05 s x 0.125 GB | 0.003126 | - | 0.003126 |
| `s3.request.tier2` | 333,333 | Requests | one third of 1,000,000 requests reach S3 as GET | 0.12 | - | 0.12 |

- 定価の小計: **USD 3.59** / 月
- 毎月の無料枠適用後の小計: **USD 0.21** / 月
- 無料枠を確認できず、何も引いていない単価: `cloudfront.kvs.api`, `s3.request.tier2`

## Aurora DSQL: 1 GB のデータを置いて、誰も問い合わせない月

ID: `sql-dsql-idle` / 章: [13 D1 に親しんだ人の SQL 開発: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2](/ja/chapters/13-sql.md)

前提:

- 問い合わせゼロ。DPU は発生しない
- データは 1 GB
- backup なし

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dsql.dpu` | 0 | DPU | no database activity | 0 | 100,000 | 0 |
| `dsql.storage` | 1 | GB-Month | 1 GB stored for the month | 0.40 | 1 | 0 |

- 定価の小計: **USD 0.40** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## Aurora DSQL: 月 100 万リクエストのノート API（DB の分だけ）

ID: `sql-dsql-small` / 章: [13 D1 に親しんだ人の SQL 開発: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2](/ja/chapters/13-sql.md)

前提:

- 読み取り 90 万件、書き込み 10 万件
- 読み取り 1 件は 0.00675 DPU と仮定（公式ドキュメントの point lookup の計算例の値）
- 書き込み 1 件は 0.18525 DPU と仮定（公式ドキュメントの 1 行 insert の計算例 0.06175 DPU の 3 倍。この章の作成は 3 行に書く）
- この章の query で実測した値ではない
- データは 1 GB
- Lambda、API Gateway、ログ、backup は含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dsql.dpu` | 24,600 | DPU | 900,000 x 0.00675 DPU + 100,000 x 0.18525 DPU | 0.25 | 100,000 | 0 |
| `dsql.storage` | 1 | GB-Month | 1 GB stored for the month | 0.40 | 1 | 0 |

- 定価の小計: **USD 0.65** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## RDS for PostgreSQL: 最小構成を 730 時間動かす

ID: `sql-rds-min` / 章: [13 D1 に親しんだ人の SQL 開発: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2](/ja/chapters/13-sql.md)

前提:

- db.t4g.micro、Single-AZ、止めずに 730 時間
- gp3 を 20 GB（PostgreSQL での最小）
- 問い合わせの量によらない
- backup の超過分、データ転送、VPC の料金（11章）は含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.t4g-micro.single-az` | 730 | Hrs | one instance for 730 hours | 18.25 | - | 18.25 |
| `rds.postgres.gp3.storage` | 20 | GB-Mo | 20 GB provisioned for the month | 2.76 | - | 2.76 |

- 定価の小計: **USD 21.01** / 月
- 毎月の無料枠適用後の小計: **USD 21.01** / 月
- 無料枠を確認できず、何も引いていない単価: `rds.postgres.t4g-micro.single-az`, `rds.postgres.gp3.storage`

## Aurora Serverless v2: auto-pause なし、最小 0.5 ACU で 730 時間

ID: `sql-aurora-min` / 章: [13 D1 に親しんだ人の SQL 開発: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2](/ja/chapters/13-sql.md)

前提:

- Aurora PostgreSQL、writer 1 台、最小容量 0.5 ACU のまま 730 時間
- Aurora Standard（I/O は別料金。ここでは I/O ゼロ）
- データは 1 GB
- backup の超過分、データ転送、VPC の料金（11章）は含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu` | 365 | ACU-Hr | 0.5 ACU x 730 hours | 54.75 | - | 54.75 |
| `aurora.postgres.storage` | 1 | GB-Mo | 1 GB stored for the month | 0.12 | - | 0.12 |

- 定価の小計: **USD 54.87** / 月
- 毎月の無料枠適用後の小計: **USD 54.87** / 月

## Aurora Serverless v2: auto-pause で 1 か月ずっと止まっていた場合

ID: `sql-aurora-paused` / 章: [13 D1 に親しんだ人の SQL 開発: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2](/ja/chapters/13-sql.md)

前提:

- 最小容量 0 ACU。1 か月のあいだ一度も接続がなく、再開もしなかったと仮定
- 実際には保守のために Aurora が instance を再開することがあり、その時間は課金される
- データは 1 GB

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu` | 0 | ACU-Hr | paused for all 730 hours | 0 | - | 0 |
| `aurora.postgres.storage` | 1 | GB-Mo | 1 GB stored for the month | 0.12 | - | 0.12 |

- 定価の小計: **USD 0.12** / 月
- 毎月の無料枠適用後の小計: **USD 0.12** / 月

## 画像の添付: 月 10,000 枚のアップロード、100,000 回の表示

ID: `uploads-small` / 章: [07 画像をアップロードする: presigned URL と S3](/ja/chapters/07-uploads.md)

前提:

- 06章のノートアプリの料金に上乗せされる分だけを数える
- 画像は 1 枚 1 MB。月に 10,000 枚がアップロードされ、すべて添付まで完了する。月末の保存量は 10 GB
- ノートを開くたびに添付の一覧を 1 回呼び、画像を 1 枚読み込む。それが月に 100,000 回。ブラウザの cache は効かないものとする
- S3 へのリクエスト: アップロードの POST が 10,000、HeadObject が 10,000、画像の GET が 100,000。tag を外すリクエストは請求されない。削除のリクエストは未算入
- API は許可の発行 10,000、完了 10,000、一覧 100,000 の計 120,000 リクエスト。Lambda は平均 60 ミリ秒、256 MB、arm64
- DynamoDB の読み取りは、許可の発行で 2、完了で 3、一覧で 2 unit。書き込みは完了のたびに 1 unit
- アップロードのデータ転送（インターネットから S3 へ）は 0。未完了のアップロード、tag の保存料金、掃除のための LIST は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3.standard.storage` | 10 | GB-Mo | 10 GB stored, in GB-month | 0.25 | - | 0.25 |
| `s3.request.tier1` | 10,000 | Requests | 10,000 upload POSTs | 0.05 | - | 0.05 |
| `s3.request.tier2` | 110,000 | Requests | 10,000 HeadObject + 100,000 GET | 0.04 | - | 0.04 |
| `datatransfer.out.internet` | 97.656 | GB | 100,000 views x 1 MB, in GB | 11.13 | - | 11.13 |
| `apigw.http.request` | 120,000 | Requests | 10,000 permits + 10,000 finishes + 100,000 lists | 0.15 | - | 0.15 |
| `lambda.request.arm` | 120,000 | Requests | one invocation per request | 0.02 | 1,000,000 | 0 |
| `lambda.duration.arm` | 1,800 | Lambda-GB-Second | 120,000 x 0.06 s x 0.25 GB, in GB-seconds | 0.02 | 400,000 | 0 |
| `logs.ingest.standard` | 0.057 | GB | 120,000 x 0.5 KB, in GB | 0.04 | 5 | 0 |
| `logs.storage` | 0.013 | GB-Mo | 0.057 GB x 7/30, in GB-month | 0.000429 | 5 | 0 |
| `dynamodb.read.on-demand` | 250,000 | ReadRequestUnits | 10,000 x 2 + 10,000 x 3 + 100,000 x 2 | 0.04 | - | 0.04 |
| `dynamodb.write.on-demand` | 10,000 | WriteRequestUnits | one record per finished upload | 0.01 | - | 0.01 |

- 定価の小計: **USD 11.76** / 月
- 毎月の無料枠適用後の小計: **USD 11.67** / 月
- 無料枠を確認できず、何も引いていない単価: `apigw.http.request`, `s3.standard.storage`, `datatransfer.out.internet`, `s3.request.tier1`, `s3.request.tier2`

## SSR: デプロイ済みで誰も来ない月

ID: `ssr-idle` / 章: [09 SSR と BFF: Nuxt をリージョンの Lambda で動かす](/ja/chapters/09-ssr.md)

前提:

- リクエストゼロ、publish ゼロ
- bucket に 5 MB の静的 asset
- log は 1 週間で失効し、保存量ゼロ

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3.standard.storage` | 0.005 | GB-Mo | 5 MB stored for the month, in GB-month | 0.000125 | - | 0.000125 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`

## SSR: 月 10 万ページビュー

ID: `ssr-small` / 章: [09 SSR と BFF: Nuxt をリージョンの Lambda で動かす](/ja/chapters/09-ssr.md)

前提:

- 1 ページビューあたり CloudFront へ平均 4 リクエスト（HTML か API の JSON が 1、asset が平均 3）、合計 100 KB と仮定
- すべて日本の edge から配信、HTTPS
- HTML と API の 10 万リクエストのうち、半分が CloudFront の cache で返り、残り 5 万が Lambda に届くと仮定
- Lambda は平均 200 ms、512 MB、arm64、buffered。200 ms は仮定で、計測値ではない
- 1 回の呼び出しあたり log 0.3 KB（Lambda が書く START/END/REPORT 行のみ）。保持 7 日で、月平均の保存量を取込み量の 7/30 と仮定
- asset の 30 万リクエストのうち 1/10 が S3 に届くと仮定
- publish は月 10 回、各 20 object を PUT。bucket に 5 MB
- Lambda から CloudFront へのデータ転送、標準ログ、WAF、独自ドメインは含めていない（未算入）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 400,000 | Requests | 100,000 page views x 4 requests | 0.48 | 10,000,000 | 0 |
| `cloudfront.jp.transfer` | 9.537 | GB | 100,000 page views x 100 KB, in GB | 1.09 | 1,024 | 0 |
| `lambda.request.arm` | 50,000 | Requests | half of 100,000 HTML and API requests | 0.01 | 1,000,000 | 0 |
| `lambda.duration.arm` | 5,000 | Lambda-GB-Second | 50,000 x 0.2 s x 0.5 GB, in GB-seconds | 0.07 | 400,000 | 0 |
| `logs.ingest.standard` | 0.014 | GB | 50,000 x 0.3 KB, in GB | 0.01 | 5 | 0 |
| `logs.storage` | 0.003 | GB-Mo | 0.0143 GB x 7/30, in GB-month | 0.000109 | 5 | 0 |
| `s3.request.tier2` | 30,000 | Requests | one tenth of 300,000 asset requests reach S3 as GET | 0.01 | - | 0.01 |
| `s3.request.tier1` | 200 | Requests | 10 publishes x 20 PUTs | 0.000940 | - | 0.000940 |
| `s3.standard.storage` | 0.005 | GB-Mo | 5 MB, in GB-month | 0.000125 | - | 0.000125 |

- 定価の小計: **USD 1.67** / 月
- 毎月の無料枠適用後の小計: **USD 0.01** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `s3.request.tier1`, `s3.request.tier2`

## 監視つきノート API: デプロイ済みで呼ばれない月

ID: `obs-idle` / 章: [19 本番の挙動を見る: CloudWatch、OpenTelemetry、RUM、Synthetics](/ja/chapters/19-observability.md)

前提:

- リクエストゼロ。ログ、trace、custom metric のデータ点はどれも発生しない
- アラーム 2 つが参照するメトリクスは合計 3 つ（5xx の率が Count と 5xx、遅さが Latency）
- ダッシュボード 1 つは無料枠（3 つまで、各 50 メトリクスまで）の内と仮定。4 つ目からの単価は確認できていないため、金額に含めていない
- API、Lambda、DynamoDB そのものの料金は 04章と 05章の計算のとおりで、ここには含めていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.alarm.standard` | 3 | Alarms | 2 alarms listing 3 metrics | 0.30 | 10 | 0 |

- 定価の小計: **USD 0.30** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## 監視つきノート API: 月 100 万リクエストの観測の料金

ID: `obs-small` / 章: [19 本番の挙動を見る: CloudWatch、OpenTelemetry、RUM、Synthetics](/ja/chapters/19-observability.md)

前提:

- 1 リクエストあたりログ 1 KB。アプリの 1 行は実測で 255 バイト（trace の項目つき）、残りは Lambda が書く行で、JSON 形式での大きさは未計測の仮定
- ログの保持は 7 日。月平均の保存量を取り込み量の 7/30 と仮定
- リクエストが一定の間隔で届くと仮定。毎秒 0.38 件で、Lambda の既定の sampling（毎秒最初の 1 件と残りの 5%）では全件が trace になる。これは上限で、実際の到着が偏れば減る
- 1 つの trace に含まれる span の数は料金に影響しない（trace 単位の課金）と仮定
- trace を画面で開くのは月 10,000 件、Logs Insights で調べるログは月 1 GB
- custom metric は NoteConflicts の 1 つ、アラームが参照するメトリクスは 3 つ
- ダッシュボードは無料枠の内と仮定。SNS の通知、API・Lambda・DynamoDB そのものの料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `logs.ingest.standard` | 0.954 | GB | 1,000,000 x 1,024 bytes, in GB | 0.72 | 5 | 0 |
| `logs.storage` | 0.223 | GB-Mo | 0.953674 GB x 7/30, in GB-month | 0.01 | 5 | 0 |
| `logs.insights.scanned` | 1 | GB | 1 GB scanned by queries | 0.01 | 5 | 0 |
| `cloudwatch.metric.custom` | 1 | Metrics | NoteConflicts | 0.30 | 10 | 0 |
| `cloudwatch.alarm.standard` | 3 | Alarms | 2 alarms listing 3 metrics | 0.30 | 10 | 0 |
| `xray.trace.recorded` | 1,000,000 | traces | every request traced at 0.38 requests per second | 5.00 | 100,000 | 4.50 |
| `xray.trace.retrieved` | 10,000 | traces | 10,000 traces opened | 0.01 | 1,000,000 | 0 |

- 定価の小計: **USD 6.34** / 月
- 毎月の無料枠適用後の小計: **USD 4.50** / 月

## ログを 1 行増やす: 月 100 万リクエスト

ID: `obs-one-more-line` / 章: [19 本番の挙動を見る: CloudWatch、OpenTelemetry、RUM、Synthetics](/ja/chapters/19-observability.md)

前提:

- 増やす 1 行はリクエストの行と同じ 167 バイト（実測。trace の項目なし）
- 保持は 7 日。月平均の保存量を取り込み量の 7/30 と仮定

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `logs.ingest.standard` | 0.156 | GB | 1,000,000 x 167 bytes, in GB | 0.12 | 5 | 0 |
| `logs.storage` | 0.036 | GB-Mo | 0.15553 GB x 7/30, in GB-month | 0.001198 | 5 | 0 |

- 定価の小計: **USD 0.12** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## メトリクスを 1 つ増やす

ID: `obs-one-more-metric` / 章: [19 本番の挙動を見る: CloudWatch、OpenTelemetry、RUM、Synthetics](/ja/chapters/19-observability.md)

前提:

- dimension なしの custom metric を 1 つ、毎時間データ点が届く状態で 1 か月
- dimension を付けると、値の組み合わせ 1 つごとに 1 メトリクスと数える

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.metric.custom` | 1 | Metrics | 1 metric for a full month | 0.30 | 10 | 0 |

- 定価の小計: **USD 0.30** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## Synthetics: 5 分ごとの canary 1 つ

ID: `obs-canary-5min` / 章: [19 本番の挙動を見る: CloudWatch、OpenTelemetry、RUM、Synthetics](/ja/chapters/19-observability.md)

前提:

- 730 時間 x 毎時 12 回 = 8,760 回の実行
- canary が使う Lambda、S3、ログ、メトリクスの料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.synthetics.run` | 8,760 | Runs | 730 h x 12 runs | 16.64 | 100 | 16.45 |

- 定価の小計: **USD 16.64** / 月
- 毎月の無料枠適用後の小計: **USD 16.45** / 月

## RUM: 月 1 万回の訪問を全件収集

ID: `obs-rum-small` / 章: [19 本番の挙動を見る: CloudWatch、OpenTelemetry、RUM、Synthetics](/ja/chapters/19-observability.md)

前提:

- 1 回の訪問で 20 イベント（料金ページの計算例と同じ数）、session の収集率 100%
- 初回の無料トライアル（100 万イベント、1 回限り）は引いていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.rum.event` | 200,000 | Events | 10,000 visits x 20 events | 2.00 | - | 2.00 |

- 定価の小計: **USD 2.00** / 月
- 毎月の無料枠適用後の小計: **USD 2.00** / 月
- 無料枠を確認できず、何も引いていない単価: `cloudwatch.rum.event`

## KV と cache: 既定の stack（DynamoDB）を置いたまま、呼ばれない月

ID: `kv-idle-dynamodb` / 章: [14 key-value と cache を選ぶ: DynamoDB、ElastiCache/Valkey、edge 設定](/ja/chapters/14-kv-cache.md)

前提:

- リクエストゼロ
- table に残るのは期限切れを待つ item だけ。1 MB と多めに仮定
- ElastiCache は作っていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.storage` | 0.001 | GB-Mo | 1 MB stored, in GB-month | 0 | - | 0 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## KV と cache: ElastiCache Serverless（Valkey）を置いたまま、呼ばれない月

ID: `kv-idle-valkey-serverless` / 章: [14 key-value と cache を選ぶ: DynamoDB、ElastiCache/Valkey、edge 設定](/ja/chapters/14-kv-cache.md)

前提:

- `-c store=valkey`。cache を 730 時間置いたまま。リクエストゼロ
- 保存量は 100 MB 未満。Valkey の最小課金 100 MB（0.1 GB として計算）がかかる
- snapshot なし。データ転送なし

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `elasticache.serverless.valkey.storage` | 73 | GB-Hours | 0.1 GB minimum x 730 hours, in GB-hours | 7.37 | - | 7.37 |

- 定価の小計: **USD 7.37** / 月
- 毎月の無料枠適用後の小計: **USD 7.37** / 月

## 比較: node ベースの Valkey（cache.t4g.micro 1 台）を置いたままの月

ID: `kv-idle-valkey-node` / 章: [14 key-value と cache を選ぶ: DynamoDB、ElastiCache/Valkey、edge 設定](/ja/chapters/14-kv-cache.md)

前提:

- この章の stack は作らない構成。料金の比較のためだけに計算
- replica なしの 1 node を 730 時間。VPC が要る（VPC 自体は無料）
- backup、データ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `elasticache.node.valkey.t4g-micro` | 730 | Hrs | 1 node x 730 hours | 14.60 | - | 14.60 |

- 定価の小計: **USD 14.60** / 月
- 毎月の無料枠適用後の小計: **USD 14.60** / 月

## KV と cache: DynamoDB 版で月 100 万リクエスト

ID: `kv-used-dynamodb` / 章: [14 key-value と cache を選ぶ: DynamoDB、ElastiCache/Valkey、edge 設定](/ja/chapters/14-kv-cache.md)

前提:

- `GET /items` を月 100 万回。すべて rate limit を通る（拒否された分も書き込み 1 単位を消費する）
- rate limit: リクエストごとに UpdateItem 1 回（1 KB 未満、書き込み 1 単位）。固定窓
- cache の読み取り: リクエストごとに結果整合の GetItem 1 回（4 KB 未満、読み取り 0.5 単位）
- cache の詰め直し: TTL 30 秒が切れるたびに必ず 1 回起きると仮定して月 87,600 回。1 回あたり lock の取得・値の書き込み・lock の解放で書き込み 3 単位、取り直しの読み取り 0.5 単位
- Lambda は arm64、256 MB、平均 30 ミリ秒と仮定。ログは 1 リクエスト 0.5 KB
- table の保存量は 1 MB。インターネットへのデータ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 1,000,000 | Requests | 1,000,000 requests | 1.29 | - | 1.29 |
| `lambda.request.arm` | 1,000,000 | Requests | 1,000,000 invocations | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 7,500 | Lambda-GB-Second | 1,000,000 x 0.03 s x 0.25 GB | 0.10 | 400,000 | 0 |
| `dynamodb.write.on-demand` | 1,262,800 | WriteRequestUnits | 1,000,000 counter updates + 87,600 refills x 3 writes | 0.90 | - | 0.90 |
| `dynamodb.read.on-demand` | 543,800 | ReadRequestUnits | (1,000,000 + 87,600) eventually consistent reads x 0.5 | 0.08 | - | 0.08 |
| `dynamodb.storage` | 0.001 | GB-Mo | 1 MB stored, in GB-month | 0 | - | 0 |
| `logs.ingest.standard` | 0.477 | GB | 1,000,000 x 0.5 KB, in GB | 0.36 | 5 | 0 |
| `logs.storage` | 0.111 | GB-Mo | about 7 days of logs kept, in GB-month | 0.003663 | 5 | 0 |

- 定価の小計: **USD 2.94** / 月
- 毎月の無料枠適用後の小計: **USD 2.27** / 月
- 無料枠を確認できず、何も引いていない単価: `apigw.http.request`

## KV と cache: ElastiCache Serverless（Valkey）版で月 100 万リクエスト

ID: `kv-used-valkey` / 章: [14 key-value と cache を選ぶ: DynamoDB、ElastiCache/Valkey、edge 設定](/ja/chapters/14-kv-cache.md)

前提:

- `GET /items` を月 100 万回
- 保存量は 100 MB 未満。最小課金 100 MB（0.1 GB として計算）を 730 時間
- 1 リクエストあたり 10 ECPU と多めに仮定。script（EVAL）が実際に何 ECPU を消費するかは計測していない
- Lambda は arm64、256 MB、平均 30 ミリ秒と仮定。ログは 1 リクエスト 0.5 KB
- public endpoint へのデータ転送（アプリ側で 1 GB あたり USD 0.01）と、インターネットへのデータ転送は未算入
- DynamoDB の table は stack に残るが、この構成では読み書きしない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 1,000,000 | Requests | 1,000,000 requests | 1.29 | - | 1.29 |
| `lambda.request.arm` | 1,000,000 | Requests | 1,000,000 invocations | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 7,500 | Lambda-GB-Second | 1,000,000 x 0.03 s x 0.25 GB | 0.10 | 400,000 | 0 |
| `elasticache.serverless.valkey.storage` | 73 | GB-Hours | 0.1 GB minimum x 730 hours, in GB-hours | 7.37 | - | 7.37 |
| `elasticache.serverless.valkey.ecpu` | 10,000,000 | ElastiCacheProcessingUnit | 1,000,000 requests x 10 ECPUs (assumption) | 0.03 | - | 0.03 |
| `logs.ingest.standard` | 0.477 | GB | 1,000,000 x 0.5 KB, in GB | 0.36 | 5 | 0 |
| `logs.storage` | 0.111 | GB-Mo | about 7 days of logs kept, in GB-month | 0.003663 | 5 | 0 |

- 定価の小計: **USD 9.36** / 月
- 毎月の無料枠適用後の小計: **USD 8.69** / 月
- 無料枠を確認できず、何も引いていない単価: `apigw.http.request`

## 変更を届ける: stack と CI の role を置いて、誰も呼ばない月

ID: `ship-idle` / 章: [20 変更を届ける: CI/CD、OIDC、環境、preview、rollback、drift](/ja/chapters/20-shipping.md)

前提:

- API へのリクエストゼロ。log は失効して保存量ゼロ
- CloudFormation は AWS:: の resource type に追加料金なし。IAM の role と OIDC provider は IAM の一部で、追加料金なし
- deploy も drift 検出も 0 回
- GitHub Actions の料金は AWS の請求ではないので含めていない

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## 変更を届ける: 1 日 1 回のデプロイを 1 年続けて、asset を一度も片付けない

ID: `ship-assets-year` / 章: [20 変更を届ける: CI/CD、OIDC、環境、preview、rollback、drift](/ja/chapters/20-shipping.md)

前提:

- デプロイのたびにコードが変わり、新しい zip が CDK の asset bucket に 1 つ増える
- zip は 1 つ 137 KB（この章の bundle 837 KB を手元で deflate した大きさ。CDK CLI が作る zip の実測ではない）
- 365 個すべてが残っている月の保存料金。PUT のリクエスト料金は含めていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3.standard.storage` | 0.048 | GB-Mo | 365 x 137 KB, in GB | 0.001192 | - | 0.001192 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`

## コンテナ: repository だけ（image tag なしで deploy）

ID: `containers-repository-only` / 章: [12 コンテナを動かす: ECR、ECS/Fargate、ALB](/ja/chapters/12-containers.md)

前提:

- `-c imageTag` を付けずに deploy した状態。ALB も task も無い
- image 1 つぶんとして 0.1 GB を保存していると仮定（実際の image の大きさは build していないので未計測）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ecr.storage` | 0.1 | GB-Mo | 0.1 GB stored (assumption) | 0.01 | - | 0.01 |

- 定価の小計: **USD 0.01** / 月
- 毎月の無料枠適用後の小計: **USD 0.01** / 月
- 無料枠を確認できず、何も引いていない単価: `ecr.storage`

## コンテナ: 既定の構成を置いたまま 1 か月

ID: `containers-idle` / 章: [12 コンテナを動かす: ECR、ECS/Fargate、ALB](/ja/chapters/12-containers.md)

前提:

- task 2 つ（0.25 vCPU、0.5 GB、arm64）を public subnet で 730 時間
- ALB 1 つを 730 時間。LCU は未算入（health check だけのときの LCU は確認していない）
- public IPv4 アドレスは ALB の node 2 つと task 2 つで 4 つ。ALB が node を増やせば増える
- repository に 0.1 GB（仮定）
- ログ、データ転送、auto scaling で増えた task は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 365 | hours | 2 tasks x 0.25 vCPU x 730 hours | 14.76 | - | 14.76 |
| `fargate.arm.memory.gb-hour` | 730 | hours | 2 tasks x 0.5 GB x 730 hours | 3.23 | - | 3.23 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,920 | Hrs | (2 load balancer nodes + 2 tasks) x 730 hours | 14.60 | - | 14.60 |
| `ecr.storage` | 0.1 | GB-Mo | 0.1 GB stored (assumption) | 0.01 | - | 0.01 |

- 定価の小計: **USD 50.34** / 月
- 毎月の無料枠適用後の小計: **USD 50.34** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `ecr.storage`

## コンテナ: 既定の構成を 1 日

ID: `containers-one-day` / 章: [12 コンテナを動かす: ECR、ECS/Fargate、ALB](/ja/chapters/12-containers.md)

前提:

- `containers-idle` と同じ構成を 24 時間
- repository の保存料金、ログ、データ転送、LCU は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 12 | hours | 2 tasks x 0.25 vCPU x 24 hours | 0.49 | - | 0.49 |
| `fargate.arm.memory.gb-hour` | 24 | hours | 2 tasks x 0.5 GB x 24 hours | 0.11 | - | 0.11 |
| `alb.hour` | 24 | Hrs | 1 load balancer x 24 hours | 0.58 | - | 0.58 |
| `vpc.public-ipv4.in-use.hour` | 96 | Hrs | (2 load balancer nodes + 2 tasks) x 24 hours | 0.48 | - | 0.48 |

- 定価の小計: **USD 1.65** / 月
- 毎月の無料枠適用後の小計: **USD 1.65** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`

## コンテナ: 月 100 万リクエスト

ID: `containers-small` / 章: [12 コンテナを動かす: ECR、ECS/Fargate、ALB](/ja/chapters/12-containers.md)

前提:

- `containers-idle` の構成のまま、task は 2 つから増えないと仮定
- LCU は新規接続の次元で数える。1 リクエスト 1 接続、月 100 万件は毎秒 0.38 件で 0.0152 LCU、730 時間で 11.1 LCU 時間
- ログは 1 リクエスト 0.2 KB の 1 行（成功した health check は書かない）。保持 7 日、月平均の保存量を取込み量の 7/30 と仮定
- 応答は 1 件 0.5 KB と仮定し、インターネットへのデータ転送を 0.477 GB

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 365 | hours | 2 tasks x 0.25 vCPU x 730 hours | 14.76 | - | 14.76 |
| `fargate.arm.memory.gb-hour` | 730 | hours | 2 tasks x 0.5 GB x 730 hours | 3.23 | - | 3.23 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,920 | Hrs | (2 load balancer nodes + 2 tasks) x 730 hours | 14.60 | - | 14.60 |
| `ecr.storage` | 0.1 | GB-Mo | 0.1 GB stored (assumption) | 0.01 | - | 0.01 |
| `alb.lcu.hour` | 11.1 | LCU-Hrs | 0.0152 LCU x 730 hours (assumption) | 0.09 | - | 0.09 |
| `logs.ingest.standard` | 0.191 | GB | 1,000,000 x 0.2 KB, in GB | 0.15 | 5 | 0 |
| `logs.storage` | 0.045 | GB-Mo | 0.191 GB x 7/30, in GB-month | 0.001485 | 5 | 0 |
| `datatransfer.out.internet` | 0.477 | GB | 1,000,000 x 0.5 KB, in GB | 0.05 | - | 0.05 |

- 定価の小計: **USD 50.63** / 月
- 毎月の無料枠適用後の小計: **USD 50.48** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `datatransfer.out.internet`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `alb.lcu.hour`, `ecr.storage`

## コンテナ: task を private subnet に置き、NAT Gateway 1 つで出る

ID: `containers-private-nat` / 章: [12 コンテナを動かす: ECR、ECS/Fargate、ALB](/ja/chapters/12-containers.md)

前提:

- `-c taskSubnets=private`、11章を `-c egress=nat` で deploy
- task は public IPv4 アドレスを持たない。ALB の node 2 つと NAT Gateway の Elastic IP アドレスで 3 つ
- NAT Gateway を通るデータ（image の取得とログ）は月 2 GB と仮定
- LCU、ログ、インターネットへのデータ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 365 | hours | 2 tasks x 0.25 vCPU x 730 hours | 14.76 | - | 14.76 |
| `fargate.arm.memory.gb-hour` | 730 | hours | 2 tasks x 0.5 GB x 730 hours | 3.23 | - | 3.23 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,190 | Hrs | (2 load balancer nodes + 1 NAT gateway) x 730 hours | 10.95 | - | 10.95 |
| `ecr.storage` | 0.1 | GB-Mo | 0.1 GB stored (assumption) | 0.01 | - | 0.01 |
| `nat.gateway.hour` | 730 | Hrs | 1 NAT gateway x 730 hours | 45.26 | - | 45.26 |
| `nat.gateway.data` | 2 | GB | 2 GB processed (assumption) | 0.12 | - | 0.12 |

- 定価の小計: **USD 92.07** / 月
- 毎月の無料枠適用後の小計: **USD 92.07** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `ecr.storage`

## コンテナ: task を private subnet に置き、interface endpoint 3 つで AWS に届く

ID: `containers-private-endpoints` / 章: [12 コンテナを動かす: ECR、ECS/Fargate、ALB](/ja/chapters/12-containers.md)

前提:

- `-c taskSubnets=private`、11章を `-c interfaceEndpoints=ecr.api,ecr.dkr,logs` で deploy
- interface endpoint 3 つ × 2 AZ。image の layer は S3 の gateway endpoint（無料）を通る
- interface endpoint を通るデータは月 1 GB と仮定
- public IPv4 アドレスは ALB の node 2 つだけ
- LCU、ログ、インターネットへのデータ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 365 | hours | 2 tasks x 0.25 vCPU x 730 hours | 14.76 | - | 14.76 |
| `fargate.arm.memory.gb-hour` | 730 | hours | 2 tasks x 0.5 GB x 730 hours | 3.23 | - | 3.23 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 1,460 | Hrs | 2 load balancer nodes x 730 hours | 7.30 | - | 7.30 |
| `ecr.storage` | 0.1 | GB-Mo | 0.1 GB stored (assumption) | 0.01 | - | 0.01 |
| `vpc.endpoint.interface.hour` | 4,380 | Hrs | 3 interface endpoints x 2 zones x 730 hours | 61.32 | - | 61.32 |
| `vpc.endpoint.interface.data` | 1 | GB | 1 GB processed (assumption) | 0.01 | - | 0.01 |

- 定価の小計: **USD 104.37** / 月
- 毎月の無料枠適用後の小計: **USD 104.37** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `ecr.storage`

## 非同期の検査と掃除: デプロイ済みで、画像が 1 枚もない月

ID: `async-idle` / 章: [08 リクエストの外で処理する: SQS、DLQ、冪等性、Scheduler](/ja/chapters/08-async.md)

前提:

- 07章のアプリの料金に上乗せされる分だけを数える。アップロードはゼロ、bucket は空
- schedule は 1 時間に 1 回、月 730 回、掃除の関数を起動する。1 回は 0.5 秒、256 MB、arm64 と仮定する
- 掃除は 1 回につき bucket の一覧を 2 回読む。空なので 1 ページずつ
- ログは 1 回の起動につき 1 KB（関数の 1 行と、Lambda が書く START、END、REPORT の行）
- 未算入: Lambda が空の queue を long polling するときの SQS のリクエスト。頻度が公式ドキュメントに書かれていないため、数量を出せない。0 という意味ではない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `scheduler.invocation` | 730 | Invocations | one invocation an hour | 0 | - | 0 |
| `lambda.request.arm` | 730 | Requests | one housekeeping run an hour | 0.000146 | 1,000,000 | 0 |
| `lambda.duration.arm` | 91.25 | Lambda-GB-Second | 730 x 0.5 s x 0.25 GB, in GB-seconds | 0.001217 | 400,000 | 0 |
| `s3.request.tier1` | 1,460 | Requests | 730 runs x 2 LIST requests | 0.01 | - | 0.01 |
| `logs.ingest.standard` | 0.001 | GB | 730 x 1 KB, in GB | 0.000532 | 5 | 0 |
| `logs.storage` | 0 | GB-Mo | 0.0007 GB x 7/30, in GB-month | 0.000007 | 5 | 0 |

- 定価の小計: **USD 0.01** / 月
- 毎月の無料枠適用後の小計: **USD 0.01** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.request.tier1`

## 非同期の検査: 月 10,000 枚のアップロードと 1,000 回の削除

ID: `async-pipeline-small` / 章: [08 リクエストの外で処理する: SQS、DLQ、冪等性、Scheduler](/ja/chapters/08-async.md)

前提:

- 07章の例（月 10,000 枚のアップロード）に上乗せされる、イベントごとの分だけを数える。掃除の分は別の例
- S3 のイベントは 11,000 件（作成 10,000、削除 1,000）。重複と再試行はゼロとする
- SQS のリクエストは 1 メッセージにつき 3 回（S3 の SendMessage、Lambda の ReceiveMessage と DeleteMessage）と数える。空振りの ReceiveMessage は未算入（頻度が不明）
- worker は 1 メッセージにつき 1 回起動するものとする（batch にまとまれば、これより少ない）。平均 200 ミリ秒、256 MB、arm64
- worker の S3 へのリクエストは、作成イベントごとに GetObject が 1 回。tag を外すリクエストは請求されないものとする（07章と同じ）
- DynamoDB は、作成イベントごとに書き込み 1 unit と強い整合性の読み取り 1 unit、削除イベントごとに書き込み 1 unit
- ログは 1 イベントにつき 0.8 KB
- 未算入: S3 から同じリージョンの Lambda へのデータ転送（料金を確認していない）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `sqs.request.standard` | 33,000 | Requests | 11,000 messages x 3 requests | 0.01 | 1,000,000 | 0 |
| `lambda.request.arm` | 11,000 | Requests | one invocation per message | 0.002200 | 1,000,000 | 0 |
| `lambda.duration.arm` | 550 | Lambda-GB-Second | 11,000 x 0.2 s x 0.25 GB, in GB-seconds | 0.01 | 400,000 | 0 |
| `s3.request.tier2` | 10,000 | Requests | one GetObject per create event | 0.003700 | - | 0.003700 |
| `dynamodb.write.on-demand` | 11,000 | WriteRequestUnits | one conditional write per event | 0.01 | - | 0.01 |
| `dynamodb.read.on-demand` | 10,000 | ReadRequestUnits | one attachment lookup per create event | 0.001425 | - | 0.001425 |
| `logs.ingest.standard` | 0.008 | GB | 11,000 x 0.8 KB, in GB | 0.01 | 5 | 0 |
| `logs.storage` | 0.002 | GB-Mo | 0.0084 GB x 7/30, in GB-month | 0.000066 | 5 | 0 |

- 定価の小計: **USD 0.04** / 月
- 毎月の無料枠適用後の小計: **USD 0.01** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.request.tier2`

## 定期的な掃除: 10,000 枚が置いてある bucket を 1 時間ごとに突き合わせる

ID: `async-housekeeping-10k` / 章: [08 リクエストの外で処理する: SQS、DLQ、冪等性、Scheduler](/ja/chapters/08-async.md)

前提:

- bucket には月を通して 10,000 枚の画像があり、すべて添付の記録がある
- 掃除は月 730 回。1 回につき、bucket の一覧を 2 回読み（1,000 件ずつ 10 ページ）、画像 1 枚につき DynamoDB を 4 回読む（07章の掃除が記録とノート、この章の処理が記録と検査の結果）。すべて強い整合性の読み取りで、1 回 1 unit
- 1 回の実行は 200 秒と仮定する（40,000 回の読み取りを 1 回 5 ミリ秒で順に実行）。256 MB、arm64。計測した値ではない
- tag を外すリクエストは請求されないものとする。削除はゼロとする
- ログは 1 回の起動につき 1 KB

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `scheduler.invocation` | 730 | Invocations | one invocation an hour | 0 | - | 0 |
| `lambda.request.arm` | 730 | Requests | one housekeeping run an hour | 0.000146 | 1,000,000 | 0 |
| `lambda.duration.arm` | 36,500 | Lambda-GB-Second | 730 x 200 s x 0.25 GB, in GB-seconds | 0.49 | 400,000 | 0 |
| `s3.request.tier1` | 14,600 | Requests | 730 runs x 2 passes x 10 LIST pages | 0.07 | - | 0.07 |
| `dynamodb.read.on-demand` | 29,200,000 | ReadRequestUnits | 730 runs x 10,000 images x 4 reads | 4.16 | - | 4.16 |
| `logs.ingest.standard` | 0.001 | GB | 730 x 1 KB, in GB | 0.000532 | 5 | 0 |
| `logs.storage` | 0 | GB-Mo | 0.0007 GB x 7/30, in GB-month | 0.000007 | 5 | 0 |

- 定価の小計: **USD 4.72** / 月
- 毎月の無料枠適用後の小計: **USD 4.23** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.request.tier1`

## EC2: private subnet で 1 か月動かしたまま

ID: `ec2-private-running` / 章: [23 制御したいときの EC2: SSM、EBS、プロセス運用](/ja/chapters/23-ec2.md)

前提:

- 既定の構成。t4g.micro を 730 時間動かしたまま
- 11章の stack に interface endpoint を 3 つ（ssm、ssmmessages、ec2messages）、2 つの AZ に置いたまま
- root volume は 8 GiB と仮定（大きさは AMI が決める。実際の値は確かめていない）。data volume は 8 GiB。どちらも gp3 で、IOPS と throughput は追加料金のない範囲
- CPU credit は standard。baseline を超える分の課金は起きない設定
- Session Manager と Run Command は、EC2 の instance に対しては追加料金なし
- データ転送、snapshot、release 用の S3 bucket（1 MB 未満の file が数個）の料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-micro.linux.hour` | 730 | Hrs | 1 t4g.micro x 730 hours | 7.88 | - | 7.88 |
| `ebs.gp3.storage` | 16 | GB-Mo | 8 GiB root (assumed) + 8 GiB data, 730 of 730 hours | 1.54 | - | 1.54 |
| `vpc.endpoint.interface.hour` | 4,380 | Hrs | 3 interface endpoints x 2 zones x 730 hours | 61.32 | - | 61.32 |

- 定価の小計: **USD 70.74** / 月
- 毎月の無料枠適用後の小計: **USD 70.74** / 月
- 無料枠を確認できず、何も引いていない単価: `ec2.t4g-micro.linux.hour`, `ebs.gp3.storage`

## EC2: private subnet で 1 か月止めたまま

ID: `ec2-private-stopped` / 章: [23 制御したいときの EC2: SSM、EBS、プロセス運用](/ja/chapters/23-ec2.md)

前提:

- instance を停止したまま 730 時間。volume と、11章の stack の interface endpoint は残っている
- root volume は 8 GiB と仮定（大きさは AMI が決める。実際の値は確かめていない）。data volume は 8 GiB。どちらも gp3 で、IOPS と throughput は追加料金のない範囲
- CPU credit は standard。baseline を超える分の課金は起きない設定
- Session Manager と Run Command は、EC2 の instance に対しては追加料金なし
- データ転送、snapshot、release 用の S3 bucket（1 MB 未満の file が数個）の料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ebs.gp3.storage` | 16 | GB-Mo | 8 GiB root (assumed) + 8 GiB data, 730 of 730 hours | 1.54 | - | 1.54 |
| `vpc.endpoint.interface.hour` | 4,380 | Hrs | 3 interface endpoints x 2 zones x 730 hours | 61.32 | - | 61.32 |

- 定価の小計: **USD 62.86** / 月
- 毎月の無料枠適用後の小計: **USD 62.86** / 月
- 無料枠を確認できず、何も引いていない単価: `ebs.gp3.storage`

## EC2: public subnet で 1 か月動かしたまま

ID: `ec2-public-running` / 章: [23 制御したいときの EC2: SSM、EBS、プロセス運用](/ja/chapters/23-ec2.md)

前提:

- `-c placement=public`。t4g.micro を 730 時間動かしたまま、自動で割り当てられた public IPv4 アドレス 1 つ
- interface endpoint なし
- root volume は 8 GiB と仮定（大きさは AMI が決める。実際の値は確かめていない）。data volume は 8 GiB。どちらも gp3 で、IOPS と throughput は追加料金のない範囲
- CPU credit は standard。baseline を超える分の課金は起きない設定
- Session Manager と Run Command は、EC2 の instance に対しては追加料金なし
- データ転送、snapshot、release 用の S3 bucket（1 MB 未満の file が数個）の料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-micro.linux.hour` | 730 | Hrs | 1 t4g.micro x 730 hours | 7.88 | - | 7.88 |
| `ebs.gp3.storage` | 16 | GB-Mo | 8 GiB root (assumed) + 8 GiB data, 730 of 730 hours | 1.54 | - | 1.54 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 public IPv4 address x 730 hours | 3.65 | - | 3.65 |

- 定価の小計: **USD 13.07** / 月
- 毎月の無料枠適用後の小計: **USD 13.07** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `ec2.t4g-micro.linux.hour`, `ebs.gp3.storage`

## EC2: public subnet で 1 か月止めたまま

ID: `ec2-public-stopped` / 章: [23 制御したいときの EC2: SSM、EBS、プロセス運用](/ja/chapters/23-ec2.md)

前提:

- `-c placement=public` の instance を停止したまま 730 時間。自動で割り当てられた public IPv4 アドレスは停止時に解放される。Elastic IP アドレスは使っていない
- root volume は 8 GiB と仮定（大きさは AMI が決める。実際の値は確かめていない）。data volume は 8 GiB。どちらも gp3 で、IOPS と throughput は追加料金のない範囲
- CPU credit は standard。baseline を超える分の課金は起きない設定
- Session Manager と Run Command は、EC2 の instance に対しては追加料金なし
- データ転送、snapshot、release 用の S3 bucket（1 MB 未満の file が数個）の料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ebs.gp3.storage` | 16 | GB-Mo | 8 GiB root (assumed) + 8 GiB data, 730 of 730 hours | 1.54 | - | 1.54 |

- 定価の小計: **USD 1.54** / 月
- 毎月の無料枠適用後の小計: **USD 1.54** / 月
- 無料枠を確認できず、何も引いていない単価: `ebs.gp3.storage`

## 長い処理: デプロイ済みで、ノートが 1 件もない月

ID: `export-idle` / 章: [16 長い処理を動かす: ECS task、Step Functions、Lambda durable functions、AWS Batch](/ja/chapters/16-long-jobs.md)

前提:

- schedule は 1 日 1 回、月 30 回 workflow を起動する。table は空
- 1 回の実行は ExportPages、MorePages、Finish、Exported を 1 回ずつ通る。開始と終了を足して state transition は 6 と数える（料金ページの例の数え方。実測ではない）
- 関数の呼び出しは 1 回の実行につき 2 回。それぞれ 0.5 秒、256 MB、arm64 と仮定
- 空の Scan は 1 回につき読み取り 1 unit と多めに数える。S3 は LIST 1 回と manifest の PUT 1 回
- ログは関数の呼び出し 1 回につき 1 KB

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `scheduler.invocation` | 30 | Invocations | one start a day | 0 | - | 0 |
| `sfn.standard.transition` | 180 | StateTransitions | 30 executions x 6 transitions | 0.004500 | 4,000 | 0 |
| `lambda.request.arm` | 60 | Requests | 30 executions x 2 invocations | 0.000012 | 1,000,000 | 0 |
| `lambda.duration.arm` | 7.5 | Lambda-GB-Second | 60 x 0.5 s x 0.25 GB, in GB-seconds | 0.000100 | 400,000 | 0 |
| `dynamodb.read.on-demand` | 30 | ReadRequestUnits | one empty Scan per run, counted as 1 unit | 0.000004 | - | 0.000004 |
| `s3.request.tier1` | 60 | Requests | 30 runs x (1 LIST + 1 manifest PUT) | 0.000282 | - | 0.000282 |
| `logs.ingest.standard` | 0 | GB | 60 x 1 KB, in GB | 0.000043 | 5 | 0 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.request.tier1`

## 長い処理: 10,000 件を毎日 export。1 回の呼び出しで全ページ（この章の既定）

ID: `export-daily-10k-coarse` / 章: [16 長い処理を動かす: ECS task、Step Functions、Lambda durable functions、AWS Batch](/ja/chapters/16-long-jobs.md)

前提:

- table に 1 KB のノートが 10,000 件（10 MB）。1 日 1 回、月 30 回 export する
- 1 ページ 100 件で、part は 1 回の export につき 100 個。1 個 120 KB、export 1 回で 12 MB と仮定
- Scan は結果整合で、4 KB あたり 0.5 unit。10 MB で 1,280 unit
- export は 7 日で消えるので、bucket に置いてあるのは常に 7 回分（84 MB）
- 関数は arm64、256 MB。ページ 1 つあたり 200 ミリ秒、Finish は 1 秒と仮定。計測した値ではない
- state transition は、料金ページの例の数え方（開始と終了も 1 つずつ）に合わせた見積もり。実測ではない
- 未算入: 再試行、redrive、S3 と DynamoDB からのデータ転送
- ExportPages は 1 回の呼び出しで 100 ページを書き終える（20 秒）。state transition は 1 回の実行で 6

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `scheduler.invocation` | 30 | Invocations | one start a day | 0 | - | 0 |
| `sfn.standard.transition` | 180 | StateTransitions | 30 executions x 6 transitions | 0.004500 | 4,000 | 0 |
| `lambda.request.arm` | 60 | Requests | 30 executions x 2 invocations | 0.000012 | 1,000,000 | 0 |
| `lambda.duration.arm` | 157.5 | Lambda-GB-Second | 30 x (20 s + 1 s) x 0.25 GB, in GB-seconds | 0.002100 | 400,000 | 0 |
| `dynamodb.read.on-demand` | 38,400 | ReadRequestUnits | 30 runs x 10,240 KB scanned / 4 KB x 0.5 (eventually consistent) | 0.01 | - | 0.01 |
| `s3.request.tier1` | 3,060 | Requests | 30 runs x (100 part PUTs + 1 manifest PUT + 1 LIST) | 0.01 | - | 0.01 |
| `s3.standard.storage` | 0.082 | GB-Mo | 7 exports of 12 MB kept at any time, in GB-month | 0.002050 | - | 0.002050 |
| `logs.ingest.standard` | 0 | GB | 60 x 1 KB, in GB | 0.000043 | 5 | 0 |

- 定価の小計: **USD 0.03** / 月
- 毎月の無料枠適用後の小計: **USD 0.02** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `s3.request.tier1`

## 長い処理: 10,000 件を毎日 export。1 ページごとに workflow に戻る

ID: `export-daily-10k-fine` / 章: [16 長い処理を動かす: ECS task、Step Functions、Lambda durable functions、AWS Batch](/ja/chapters/16-long-jobs.md)

前提:

- table に 1 KB のノートが 10,000 件（10 MB）。1 日 1 回、月 30 回 export する
- 1 ページ 100 件で、part は 1 回の export につき 100 個。1 個 120 KB、export 1 回で 12 MB と仮定
- Scan は結果整合で、4 KB あたり 0.5 unit。10 MB で 1,280 unit
- export は 7 日で消えるので、bucket に置いてあるのは常に 7 回分（84 MB）
- 関数は arm64、256 MB。ページ 1 つあたり 200 ミリ秒、Finish は 1 秒と仮定。計測した値ではない
- state transition は、料金ページの例の数え方（開始と終了も 1 つずつ）に合わせた見積もり。実測ではない
- 未算入: 再試行、redrive、S3 と DynamoDB からのデータ転送
- ExportPages は 1 ページ書くごとに戻る。1 回の実行で ExportPages と MorePages を 100 回ずつ通り、state transition は 204

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `scheduler.invocation` | 30 | Invocations | one start a day | 0 | - | 0 |
| `sfn.standard.transition` | 6,120 | StateTransitions | 30 executions x (100 x 2 + 4) transitions | 0.15 | 4,000 | 0.05 |
| `lambda.request.arm` | 3,030 | Requests | 30 executions x (100 pages + 1 finish) | 0.000606 | 1,000,000 | 0 |
| `lambda.duration.arm` | 157.5 | Lambda-GB-Second | 30 x (100 x 0.2 s + 1 s) x 0.25 GB, in GB-seconds | 0.002100 | 400,000 | 0 |
| `dynamodb.read.on-demand` | 38,400 | ReadRequestUnits | 30 runs x 10,240 KB scanned / 4 KB x 0.5 (eventually consistent) | 0.01 | - | 0.01 |
| `s3.request.tier1` | 3,060 | Requests | 30 runs x (100 part PUTs + 1 manifest PUT + 1 LIST) | 0.01 | - | 0.01 |
| `s3.standard.storage` | 0.082 | GB-Mo | 7 exports of 12 MB kept at any time, in GB-month | 0.002050 | - | 0.002050 |
| `logs.ingest.standard` | 0.003 | GB | 3,030 x 1 KB, in GB | 0.002196 | 5 | 0 |

- 定価の小計: **USD 0.18** / 月
- 毎月の無料枠適用後の小計: **USD 0.07** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `s3.request.tier1`

## 長い処理: 10,000 件を毎日 export。durable function 版（`-c durable=true`）

ID: `export-daily-10k-durable` / 章: [16 長い処理を動かす: ECS task、Step Functions、Lambda durable functions、AWS Batch](/ja/chapters/16-long-jobs.md)

前提:

- table に 1 KB のノートが 10,000 件（10 MB）。1 日 1 回、月 30 回 export する
- 1 ページ 100 件で、part は 1 回の export につき 100 個。1 個 120 KB、export 1 回で 12 MB と仮定
- Scan は結果整合で、4 KB あたり 0.5 unit。10 MB で 1,280 unit
- export は 7 日で消えるので、bucket に置いてあるのは常に 7 回分（84 MB）
- 関数は arm64、256 MB。ページ 1 つあたり 200 ミリ秒、Finish は 1 秒と仮定。計測した値ではない
- 未算入: 再試行、redrive、S3 と DynamoDB からのデータ転送
- 1 日 1 回、手で（または別の schedule で）起動するものとする。Step Functions は通らない
- step は 20 ページごとに 1 つで 5 つ、それに finish。実行の開始を足して durable operation は 1 回の実行で 7
- 待機がないので、関数の呼び出しは 1 回の実行につき 1 回（21 秒）と仮定
- checkpoint に書かれるのは進捗だけ。1 operation あたり 1 KB、保持は 1 日と仮定

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.durable.operation` | 210 | DurableOperations | 30 executions x (1 start + 5 page steps + 1 finish) | 0.002226 | - | 0.002226 |
| `lambda.durable.written` | 0 | GigaBytes | 210 operations x 1 KB, in GB | 0.000066 | - | 0.000066 |
| `lambda.durable.retained` | 0 | GigaBytesMonth | 0.0002 GB x 1/30, in GB-month | 0.000001 | - | 0.000001 |
| `lambda.request.arm` | 30 | Requests | one invocation per execution | 0.000006 | 1,000,000 | 0 |
| `lambda.duration.arm` | 157.5 | Lambda-GB-Second | 30 x 21 s x 0.25 GB, in GB-seconds | 0.002100 | 400,000 | 0 |
| `dynamodb.read.on-demand` | 38,400 | ReadRequestUnits | 30 runs x 10,240 KB scanned / 4 KB x 0.5 (eventually consistent) | 0.01 | - | 0.01 |
| `s3.request.tier1` | 3,060 | Requests | 30 runs x (100 part PUTs + 1 manifest PUT + 1 LIST) | 0.01 | - | 0.01 |
| `s3.standard.storage` | 0.082 | GB-Mo | 7 exports of 12 MB kept at any time, in GB-month | 0.002050 | - | 0.002050 |
| `logs.ingest.standard` | 0 | GB | 30 x 1 KB, in GB | 0.000022 | 5 | 0 |

- 定価の小計: **USD 0.03** / 月
- 毎月の無料枠適用後の小計: **USD 0.02** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `s3.request.tier1`, `lambda.durable.operation`, `lambda.durable.written`, `lambda.durable.retained`

## 比較: 1 時間かかる step を、1 日 1 回 Fargate の task で動かす月

ID: `export-step-fargate-1h` / 章: [16 長い処理を動かす: ECS task、Step Functions、Lambda durable functions、AWS Batch](/ja/chapters/16-long-jobs.md)

前提:

- この章の stack は作らない構成。料金の比較のためだけに計算
- 0.25 vCPU、0.5 GB、arm64 の task を 1 日 1 回、1 時間。月 30 時間
- public subnet で public IPv4 を付けて動かす（12章の構成）。task が動いている間だけ課金される
- 未算入: image の保存（ECR）、ログ、データ転送、Step Functions の state transition

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 7.5 | hours | 30 hours x 0.25 vCPU | 0.30 | - | 0.30 |
| `fargate.arm.memory.gb-hour` | 15 | hours | 30 hours x 0.5 GB | 0.07 | - | 0.07 |
| `vpc.public-ipv4.in-use.hour` | 30 | Hrs | one public IPv4 address for 30 hours | 0.15 | - | 0.15 |

- 定価の小計: **USD 0.52** / 月
- 毎月の無料枠適用後の小計: **USD 0.52** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`

## 守り: 既定の stack を置いたまま、誰も呼ばない月

ID: `sec-idle-default` / 章: [21 守り、統制する: WAF、Inspector、GuardDuty、secret、KMS、CloudTrail、Config、Organizations](/ja/chapters/21-security.md)

前提:

- `-c cmk=on` も `-c webAclArn=...` も付けていない。web ACL の stack（AihSecurityWaf）も作っていない
- リクエストゼロ。関数が動かないので、Secrets Manager の API も呼ばれない
- secret は 1 つを 730 時間。暗号化は aws/secretsmanager（月額なし）
- CloudFront の distribution、Lambda、IAM の role は、呼ばれなければ料金がかからない。log は失効して保存量ゼロ

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `secretsmanager.secret` | 1 | Secrets | 1 secret for the whole month | 0.40 | - | 0.40 |

- 定価の小計: **USD 0.40** / 月
- 毎月の無料枠適用後の小計: **USD 0.40** / 月
- 無料枠を確認できず、何も引いていない単価: `secretsmanager.secret`

## 守り: `-c cmk=on` を付けて置いたまま、誰も呼ばない月

ID: `sec-idle-cmk` / 章: [21 守り、統制する: WAF、Inspector、GuardDuty、secret、KMS、CloudTrail、Config、Organizations](/ja/chapters/21-security.md)

前提:

- 既定の stack に、customer managed key を 1 つ足したもの
- 鍵は作ってから 1 年未満で、まだ一度も自動 rotation していない。rotation のたびに、2 回目まで月 USD 1 ずつ増える
- リクエストゼロ

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `secretsmanager.secret` | 1 | Secrets | 1 secret for the whole month | 0.40 | - | 0.40 |
| `kms.key` | 1 | Keys | 1 customer managed key, one key version | 1.00 | - | 1.00 |

- 定価の小計: **USD 1.40** / 月
- 毎月の無料枠適用後の小計: **USD 1.40** / 月
- 無料枠を確認できず、何も引いていない単価: `secretsmanager.secret`, `kms.key`

## 守り: web ACL（AihSecurityWaf）を 1 か月置いて、100 万リクエストを検査

ID: `sec-waf-month` / 章: [21 守り、統制する: WAF、Inspector、GuardDuty、secret、KMS、CloudTrail、Config、Organizations](/ja/chapters/21-security.md)

前提:

- web ACL 1 つと rule 3 つ（rate-based rule 1 つ、AWS managed rule group 2 つ。managed rule group は 1 つの rule として数える）
- 合計 727 WCU で、基本料金に含まれる 1,500 WCU の内側
- 検査するリクエストは月 100 万。0 なら月 USD 8.00
- CloudFront 用の web ACL が Global-* の usage type で課金されるという対応は、請求では確かめていない。ap-northeast-1 と us-east-1 の単価も同じ値
- この小計に、既定の stack の料金は含まない。WAF のログ、Bot Control などの追加機能は使っていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `waf.global.webacl` | 1 | Month | 1 web ACL for the whole month | 5.00 | - | 5.00 |
| `waf.global.rule` | 3 | Month | 3 rules for the whole month | 3.00 | - | 3.00 |
| `waf.global.request` | 1,000,000 | Request | 1,000,000 requests inspected | 0.60 | - | 0.60 |

- 定価の小計: **USD 8.60** / 月
- 毎月の無料枠適用後の小計: **USD 8.60** / 月
- 無料枠を確認できず、何も引いていない単価: `waf.global.webacl`, `waf.global.rule`, `waf.global.request`

## 守り: 既定の stack で、token の発行と検証を月 10 万回ずつ

ID: `sec-small` / 章: [21 守り、統制する: WAF、Inspector、GuardDuty、secret、KMS、CloudTrail、Config、Organizations](/ja/chapters/21-security.md)

前提:

- CloudFront へ 20 万リクエスト（HTTPS、日本の edge）。cache しないので、すべて Lambda に届く
- 応答は 1 回あたり 0.5 KB と仮定
- Lambda は平均 50 ms、256 MB、arm64。50 ms は仮定で、計測値ではない
- 実行環境 1 つが 1 か月動き続け、5 分ごとに鍵を読み直すと仮定（730 時間 x 12 回 x GetSecretValue 2 回）。実行環境が増えれば、そのぶん増える
- 1 回の呼び出しあたり log 0.3 KB（Lambda が書く行のみ）。保持 7 日で、月平均の保存量を取込み量の 7/30 と仮定
- customer managed key、web ACL は無し。Lambda から CloudFront へのデータ転送は含めていない（未算入）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `secretsmanager.secret` | 1 | Secrets | 1 secret for the whole month | 0.40 | - | 0.40 |
| `secretsmanager.api` | 17,520 | API Requests | 730 hours x 12 reloads x 2 GetSecretValue calls | 0.09 | - | 0.09 |
| `cloudfront.jp.request.https` | 200,000 | Requests | 100,000 /token + 100,000 /verify | 0.24 | 10,000,000 | 0 |
| `cloudfront.jp.transfer` | 0.095 | GB | 200,000 x 0.5 KB, in GB | 0.01 | 1,024 | 0 |
| `lambda.request.arm` | 200,000 | Requests | every request reaches the function | 0.04 | 1,000,000 | 0 |
| `lambda.duration.arm` | 2,500 | Lambda-GB-Second | 200,000 x 0.05 s x 0.25 GB, in GB-seconds | 0.03 | 400,000 | 0 |
| `logs.ingest.standard` | 0.057 | GB | 200,000 x 0.3 KB, in GB | 0.04 | 5 | 0 |
| `logs.storage` | 0.013 | GB-Mo | 0.057220 GB x 7/30, in GB-month | 0.000441 | 5 | 0 |

- 定価の小計: **USD 0.86** / 月
- 毎月の無料枠適用後の小計: **USD 0.49** / 月
- 無料枠を確認できず、何も引いていない単価: `secretsmanager.secret`, `secretsmanager.api`

## 守り: GuardDuty、Inspector、AWS Config を小さなアカウントで 1 か月（桁をつかむための例）

ID: `sec-detect-example` / 章: [21 守り、統制する: WAF、Inspector、GuardDuty、secret、KMS、CloudTrail、Config、Organizations](/ja/chapters/21-security.md)

前提:

- 無料の試用期間が終わったあとの月
- GuardDuty が分析する CloudTrail の management event を月 10 万件と仮定。実際の件数は、アカウントで何をしているかで決まる。この数字は計測値ではない
- GuardDuty のほかの課金対象（VPC flow log と DNS log の分析量、S3、Lambda、Malware Protection などの protection plan）は含めていない。初めて有効にすると、既定ですべての protection plan が有効になる
- Inspector は Lambda standard scanning だけで、関数 1 つを 730 時間。ECR の image と EC2 instance の検査は含めていない
- AWS Config は連続記録で、月 500 件の configuration item と仮定。rule の評価と、記録を置く S3 の料金は含めていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `guardduty.cloudtrail.event` | 100,000 | Events | 100,000 management events analyzed (assumed) | 0.47 | - | 0.47 |
| `inspector.lambda.standard` | 730 | Hourly | 1 function x 730 hours | 0.36 | - | 0.36 |
| `config.item.continuous` | 500 | APN1-ConfigurationItemRecorded | 500 configuration items (assumed) | 1.50 | - | 1.50 |

- 定価の小計: **USD 2.34** / 月
- 毎月の無料枠適用後の小計: **USD 2.34** / 月
- 無料枠を確認できず、何も引いていない単価: `guardduty.cloudtrail.event`, `inspector.lambda.standard`, `config.item.continuous`

## 復旧: 戻せる状態を 1 か月保つための上乗せ（table 1 GB、画像 10 GB）

ID: `recovery-keep` / 章: [22 データとサービスを復旧する: PITR、snapshot、S3 versioning、AWS Backup](/ja/chapters/22-recovery.md)

前提:

- 既定の stack。table は 1 GB で、point-in-time recovery が有効
- 画像は 10 GB。月に 1 GB ぶんが上書きか削除をされ、その古い version が 30 日残る（1 GB を 1 か月ぶんとして計算）
- table と現行の画像そのものの保存料、リクエスト、Lambda は含めない。上乗せ分だけ

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.pitr.storage` | 1 | GB-Mo | 1 GB table under PITR, in GB-month | 0.23 | - | 0.23 |
| `s3.standard.storage` | 1 | GB-Mo | 1 GB of noncurrent versions, in GB-month | 0.03 | - | 0.03 |

- 定価の小計: **USD 0.25** / 月
- 毎月の無料枠適用後の小計: **USD 0.25** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`

## 復旧: 1 GB の table を 1 回復元して検査する drill

ID: `recovery-drill` / 章: [22 データとサービスを復旧する: PITR、snapshot、S3 versioning、AWS Backup](/ja/chapters/22-recovery.md)

前提:

- RestoreTableToPointInTime を 1 回。復元されるデータは 1 GB
- 検査（table 全体の Scan、強い整合性）を 4 回。1 GB を 4 KB の item で数えて、1 回 262,144 read request unit
- 復元した table を 1 か月置いたままにした場合の保存料（1 GB）を含む
- S3 の一覧と復元のリクエスト、Lambda、ログは含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.restore` | 1 | GB | 1 GB restored | 0.17 | - | 0.17 |
| `dynamodb.read.on-demand` | 1,048,576 | ReadRequestUnits | 4 full scans x 262,144 read request units | 0.15 | - | 0.15 |
| `dynamodb.storage` | 1 | GB-Mo | the restored table, 1 GB for a month | 0 | - | 0 |

- 定価の小計: **USD 0.32** / 月
- 毎月の無料枠適用後の小計: **USD 0.32** / 月
- 無料枠を確認できず、何も引いていない単価: `dynamodb.restore`

## 復旧: `-c backup=on` で増える分（AWS Backup、1 GB の table）

ID: `recovery-backup-optin` / 章: [22 データとサービスを復旧する: PITR、snapshot、S3 versioning、AWS Backup](/ja/chapters/22-recovery.md)

前提:

- 毎日 1 回の snapshot を 7 日保持。常に 7 つが warm storage にある
- snapshot 1 つが table 全体（1 GB）として課金されると仮定。差分で取られるかどうかは確認していない
- 復元はしていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `backup.dynamodb.warm` | 7 | GB-month | 7 snapshots x 1 GB, in GB-month | 0.80 | - | 0.80 |

- 定価の小計: **USD 0.80** / 月
- 毎月の無料枠適用後の小計: **USD 0.80** / 月
- 無料枠を確認できず、何も引いていない単価: `backup.dynamodb.warm`

## 復旧: `-c replica=on` で増える分（S3 Replication、画像 10 GB）

ID: `recovery-replica-optin` / 章: [22 データとサービスを復旧する: PITR、snapshot、S3 versioning、AWS Backup](/ja/chapters/22-recovery.md)

前提:

- 複製先に、複製を有効にした後に置かれた画像 10 GB と、古い version 1 GB がある
- 月に 10,000 個の object が複製される。複製の PUT を、通常の PUT と同じ単価（Tier 1）として計算
- 同じリージョン内の複製。データ転送料は含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3.standard.storage` | 11 | GB-Mo | the second copy: 10 GB current + 1 GB noncurrent, in GB-month | 0.28 | - | 0.28 |
| `s3.request.tier1` | 10,000 | Requests | 10,000 replication PUT requests | 0.05 | - | 0.05 |

- 定価の小計: **USD 0.32** / 月
- 毎月の無料枠適用後の小計: **USD 0.32** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `s3.request.tier1`

## celld: node 1 台を 1 か月動かしたまま

ID: `celld-one-node-running` / 章: [24 発展ラボ: celld を AWS でセルフホストする](/ja/chapters/24-celld.md)

前提:

- `-c nodes=1`。t4g.small を 730 時間動かしたまま
- 11章の stack に interface endpoint を 3 つ（ssm、ssmmessages、ec2messages）、2 つの AZ に置いたまま
- S3 の request は、celld の文書にある間隔からの見積もり（node ごとに、lease の更新が約 3.3 秒に 1 回、fleet sample の読み取りが 5 秒に 1 回、deployment pointer の読み取りが 30 秒に 1 回）。実測ではなく、cell が動いたときの request は含まない
- root volume は 8 GiB と仮定（大きさは AMI が決める。実際の値は確かめていない）。data volume は node ごとに 8 GiB。どちらも gp3 で、IOPS と throughput は追加料金のない範囲
- CPU credit は standard。baseline を超える分の課金は起きない設定
- Session Manager と Run Command は、EC2 の instance に対しては追加料金なし
- S3 の保存容量、データ転送、snapshot、backup 用 bucket の料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-small.linux.hour` | 730 | Hrs | 1 t4g.small x 730 hours | 15.77 | - | 15.77 |
| `ebs.gp3.storage` | 16 | GB-Mo | 1 x (8 GiB root, assumed + 8 GiB data), 730 of 730 hours | 1.54 | - | 1.54 |
| `s3.request.tier1` | 788,400 | Requests | 1 node(s) x one lease renewal about every 3.3 s (estimated from the documented interval) | 3.71 | - | 3.71 |
| `s3.request.tier2` | 613,200 | Requests | 1 node(s) x (fleet sample every 5 s + deployment pointer every 30 s), estimated | 0.23 | - | 0.23 |
| `vpc.endpoint.interface.hour` | 4,380 | Hrs | 3 interface endpoints x 2 zones x 730 hours | 61.32 | - | 61.32 |

- 定価の小計: **USD 82.56** / 月
- 毎月の無料枠適用後の小計: **USD 82.56** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.request.tier1`, `s3.request.tier2`, `ebs.gp3.storage`

## celld: node 3 台を 1 か月動かしたまま

ID: `celld-three-nodes-running` / 章: [24 発展ラボ: celld を AWS でセルフホストする](/ja/chapters/24-celld.md)

前提:

- `-c nodes=3`。t4g.small 3 台を 730 時間動かしたまま
- 11章の stack に interface endpoint を 3 つ（ssm、ssmmessages、ec2messages）、2 つの AZ に置いたまま
- S3 の request は、celld の文書にある間隔からの見積もり（node ごとに、lease の更新が約 3.3 秒に 1 回、fleet sample の読み取りが 5 秒に 1 回、deployment pointer の読み取りが 30 秒に 1 回）。実測ではなく、cell が動いたときの request は含まない
- root volume は 8 GiB と仮定（大きさは AMI が決める。実際の値は確かめていない）。data volume は node ごとに 8 GiB。どちらも gp3 で、IOPS と throughput は追加料金のない範囲
- CPU credit は standard。baseline を超える分の課金は起きない設定
- Session Manager と Run Command は、EC2 の instance に対しては追加料金なし
- S3 の保存容量、データ転送、snapshot、backup 用 bucket の料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-small.linux.hour` | 2,190 | Hrs | 3 t4g.small x 730 hours | 47.30 | - | 47.30 |
| `ebs.gp3.storage` | 48 | GB-Mo | 3 x (8 GiB root, assumed + 8 GiB data), 730 of 730 hours | 4.61 | - | 4.61 |
| `s3.request.tier1` | 2,365,200 | Requests | 3 node(s) x one lease renewal about every 3.3 s (estimated from the documented interval) | 11.12 | - | 11.12 |
| `s3.request.tier2` | 1,839,600 | Requests | 3 node(s) x (fleet sample every 5 s + deployment pointer every 30 s), estimated | 0.68 | - | 0.68 |
| `vpc.endpoint.interface.hour` | 4,380 | Hrs | 3 interface endpoints x 2 zones x 730 hours | 61.32 | - | 61.32 |

- 定価の小計: **USD 125.03** / 月
- 毎月の無料枠適用後の小計: **USD 125.03** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.request.tier1`, `s3.request.tier2`, `ebs.gp3.storage`

## celld: node 3 台を 1 か月止めたまま

ID: `celld-three-nodes-stopped` / 章: [24 発展ラボ: celld を AWS でセルフホストする](/ja/chapters/24-celld.md)

前提:

- `-c nodes=3` の instance を 3 台とも停止したまま 730 時間。volume と、11章の stack の interface endpoint は残っている
- root volume は 8 GiB と仮定（大きさは AMI が決める。実際の値は確かめていない）。data volume は node ごとに 8 GiB。どちらも gp3 で、IOPS と throughput は追加料金のない範囲
- CPU credit は standard。baseline を超える分の課金は起きない設定
- Session Manager と Run Command は、EC2 の instance に対しては追加料金なし
- S3 の保存容量、データ転送、snapshot、backup 用 bucket の料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ebs.gp3.storage` | 48 | GB-Mo | 3 x (8 GiB root, assumed + 8 GiB data), 730 of 730 hours | 4.61 | - | 4.61 |
| `vpc.endpoint.interface.hour` | 4,380 | Hrs | 3 interface endpoints x 2 zones x 730 hours | 61.32 | - | 61.32 |

- 定価の小計: **USD 65.93** / 月
- 毎月の無料枠適用後の小計: **USD 65.93** / 月
- 無料枠を確認できず、何も引いていない単価: `ebs.gp3.storage`

## celld: stack を消した後に残る data volume（3 台分）

ID: `celld-retained-after-destroy` / 章: [24 発展ラボ: celld を AWS でセルフホストする](/ja/chapters/24-celld.md)

前提:

- 既定の `stateOnDestroy=retain` のまま、`-c nodes=3` の stack を destroy し、11章の interface endpoint も消した後の 730 時間
- 残るのは 8 GiB の data volume 3 つ。root volume は instance と一緒に消える
- 残った 2 つの bucket の保存容量は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ebs.gp3.storage` | 24 | GB-Mo | 3 retained data volume(s) x 8 GiB, 730 of 730 hours | 2.30 | - | 2.30 |

- 定価の小計: **USD 2.30** / 月
- 毎月の無料枠適用後の小計: **USD 2.30** / 月
- 無料枠を確認できず、何も引いていない単価: `ebs.gp3.storage`

## 単価

| ID | リージョン | usageType | 単位 | 段階（開始 - 終了: USD） | 出典の公開日 | 確認日 |
| --- | --- | --- | --- | --- | --- | --- |
| `lambda.request.arm` | ap-northeast-1 | APN1-Request-ARM | Requests | 0 - ∞: 0.0000002000 | 2026-10-09 | 2026-10-11 |
| `lambda.duration.arm` | ap-northeast-1 | APN1-Lambda-GB-Second-ARM | Lambda-GB-Second | 0 - 7,500,000,000: 0.0000133334<br>7,500,000,000 - 18,750,000,000: 0.0000120001<br>18,750,000,000 - ∞: 0.0000106667 | 2026-10-09 | 2026-10-11 |
| `lambda.request.x86` | ap-northeast-1 | APN1-Request | Request | 0 - ∞: 0.0000002000 | 2026-10-09 | 2026-10-11 |
| `lambda.duration.x86` | ap-northeast-1 | APN1-Lambda-GB-Second | Lambda-GB-Second | 0 - 6,000,000,000: 0.0000166667<br>6,000,000,000 - 15,000,000,000: 0.0000150000<br>15,000,000,000 - ∞: 0.0000133334 | 2026-10-09 | 2026-10-11 |
| `apigw.http.request` | ap-northeast-1 | APN1-ApiGatewayHttpRequest | Requests | 0 - 300,000,000: 0.0000012900<br>300,000,000 - ∞: 0.0000011800 | 2026-10-02 | 2026-10-11 |
| `apigw.rest.request` | ap-northeast-1 | APN1-ApiGatewayRequest | Requests | 0 - 333,000,000: 0.0000042500<br>333,000,000 - 1,000,000,000: 0.0000035300<br>1,000,000,000 - 20,000,000,000: 0.0000030000<br>20,000,000,000 - ∞: 0.0000019100 | 2026-10-02 | 2026-10-11 |
| `s3.standard.storage` | ap-northeast-1 | APN1-TimedStorage-ByteHrs | GB-Mo | 0 - 51,200: 0.0250000000<br>51,200 - 512,000: 0.0240000000<br>512,000 - ∞: 0.0230000000 | 2026-09-28 | 2026-10-11 |
| `s3.request.tier1` | ap-northeast-1 | APN1-Requests-Tier1 | Requests | 0 - ∞: 0.0000047000 | 2026-09-28 | 2026-10-11 |
| `s3.request.tier2` | ap-northeast-1 | APN1-Requests-Tier2 | Requests | 0 - ∞: 0.0000003700 | 2026-09-28 | 2026-10-11 |
| `logs.ingest.standard` | ap-northeast-1 | APN1-DataProcessing-Bytes | GB | 0 - ∞: 0.7600000000 | 2026-10-07 | 2026-10-11 |
| `logs.storage` | ap-northeast-1 | APN1-TimedStorage-ByteHrs | GB-Mo | 0 - ∞: 0.0330000000 | 2026-10-07 | 2026-10-11 |
| `cloudfront.jp.transfer` | global | JP-DataTransfer-Out-Bytes | GB | 0 - 10,240: 0.1140000000<br>10,240 - 51,200: 0.0890000000<br>51,200 - 153,600: 0.0860000000<br>153,600 - 512,000: 0.0840000000<br>512,000 - 1,048,576: 0.0800000000<br>1,048,576 - 5,242,880: 0.0700000000<br>5,242,880 - ∞: 0.0600000000 | 2026-10-03 | 2026-10-11 |
| `cloudfront.jp.request.https` | global | JP-Requests-Tier2-HTTPS | Requests | 0 - ∞: 0.0000012000 | 2026-10-03 | 2026-10-11 |
| `cloudfront.jp.request.http` | global | JP-Requests-Tier1 | Requests | 0 - ∞: 0.0000009000 | 2026-10-03 | 2026-10-11 |
| `cloudfront.jp.request.https-proxy` | global | JP-Requests-HTTPS-Proxy | Requests | 0 - ∞: 0.0000012000 | 2026-10-03 | 2026-10-11 |
| `cloudfront.invalidation` | global | Invalidations | URL | 0 - 1,000: 0.0000000000<br>1,000 - ∞: 0.0050000000 | 2026-10-03 | 2026-10-11 |
| `cloudfront.function.execution` | global | Executions-CloudFrontFunctions | FunctionExecutions | 0 - 2,000,000: 0.0000000000<br>2,000,000 - ∞: 0.0000001000 | 2026-10-03 | 2026-10-11 |
| `dynamodb.write.on-demand` | ap-northeast-1 | APN1-WriteRequestUnits | WriteRequestUnits | 0 - ∞: 0.0000007150 | 2026-09-11 | 2026-10-11 |
| `dynamodb.read.on-demand` | ap-northeast-1 | APN1-ReadRequestUnits | ReadRequestUnits | 0 - ∞: 0.0000001425 | 2026-09-11 | 2026-10-11 |
| `dynamodb.storage` | ap-northeast-1 | APN1-TimedStorage-ByteHrs | GB-Mo | 0 - 25: 0.0000000000<br>25 - ∞: 0.2850000000 | 2026-09-11 | 2026-10-11 |
| `dynamodb.pitr.storage` | ap-northeast-1 | APN1-TimedPITRStorage-ByteHrs | GB-Mo | 0 - ∞: 0.2280000000 | 2026-09-11 | 2026-10-11 |
| `cognito.essentials.mau` | ap-northeast-1 | APN1-CognitoEssentialsMAU | CognitoUserPoolsMAU | 0 - ∞: 0.0150000000 | 2026-09-25 | 2026-10-11 |
| `ivs.input.basic` | global | AP-Input-Basic-Hours | hours | 0 - ∞: 0.2000000000 | 2026-09-11 | 2026-10-11 |
| `ivs.input.standard` | global | AP-Input-Standard-Hours | hours | 0 - ∞: 2.0000000000 | 2026-09-11 | 2026-10-11 |
| `ivs.output.sd.ap` | global | AP-Output-SD-Hours | hours | 0 - 10,000: 0.0460000000<br>10,000 - 50,000: 0.0420000000<br>50,000 - 150,000: 0.0390000000<br>150,000 - 500,000: 0.0350000000<br>500,000 - ∞: 0.0310000000 | 2026-09-11 | 2026-10-11 |
| `ivs.output.hd.ap` | global | AP-Output-HD-Hours | hours | 0 - 10,000: 0.0920000000<br>10,000 - 50,000: 0.0840000000<br>50,000 - 150,000: 0.0780000000<br>150,000 - 500,000: 0.0700000000<br>500,000 - ∞: 0.0620000000 | 2026-09-11 | 2026-10-11 |
| `ivs.output.fullhd.ap` | global | AP-Output-FullHD-Hours | hours | 0 - 10,000: 0.1840000000<br>10,000 - 50,000: 0.1680000000<br>50,000 - 150,000: 0.1560000000<br>150,000 - 500,000: 0.1400000000<br>500,000 - ∞: 0.1240000000 | 2026-09-11 | 2026-10-11 |
| `nat.gateway.hour` | ap-northeast-1 | APN1-NatGateway-Hours | Hrs | 0 - ∞: 0.0620000000 | 2026-10-09 | 2026-10-11 |
| `nat.gateway.data` | ap-northeast-1 | APN1-NatGateway-Bytes | GB | 0 - ∞: 0.0620000000 | 2026-10-09 | 2026-10-11 |
| `vpc.endpoint.interface.hour` | ap-northeast-1 | APN1-VpcEndpoint-Hours | Hrs | 0 - ∞: 0.0140000000 | 2026-09-17 | 2026-10-11 |
| `vpc.endpoint.interface.data` | ap-northeast-1 | APN1-VpcEndpoint-Bytes | GB | 0 - 1,048,576: 0.0100000000<br>1,048,576 - 5,242,880: 0.0060000000<br>5,242,880 - ∞: 0.0040000000 | 2026-09-17 | 2026-10-11 |
| `vpc.public-ipv4.in-use.hour` | ap-northeast-1 | APN1-PublicIPv4:InUseAddress | Hrs | 0 - ∞: 0.0050000000 | 2026-09-17 | 2026-10-11 |
| `bedrock.nova-2-lite.input` | ap-northeast-1 | APN1-Nova2.0Lite-input-tokens | 1K tokens | 0 - ∞: 0.0003960000 | 2026-10-10 | 2026-10-11 |
| `bedrock.nova-2-lite.output` | ap-northeast-1 | APN1-Nova2.0Lite-output-tokens | 1K tokens | 0 - ∞: 0.0033110000 | 2026-10-10 | 2026-10-11 |
| `bedrock.claude-haiku-4-5.input` | ap-northeast-1 | APN1-MP:APN1_InputTokenCount-Units | 1M tokens | 0 - ∞: 1.1000000000 | 2026-10-08 | 2026-10-11 |
| `bedrock.claude-haiku-4-5.output` | ap-northeast-1 | APN1-MP:APN1_OutputTokenCount-Units | 1M tokens | 0 - ∞: 5.5000000000 | 2026-10-08 | 2026-10-11 |
| `ses.outbound.message` | ap-northeast-1 | APN1-Recipients | Count | 0 - ∞: 0.0001000000 | 2026-09-11 | 2026-10-11 |
| `sns.request` | ap-northeast-1 | APN1-Requests-Tier1 | Requests | 0 - 1,000,000: 0.0000000000<br>1,000,000 - ∞: 0.0000005000 | 2026-09-15 | 2026-10-11 |
| `sns.delivery.lambda` | ap-northeast-1 | APN1-DeliveryAttempts-LAMBDA | Notifications | 0 - ∞: 0.0000000000 | 2026-09-15 | 2026-10-11 |
| `cloudfront.kvs.read` | global | KeyValueStore-EdgeReads | EdgeReads | 0 - 2,000,000: 0.0000000000<br>2,000,000 - ∞: 0.0000000300 | 2026-10-03 | 2026-10-11 |
| `cloudfront.kvs.api` | global | KeyValueStore-APIOperations | API Requests | 0 - ∞: 0.0010000000 | 2026-10-03 | 2026-10-11 |
| `lambdaedge.jp.request` | global | APN1-Lambda-Edge-Request | Request | 0 - ∞: 0.0000006000 | 2026-10-03 | 2026-10-11 |
| `lambdaedge.jp.duration` | global | APN1-Lambda-Edge-GB-Second | Lambda-GB-Second | 0 - ∞: 0.0000500100 | 2026-10-03 | 2026-10-11 |
| `dsql.dpu` | ap-northeast-1 | APN1-DSQL-DistributedProcessingUnits | DPU | 0 - ∞: 0.0000100000 | 2026-09-11 | 2026-10-11 |
| `dsql.storage` | ap-northeast-1 | APN1-DSQL-Storage-ByteHrs | GB-Month | 0 - ∞: 0.4000000000 | 2026-09-11 | 2026-10-11 |
| `rds.postgres.t4g-micro.single-az` | ap-northeast-1 | APN1-InstanceUsage:db.t4g.micro | Hrs | 0 - ∞: 0.0250000000 | 2026-10-06 | 2026-10-11 |
| `rds.postgres.gp3.storage` | ap-northeast-1 | APN1-RDS:GP3-Storage | GB-Mo | 0 - ∞: 0.1380000000 | 2026-10-06 | 2026-10-11 |
| `aurora.postgres.serverless-v2.acu` | ap-northeast-1 | APN1-Aurora:ServerlessV2Usage | ACU-Hr | 0 - ∞: 0.1500000000 | 2026-10-06 | 2026-10-11 |
| `aurora.postgres.storage` | ap-northeast-1 | APN1-Aurora:StorageUsage | GB-Mo | 0 - ∞: 0.1200000000 | 2026-10-06 | 2026-10-11 |
| `datatransfer.out.internet` | ap-northeast-1 | APN1-DataTransfer-Out-Bytes | GB | 0 - 10,240: 0.1140000000<br>10,240 - 51,200: 0.0890000000<br>51,200 - 153,600: 0.0860000000<br>153,600 - ∞: 0.0840000000 | 2026-09-16 | 2026-10-11 |
| `lambda.streaming.arm` | ap-northeast-1 | APN1-Lambda-Streaming-Response-Processed-Bytes-ARM | Processed-Gigabytes | 0 - ∞: 0.0080000000 | 2026-10-09 | 2026-10-11 |
| `cloudwatch.metric.custom` | ap-northeast-1 | APN1-CW:MetricMonitorUsage | Metrics | 0 - 10,000: 0.3000000000<br>10,000 - 250,000: 0.1000000000<br>250,000 - 1,000,000: 0.0500000000<br>1,000,000 - ∞: 0.0200000000 | 2026-10-07 | 2026-10-12 |
| `cloudwatch.alarm.standard` | ap-northeast-1 | APN1-CW:AlarmMonitorUsage | Alarms | 0 - ∞: 0.1000000000 | 2026-10-07 | 2026-10-12 |
| `logs.insights.scanned` | ap-northeast-1 | APN1-DataScanned-Bytes | GB | 0 - ∞: 0.0076000000 | 2026-10-07 | 2026-10-12 |
| `xray.trace.recorded` | ap-northeast-1 | APN1-XRay-TracesStored | traces | 0 - ∞: 0.0000050000 | 2026-09-11 | 2026-10-12 |
| `xray.trace.retrieved` | ap-northeast-1 | APN1-XRay-TracesAccessed | traces | 0 - ∞: 0.0000005000 | 2026-09-11 | 2026-10-12 |
| `cloudwatch.rum.event` | ap-northeast-1 | APN1-CW:RUM-events | Events | 0 - ∞: 0.0000100000 | 2026-10-07 | 2026-10-12 |
| `cloudwatch.synthetics.run` | ap-northeast-1 | APN1-CW:Canary-runs | Runs | 0 - ∞: 0.0019000000 | 2026-10-07 | 2026-10-12 |
| `elasticache.serverless.valkey.storage` | ap-northeast-1 | APN1-CachedData:Valkey | GB-Hours | 0 - ∞: 0.1010000000 | 2026-09-14 | 2026-10-12 |
| `elasticache.serverless.valkey.ecpu` | ap-northeast-1 | APN1-ElastiCacheProcessingUnits:Valkey | ElastiCacheProcessingUnit | 0 - ∞: 0.0000000027 | 2026-09-14 | 2026-10-12 |
| `elasticache.node.valkey.t4g-micro` | ap-northeast-1 | APN1-NodeUsage:cache.t4g.micro | Hrs | 0 - ∞: 0.0200000000 | 2026-09-14 | 2026-10-12 |
| `fargate.arm.vcpu.hour` | ap-northeast-1 | APN1-Fargate-ARM-vCPU-Hours:perCPU | hours | 0 - ∞: 0.0404500000 | 2026-09-11 | 2026-10-12 |
| `fargate.arm.memory.gb-hour` | ap-northeast-1 | APN1-Fargate-ARM-GB-Hours | hours | 0 - ∞: 0.0044200000 | 2026-09-11 | 2026-10-12 |
| `fargate.x86.vcpu.hour` | ap-northeast-1 | APN1-Fargate-vCPU-Hours:perCPU | hours | 0 - ∞: 0.0505600000 | 2026-09-11 | 2026-10-12 |
| `fargate.x86.memory.gb-hour` | ap-northeast-1 | APN1-Fargate-GB-Hours | hours | 0 - ∞: 0.0055300000 | 2026-09-11 | 2026-10-12 |
| `alb.hour` | ap-northeast-1 | APN1-LoadBalancerUsage | Hrs | 0 - ∞: 0.0243000000 | 2026-09-11 | 2026-10-12 |
| `alb.lcu.hour` | ap-northeast-1 | APN1-LCUUsage | LCU-Hrs | 0 - ∞: 0.0080000000 | 2026-09-11 | 2026-10-12 |
| `ecr.storage` | ap-northeast-1 | APN1-TimedStorage-ByteHrs | GB-Mo | 0 - ∞: 0.1000000000 | 2026-09-11 | 2026-10-12 |
| `sqs.request.standard` | ap-northeast-1 | APN1-Requests-Tier1 | Requests | 0 - 100,000,000,000: 0.0000004000<br>100,000,000,000 - 200,000,000,000: 0.0000003500<br>200,000,000,000 - ∞: 0.0000003200 | 2026-09-11 | 2026-10-12 |
| `scheduler.invocation` | ap-northeast-1 | APN1-ScheduledInvocation | Invocations | 0 - 14,000,000: 0.0000000000<br>14,000,000 - ∞: 0.0000012500 | 2026-09-24 | 2026-10-12 |
| `ec2.t4g-micro.linux.hour` | ap-northeast-1 | APN1-BoxUsage:t4g.micro | Hrs | 0 - ∞: 0.0108000000 | 2026-10-09 | 2026-10-12 |
| `ec2.t4g-small.linux.hour` | ap-northeast-1 | APN1-BoxUsage:t4g.small | Hrs | 0 - ∞: 0.0216000000 | 2026-10-09 | 2026-10-12 |
| `ec2.t4g.cpu-credit` | ap-northeast-1 | APN1-CPUCredits:t4g | vCPU-Hours | 0 - ∞: 0.0400000000 | 2026-10-09 | 2026-10-12 |
| `ebs.gp3.storage` | ap-northeast-1 | APN1-EBS:VolumeUsage.gp3 | GB-Mo | 0 - ∞: 0.0960000000 | 2026-10-09 | 2026-10-12 |
| `ebs.snapshot.storage` | ap-northeast-1 | APN1-EBS:SnapshotUsage | GB-Mo | 0 - ∞: 0.0500000000 | 2026-10-09 | 2026-10-12 |
| `sfn.standard.transition` | ap-northeast-1 | APN1-StateTransition | StateTransitions | 0 - ∞: 0.0000250000 | 2026-09-11 | 2026-10-12 |
| `lambda.durable.operation` | ap-northeast-1 | APN1-Lambda-Durable-Execution-Operations | DurableOperations | 0 - ∞: 0.0000106000 | 2026-10-09 | 2026-10-12 |
| `lambda.durable.written` | ap-northeast-1 | APN1-Lambda-Durable-Execution-Written-Bytes | GigaBytes | 0 - ∞: 0.3300000000 | 2026-10-09 | 2026-10-12 |
| `lambda.durable.retained` | ap-northeast-1 | APN1-Lambda-Durable-Execution-TimedStorage-ByteHrs | GigaBytesMonth | 0 - ∞: 0.2000000000 | 2026-10-09 | 2026-10-12 |
| `secretsmanager.secret` | ap-northeast-1 | APN1-AWSSecretsManager-Secrets | Secrets | 0 - ∞: 0.4000000000 | 2026-09-11 | 2026-10-12 |
| `secretsmanager.api` | ap-northeast-1 | APN1-AWSSecretsManagerAPIRequest | API Requests | 0 - ∞: 0.0000050000 | 2026-09-11 | 2026-10-12 |
| `kms.key` | ap-northeast-1 | ap-northeast-1-KMS-Keys | Keys | 0 - ∞: 1.0000000000 | 2026-09-11 | 2026-10-12 |
| `kms.request` | ap-northeast-1 | ap-northeast-1-KMS-Requests | Requests | 0 - ∞: 0.0000030000 | 2026-09-11 | 2026-10-12 |
| `waf.global.webacl` | global | Global-WebACLV2 | Month | 0 - ∞: 5.0000000000 | 2026-09-14 | 2026-10-12 |
| `waf.global.rule` | global | Global-RuleV2 | Month | 0 - ∞: 1.0000000000 | 2026-09-14 | 2026-10-12 |
| `waf.global.request` | global | Global-RequestV2-Tier1 | Request | 0 - ∞: 0.0000006000 | 2026-09-14 | 2026-10-12 |
| `guardduty.cloudtrail.event` | ap-northeast-1 | APN1-PaidEventsAnalyzed | Events | 0 - ∞: 0.0000047200 | 2026-10-08 | 2026-10-12 |
| `inspector.lambda.standard` | ap-northeast-1 | APN1-Lambda-Standard-Scanning | Hourly | 0 - ∞: 0.0005000000 | 2026-09-11 | 2026-10-12 |
| `config.item.continuous` | ap-northeast-1 | APN1-ConfigurationItemRecorded | APN1-ConfigurationItemRecorded | 0 - ∞: 0.0030000000 | 2026-09-11 | 2026-10-12 |
| `dynamodb.restore` | ap-northeast-1 | APN1-RestoreDataSize-Bytes | GB | 0 - ∞: 0.1710000000 | 2026-09-11 | 2026-10-12 |
| `backup.dynamodb.warm` | ap-northeast-1 | APN1-WarmStorage-ByteHrs-DynamoDB | GB-month | 0 - ∞: 0.1140000000 | 2026-09-28 | 2026-10-12 |

出典はいずれも AWS Price List bulk API（`sourceUrl` は `data/pricing/unit-prices.json` に記録）。CloudFront の単価は日本の edge のものです。

## 毎月の無料枠

| 単価 ID | 数量 | 出典 | 注記 |
| --- | ---: | --- | --- |
| `lambda.request.arm` | 1,000,000 | `lambda-pricing` | Shared across architectures. The pricing page does not say whether it expires. |
| `lambda.duration.arm` | 400,000 | `lambda-pricing` | GB-seconds. Shared across architectures. |
| `cloudfront.jp.transfer` | 1,024 | `cloudfront-pricing-payg` | 1 TB of data transfer out, all edge regions combined, pay-as-you-go only. |
| `cloudfront.jp.request.https` | 10,000,000 | `cloudfront-pricing-payg` | HTTP and HTTPS requests combined, all edge regions combined. |
| `cloudfront.function.execution` | 2,000,000 | `cloudfront-pricing-payg` | Already a USD 0 tier in the price list; listed so the worksheet shows it. |
| `cloudfront.invalidation` | 1,000 | `cloudfront-pricing-payg` | Already a USD 0 tier in the price list. |
| `logs.ingest.standard` | 5 | `aws-price-list-cloudwatch` | GB. From the Global-DataProcessing-Bytes USD 0 tier. |
| `logs.storage` | 5 | `aws-price-list-cloudwatch` | GB-month. From the Global-TimedStorage-ByteHrs USD 0 tier. |
| `cognito.essentials.mau` | 10,000 | `cognito-pricing` | MAUs per account or organization, shared with the Lite plan. Direct sign-in users only. |
| `cloudfront.kvs.read` | 2,000,000 | `cloudfront-pricing-payg` | Already a USD 0 tier in the price list; listed so the worksheet shows it. Pay-as-you-go only. |
| `dsql.dpu` | 100,000 | `dsql-pricing` | First 100,000 DPUs each month. The pricing page does not say whether it expires. |
| `dsql.storage` | 1 | `dsql-pricing` | First GB of storage each month. The pricing page does not say whether it expires. |
| `lambda.streaming.arm` | 100 | `lambda-pricing` | GB streamed beyond the first 6 MB of each request. From the pricing page and the Global-Lambda-Streaming-Response-Processed-Bytes USD 0 tier (0 to 100). |
| `cloudwatch.metric.custom` | 10 | `aws-price-list-cloudwatch-observability` | Metrics. From the Global-CW:MetricMonitorUsage USD 0 tier; the pricing page lists 10 custom and detailed monitoring metrics. |
| `cloudwatch.alarm.standard` | 10 | `aws-price-list-cloudwatch-observability` | Alarm metrics. From the Global-CW:AlarmMonitorUsage USD 0 tier; standard-resolution alarms that list metrics directly. |
| `logs.insights.scanned` | 5 | `aws-price-list-cloudwatch-observability` | GB. From the Global-DataScanned-Bytes USD 0 tier. |
| `cloudwatch.synthetics.run` | 100 | `aws-price-list-cloudwatch-observability` | Runs. From the Global-CW:Canary-runs USD 0 tier. |
| `xray.trace.recorded` | 100,000 | `aws-price-list-xray` | Traces. From the Global-XRay-TracesStored USD 0 tier. |
| `xray.trace.retrieved` | 1,000,000 | `aws-price-list-xray` | Traces. From the Global-XRay-TracesAccessed USD 0 tier, shared by retrieved and scanned traces. |
| `sqs.request.standard` | 1,000,000 | `sqs-pricing` | 1 million requests a month for all customers, counted across all Regions and shared by every queue in the account. |
| `sfn.standard.transition` | 4,000 | `sfn-pricing` | 4,000 state transitions a month. The pricing page says it does not expire and applies to existing and new customers; the Price List has a matching USD 0 tier (Global-StateTransition, 0 to 4,000). |
| `kms.request` | 20,000 | `kms-pricing` | Calculated across all Regions. Requests on asymmetric keys and GenerateDataKeyPair are excluded. |

確認できなかった無料枠（0 としてではなく「不明」として扱い、何も引かない）:

- `apigw.http.request`: A free allowance for HTTP API requests was not confirmed from a primary source for accounts on the current Free Tier model, so none is applied.
- `s3.standard.storage`: No always-free S3 allowance was confirmed; none is applied.
- `ivs.input.basic`: The pricing page gives new customers 5 hours of basic input a month for their first 12 months. It is not an always-free allowance and does not apply to every account, so nothing is deducted.
- `ivs.output.sd.ap`: The pricing page gives new customers 100 hours of SD or audio-only output a month for their first 12 months. Not always-free, so nothing is deducted.
- `vpc.public-ipv4.in-use.hour`: The VPC user guide gives Free Tier customers 750 hours of public IPv4 usage with the EC2 service. Whether a NAT gateway's Elastic IP address counts, and for how long the allowance lasts, was not confirmed; nothing is deducted.
- `bedrock.nova-2-lite.input`: No always-free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source; none is applied.
- `bedrock.nova-2-lite.output`: No always-free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source; none is applied.
- `bedrock.claude-haiku-4-5.input`: No always-free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source; none is applied.
- `bedrock.claude-haiku-4-5.output`: No always-free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source; none is applied.
- `ses.outbound.message`: The SES pricing page describes Free Tier credits for new customers, whose terms depend on the account, and no monthly count of free messages. None is applied.
- `cloudfront.kvs.api`: The pay-as-you-go pricing page lists no free allowance for KeyValueStore API operations; none is applied.
- `rds.postgres.t4g-micro.single-az`: The RDS free tier terms were not checked while writing chapter 13.
- `rds.postgres.gp3.storage`: The RDS free tier terms were not checked while writing chapter 13.
- `datatransfer.out.internet`: The price list calls the first tier "beyond the global free tier". The size of that free tier, and whether it applies to every account, was not confirmed from a primary source, so none is applied.
- `s3.request.tier1`: No always-free S3 request allowance was confirmed; none is applied.
- `s3.request.tier2`: No always-free S3 request allowance was confirmed; none is applied.
- `cloudwatch.rum.event`: The pricing page describes a one-time free trial of 1 million web RUM events per account, not a monthly allowance. None is applied.
- `fargate.arm.vcpu.hour`: The Fargate pricing page lists no free allowance; none is applied.
- `fargate.arm.memory.gb-hour`: The Fargate pricing page lists no free allowance; none is applied.
- `alb.hour`: The pricing page gives new AWS customers 750 load balancer hours a month. It is not an always-free allowance and does not apply to every account, so nothing is deducted.
- `alb.lcu.hour`: The pricing page gives new AWS customers 15 LCUs. It is not an always-free allowance, so nothing is deducted.
- `ecr.storage`: The pricing page gives new ECR customers 500 MB a month of private storage for one year. Not always-free, so nothing is deducted.
- `ec2.t4g-micro.linux.hour`: The EC2 user guide mentions Free Tier use of t4g.micro and t4g.small for accounts on the credit-based Free Tier. Which accounts qualify, and for how long, was not confirmed; nothing is deducted.
- `ebs.gp3.storage`: The EBS pricing page mentions 30 GB of storage under the AWS Free Tier and, for accounts created from July 15, 2025, Free Tier credits instead. Which applies to a given account was not confirmed; nothing is deducted.
- `lambda.durable.operation`: The Lambda pricing page names no free allowance for durable execution; none is applied.
- `lambda.durable.written`: The Lambda pricing page names no free allowance for durable execution; none is applied.
- `lambda.durable.retained`: The Lambda pricing page names no free allowance for durable execution; none is applied.
- `secretsmanager.secret`: No monthly free allowance for secrets was found on the pricing page or in the price list; none is applied.
- `secretsmanager.api`: No monthly free allowance for Secrets Manager API requests was found on the pricing page or in the price list; none is applied.
- `kms.key`: The KMS free tier covers requests, not keys; none is applied.
- `waf.global.webacl`: No free allowance for web ACLs was confirmed for the pay-as-you-go model. CloudFront's flat-rate pricing plans were not examined in this chapter.
- `waf.global.rule`: No free allowance for rules was confirmed for the pay-as-you-go model; none is applied.
- `waf.global.request`: No free allowance for inspected requests was confirmed for the pay-as-you-go model; none is applied.
- `guardduty.cloudtrail.event`: GuardDuty has a 30-day free trial per account, not a monthly allowance; none is applied.
- `inspector.lambda.standard`: Inspector has a 15-day free trial for new accounts, not a monthly allowance; none is applied.
- `config.item.continuous`: No free allowance for configuration items was found on the pricing page; none is applied.
- `dynamodb.restore`: No free allowance for restores was looked for or confirmed; none is applied.
- `backup.dynamodb.warm`: No free allowance for AWS Backup storage was looked for or confirmed; none is applied.
