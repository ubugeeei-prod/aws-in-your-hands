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
