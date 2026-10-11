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
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`

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
