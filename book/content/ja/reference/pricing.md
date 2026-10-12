---
title: "料金の計算"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/pricing/*.json (tools/src/book/generate.ts) -->

# 料金の計算

この本の料金の数値は、すべてここにある入力と単価から `tools/src/pricing/calc.ts` が計算したものです。通貨は USD、1 か月は 730 時間、プランは従量課金（on-demand / pay-as-you-go）、税は含みません。使用量は説明のための仮定であり、あなたのアプリの見積もりではありません。

「定価」は無料枠・credits・割引を一切引かない金額です。「毎月の無料枠適用後」は、一次情報で確認できた always-free 枠だけを数量から引いた金額で、同じアカウントの他の利用がその枠を使っていない場合に限ります。credits は反映していません。

## 本のサイト: 公開済みで誰も読まない月

ID: `book-site-idle` / 章: [03 Static Hosting: private S3 origin と CloudFront](/ja/chapters/03-spa.md)

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

ID: `book-site-small` / 章: [03 Static Hosting: private S3 origin と CloudFront](/ja/chapters/03-spa.md)

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

ID: `http-api-idle` / 章: [04 HTTP API: Lambda と API Gateway HTTP API](/ja/chapters/04-http-api.md)

前提:

- リクエストゼロ
- log は 1 週間で失効し、保存量ゼロ

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## HTTP API: 月 100 万リクエスト

ID: `http-api-small` / 章: [04 HTTP API: Lambda と API Gateway HTTP API](/ja/chapters/04-http-api.md)

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

ID: `notes-idle` / 章: [05 KV Store: DynamoDB](/ja/chapters/05-dynamodb.md)

前提:

- リクエストゼロ
- table に 10 MB のノート。point-in-time recovery は無効

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.storage` | 0.01 | GB-Mo | 10 MB stored, in GB-month | 0 | - | 0 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## ノート API と table: 月 100 万リクエスト

ID: `notes-small` / 章: [05 KV Store: DynamoDB](/ja/chapters/05-dynamodb.md)

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

ID: `notes-app-small` / 章: [06 Auth: Cognito と認可](/ja/chapters/06-auth.md)

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

ID: `live-monthly-100` / 章: [18 Live Streaming: IVS](/ja/chapters/18-live.md)

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

ID: `live-monthly-1000` / 章: [18 Live Streaming: IVS](/ja/chapters/18-live.md)

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

ID: `live-left-on-weekend` / 章: [18 Live Streaming: IVS](/ja/chapters/18-live.md)

前提:

- 視聴者は 0 人。1 本の stream の上限である 48 時間、配信ソフトが送り続けた

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.basic` | 48 | hours | 48 hours of input | 9.60 | - | 9.60 |

- 定価の小計: **USD 9.60** / 月
- 毎月の無料枠適用後の小計: **USD 9.60** / 月
- 無料枠を確認できず、何も引いていない単価: `ivs.input.basic`

## 止め忘れ: BASIC の channel に 1 か月送り続けた

ID: `live-left-on-month-basic` / 章: [18 Live Streaming: IVS](/ja/chapters/18-live.md)

前提:

- 視聴者は 0 人。配信ソフトが再接続を繰り返し、730 時間ずっと送り続けた

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.basic` | 730 | hours | 730 hours of input | 146.00 | - | 146.00 |

- 定価の小計: **USD 146.00** / 月
- 毎月の無料枠適用後の小計: **USD 146.00** / 月
- 無料枠を確認できず、何も引いていない単価: `ivs.input.basic`

## 止め忘れ: STANDARD の channel に 1 か月送り続けた

ID: `live-left-on-month-standard` / 章: [18 Live Streaming: IVS](/ja/chapters/18-live.md)

前提:

- 視聴者は 0 人。channel の type が既定の STANDARD だった場合

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.standard` | 730 | hours | 730 hours of input | 1460.00 | - | 1460.00 |

- 定価の小計: **USD 1460.00** / 月
- 毎月の無料枠適用後の小計: **USD 1460.00** / 月

## ネットワーク: NAT Gateway を 1 つ足す

ID: `network-nat-single` / 章: [11 Network: VPC、subnet、NAT、endpoint](/ja/chapters/11-network.md)

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

ID: `network-nat-per-az` / 章: [11 Network: VPC、subnet、NAT、endpoint](/ja/chapters/11-network.md)

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

ID: `network-interface-endpoints` / 章: [11 Network: VPC、subnet、NAT、endpoint](/ja/chapters/11-network.md)

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

## 通知メール: デプロイ済みで 1 通も送らない月

ID: `email-idle` / 章: [15 Email: SES](/ja/chapters/15-email.md)

前提:

- 送信ゼロ、イベントゼロ
- table に 10 MB の記録（送信停止の一覧と、期限前の通知の記録）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.storage` | 0.01 | GB-Mo | 10 MB stored, in GB-month | 0 | - | 0 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## 通知メール: 月 1 万通

ID: `email-small` / 章: [15 Email: SES](/ja/chapters/15-email.md)

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

ID: `edge-small` / 章: [10 Edge: CloudFront Functions、KeyValueStore、Lambda@Edge](/ja/chapters/10-edge.md)

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

## 画像の添付: 月 10,000 枚のアップロード、100,000 回の表示

ID: `uploads-small` / 章: [07 File Upload: presigned URL と S3](/ja/chapters/07-uploads.md)

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

## KV と cache: 既定の stack（DynamoDB）を置いたまま、呼ばれない月

ID: `kv-idle-dynamodb` / 章: [14 Cache: key-value、DynamoDB、ElastiCache/Valkey、edge 設定](/ja/chapters/14-kv-cache.md)

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

ID: `kv-idle-valkey-serverless` / 章: [14 Cache: key-value、DynamoDB、ElastiCache/Valkey、edge 設定](/ja/chapters/14-kv-cache.md)

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

ID: `kv-idle-valkey-node` / 章: [14 Cache: key-value、DynamoDB、ElastiCache/Valkey、edge 設定](/ja/chapters/14-kv-cache.md)

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

ID: `kv-used-dynamodb` / 章: [14 Cache: key-value、DynamoDB、ElastiCache/Valkey、edge 設定](/ja/chapters/14-kv-cache.md)

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

ID: `kv-used-valkey` / 章: [14 Cache: key-value、DynamoDB、ElastiCache/Valkey、edge 設定](/ja/chapters/14-kv-cache.md)

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

## celld: node 1 台を 1 か月動かしたまま

ID: `celld-one-node-running` / 章: [24 Self-hosting: celld を AWS で動かす](/ja/chapters/24-celld.md)

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

ID: `celld-three-nodes-running` / 章: [24 Self-hosting: celld を AWS で動かす](/ja/chapters/24-celld.md)

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

ID: `celld-three-nodes-stopped` / 章: [24 Self-hosting: celld を AWS で動かす](/ja/chapters/24-celld.md)

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

ID: `celld-retained-after-destroy` / 章: [24 Self-hosting: celld を AWS で動かす](/ja/chapters/24-celld.md)

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

## イベントの配線: デプロイ済みで、ノートが 1 件も変わらない月

ID: `events-idle` / 章: [25 Events: EventBridge、SNS、Pipes、archive と replay](/ja/chapters/25-events.md)

前提:

- 08章のスタックの料金に上乗せされる分だけを数える
- pipe は stream の shard を 1 秒に 4 回読みにいく（公式ドキュメントの「基本の頻度」）。shard は 1 つ、頻度は 1 か月変わらないと仮定する。4 × 3,600 × 730 = 10,512,000 回
- この読み取りが DynamoDB Streams の read request unit として請求されると仮定する。料金ページが無料としているのは Lambda のトリガーと global tables からの GetRecords だけで、Pipes は挙がっていない。請求書では確かめていない
- イベントが無いので、Pipes のリクエスト、custom event、archive、関数の実行、SNS はすべて 0
- 未算入: Lambda が counter の空の queue を long polling するときの SQS のリクエスト（頻度が公式ドキュメントに無い。08章と同じ）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.streams.read` | 10,512,000 | Requests | 4 polls a second x 3,600 s x 730 h, one shard | 1.83 | - | 1.83 |

- 定価の小計: **USD 1.83** / 月
- 毎月の無料枠適用後の小計: **USD 1.83** / 月

## イベントの配線: 月 10,000 件のノートの変更と 10,000 件の検査

ID: `events-small` / 章: [25 Events: EventBridge、SNS、Pipes、archive と replay](/ja/chapters/25-events.md)

前提:

- ノートの変更は 10,000 件（作成 6,000、更新 3,000、削除 1,000）、検査の記録は 10,000 件でうち 100 件が rejected。重複と再試行はゼロとする
- stream の読み取りは、使っていない月と同じ 10,512,000 回と仮定する
- pipe を通るのは 20,000 件。batch は 1 件ずつ、どれも 64 KB 未満なので、Pipes のリクエストは 20,000。shape の関数は 20,000 回、custom event は 20,000 件
- archive は 1 件 0.5 KB として 20,000 件で 0.01 GB を取り込み、7 日ぶん（月の 7/30）を置いておく
- timeline は 10,000 回起動して 1 回ずつ書く。counter は 7,000 件を queue 経由で受け取り（SQS のリクエストは 1 件 3 回）、1 件につきトランザクションで 2 つの書き込み（トランザクションの書き込みは 1 KB あたり 2 unit なので 4 unit）
- 関数はどれも 1 回 100 ミリ秒、256 MB、arm64 と仮定する。counter は 1 メッセージにつき 1 回起動するものとする
- rejected の 100 件は SNS に 100 回 publish され、inbox の queue に 100 回届く（SQS の SendMessage 100 回）
- ログは 1 回の起動につき 0.5 KB
- 未算入: counter の queue の空振りの ReceiveMessage、projections のテーブルの保存料金（数 MB）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.streams.read` | 10,512,000 | Requests | 4 polls a second x 3,600 s x 730 h, one shard | 1.83 | - | 1.83 |
| `events.pipe-request` | 20,000 | 64K-Chunks | one request per record that passed the filter | 0.01 | - | 0.01 |
| `events.custom-event` | 20,000 | 64K-Chunks | one event per record | 0.02 | - | 0.02 |
| `events.archive.processing` | 0.01 | GigaBytes | 20,000 events x 0.5 KB | 0.001300 | - | 0.001300 |
| `events.archive.storage` | 0.002 | GB-Mo | 0.01 GB x 7/30 of a month | 0.000058 | - | 0.000058 |
| `lambda.request.arm` | 37,000 | Requests | shape 20,000 + timeline 10,000 + counter 7,000 | 0.01 | 1,000,000 | 0 |
| `lambda.duration.arm` | 925 | Lambda-GB-Second | 37,000 x 0.1 s x 0.25 GB, in GB-seconds | 0.01 | 400,000 | 0 |
| `dynamodb.write.on-demand` | 38,000 | WriteRequestUnits | timeline 10,000 x 1 + counter 7,000 x 4 | 0.03 | - | 0.03 |
| `sqs.request.standard` | 21,100 | Requests | counter 7,000 x 3 + 100 deliveries to the inbox | 0.01 | 1,000,000 | 0 |
| `sns.request` | 100 | Requests | one publish per rejection | 0 | - | 0 |
| `logs.ingest.standard` | 0.019 | GB | 37,000 runs x 0.5 KB | 0.01 | 5 | 0 |

- 定価の小計: **USD 1.93** / 月
- 毎月の無料枠適用後の小計: **USD 1.89** / 月
- 無料枠を確認できず、何も引いていない単価: `events.custom-event`, `events.pipe-request`, `events.archive.processing`, `events.archive.storage`

## イベントの配線: 7 日ぶんの archive をすべてのルールにリプレイする

ID: `events-replay` / 章: [25 Events: EventBridge、SNS、Pipes、archive と replay](/ja/chapters/25-events.md)

前提:

- 月 20,000 件の例の 7 日ぶん、4,667 件をリプレイする。リプレイしたイベントは custom event の単価で請求される
- timeline の規則に一致する 2,333 件と counter の規則に一致する 1,633 件が、もう一度それぞれの関数を動かす。関数は 1 回 100 ミリ秒、256 MB
- timeline の条件付き書き込みは弾かれても 1 unit を使うものとして 2,333 unit を数える。counter のキャンセルされたトランザクションの消費量は確認していないので、成功したときと同じ 4 unit として 6,532 unit を数える
- counter の SQS のリクエストは 1 件 3 回。rejected の 23 件は、通知のルールがリプレイされたイベントを通さないので、SNS には届かない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `events.custom-event` | 4,667 | 64K-Chunks | 20,000 x 7/30 events replayed | 0.004667 | - | 0.004667 |
| `lambda.request.arm` | 3,966 | Requests | timeline 2,333 + counter 1,633 | 0.000793 | 1,000,000 | 0 |
| `lambda.duration.arm` | 99.15 | Lambda-GB-Second | 3,966 x 0.1 s x 0.25 GB | 0.001322 | 400,000 | 0 |
| `dynamodb.write.on-demand` | 8,865 | WriteRequestUnits | timeline 2,333 x 1 + counter 1,633 x 4 | 0.01 | - | 0.01 |
| `sqs.request.standard` | 4,899 | Requests | counter 1,633 x 3 | 0.001960 | 1,000,000 | 0 |

- 定価の小計: **USD 0.02** / 月
- 毎月の無料枠適用後の小計: **USD 0.01** / 月
- 無料枠を確認できず、何も引いていない単価: `events.custom-event`

## リクエストの記録: デプロイ済みで呼ばれない月

ID: `analytics-idle` / 章: [26 Analytics: Firehose、S3、Glue、Athena](/ja/chapters/26-analytics.md)

前提:

- リクエストゼロ。Firehose にレコードが届かず、オブジェクトも書かれない
- クエリを 1 回も実行しない
- Glue Data Catalog のオブジェクトは、データベース 1 つとテーブル 1 つ
- API、Lambda、DynamoDB そのものの料金は 04章と 05章の計算のとおりで、ここには含めていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `glue.catalog.storage` | 2 | Obj-Month | 1 database + 1 table | 0.000020 | 1,000,000 | 0 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## リクエストの記録: 月 100 万リクエスト、gzip の JSON

ID: `analytics-1m-json` / 章: [26 Analytics: Firehose、S3、Glue、Athena](/ja/chapters/26-analytics.md)

前提:

- 1 リクエストにつきレコード 1 件。再試行による重複は数えない
- レコードは 242 バイト（サンプル 5,000 件の平均）。Firehose は 5 KB 単位に切り上げて課金する（5 KB を 5,120 バイトとして計算）
- バッファーは 60 秒。毎分 1 つオブジェクトができるとして 730 時間で 43,800 個（上限）
- gzip 後は元の 24.3%（サンプルの実測）。90 日で消えるので、置き続ける量は 3 か月ぶん
- クエリは月 100 回。どれも 3 日ぶんのパーティションを読み、読む量は 10 MB の最低課金に届かない
- Athena がオブジェクトごとに GET を 1 回行うと仮定（実際の回数は未確認）: 100 回 × 3 日 × 1,440 個
- クエリ結果の保存、Glue へのリクエスト、Firehose のエラーログは含めていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `firehose.ingest.direct-put` | 4.768 | GB | 1,000,000 records x 5,120 bytes | 0.17 | - | 0.17 |
| `s3.request.tier1` | 43,800 | Requests | one PUT per delivered object, one object a minute | 0.21 | - | 0.21 |
| `s3.standard.storage` | 0.164 | GB-Mo | 0.054703 GB a month, kept 90 days | 0.004103 | - | 0.004103 |
| `athena.scanned` | 0.001 | Terabytes | 100 queries x 10 MB minimum | 0.004770 | - | 0.004770 |
| `s3.request.tier2` | 432,000 | Requests | 100 queries x 4,320 objects, one GET each (assumed) | 0.16 | - | 0.16 |
| `glue.catalog.storage` | 2 | Obj-Month | 1 database + 1 table | 0.000020 | 1,000,000 | 0 |

- 定価の小計: **USD 0.55** / 月
- 毎月の無料枠適用後の小計: **USD 0.55** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `s3.request.tier1`, `s3.request.tier2`, `athena.scanned`

## リクエストの記録: 月 100 万リクエスト、Parquet

ID: `analytics-1m-parquet` / 章: [26 Analytics: Firehose、S3、Glue、Athena](/ja/chapters/26-analytics.md)

前提:

- レコードの数と大きさは JSON のシナリオと同じ
- フォーマット変換は、取り込みと同じ 5 KB 単位の量に対して課金される
- バッファーは 300 秒。5 分に 1 つオブジェクトができるとして 730 時間で 8,760 個（上限）
- Parquet のファイルは 1 レコードあたり 84.6 バイト（手元のライブラリで書いたサンプルの実測。Firehose が書くファイルの大きさは未確認）
- クエリは月 100 回。どれも 10 MB の最低課金に届かない
- Athena がオブジェクトごとに GET を 1 回行うと仮定（Parquet では複数回になりうる。未確認）: 100 回 × 3 日 × 288 個

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `firehose.ingest.direct-put` | 4.768 | GB | 1,000,000 records x 5,120 bytes | 0.17 | - | 0.17 |
| `firehose.format-conversion` | 4.768 | GB | the same billed volume | 0.10 | - | 0.10 |
| `s3.request.tier1` | 8,760 | Requests | one PUT per delivered object, one object every 5 minutes | 0.04 | - | 0.04 |
| `s3.standard.storage` | 0.236 | GB-Mo | 0.078752 GB a month, kept 90 days | 0.01 | - | 0.01 |
| `athena.scanned` | 0.001 | Terabytes | 100 queries x 10 MB minimum | 0.004770 | - | 0.004770 |
| `s3.request.tier2` | 86,400 | Requests | 100 queries x 864 objects, one GET each (assumed) | 0.03 | - | 0.03 |
| `glue.catalog.storage` | 2 | Obj-Month | 1 database + 1 table | 0.000020 | 1,000,000 | 0 |

- 定価の小計: **USD 0.36** / 月
- 毎月の無料枠適用後の小計: **USD 0.36** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `s3.request.tier1`, `s3.request.tier2`, `athena.scanned`

## dynamic partitioning を足した場合の追加ぶん（この章では使っていない）

ID: `analytics-dynamic-partitioning-extra` / 章: [26 Analytics: Firehose、S3、Glue、Athena](/ja/chapters/26-analytics.md)

前提:

- 月 100 万レコード、242 バイト。届けた量は 0.225 GB
- パーティションのキーは日付だけ。毎分 1 つオブジェクトができるとして 43,800 個
- JQ での解析にかかる時間は見積もれないため、含めていない（1 時間あたり 0.112）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `firehose.dynamic-partitioning.gb` | 0.225 | GB | 1,000,000 records x 242 bytes | 0.01 | - | 0.01 |
| `firehose.dynamic-partitioning.object` | 43,800 | Objects | one object a minute | 0.35 | - | 0.35 |

- 定価の小計: **USD 0.36** / 月
- 毎月の無料枠適用後の小計: **USD 0.36** / 月

## リクエストの記録: スロットリングの上限に 30 日張り付いた場合

ID: `analytics-flood-json` / 章: [26 Analytics: Firehose、S3、Glue、Athena](/ja/chapters/26-analytics.md)

前提:

- ステージのスロットリングは毎秒 10 件。関数まで届くのは 30 日で最大 2,592 万件で、その数だけレコードができる
- レコードは 242 バイト、5 KB 単位に切り上げ。gzip 後は 24.3%
- 毎分 1 つオブジェクトができるとして 43,200 個
- クエリは含めていない。API、Lambda、DynamoDB の料金は 19章の「叩かれたら」のとおり

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `firehose.ingest.direct-put` | 123.596 | GB | 25,920,000 records x 5,120 bytes | 4.45 | - | 4.45 |
| `s3.request.tier1` | 43,200 | Requests | one PUT per delivered object | 0.20 | - | 0.20 |
| `s3.standard.storage` | 4.254 | GB-Mo | 1.417893 GB a month, kept 90 days | 0.11 | - | 0.11 |

- 定価の小計: **USD 4.76** / 月
- 毎月の無料枠適用後の小計: **USD 4.76** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `s3.request.tier1`

## 検索: デプロイ済みで、書き込みも検索もない月

ID: `search-idle` / 章: [27 Search: 全文検索、ベクトル検索、RAG](/ja/chapters/27-search.md)

前提:

- 1,000 件のノートが索引済みで、パッセージは 1 件あたり平均 2 つ（ベクトル 2,000 本）と仮定
- ベクトル 1 本は 4.2 KB と仮定（1,024 次元 × 4 バイト、キー約 30 バイト、メタデータ約 70 バイト）
- 書き込み、検索、回答はゼロ
- DynamoDB の保存量は 25 GB の無料枠の内側（1,000 件 × 約 2 KB）
- 空のデッドレターキューと、7 日で消えるログは 0

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3vectors.storage` | 0.008 | GB-Mo | 2,000 vectors x 4.2 KB, in GB | 0.000529 | - | 0.000529 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月
- 無料枠を確認できず、何も引いていない単価: `s3vectors.storage`

## 検索: 月に書き込み 1,000 件、検索 10,000 件、回答 1,000 件

ID: `search-month` / 章: [27 Search: 全文検索、ベクトル検索、RAG](/ja/chapters/27-search.md)

前提:

- 索引は search-idle と同じ 2,000 本
- 書き込み 1,000 件。1 件あたりパッセージ 2 つ、1 パッセージ 400 トークンと仮定（日本語の文字とトークンの比は確かめていない）
- PutVectors は書き込み 1 件につき 1 回。1 回の最低課金 128 KB が適用されると仮定
- 検索 10,000 件。問い合わせの埋め込みは 1 件 30 トークンと仮定
- 1 回の検索で読む所有者のノートは 10 件、約 20 KB（3 読み込みユニット）と仮定
- 検索のうち 1,000 件が回答まで進む。回答 1 件は入力 2,500 トークン、出力 150 トークンと仮定
- Lambda は 256 MB、arm64。検索 0.5 秒、回答 4 秒、索引 1 秒と仮定
- ログは 1 件あたり 1 KB と仮定
- データ転送と、問い合わせが返すバイト数（1 回 512 KB まで無料）は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3vectors.storage` | 0.008 | GB-Mo | 2,000 vectors x 4.2 KB, in GB | 0.000529 | - | 0.000529 |
| `s3vectors.put` | 0.122 | GB | 1,000 PutVectors calls x the 128 KB minimum, in GB | 0.03 | - | 0.03 |
| `s3vectors.query.request` | 10,000 | Requests | one QueryVectors call per search | 0.03 | - | 0.03 |
| `s3vectors.query.processed.tier1` | 80.109 | GB | 10,000 queries x 2,000 vectors x 4.2 KB, in GB | 0.000343 | - | 0.000343 |
| `bedrock.titan-embed-text-v2.input` | 1,100 | 1K tokens | 1,000 writes x 800 tokens + 10,000 queries x 30 tokens, in 1K tokens | 0.03 | - | 0.03 |
| `bedrock.nova-2-lite.input` | 2,500 | 1K tokens | 1,000 answers x 2,500 input tokens, in 1K tokens | 0.99 | - | 0.99 |
| `bedrock.nova-2-lite.output` | 150 | 1K tokens | 1,000 answers x 150 output tokens, in 1K tokens | 0.50 | - | 0.50 |
| `dynamodb.write.on-demand` | 2,000 | WriteRequestUnits | 1,000 notes of about 2 KB, 2 write units each | 0.001430 | - | 0.001430 |
| `dynamodb.read.on-demand` | 30,000 | ReadRequestUnits | 10,000 searches x 3 read units | 0.004275 | - | 0.004275 |
| `lambda.request.arm` | 11,000 | Requests | 10,000 searches + 1,000 indexer invocations | 0.002200 | 1,000,000 | 0 |
| `lambda.duration.arm` | 2,375 | Lambda-GB-Second | (9,000 x 0.5 s + 1,000 x 4 s + 1,000 x 1 s) x 0.25 GB | 0.03 | 400,000 | 0 |
| `logs.ingest.standard` | 0.01 | GB | 11,000 x 1 KB, in GB | 0.01 | 5 | 0 |

- 定価の小計: **USD 1.62** / 月
- 毎月の無料枠適用後の小計: **USD 1.58** / 月
- 無料枠を確認できず、何も引いていない単価: `s3vectors.storage`, `s3vectors.put`, `s3vectors.query.request`, `s3vectors.query.processed.tier1`, `bedrock.titan-embed-text-v2.input`, `bedrock.nova-2-lite.input`, `bedrock.nova-2-lite.output`

## 比較: OpenSearch Serverless の Classic コレクションを 1 か月置いた場合の最低額

ID: `search-opensearch-classic-minimum` / 章: [27 Search: 全文検索、ベクトル検索、RAG](/ja/chapters/27-search.md)

前提:

- Classic コレクションの最初の 1 つ。冗長構成（既定）で、最低 2 OCU（索引 1、検索 1）
- 730 時間。リクエストはゼロ
- 保存量の料金は含まない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `opensearch.serverless.ocu.indexing` | 730 | OCU-hours | 1 OCU x 730 h | 243.82 | - | 243.82 |
| `opensearch.serverless.ocu.search` | 730 | OCU-hours | 1 OCU x 730 h | 243.82 | - | 243.82 |

- 定価の小計: **USD 487.64** / 月
- 毎月の無料枠適用後の小計: **USD 487.64** / 月
- 無料枠を確認できず、何も引いていない単価: `opensearch.serverless.ocu.indexing`, `opensearch.serverless.ocu.search`

## 比較: OpenSearch Serverless の Classic コレクション（冗長なし）の最低額

ID: `search-opensearch-classic-dev` / 章: [27 Search: 全文検索、ベクトル検索、RAG](/ja/chapters/27-search.md)

前提:

- 冗長なし（dev-test）。最低 1 OCU（索引 0.5、検索 0.5）
- 730 時間。リクエストはゼロ
- 保存量の料金は含まない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `opensearch.serverless.ocu.indexing` | 365 | OCU-hours | 0.5 OCU x 730 h | 121.91 | - | 121.91 |
| `opensearch.serverless.ocu.search` | 365 | OCU-hours | 0.5 OCU x 730 h | 121.91 | - | 121.91 |

- 定価の小計: **USD 243.82** / 月
- 毎月の無料枠適用後の小計: **USD 243.82** / 月
- 無料枠を確認できず、何も引いていない単価: `opensearch.serverless.ocu.indexing`, `opensearch.serverless.ocu.search`

## Multi-Region: 2 つ目のリージョンが 1 か月に上乗せするもの（テーブル 1 GB、画像 10 GB）

ID: `mr-second-region` / 章: [28 Multi-Region: global tables、S3 replication、Route 53](/ja/chapters/28-multi-region.md)

前提:

- 既定の 2 つのスタック。テーブルは各リージョンで 1 GB、point-in-time recovery は両方のレプリカで有効
- 書き込みは月 10 万回で、どれも 1 KB 以下。大阪のレプリカに同じ数の replicated write request unit がかかる。東京側の書き込みは、同じ単価の replicated write request unit に置き換わるので、上乗せには数えない
- 画像は 10 GB で、その写しを大阪に置く。月に 1 GB、10,000 個が新しく複製される。複製の PUT は大阪の通常の PUT の単価で計算
- 読み取り、Lambda、API Gateway、ログ、東京側の保存料は含めない。大阪の DynamoDB の保存料は、最初の 25 GB が USD 0 の段に入る

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.replicated-write.osaka` | 100,000 | ReplicatedWriteRequestUnits | 100,000 writes of 1 KB or less, replicated to Osaka | 0.07 | - | 0.07 |
| `dynamodb.storage.osaka` | 1 | GB-Mo | 1 GB replica in Osaka, in GB-month | 0 | - | 0 |
| `dynamodb.pitr.storage.osaka` | 1 | GB-Mo | 1 GB replica under PITR in Osaka, in GB-month | 0.23 | - | 0.23 |
| `s3.standard.storage.osaka` | 10 | GB-Mo | 10 GB of replicas in Osaka, in GB-month | 0.25 | - | 0.25 |
| `s3.request.tier1.osaka` | 10,000 | Requests | 10,000 replication PUT requests into Osaka | 0.05 | - | 0.05 |
| `datatransfer.tokyo-osaka` | 1 | GB | 1 GB replicated from Tokyo to Osaka | 0.09 | - | 0.09 |

- 定価の小計: **USD 0.69** / 月
- 毎月の無料枠適用後の小計: **USD 0.69** / 月
- 無料枠を確認できず、何も引いていない単価: `dynamodb.replicated-write.osaka`, `datatransfer.tokyo-osaka`

## Multi-Region: ドメインを付けた構成が 1 か月に上乗せするもの

ID: `mr-dns` / 章: [28 Multi-Region: global tables、S3 replication、Route 53](/ja/chapters/28-multi-region.md)

前提:

- `-c domain=...` を付けた 2 つのスタック。ヘルスチェックは HTTPS で 2 つ、間隔は 30 秒
- ヘルスチェックの基本料金は、AWS のエンドポイント向けの最初の 50 個が USD 0 の段に入る。HTTPS は追加機能として 1 つずつ課金される
- ホストゾーンは 1 つ。すでに持っているゾーンを使うなら、この行は上乗せにならない
- エイリアスレコードへのクエリは無料。ACM の証明書と API Gateway のカスタムドメインの料金は調べておらず、含めていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `route53.health-check.aws` | 2 | Mo | 2 health checks of AWS endpoints, per month | 0 | - | 0 |
| `route53.health-check.option.aws` | 2 | Mo | HTTPS on each of the 2 health checks, per month | 2.00 | - | 2.00 |
| `route53.hosted-zone` | 1 | HostedZone | 1 public hosted zone, per month | 0.50 | - | 0.50 |

- 定価の小計: **USD 2.50** / 月
- 毎月の無料枠適用後の小計: **USD 2.50** / 月

## Multi-Region: S3 Replication Time Control が 1 か月に上乗せするもの

ID: `mr-rtc` / 章: [28 Multi-Region: global tables、S3 replication、Route 53](/ja/chapters/28-multi-region.md)

前提:

- `-c rtc=on`。東京から大阪への複製ルールが 1 つ
- 月に 1 GB が複製される
- 複製のメトリクスは 4 つ（bytes pending、operations pending、operations failed、replication latency）が 1 か月ずっと課金されると仮定。ルール 1 つあたりの実際の本数と、複製するものがない月にも課金されるかは確認していない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3.rtc.tokyo-osaka` | 1 | GB | 1 GB replicated under Replication Time Control | 0.01 | - | 0.01 |
| `cloudwatch.metric.custom` | 4 | Metrics | 4 replication metrics, per month (assumed count) | 1.20 | 10 | 0 |

- 定価の小計: **USD 1.22** / 月
- 毎月の無料枠適用後の小計: **USD 0.02** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.rtc.tokyo-osaka`

## Lambda Tuning: 既定の設定でデプロイして、呼ばれない月

ID: `tune-idle` / 章: [29 Lambda Tuning: cold start、メモリ、同時実行数、bundle](/ja/chapters/29-lambda-tuning.md)

前提:

- リクエストゼロ
- provisioned concurrency を付けていない（既定）。予約済み同時実行数は付けても料金がかからない
- ログは 7 日で失効し、保存量ゼロ

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## Lambda Tuning: 月 100 万回、256 MB、50 ms

ID: `tune-1m-256` / 章: [29 Lambda Tuning: cold start、メモリ、同時実行数、bundle](/ja/chapters/29-lambda-tuning.md)

前提:

- Lambda の料金だけ。API Gateway、DynamoDB、ログの料金は 04章、05章、19章の計算のとおりで、ここには含めていない
- arm64、256 MB、1 回あたりの課金時間 50 ms（04章と同じ仮定）
- コールドスタートなし

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 1,000,000 | Requests | 1,000,000 invocations | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 12,500 | Lambda-GB-Second | 1,000,000 x 0.05 s x 0.25 GB, in GB-seconds | 0.17 | 400,000 | 0 |

- 定価の小計: **USD 0.37** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## Lambda Tuning: 月 100 万回、1,024 MB にしても 50 ms のままだった場合

ID: `tune-1m-1024` / 章: [29 Lambda Tuning: cold start、メモリ、同時実行数、bundle](/ja/chapters/29-lambda-tuning.md)

前提:

- Lambda の料金だけ。API Gateway、DynamoDB、ログの料金は 04章、05章、19章の計算のとおりで、ここには含めていない
- arm64、1,024 MB。メモリを 4 倍にしても実行時間が 50 ms のまま変わらなかったという仮定（待ち時間の大半がネットワークである場合）
- コールドスタートなし

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 1,000,000 | Requests | 1,000,000 invocations | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 50,000 | Lambda-GB-Second | 1,000,000 x 0.05 s x 1 GB, in GB-seconds | 0.67 | 400,000 | 0 |

- 定価の小計: **USD 0.87** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## Lambda Tuning: 月 100 万回のうち 1% がコールドスタートだった場合

ID: `tune-1m-cold` / 章: [29 Lambda Tuning: cold start、メモリ、同時実行数、bundle](/ja/chapters/29-lambda-tuning.md)

前提:

- Lambda の料金だけ。API Gateway、DynamoDB、ログの料金は 04章、05章、19章の計算のとおりで、ここには含めていない
- arm64、256 MB、ハンドラー 50 ms
- 1%（1 万回）がコールドスタートで、初期化に 300 ms かかるという仮定。300 ms は計測値ではない
- 初期化の時間も実行時間と同じ単価で課金される（2025 年 8 月 1 日から）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 1,000,000 | Requests | 1,000,000 invocations | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 13,250 | Lambda-GB-Second | 12,500 + 10,000 x 0.3 s x 0.25 GB, in GB-seconds | 0.18 | 400,000 | 0 |

- 定価の小計: **USD 0.38** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## Lambda Tuning: provisioned concurrency 1 を 1 か月置いた場合（呼ばれなくてもかかる分）

ID: `tune-provisioned-1` / 章: [29 Lambda Tuning: cold start、メモリ、同時実行数、bundle](/ja/chapters/29-lambda-tuning.md)

前提:

- -c provisionedConcurrency=1、256 MB、arm64 でデプロイして 730 時間置く
- リクエストゼロ。呼ばれたぶんのリクエスト料金と実行時間の料金は別にかかる
- provisioned concurrency を有効にした関数には Lambda の無料枠が適用されない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.provisioned.arm` | 657,000 | Lambda-GB-Second | 1 x 0.25 GB x 2,628,000 s, in GB-seconds | 2.83 | - | 2.83 |

- 定価の小計: **USD 2.83** / 月
- 毎月の無料枠適用後の小計: **USD 2.83** / 月

## Lambda Tuning: 1,024 MB にした関数が、スロットリングの上限に 30 日張り付いた場合

ID: `tune-flood-1024` / 章: [29 Lambda Tuning: cold start、メモリ、同時実行数、bundle](/ja/chapters/29-lambda-tuning.md)

前提:

- Lambda の料金だけ。ほかの行は 19章の「叩かれたら」と同じ
- ステージのスロットリング（毎秒 10 件）に 30 日張り付く: 2,592 万回
- 1 回 60 ms、1,024 MB、arm64（19章の表の仮定を、メモリだけ 4 倍にしたもの）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 25,920,000 | Requests | 10 a second x 2,592,000 s | 5.18 | 1,000,000 | 4.98 |
| `lambda.duration.arm` | 1,555,200 | Lambda-GB-Second | 25,920,000 x 0.06 s x 1 GB, in GB-seconds | 20.74 | 400,000 | 15.40 |

- 定価の小計: **USD 25.92** / 月
- 毎月の無料枠適用後の小計: **USD 20.39** / 月

## Lambda Tuning: スロットリングの上限に張り付かれ、どの呼び出しもタイムアウトまで動いた場合

ID: `tune-flood-stalled` / 章: [29 Lambda Tuning: cold start、メモリ、同時実行数、bundle](/ja/chapters/29-lambda-tuning.md)

前提:

- Lambda の料金だけ。計算上の上限で、請求で確かめたものではない
- ステージのスロットリング（毎秒 10 件）に 30 日張り付く: 2,592 万回
- 下流が応答せず、どの呼び出しも関数のタイムアウトの 10 秒まで課金されるという仮定。256 MB、arm64
- 予約済み同時実行数なし。同時実行数は 10 x 10 = 100 に達する

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 25,920,000 | Requests | 10 a second x 2,592,000 s | 5.18 | 1,000,000 | 4.98 |
| `lambda.duration.arm` | 64,800,000 | Lambda-GB-Second | 25,920,000 x 10 s x 0.25 GB, in GB-seconds | 864.00 | 400,000 | 858.67 |

- 定価の小計: **USD 869.19** / 月
- 毎月の無料枠適用後の小計: **USD 863.65** / 月

## Lambda Tuning: 同じ状況で、予約済み同時実行数が 5 の場合

ID: `tune-flood-stalled-reserved` / 章: [29 Lambda Tuning: cold start、メモリ、同時実行数、bundle](/ja/chapters/29-lambda-tuning.md)

前提:

- Lambda の料金だけ。計算上の上限で、請求で確かめたものではない
- -c reservedConcurrency=5。実行環境は 5 つまでで、それを超えたリクエストは関数を動かさずに断られる
- 5 つの実行環境が 30 日のあいだ休みなく 10 秒の呼び出しを続ける: 129.6 万回、256 MB、arm64

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 1,296,000 | Requests | 5 environments x 2,592,000 s / 10 s | 0.26 | 1,000,000 | 0.06 |
| `lambda.duration.arm` | 3,240,000 | Lambda-GB-Second | 5 x 2,592,000 s x 0.25 GB, in GB-seconds | 43.20 | 400,000 | 37.87 |

- 定価の小計: **USD 43.46** / 月
- 毎月の無料枠適用後の小計: **USD 37.93** / 月

## Data Modeling: デプロイ済みで使われない月

ID: `modeling-idle` / 章: [30 Data Modeling: DynamoDB の single-table design、GSI、Streams、transaction](/ja/chapters/30-data-modeling.md)

前提:

- 既定のスタック。Contributor Insights は無効
- テーブルとインデックスを合わせて 10 MB。読み書きなし
- ストリームに変更がないので、関数は呼ばれない。Lambda によるストリームのポーリングは料金に含まれない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.storage` | 0.01 | GB-Mo | 10 MB stored in the table and the index, in GB-month | 0 | - | 0 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## Data Modeling: 月 100 万回の読み書き

ID: `modeling-month` / 章: [30 Data Modeling: DynamoDB の single-table design、GSI、Streams、transaction](/ja/chapters/30-data-modeling.md)

前提:

- 月 100 万回の操作。最近の一覧 60%、タグの一覧 10%、ノートと添付の取得 20%、編集 5%（5 回に 1 回は題名も変える）、作成 3%、添付の追加 1%、削除 1%
- アイテムはどれも 1 KB 以下、一覧の 1 ページは 8 KB 以下、ノートと添付は合わせて 4 KB 以下。ノート 1 件にタグ 3 つ、slug なし、削除するノートに添付 1 つ
- トランザクションの中のアイテムは、条件だけのもの（ConditionCheck）も含めて 2 ユニットで数えた。ConditionCheck が書き込みと読み取りのどちらで課金されるかは確認していない
- ストリームを読む関数は、タグのアイテムの変更 1 件につき 1 回、合わせて 15 万回呼ばれ、256 MB で 50 ミリ秒かかると仮定（計測値ではない）。ログは 1 回 200 バイト
- テーブルとインデックスで 1 GB。Contributor Insights は無効。競合と再試行は 0 と仮定

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.read.on-demand` | 960,000 | ReadRequestUnits | 600,000 recent lists and 100,000 tag lists at 1 unit (8 KB, eventually consistent), 200,000 collections at 1 unit (4 KB, strongly consistent), 60,000 reads before an edit or a delete at 1 unit | 0.14 | - | 0.14 |
| `dynamodb.write.on-demand` | 1,190,000 | WriteRequestUnits | creates 30,000 x 11 (5 items x 2, index 1); plain edits 40,000 x 3 (1, index 2); renames 10,000 x 10 (4 items x 2, index 2); attachments 10,000 x 4; deletes 10,000 x 12 (5 items x 2, index 1, one attachment); stream consumer 120,000 x 4 (2 items x 2) | 0.85 | - | 0.85 |
| `dynamodb.storage` | 1 | GB-Mo | 1 GB in the table and the index, in GB-month | 0 | - | 0 |
| `lambda.request.arm` | 150,000 | Requests | one invocation per tag item change: 90,000 inserts, 30,000 removes, 30,000 rewrites after a rename | 0.03 | 1,000,000 | 0 |
| `lambda.duration.arm` | 1,875 | Lambda-GB-Second | 150,000 x 0.05 s x 0.25 GB | 0.03 | 400,000 | 0 |
| `logs.ingest.standard` | 0.03 | GB | 150,000 x 200 bytes, in GB | 0.02 | 5 | 0 |

- 定価の小計: **USD 1.07** / 月
- 毎月の無料枠適用後の小計: **USD 0.99** / 月

## Data Modeling: Contributor Insights を有効にした月（-c insights=on）

ID: `modeling-insights` / 章: [30 Data Modeling: DynamoDB の single-table design、GSI、Streams、transaction](/ja/chapters/30-data-modeling.md)

前提:

- テーブルだけに、スロットリングされたキーだけを数えるモードで有効にする。ソートキーがあるのでルールは 2 つ
- スロットリングが 1 件も起きず、イベントは 0
- インデックスにも付けるなら、ルールがさらに 2 つ増える

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.contributor-insights.dynamodb.rule` | 2 | Rule-Hour | 2 rules for one month | 1.00 | - | 1.00 |
| `cloudwatch.contributor-insights.dynamodb.event` | 0 | Events | no throttled requests | 0 | - | 0 |

- 定価の小計: **USD 1.00** / 月
- 毎月の無料枠適用後の小計: **USD 1.00** / 月
- 無料枠を確認できず、何も引いていない単価: `cloudwatch.contributor-insights.dynamodb.rule`, `cloudwatch.contributor-insights.dynamodb.event`

## Progressive Delivery: デプロイして 1 か月、何も呼ばれなかった場合

ID: `progressive-idle` / 章: [31 Progressive Delivery: alias、canary、blue/green、feature flag](/ja/chapters/31-progressive-delivery.md)

前提:

- 既定のスタック。標準解像度のアラームが 2 つ
- リクエストは 0 件。関数が起動しないので、拡張機能も AppConfig を呼ばない
- ログは書かれない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.alarm.standard` | 2 | Alarms | 2 alarms, one metric each, for one month | 0.20 | 10 | 0 |

- 定価の小計: **USD 0.20** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## Progressive Delivery: フラグとアラームの 1 か月ぶん（実行環境 1 つが動き続け、コールドスタートが 1,000 回）

ID: `progressive-flags-month` / 章: [31 Progressive Delivery: alias、canary、blue/green、feature flag](/ja/chapters/31-progressive-delivery.md)

前提:

- 実行環境 1 つが 730 時間ずっと呼ばれ続け、拡張機能が 45 秒ごとに AppConfig に問い合わせる: 730 × 3,600 ÷ 45 = 58,400 回
- 設定を受け取る回数は 1,000 回。コールドスタートのたびに 1 回、動いている実行環境がフラグのデプロイのたびに 1 回受け取るものとして数えた。この数え方は料金表の単位名とドキュメントの注記から読み取ったもので、請求で確かめてはいない
- API Gateway、Lambda、ログの料金は 04章と同じなので含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.alarm.standard` | 2 | Alarms | 2 alarms, one metric each, for one month | 0.20 | 10 | 0 |
| `appconfig.request` | 58,400 | Configuration Requests | 730 h x 3600 s / 45 s poll interval | 0.01 | - | 0.01 |
| `appconfig.received` | 1,000 | Configuration Received | 1,000 configurations received | 0.80 | - | 0.80 |

- 定価の小計: **USD 1.01** / 月
- 毎月の無料枠適用後の小計: **USD 0.81** / 月
- 無料枠を確認できず、何も引いていない単価: `appconfig.request`, `appconfig.received`

## 上限つきノート API: デプロイ済みで呼ばれない月

ID: `limits-idle` / 章: [32 Limits: quota、throttling、retry、負荷試験、費用の内訳](/ja/chapters/32-limits.md)

前提:

- リクエストゼロ。API Gateway、Lambda、DynamoDB、ログのどれにも使用量がない
- アラーム 1 つが参照するメトリクスは 1 つ（Lambda の Throttles）
- 予算は 1 つで、アクションを付けていない。Price List の BudgetsUsage は USD 0.00
- 予約済み同時実行数とステージのスロットリングの設定に料金はかからない
- Cost Explorer の API は 1 回も呼ばない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.alarm.standard` | 1 | Alarms | 1 alarm on 1 metric | 0.10 | 10 | 0 |

- 定価の小計: **USD 0.10** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## タグ別の費用を毎日 1 回、スクリプトで見る月

ID: `limits-cost-report` / 章: [32 Limits: quota、throttling、retry、負荷試験、費用の内訳](/ja/chapters/32-limits.md)

前提:

- vp run limits:cost を 1 日 1 回、30 日。1 回が Cost Explorer の API リクエスト 1 件
- 結果は 1 ページに収まる（2 ページ目を取ると、もう 1 件ぶんかかる。スクリプトは取らない）
- コンソールの Cost Explorer を開いたぶんは含めていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `costexplorer.api.request` | 30 | Request | 30 runs x 1 request | 0.30 | - | 0.30 |

- 定価の小計: **USD 0.30** / 月
- 毎月の無料枠適用後の小計: **USD 0.30** / 月
- 無料枠を確認できず、何も引いていない単価: `costexplorer.api.request`

## Lambda Managed Instances: 1 件も処理しないまま 1 か月

ID: `lmi-idle` / 章: [35 Lambda Managed Instances: Lambda を自分の EC2 キャパシティで動かす](/ja/chapters/35-lambda-managed-instances.md)

前提:

- 既定の構成。Lambda が m6g.large を 3 台起動すると仮定（Lambda のガイドは、関数のバージョンを公開したとき既定で 3 台と書いている。実機では確かめていない）
- EC2 のオンデマンドの定価と、その 15% にあたる Lambda の管理料
- 11章のスタックに、CloudWatch Logs のインターフェースエンドポイントを 1 つ、2 つの AZ に置いたまま
- インスタンスの EBS ボリューム（大きさを確認できていない）、API Gateway、ログ、データ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.m6g-large.linux.hour` | 2,190 | Hrs | 3 m6g.large x 730 hours | 216.81 | - | 216.81 |
| `lambda.managed-instances.m6g-large.management.hour` | 2,190 | Hours | management fee, 3 m6g.large x 730 hours | 32.52 | - | 32.52 |
| `vpc.endpoint.interface.hour` | 1,460 | Hrs | 1 interface endpoint x 2 zones x 730 hours | 20.44 | - | 20.44 |

- 定価の小計: **USD 269.77** / 月
- 毎月の無料枠適用後の小計: **USD 269.77** / 月
- 無料枠を確認できず、何も引いていない単価: `ec2.m6g-large.linux.hour`

## Lambda Managed Instances: 1 日だけ置く

ID: `lmi-one-day` / 章: [35 Lambda Managed Instances: Lambda を自分の EC2 キャパシティで動かす](/ja/chapters/35-lambda-managed-instances.md)

前提:

- 既定の構成。Lambda が m6g.large を 3 台起動すると仮定（Lambda のガイドは、関数のバージョンを公開したとき既定で 3 台と書いている。実機では確かめていない）
- 11章のスタックに、CloudWatch Logs のインターフェースエンドポイントを 1 つ、2 つの AZ に置いたまま
- インスタンスの EBS ボリューム（大きさを確認できていない）、API Gateway、ログ、データ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.m6g-large.linux.hour` | 72 | Hrs | 3 m6g.large x 24 hours | 7.13 | - | 7.13 |
| `lambda.managed-instances.m6g-large.management.hour` | 72 | Hours | management fee, 3 m6g.large x 24 hours | 1.07 | - | 1.07 |
| `vpc.endpoint.interface.hour` | 48 | Hrs | 1 interface endpoint x 2 zones x 24 hours | 0.67 | - | 0.67 |

- 定価の小計: **USD 8.87** / 月
- 毎月の無料枠適用後の小計: **USD 8.87** / 月
- 無料枠を確認できず、何も引いていない単価: `ec2.m6g-large.linux.hour`

## Lambda Managed Instances: vCPU の上限まで増えたまま 1 か月

ID: `lmi-ceiling` / 章: [35 Lambda Managed Instances: Lambda を自分の EC2 キャパシティで動かす](/ja/chapters/35-lambda-managed-instances.md)

前提:

- maxVCpuCount が 12 なので、m6g.large（2 vCPU）は最大 6 台。6 台が 730 時間動き続けた場合
- 11章のスタックに、CloudWatch Logs のインターフェースエンドポイントを 1 つ、2 つの AZ に置いたまま
- インスタンスの EBS ボリューム（大きさを確認できていない）、API Gateway、ログ、データ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.m6g-large.linux.hour` | 4,380 | Hrs | 6 m6g.large x 730 hours | 433.62 | - | 433.62 |
| `lambda.managed-instances.m6g-large.management.hour` | 4,380 | Hours | management fee, 6 m6g.large x 730 hours | 65.04 | - | 65.04 |
| `vpc.endpoint.interface.hour` | 1,460 | Hrs | 1 interface endpoint x 2 zones x 730 hours | 20.44 | - | 20.44 |

- 定価の小計: **USD 519.10** / 月
- 毎月の無料枠適用後の小計: **USD 519.10** / 月
- 無料枠を確認できず、何も引いていない単価: `ec2.m6g-large.linux.hour`

## Lambda Managed Instances: 一定の負荷が続く 1 か月

ID: `lmi-steady` / 章: [35 Lambda Managed Instances: Lambda を自分の EC2 キャパシティで動かす](/ja/chapters/35-lambda-managed-instances.md)

前提:

- 1 か月に 1 億リクエスト、1 リクエストあたり平均 200 ミリ秒（同時に処理中のリクエストは平均 7.6 件）
- 3 台の m6g.large でこの負荷を処理できると仮定（1 リクエストが使う CPU 時間によるので、確かめていない）
- 11章のスタックに、CloudWatch Logs のインターフェースエンドポイントを 1 つ、2 つの AZ に置いたまま
- インスタンスの EBS ボリューム（大きさを確認できていない）、API Gateway、ログ、データ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.managed-instances.request.arm` | 100,000,000 | Requests | 100 million requests | 20.00 | - | 20.00 |
| `ec2.m6g-large.linux.hour` | 2,190 | Hrs | 3 m6g.large x 730 hours | 216.81 | - | 216.81 |
| `lambda.managed-instances.m6g-large.management.hour` | 2,190 | Hours | management fee, 3 m6g.large x 730 hours | 32.52 | - | 32.52 |
| `vpc.endpoint.interface.hour` | 1,460 | Hrs | 1 interface endpoint x 2 zones x 730 hours | 20.44 | - | 20.44 |

- 定価の小計: **USD 289.77** / 月
- 毎月の無料枠適用後の小計: **USD 289.77** / 月
- 無料枠を確認できず、何も引いていない単価: `lambda.managed-instances.request.arm`, `ec2.m6g-large.linux.hour`

## 比較: 標準の Lambda（arm64、256 MB）で同じ 1 か月

ID: `lmi-compare-standard-256mb` / 章: [35 Lambda Managed Instances: Lambda を自分の EC2 キャパシティで動かす](/ja/chapters/35-lambda-managed-instances.md)

前提:

- 1 か月に 1 億リクエスト、1 リクエストあたり平均 200 ミリ秒（同時に処理中のリクエストは平均 7.6 件）
- メモリは 256 MB。課金される時間は 1 リクエスト 200 ミリ秒のまま変わらないと仮定（メモリを変えると実行時間も変わるが、計測していない）
- 無料利用枠を引く前の定価。API Gateway、ログ、データ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 100,000,000 | Requests | 100 million requests | 20.00 | 1,000,000 | 19.80 |
| `lambda.duration.arm` | 5,000,000 | Lambda-GB-Second | 100 million x 0.2 s x 256 MB | 66.67 | 400,000 | 61.33 |

- 定価の小計: **USD 86.67** / 月
- 毎月の無料枠適用後の小計: **USD 81.13** / 月

## 比較: 標準の Lambda（arm64、1 GB）で同じ 1 か月

ID: `lmi-compare-standard-1gb` / 章: [35 Lambda Managed Instances: Lambda を自分の EC2 キャパシティで動かす](/ja/chapters/35-lambda-managed-instances.md)

前提:

- 1 か月に 1 億リクエスト、1 リクエストあたり平均 200 ミリ秒（同時に処理中のリクエストは平均 7.6 件）
- メモリは 1 GB。課金される時間は 1 リクエスト 200 ミリ秒のまま変わらないと仮定（メモリを変えると実行時間も変わるが、計測していない）
- 無料利用枠を引く前の定価。API Gateway、ログ、データ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 100,000,000 | Requests | 100 million requests | 20.00 | 1,000,000 | 19.80 |
| `lambda.duration.arm` | 20,000,000 | Lambda-GB-Second | 100 million x 0.2 s x 1 GB | 266.67 | 400,000 | 261.33 |

- 定価の小計: **USD 286.67** / 月
- 毎月の無料枠適用後の小計: **USD 281.13** / 月

## 比較: 標準の Lambda（arm64、2 GB）で同じ 1 か月

ID: `lmi-compare-standard-2gb` / 章: [35 Lambda Managed Instances: Lambda を自分の EC2 キャパシティで動かす](/ja/chapters/35-lambda-managed-instances.md)

前提:

- 1 か月に 1 億リクエスト、1 リクエストあたり平均 200 ミリ秒（同時に処理中のリクエストは平均 7.6 件）
- メモリは 2 GB。課金される時間は 1 リクエスト 200 ミリ秒のまま変わらないと仮定（メモリを変えると実行時間も変わるが、計測していない）
- 無料利用枠を引く前の定価。API Gateway、ログ、データ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 100,000,000 | Requests | 100 million requests | 20.00 | 1,000,000 | 19.80 |
| `lambda.duration.arm` | 40,000,000 | Lambda-GB-Second | 100 million x 0.2 s x 2 GB | 533.34 | 400,000 | 528.00 |

- 定価の小計: **USD 553.34** / 月
- 毎月の無料枠適用後の小計: **USD 547.80** / 月

## 比較: 同じ m6g.large 3 台を EC2 で自分で持つ 1 か月

ID: `lmi-compare-ec2` / 章: [35 Lambda Managed Instances: Lambda を自分の EC2 キャパシティで動かす](/ja/chapters/35-lambda-managed-instances.md)

前提:

- m6g.large を 3 台、730 時間
- ボリューム、ロードバランサー、パブリック IPv4 アドレス、データ転送は未算入。OS のパッチ、プロセスの監視、スケーリングは自分の仕事になる

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.m6g-large.linux.hour` | 2,190 | Hrs | 3 m6g.large x 730 hours | 216.81 | - | 216.81 |

- 定価の小計: **USD 216.81** / 月
- 毎月の無料枠適用後の小計: **USD 216.81** / 月
- 無料枠を確認できず、何も引いていない単価: `ec2.m6g-large.linux.hour`

## 比較: 同じ大きさ（2 vCPU、8 GB）の Fargate タスク 3 つで 1 か月

ID: `lmi-compare-fargate` / 章: [35 Lambda Managed Instances: Lambda を自分の EC2 キャパシティで動かす](/ja/chapters/35-lambda-managed-instances.md)

前提:

- arm64 の Fargate タスクを 3 つ、それぞれ 2 vCPU と 8 GB、730 時間
- ロードバランサー、パブリック IPv4 アドレス、ECR、データ転送は未算入（12章のシナリオに含まれる）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 4,380 | hours | 3 tasks x 2 vCPUs x 730 hours | 177.17 | - | 177.17 |
| `fargate.arm.memory.gb-hour` | 17,520 | hours | 3 tasks x 8 GB x 730 hours | 77.44 | - | 77.44 |

- 定価の小計: **USD 254.61** / 月
- 毎月の無料枠適用後の小計: **USD 254.61** / 月
- 無料枠を確認できず、何も引いていない単価: `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`

## ノートのアシスタント: デプロイ済みで呼ばれない月

ID: `bedrock-idle` / 章: [36 Bedrock: tool use、構造化出力、Guardrails、prompt caching、inference profile、batch](/ja/chapters/36-bedrock.md)

前提:

- リクエストゼロ
- テーブルは空で、保存量ゼロ
- ガードレールは置いてあるだけでは課金されない（課金は text unit ごと）
- ログは 1 週間で失効し、保存量ゼロ

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## ノートのアシスタント: 月 1,000 問（Nova 2 Lite、jp. profile）

ID: `bedrock-assistant-nova-2-lite` / 章: [36 Bedrock: tool use、構造化出力、Guardrails、prompt caching、inference profile、batch](/ja/chapters/36-bedrock.md)

前提:

- 月 1,000 問。1 問あたりモデルを 3 回呼ぶと仮定（一覧、1 件読む、答える）
- 入力は 3 回の合計で 1 問あたり 4,000 token と仮定（会話は毎回すべて送り直す。実際の値はログの usage でわかる）
- 出力は 1 問あたり合計 200 token と仮定
- prompt caching は使わない計算
- ガードレールは sensitive information filter のみ。1 問あたり 6 text unit と仮定（3 回の呼び出しそれぞれで入力 1 と出力 1。複数回の呼び出しでの数え方は未確認）
- Lambda は 256 MB、arm64、1 問あたり 8 秒と仮定
- DynamoDB は 1 問あたり書き込み 2（予算の確保と精算）、読み込み 3 と仮定
- 1 問あたりログ 1 KB と仮定
- データ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input` | 4,000 | 1K tokens | 1,000 questions x 4,000 input tokens, in 1K tokens | 1.58 | - | 1.58 |
| `bedrock.nova-2-lite.output` | 200 | 1K tokens | 1,000 questions x 200 output tokens, in 1K tokens | 0.66 | - | 0.66 |
| `bedrock.guardrail.sensitive-information` | 6,000 | TextUnit | 1,000 questions x 6 text units | 0.60 | - | 0.60 |
| `lambda.request.arm` | 1,000 | Requests | one invocation per question | 0.000200 | 1,000,000 | 0 |
| `lambda.duration.arm` | 2,000 | Lambda-GB-Second | 1,000 x 8 s x 0.25 GB | 0.03 | 400,000 | 0 |
| `dynamodb.write.on-demand` | 2,000 | WriteRequestUnits | 1,000 x 2 write request units | 0.001430 | - | 0.001430 |
| `dynamodb.read.on-demand` | 3,000 | ReadRequestUnits | 1,000 x 3 read request units | 0.000427 | - | 0.000427 |
| `logs.ingest.standard` | 0.001 | GB | 1,000 x 1 KB, in GB | 0.000725 | 5 | 0 |

- 定価の小計: **USD 2.88** / 月
- 毎月の無料枠適用後の小計: **USD 2.85** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.guardrail.sensitive-information`, `bedrock.nova-2-lite.input`, `bedrock.nova-2-lite.output`

## prompt caching の損得: 2,000 token の同じ先頭を 4 回送る会話を月 1,000 回、キャッシュなし（Nova 2 Lite）

ID: `bedrock-prefix-uncached-nova-2-lite` / 章: [36 Bedrock: tool use、構造化出力、Guardrails、prompt caching、inference profile、batch](/ja/chapters/36-bedrock.md)

前提:

- 先頭の 2,000 token の分だけ。残りの入力と出力は含まない
- 4 回とも通常の入力として課金

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input` | 8,000 | 1K tokens | 1,000 x 4 x 2,000 tokens, in 1K tokens | 3.17 | - | 3.17 |

- 定価の小計: **USD 3.17** / 月
- 毎月の無料枠適用後の小計: **USD 3.17** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.nova-2-lite.input`

## prompt caching の損得: 同じ会話、キャッシュあり（Nova 2 Lite）

ID: `bedrock-prefix-cached-nova-2-lite` / 章: [36 Bedrock: tool use、構造化出力、Guardrails、prompt caching、inference profile、batch](/ja/chapters/36-bedrock.md)

前提:

- 1 回目が書き込み、2〜4 回目が読み出しになったと仮定（キャッシュに当たる保証はない）
- 各回が前の回から 5 分以内と仮定

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.cache-write` | 2,000 | 1K tokens | 1,000 x 1 x 2,000 tokens, in 1K tokens | 0 | - | 0 |
| `bedrock.nova-2-lite.cache-read` | 6,000 | 1K tokens | 1,000 x 3 x 2,000 tokens, in 1K tokens | 0.59 | - | 0.59 |

- 定価の小計: **USD 0.59** / 月
- 毎月の無料枠適用後の小計: **USD 0.59** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.nova-2-lite.cache-read`, `bedrock.nova-2-lite.cache-write`

## prompt caching の損得: 5,000 token の同じ先頭を 4 回送る会話を月 1,000 回、キャッシュなし（Claude Haiku 4.5）

ID: `bedrock-prefix-uncached-claude-haiku-4-5` / 章: [36 Bedrock: tool use、構造化出力、Guardrails、prompt caching、inference profile、batch](/ja/chapters/36-bedrock.md)

前提:

- 先頭の 5,000 token の分だけ（このモデルの下限は 4,096 token）
- 4 回とも通常の入力として課金

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.claude-haiku-4-5.input` | 20 | 1M tokens | 1,000 x 4 x 5,000 tokens, in 1M tokens | 22.00 | - | 22.00 |

- 定価の小計: **USD 22.00** / 月
- 毎月の無料枠適用後の小計: **USD 22.00** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.claude-haiku-4-5.input`

## prompt caching の損得: 同じ会話、キャッシュあり（Claude Haiku 4.5）

ID: `bedrock-prefix-cached-claude-haiku-4-5` / 章: [36 Bedrock: tool use、構造化出力、Guardrails、prompt caching、inference profile、batch](/ja/chapters/36-bedrock.md)

前提:

- 1 回目が書き込み（5 分の TTL）、2〜4 回目が読み出しになったと仮定（キャッシュに当たる保証はない）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.claude-haiku-4-5.cache-write` | 5 | 1M tokens | 1,000 x 1 x 5,000 tokens, in 1M tokens | 6.88 | - | 6.88 |
| `bedrock.claude-haiku-4-5.cache-read` | 15 | 1M tokens | 1,000 x 3 x 5,000 tokens, in 1M tokens | 1.65 | - | 1.65 |

- 定価の小計: **USD 8.53** / 月
- 毎月の無料枠適用後の小計: **USD 8.53** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.claude-haiku-4-5.cache-read`, `bedrock.claude-haiku-4-5.cache-write`

## 要約 10,000 件を on-demand で（Nova 2 Lite、推論の分だけ）

ID: `bedrock-summaries-on-demand-nova-2-lite` / 章: [36 Bedrock: tool use、構造化出力、Guardrails、prompt caching、inference profile、batch](/ja/chapters/36-bedrock.md)

前提:

- 1 件あたり入力 2,000 token、出力 150 token と仮定（17章と同じ仮定）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input` | 20,000 | 1K tokens | 10,000 x 2,000 tokens, in 1K tokens | 7.92 | - | 7.92 |
| `bedrock.nova-2-lite.output` | 1,500 | 1K tokens | 10,000 x 150 tokens, in 1K tokens | 4.97 | - | 4.97 |

- 定価の小計: **USD 12.89** / 月
- 毎月の無料枠適用後の小計: **USD 12.89** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.nova-2-lite.input`, `bedrock.nova-2-lite.output`

## 同じ 10,000 件を batch inference で（Nova 2 Lite、推論の分だけ）

ID: `bedrock-summaries-batch-nova-2-lite` / 章: [36 Bedrock: tool use、構造化出力、Guardrails、prompt caching、inference profile、batch](/ja/chapters/36-bedrock.md)

前提:

- token 数は on-demand と同じと仮定
- S3 の保存とリクエストの料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input.batch` | 20,000 | 1K tokens | 10,000 x 2,000 tokens, in 1K tokens | 3.96 | - | 3.96 |
| `bedrock.nova-2-lite.output.batch` | 1,500 | 1K tokens | 10,000 x 150 tokens, in 1K tokens | 2.48 | - | 2.48 |

- 定価の小計: **USD 6.44** / 月
- 毎月の無料枠適用後の小計: **USD 6.44** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.nova-2-lite.input.batch`, `bedrock.nova-2-lite.output.batch`

## データの移動: 何も変わらない 1 か月（Basic モード、毎日 1 回の実行）

ID: `move-quiet-month` / 章: [38 Data Movement: DataSync、Data Pipeline のいま、データを運ぶ手段の選び方](/ja/chapters/38-data-movement.md)

前提:

- 添付は 10,000 個で合計 10 GB。キーは 07章の形（`u/<owner>/<note>/<attachment>`）で、所有者 100 人、ノート 1,000 件。フォルダーにあたるプレフィックスは 1,101 個
- 実行は 30 回。どの実行も、コピーするものがない
- リクエストの数は仮定。実行 1 回につき、両側でプレフィックスごとに LIST を 1 回、オブジェクトごとに HEAD を 1 回、ソース側でオブジェクトごとにタグの GET を 1 回と数えた。ドキュメントは回数を示していない
- バケットの保存料、ログ、Lambda、SNS は含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `datasync.basic.gb.osaka` | 0 | GB | nothing copied | 0 | - | 0 |
| `s3.request.tier1` | 33,030 | Requests | source LIST: 1,101 prefixes x 30 executions | 0.16 | - | 0.16 |
| `s3.request.tier1.osaka` | 33,030 | Requests | archive LIST: 1,101 prefixes x 30 executions | 0.16 | - | 0.16 |
| `s3.request.tier2` | 600,000 | Requests | source HEAD and tagging GET: 2 x 10,000 objects x 30 executions | 0.22 | - | 0.22 |
| `s3.request.tier2.osaka` | 300,000 | Requests | archive HEAD: 10,000 objects x 30 executions | 0.11 | - | 0.11 |

- 定価の小計: **USD 0.64** / 月
- 毎月の無料枠適用後の小計: **USD 0.64** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.request.tier1`, `s3.request.tier2`, `datasync.basic.gb.osaka`

## データの移動: 最初の 1 回（10 GB を東京から大阪へ）と、写しの 1 か月の保存料

ID: `move-first-copy` / 章: [38 Data Movement: DataSync、Data Pipeline のいま、データを運ぶ手段の選び方](/ja/chapters/38-data-movement.md)

前提:

- 添付は 10,000 個で合計 10 GB。キーは 07章の形（`u/<owner>/<note>/<attachment>`）で、所有者 100 人、ノート 1,000 件。フォルダーにあたるプレフィックスは 1,101 個
- 実行は 1 回で、全部をコピーする。Basic モード
- リクエストの数は仮定。ソース側は LIST 1,101、HEAD 10,000、GET 10,000、タグの GET 20,000。アーカイブ側は LIST 1,101、PUT 10,000、検証の HEAD 10,000。1 個は 1 回の PUT で書かれるとした
- リージョン間のデータ転送は、ソースのリージョンから出る料金として数えた
- アーカイブの保存料は S3 Standard で 10 GB を 1 か月ぶん

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `datasync.basic.gb.osaka` | 10 | GB | 10 GB copied | 0.13 | - | 0.13 |
| `datatransfer.tokyo-osaka` | 10 | GB | 10 GB from Tokyo to Osaka | 0.90 | - | 0.90 |
| `s3.request.tier1` | 1,101 | Requests | source LIST | 0.01 | - | 0.01 |
| `s3.request.tier2` | 40,000 | Requests | source HEAD, GET, and tagging GET | 0.01 | - | 0.01 |
| `s3.request.tier1.osaka` | 11,101 | Requests | archive LIST and PUT | 0.05 | - | 0.05 |
| `s3.request.tier2.osaka` | 10,000 | Requests | archive HEAD | 0.003700 | - | 0.003700 |
| `s3.standard.storage.osaka` | 10 | GB-Mo | 10 GB in the archive, in GB-month | 0.25 | - | 0.25 |

- 定価の小計: **USD 1.35** / 月
- 毎月の無料枠適用後の小計: **USD 1.35** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.request.tier1`, `s3.request.tier2`, `datatransfer.tokyo-osaka`, `datasync.basic.gb.osaka`

## データの移動: 同じ 1 か月を Enhanced モードで実行した場合の実行料

ID: `move-enhanced-month` / 章: [38 Data Movement: DataSync、Data Pipeline のいま、データを運ぶ手段の選び方](/ja/chapters/38-data-movement.md)

前提:

- 毎日 1 回、30 回の実行。コピーするものがない実行にも実行料がかかると仮定した。料金ページは、そうだとも違うとも書いていない
- S3 のリクエストは含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `datasync.enhanced.execution.osaka` | 30 | Task-Executions | 30 task executions | 16.50 | - | 16.50 |
| `datasync.enhanced.gb.osaka` | 0 | GB | nothing copied | 0 | - | 0 |

- 定価の小計: **USD 16.50** / 月
- 毎月の無料枠適用後の小計: **USD 16.50** / 月
- 無料枠を確認できず、何も引いていない単価: `datasync.enhanced.gb.osaka`, `datasync.enhanced.execution.osaka`

## Database Migration: スタックを置いただけの 1 か月（レプリケーションは一度も開始しない）

ID: `dbmig-idle` / 章: [39 Database Migration: DMS、full load、CDC、切り替え](/ja/chapters/39-database-migration.md)

前提:

- 既定のスタック。シークレットが 2 つ。レプリケーションの設定は作るが、開始しない
- 2 つのデータベース、11章の VPC とそのエンドポイントは含めない
- 開始していない設定に DCU の課金がないことは、料金ページとユーザーガイドの記述から読んだもので、請求では確かめていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `secretsmanager.secret` | 2 | Secrets | 2 secrets for a month | 0.80 | - | 0.80 |

- 定価の小計: **USD 0.80** / 月
- 毎月の無料枠適用後の小計: **USD 0.80** / 月
- 無料枠を確認できず、何も引いていない単価: `secretsmanager.secret`

## Database Migration: 1 DCU で 1 週間動かして切り替える

ID: `dbmig-week` / 章: [39 Database Migration: DMS、full load、CDC、切り替え](/ja/chapters/39-database-migration.md)

前提:

- レプリケーションが 168 時間、ずっと 1 DCU（Single-AZ）で動く。スケールアップしない
- Secrets Manager のインターフェースエンドポイントを 2 つのサブネットに 168 時間置く
- シークレット 2 つは 1 か月分。2 つのデータベース、データ転送、ログは含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dms.serverless.dcu1.hour` | 168 | DCU-Hr | 168 hours at 1 DCU | 19.22 | - | 19.22 |
| `vpc.endpoint.interface.hour` | 336 | Hrs | 1 interface endpoint x 2 subnets x 168 hours | 4.70 | - | 4.70 |
| `secretsmanager.secret` | 2 | Secrets | 2 secrets for a month | 0.80 | - | 0.80 |

- 定価の小計: **USD 24.73** / 月
- 毎月の無料枠適用後の小計: **USD 24.73** / 月
- 無料枠を確認できず、何も引いていない単価: `dms.serverless.dcu1.hour`, `secretsmanager.secret`

## Database Migration: 切り替えのあと、レプリケーションを止め忘れた 1 か月

ID: `dbmig-forgotten` / 章: [39 Database Migration: DMS、full load、CDC、切り替え](/ja/chapters/39-database-migration.md)

前提:

- レプリケーションが 730 時間、1 DCU（Single-AZ）で動き続ける
- Secrets Manager のインターフェースエンドポイントを 2 つのサブネットに 730 時間
- シークレット 2 つ。データベースは含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dms.serverless.dcu1.hour` | 730 | DCU-Hr | 730 hours at 1 DCU | 83.52 | - | 83.52 |
| `vpc.endpoint.interface.hour` | 1,460 | Hrs | 1 interface endpoint x 2 subnets x 730 hours | 20.44 | - | 20.44 |
| `secretsmanager.secret` | 2 | Secrets | 2 secrets for a month | 0.80 | - | 0.80 |

- 定価の小計: **USD 104.76** / 月
- 毎月の無料枠適用後の小計: **USD 104.76** / 月
- 無料枠を確認できず、何も引いていない単価: `dms.serverless.dcu1.hour`, `secretsmanager.secret`

## Database Migration: 比較。レプリケーションインスタンス（dms.t3.micro）を置いただけの 1 か月

ID: `dbmig-instance-idle` / 章: [39 Database Migration: DMS、full load、CDC、切り替え](/ja/chapters/39-database-migration.md)

前提:

- この章のスタックは作らない構成。Single-AZ の dms.t3.micro を 730 時間。タスクは 1 つも動かさない
- 付属の 50 GB を超えるストレージは足さない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dms.instance.t3.micro.hour` | 730 | Hrs | 730 instance hours | 20.44 | - | 20.44 |

- 定価の小計: **USD 20.44** / 月
- 毎月の無料枠適用後の小計: **USD 20.44** / 月
- 無料枠を確認できず、何も引いていない単価: `dms.instance.t3.micro.hour`

## DRS: private subnet で 1 台を 1 か月保護したまま

ID: `dr-private-idle` / 章: [40 Disaster Recovery: Elastic Disaster Recovery（DRS）、復旧訓練、failback](/ja/chapters/40-disaster-recovery.md)

前提:

- 23章のインスタンス 1 台を source server として保護したまま、訓練はしない 730 時間。23章と 11章の料金は含まない
- replication server は既定の t3.small が 1 台。staging の disk は、source の disk と同じ大きさ（root 8 GiB は 23章の仮定、data 8 GiB）で、125 GiB 以下なので magnetic
- snapshot は、料金ページの「source の disk と同じ大きさの base snapshot」をそのまま 16 GB として計上。増分の snapshot は変更量しだいで、未算入
- 未算入で金額が不明なもの: replication server 自身の root volume、magnetic volume の I/O リクエスト、endpoint のデータ処理、AZ をまたぐデータ転送、t3 の余剰 CPU credit
- staging は 2 つ目の AZ の private subnet。この章の stack が interface endpoint を 2 つ（drs、ec2）、その AZ にだけ置く

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `drs.source-server.hour` | 730 | Replication-hour | 1 replicating source server x 730 hours | 20.44 | - | 20.44 |
| `ec2.t3-small.linux.hour` | 730 | Hrs | 1 t3.small replication server x 730 hours | 19.86 | - | 19.86 |
| `ebs.magnetic.storage` | 16 | GB-Mo | 16 GiB of staging disks (magnetic), 730 of 730 hours | 1.28 | - | 1.28 |
| `ebs.snapshot.storage` | 16 | GB-Mo | base snapshots the size of the source disks, 16 GB, 730 of 730 hours | 0.80 | - | 0.80 |
| `vpc.endpoint.interface.hour` | 1,460 | Hrs | 2 interface endpoints (drs, ec2) x 1 zone x 730 hours | 20.44 | - | 20.44 |

- 定価の小計: **USD 62.82** / 月
- 毎月の無料枠適用後の小計: **USD 62.82** / 月
- 無料枠を確認できず、何も引いていない単価: `drs.source-server.hour`, `ec2.t3-small.linux.hour`, `ebs.magnetic.storage`

## DRS: public subnet で 1 台を 1 か月保護したまま

ID: `dr-public-idle` / 章: [40 Disaster Recovery: Elastic Disaster Recovery（DRS）、復旧訓練、failback](/ja/chapters/40-disaster-recovery.md)

前提:

- 23章のインスタンス 1 台を source server として保護したまま、訓練はしない 730 時間。23章と 11章の料金は含まない
- replication server は既定の t3.small が 1 台。staging の disk は、source の disk と同じ大きさ（root 8 GiB は 23章の仮定、data 8 GiB）で、125 GiB 以下なので magnetic
- snapshot は、料金ページの「source の disk と同じ大きさの base snapshot」をそのまま 16 GB として計上。増分の snapshot は変更量しだいで、未算入
- 未算入で金額が不明なもの: replication server 自身の root volume、magnetic volume の I/O リクエスト、endpoint のデータ処理、AZ をまたぐデータ転送、t3 の余剰 CPU credit
- `-c placement=public`。endpoint は作らず、replication server が public IPv4 address を 1 つ持つ

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `drs.source-server.hour` | 730 | Replication-hour | 1 replicating source server x 730 hours | 20.44 | - | 20.44 |
| `ec2.t3-small.linux.hour` | 730 | Hrs | 1 t3.small replication server x 730 hours | 19.86 | - | 19.86 |
| `ebs.magnetic.storage` | 16 | GB-Mo | 16 GiB of staging disks (magnetic), 730 of 730 hours | 1.28 | - | 1.28 |
| `ebs.snapshot.storage` | 16 | GB-Mo | base snapshots the size of the source disks, 16 GB, 730 of 730 hours | 0.80 | - | 0.80 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 public IPv4 address on the replication server x 730 hours | 3.65 | - | 3.65 |

- 定価の小計: **USD 46.03** / 月
- 毎月の無料枠適用後の小計: **USD 46.03** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `drs.source-server.hour`, `ec2.t3-small.linux.hour`, `ebs.magnetic.storage`

## DRS: 訓練のインスタンスを 2 時間置く

ID: `dr-drill-2h` / 章: [40 Disaster Recovery: Elastic Disaster Recovery（DRS）、復旧訓練、failback](/ja/chapters/40-disaster-recovery.md)

前提:

- t4g.micro の訓練用インスタンス 1 台と、16 GiB の volume を 2 時間。volume の種類は launch template が決めるので、gp3 は仮定
- launch のたびに数分動く conversion server は未算入。料金ページは 1 回あたりおおむね USD 0.05 未満としている

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-micro.linux.hour` | 2 | Hrs | 1 t4g.micro drill instance x 2 hours | 0.02 | - | 0.02 |
| `ebs.gp3.storage` | 0.044 | GB-Mo | 16 GiB of volumes (gp3 assumed), 2 of 730 hours | 0.004208 | - | 0.004208 |

- 定価の小計: **USD 0.03** / 月
- 毎月の無料枠適用後の小計: **USD 0.03** / 月
- 無料枠を確認できず、何も引いていない単価: `ec2.t4g-micro.linux.hour`, `ebs.gp3.storage`

## Fargate: 既定の構成を置いたまま 1 か月

ID: `fargate-idle` / 章: [41 Fargate: task の大きさ、Spot、auto scaling、定期実行、ECS Exec](/ja/chapters/41-fargate.md)

前提:

- タスク 2 つ（0.25 vCPU、0.5 GB、arm64、オンデマンド）をパブリックサブネットで 730 時間
- ALB 1 つを 730 時間、パブリック IPv4 アドレスは ALB のノード 2 つとタスク 2 つで 4 つ。LCU は未算入
- 夜間のジョブは 1 日 1 回、最低課金の 60 秒ぶんをオンデマンドの単価で計算（Spot の単価は Price List に無い）。ジョブのパブリック IPv4 は 1 か月で 0.5 時間ぶんで、未算入
- リポジトリに 0.1 GB（仮定）、Scheduler の呼び出し 30 回
- ログ、データ転送、auto scaling で増えたタスクは未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 365.125 | hours | 2 tasks x 0.25 vCPU x 730 hours; nightly job: 30 runs x 60 s, 30 tasks x 0.25 vCPU x 0.016666666666666666 hours | 14.77 | - | 14.77 |
| `fargate.arm.memory.gb-hour` | 730.25 | hours | 2 tasks x 0.5 GB x 730 hours; nightly job: 30 runs x 60 s, 30 tasks x 0.5 GB x 0.016666666666666666 hours | 3.23 | - | 3.23 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,920 | Hrs | (2 load balancer nodes + 2 tasks) x 730 hours | 14.60 | - | 14.60 |
| `ecr.storage` | 0.1 | GB-Mo | one image, assumed 0.1 GB | 0.01 | - | 0.01 |
| `scheduler.invocation` | 30 | Invocations | 30 invocations | 0 | - | 0 |

- 定価の小計: **USD 50.35** / 月
- 毎月の無料枠適用後の小計: **USD 50.35** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `ecr.storage`

## Fargate: 既定の構成を 1 日

ID: `fargate-one-day` / 章: [41 Fargate: task の大きさ、Spot、auto scaling、定期実行、ECS Exec](/ja/chapters/41-fargate.md)

前提:

- fargate-idle と同じ構成を 24 時間。ジョブは 1 回
- イメージの保存と Scheduler は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 12.004 | hours | 2 tasks x 0.25 vCPU x 24 hours; nightly job: 1 runs x 60 s, 1 tasks x 0.25 vCPU x 0.016666666666666666 hours | 0.49 | - | 0.49 |
| `fargate.arm.memory.gb-hour` | 24.008 | hours | 2 tasks x 0.5 GB x 24 hours; nightly job: 1 runs x 60 s, 1 tasks x 0.5 GB x 0.016666666666666666 hours | 0.11 | - | 0.11 |
| `alb.hour` | 24 | Hrs | 1 load balancer x 24 hours | 0.58 | - | 0.58 |
| `vpc.public-ipv4.in-use.hour` | 96 | Hrs | (2 load balancer nodes + 2 tasks) x 24 hours | 0.48 | - | 0.48 |

- 定価の小計: **USD 1.65** / 月
- 毎月の無料枠適用後の小計: **USD 1.65** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`

## Fargate: auto scaling の上限（タスク 6 つ）のまま 1 か月

ID: `fargate-ceiling` / 章: [41 Fargate: task の大きさ、Spot、auto scaling、定期実行、ECS Exec](/ja/chapters/41-fargate.md)

前提:

- タスク 6 つがすべてオンデマンドの単価で 730 時間動いたとした上限。実際には 3 つが Spot で、Spot の単価は Price List に無い
- パブリック IPv4 アドレスは ALB 2 + タスク 6
- そのほかは fargate-idle と同じ

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 1,095.125 | hours | 6 tasks x 0.25 vCPU x 730 hours; nightly job: 30 runs x 60 s, 30 tasks x 0.25 vCPU x 0.016666666666666666 hours | 44.30 | - | 44.30 |
| `fargate.arm.memory.gb-hour` | 2,190.25 | hours | 6 tasks x 0.5 GB x 730 hours; nightly job: 30 runs x 60 s, 30 tasks x 0.5 GB x 0.016666666666666666 hours | 9.68 | - | 9.68 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 5,840 | Hrs | (2 load balancer nodes + 6 tasks) x 730 hours | 29.20 | - | 29.20 |
| `ecr.storage` | 0.1 | GB-Mo | one image, assumed 0.1 GB | 0.01 | - | 0.01 |
| `scheduler.invocation` | 30 | Invocations | 30 invocations | 0 | - | 0 |

- 定価の小計: **USD 100.93** / 月
- 毎月の無料枠適用後の小計: **USD 100.93** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `ecr.storage`

## 比較: 1 秒に 20 件が 1 か月続く負荷を Lambda で

ID: `fargate-vs-steady-lambda` / 章: [41 Fargate: task の大きさ、Spot、auto scaling、定期実行、ECS Exec](/ja/chapters/41-fargate.md)

前提:

- 1 秒に 20 件が 24 時間、30 日。5,184 万リクエスト
- 04章の形: HTTP API と arm64 の Lambda、メモリ 512 MB、1 リクエスト平均 50 ms
- ログ、データ転送、DynamoDB などは未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 51,840,000 | Requests | 51840000 requests | 66.87 | - | 66.87 |
| `lambda.request.arm` | 51,840,000 | Requests | 51840000 requests | 10.37 | 1,000,000 | 10.17 |
| `lambda.duration.arm` | 1,296,000 | Lambda-GB-Second | 51840000 requests x 50 ms x 0.5 GB | 17.28 | 400,000 | 11.95 |

- 定価の小計: **USD 94.52** / 月
- 毎月の無料枠適用後の小計: **USD 88.99** / 月
- 無料枠を確認できず、何も引いていない単価: `apigw.http.request`

## 比較: 1 秒に 20 件が 1 か月続く負荷を Fargate で

ID: `fargate-vs-steady-fargate` / 章: [41 Fargate: task の大きさ、Spot、auto scaling、定期実行、ECS Exec](/ja/chapters/41-fargate.md)

前提:

- 1 秒に 20 件が 24 時間、30 日。タスク 2 つを 730 時間
- 12章の形: タスク（0.25 vCPU、0.5 GB、arm64、オンデマンド）をパブリックサブネットに置き、ALB を前に置く
- LCU は 1 リクエスト 1 接続として新規接続数で計算
- タスク 2 つでこのリクエスト数に答えられるかどうかは計っていない（仮定）
- ログ、データ転送、イメージの保存は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 365 | hours | 2 tasks x 0.25 vCPU x 730 hours | 14.76 | - | 14.76 |
| `fargate.arm.memory.gb-hour` | 730 | hours | 2 tasks x 0.5 GB x 730 hours | 3.23 | - | 3.23 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `alb.lcu.hour` | 576 | LCU-Hrs | 20 new connections/s / 25 x 720 hours | 4.61 | - | 4.61 |
| `vpc.public-ipv4.in-use.hour` | 2,920 | Hrs | (2 load balancer nodes + 2 tasks) x 730 hours + 0 tasks x 720 hours | 14.60 | - | 14.60 |

- 定価の小計: **USD 54.94** / 月
- 毎月の無料枠適用後の小計: **USD 54.94** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `alb.lcu.hour`

## 比較: 同じ負荷を EC2 の t4g.small 2 台で

ID: `fargate-vs-steady-ec2` / 章: [41 Fargate: task の大きさ、Spot、auto scaling、定期実行、ECS Exec](/ja/chapters/41-fargate.md)

前提:

- 23章の t4g.small を 2 台、それぞれ gp3 の 8 GB、パブリックサブネット、同じ ALB の後ろ
- OS の更新、コンテナの入れ替え、台数の調整を自分で持つ費用は金額に入っていない
- t4g の CPU クレジットの追加課金、ログ、データ転送、スナップショットは未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-small.linux.hour` | 1,460 | Hrs | 2 instances x 730 hours | 31.54 | - | 31.54 |
| `ebs.gp3.storage` | 16 | GB-Mo | 2 volumes x 8 GB | 1.54 | - | 1.54 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `alb.lcu.hour` | 576 | LCU-Hrs | 20 new connections/s / 25 x 720 hours | 4.61 | - | 4.61 |
| `vpc.public-ipv4.in-use.hour` | 2,920 | Hrs | (2 load balancer nodes + 2 instances) x 730 hours | 14.60 | - | 14.60 |

- 定価の小計: **USD 70.02** / 月
- 毎月の無料枠適用後の小計: **USD 70.02** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `alb.hour`, `alb.lcu.hour`, `ebs.gp3.storage`

## 比較: 1 日 2 時間だけ 1 秒に 20 件の負荷を Lambda で

ID: `fargate-vs-spiky-lambda` / 章: [41 Fargate: task の大きさ、Spot、auto scaling、定期実行、ECS Exec](/ja/chapters/41-fargate.md)

前提:

- 1 秒に 20 件が 1 日 2 時間、30 日。432 万リクエスト。残りの 22 時間は 0 件
- 04章の形: HTTP API と arm64 の Lambda、メモリ 512 MB、1 リクエスト平均 50 ms
- ログ、データ転送、DynamoDB などは未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 4,320,000 | Requests | 4320000 requests | 5.57 | - | 5.57 |
| `lambda.request.arm` | 4,320,000 | Requests | 4320000 requests | 0.86 | 1,000,000 | 0.66 |
| `lambda.duration.arm` | 108,000 | Lambda-GB-Second | 4320000 requests x 50 ms x 0.5 GB | 1.44 | 400,000 | 0 |

- 定価の小計: **USD 7.88** / 月
- 毎月の無料枠適用後の小計: **USD 6.24** / 月
- 無料枠を確認できず、何も引いていない単価: `apigw.http.request`

## 比較: 1 日 2 時間だけ 1 秒に 20 件の負荷を Fargate で

ID: `fargate-vs-spiky-fargate` / 章: [41 Fargate: task の大きさ、Spot、auto scaling、定期実行、ECS Exec](/ja/chapters/41-fargate.md)

前提:

- タスク 2 つを 730 時間、忙しい 2 時間だけ auto scaling がさらに 2 つ足すとした
- 12章の形: タスク（0.25 vCPU、0.5 GB、arm64、オンデマンド）をパブリックサブネットに置き、ALB を前に置く
- LCU は 1 リクエスト 1 接続として新規接続数で計算
- ログ、データ転送、イメージの保存は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 395 | hours | 2 tasks x 0.25 vCPU x 730 hours + 2 tasks x 0.25 vCPU x 60 hours | 15.98 | - | 15.98 |
| `fargate.arm.memory.gb-hour` | 790 | hours | 2 tasks x 0.5 GB x 730 hours + 2 tasks x 0.5 GB x 60 hours | 3.49 | - | 3.49 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `alb.lcu.hour` | 48 | LCU-Hrs | 20 new connections/s / 25 x 60 hours | 0.38 | - | 0.38 |
| `vpc.public-ipv4.in-use.hour` | 3,040 | Hrs | (2 load balancer nodes + 2 tasks) x 730 hours + 2 tasks x 60 hours | 15.20 | - | 15.20 |

- 定価の小計: **USD 52.79** / 月
- 毎月の無料枠適用後の小計: **USD 52.79** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `alb.lcu.hour`

## Firewall Manager: 2 つのポリシーを 1 か月置いただけ（範囲に入るリソースが無い）

ID: `fwm-policies-only` / 章: [42 Firewall Manager: 複数アカウントの WAF、security group、Network Firewall をまとめて管理する](/ja/chapters/42-firewall-manager.md)

前提:

- AihFirewallManager と AihFirewallManagerEdge を何も変えずにデプロイした状態。自動修復はどちらも無効
- 範囲に入る OU に、CloudFront のディストリビューションもセキュリティグループも無い。web ACL は作られないと仮定（optimizeUnassociatedWebACL が true のため）
- ポリシーの料金は 1 か月ぶん。月の途中で消したときに日割りになるかどうかは確認していない
- CloudFront 用の AWS WAF ポリシーが、Price List のどの usage type（Policy-WAF、USE1-Policy-WAF、Policy）で請求されるかは確認していない。3 つとも USD 100
- 前提になる AWS Config の料金、Security Hub CSPM、通知用の Lambda・SNS・EventBridge・CloudWatch Logs は含めていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fms.policy.global.wafv2` | 1 | Month | 1 AWS WAF policy for CloudFront (Global) | 100.00 | - | 100.00 |
| `fms.policy.apne1.sg-content-audit` | 1 | Month | 1 security group content audit policy in ap-northeast-1 | 100.00 | - | 100.00 |

- 定価の小計: **USD 200.00** / 月
- 毎月の無料枠適用後の小計: **USD 200.00** / 月
- 無料枠を確認できず、何も引いていない単価: `fms.policy.global.wafv2`, `fms.policy.apne1.sg-content-audit`

## Firewall Manager: アカウント 5 つの組織で、2 つのポリシーを 1 か月

ID: `fwm-small-org` / 章: [42 Firewall Manager: 複数アカウントの WAF、security group、Network Firewall をまとめて管理する](/ja/chapters/42-firewall-manager.md)

前提:

- 組織は、管理アカウント、Firewall Manager の管理者アカウント、ワークロードのアカウント 3 つ（dev、staging、prod）。ポリシーの範囲は、ワークロードの 3 つが入る OU
- 3 つのアカウントそれぞれに CloudFront のディストリビューションがあり、AWS WAF ポリシーの自動修復を有効にして、アカウントごとに web ACL が 1 つ作られる
- ポリシーのルールグループ 2 つを、web ACL ごとにルール 2 つとして数えた。Firewall Manager がメンバーアカウントの web ACL に置くルールグループの数え方は、請求では確かめていない
- web ACL 1 つあたり月 100 万リクエストを検査
- AWS Config は、ワークロードの 3 つと管理者アカウントの計 4 つで記録する。記録する configuration item は、us-east-1 でアカウントあたり月 20 件、ap-northeast-1 で月 200 件と仮定。計測値ではない
- ポリシーが作る AWS Config のルールの評価は、範囲に入るアカウントごと、ポリシーごとに月 100 回と仮定。計測値ではない
- 含めていないもの: Security Hub CSPM、AWS Config の記録を置く S3、通知用の Lambda・SNS・EventBridge・CloudWatch Logs。ポリシーの料金が日割りになるかどうかは確認していない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fms.policy.global.wafv2` | 1 | Month | 1 AWS WAF policy for CloudFront (Global) | 100.00 | - | 100.00 |
| `fms.policy.apne1.sg-content-audit` | 1 | Month | 1 security group content audit policy in ap-northeast-1 | 100.00 | - | 100.00 |
| `waf.global.webacl` | 3 | Month | 3 accounts x 1 managed web ACL | 15.00 | - | 15.00 |
| `waf.global.rule` | 6 | Month | 3 web ACLs x 2 rule groups | 6.00 | - | 6.00 |
| `waf.global.request` | 3,000,000 | Request | 3 web ACLs x 1000000 requests inspected | 1.80 | - | 1.80 |
| `config.use1.item.continuous` | 80 | ConfigurationItemRecorded | 4 accounts x 20 items in us-east-1 | 0.24 | - | 0.24 |
| `config.item.continuous` | 800 | APN1-ConfigurationItemRecorded | 4 accounts x 200 items in ap-northeast-1 | 2.40 | - | 2.40 |
| `config.use1.rule.evaluation` | 300 | ConfigRuleEvaluations | 3 accounts x 100 evaluations (AWS WAF policy) | 0.30 | - | 0.30 |
| `config.rule.evaluation` | 300 | ConfigRuleEvaluations | 3 accounts x 100 evaluations (audit policy) | 0.30 | - | 0.30 |

- 定価の小計: **USD 226.04** / 月
- 毎月の無料枠適用後の小計: **USD 226.04** / 月
- 無料枠を確認できず、何も引いていない単価: `fms.policy.global.wafv2`, `fms.policy.apne1.sg-content-audit`, `config.use1.item.continuous`, `config.use1.rule.evaluation`, `config.rule.evaluation`, `waf.global.webacl`, `waf.global.rule`, `waf.global.request`, `config.item.continuous`

## Firewall Manager: Network Firewall のポリシーが作るエンドポイント 1 つを 1 か月（桁をつかむための例）

ID: `fwm-nfw-endpoint` / 章: [42 Firewall Manager: 複数アカウントの WAF、security group、Network Firewall をまとめて管理する](/ja/chapters/42-firewall-manager.md)

前提:

- この章のスタックは Network Firewall のポリシーを作らない。分散型のポリシーが範囲に入る VPC に置くファイアウォールのエンドポイント 1 つぶんの時間料金だけを示す
- 730 時間。処理したデータ量の料金（GB あたり）と、ポリシーそのものの月額は含めていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `networkfirewall.endpoint.hour` | 730 | Hourly | 1 endpoint x 730 hours | 288.35 | - | 288.35 |

- 定価の小計: **USD 288.35** / 月
- 毎月の無料枠適用後の小計: **USD 288.35** / 月
- 無料枠を確認できず、何も引いていない単価: `networkfirewall.endpoint.hour`

## Glue の job: デプロイ済みで 1 回も実行しない月

ID: `glue-idle` / 章: [43 Glue: Data Catalog、crawler、ETL job、Data Quality](/ja/chapters/43-glue.md)

前提:

- job を 1 回も実行しない。trigger は作られているが有効にしていない
- Data Catalog のオブジェクトは、データベース 1 つとテーブル 2 つ
- アラームは 1 つ。アカウントのほかのアラームと合わせて 10 個までは無料枠に入る
- バケットが空。SNS のトピックには購読がなく、配信もない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `glue.catalog.storage` | 3 | Obj-Month | 1 database + 2 tables | 0.000030 | 1,000,000 | 0 |
| `cloudwatch.alarm.standard` | 1 | Alarms | 1 alarm on AWS/Events MatchedEvents | 0.10 | 10 | 0 |

- 定価の小計: **USD 0.10** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## Glue の job: 毎日 1 回、どの run も 1 分以内

ID: `glue-daily-minimum` / 章: [43 Glue: Data Catalog、crawler、ETL job、Data Quality](/ja/chapters/43-glue.md)

前提:

- 30 回の run。G.1X のワーカー 2 つで 2 DPU
- どの run も 60 秒以内に終わり、最低の 1 分ぶんが課金される。run の時間は測っていない。これは下限
- S3 のリクエストと保存、ログは含めていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `glue.etl.dpu-hour` | 1 | DPU-Hour | 30 runs x 2 DPU x 60 s / 3600 | 0.44 | - | 0.44 |

- 定価の小計: **USD 0.44** / 月
- 毎月の無料枠適用後の小計: **USD 0.44** / 月
- 無料枠を確認できず、何も引いていない単価: `glue.etl.dpu-hour`

## Glue の job: 毎日 1 回、どの run も 3 分

ID: `glue-daily-three-minutes` / 章: [43 Glue: Data Catalog、crawler、ETL job、Data Quality](/ja/chapters/43-glue.md)

前提:

- 30 回の run。2 DPU
- どの run も 180 秒ぶん課金されると仮定する。測定した値ではない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `glue.etl.dpu-hour` | 3 | DPU-Hour | 30 runs x 2 DPU x 180 s / 3600 | 1.32 | - | 1.32 |

- 定価の小計: **USD 1.32** / 月
- 毎月の無料枠適用後の小計: **USD 1.32** / 月
- 無料枠を確認できず、何も引いていない単価: `glue.etl.dpu-hour`

## Glue の job: 毎日 1 回、どの run もタイムアウトまで動く

ID: `glue-daily-timeout` / 章: [43 Glue: Data Catalog、crawler、ETL job、Data Quality](/ja/chapters/43-glue.md)

前提:

- 30 回の run。2 DPU
- どの run も、job に設定した 10 分のタイムアウトまで動く。このスタックの設定での上限

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `glue.etl.dpu-hour` | 10 | DPU-Hour | 30 runs x 2 DPU x 600 s / 3600 | 4.40 | - | 4.40 |

- 定価の小計: **USD 4.40** / 月
- 毎月の無料枠適用後の小計: **USD 4.40** / 月
- 無料枠を確認できず、何も引いていない単価: `glue.etl.dpu-hour`

## crawler を毎日 1 回動かした場合（このスタックには無い）

ID: `glue-daily-crawler` / 章: [43 Glue: Data Catalog、crawler、ETL job、Data Quality](/ja/chapters/43-glue.md)

前提:

- 30 回の crawl。どれも最低の 10 分ぶんが課金される
- crawler が使う DPU は 2 と仮定する。料金ページの例の値で、crawler が実際にいくつ使うかは確かめていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `glue.crawler.dpu-hour` | 10 | DPU-Hour | 30 crawls x 2 DPU x 600 s / 3600 | 4.40 | - | 4.40 |

- 定価の小計: **USD 4.40** / 月
- 毎月の無料枠適用後の小計: **USD 4.40** / 月
- 無料枠を確認できず、何も引いていない単価: `glue.crawler.dpu-hour`

## Health の通知: デプロイ済みで、イベントが 1 件も届かない月

ID: `health-idle` / 章: [44 Health: AWS 側の障害とメンテナンスを知る](/ja/chapters/44-health.md)

前提:

- AihHealth（東京）と AihHealthGlobal（バージニア北部）の両方をデプロイ済み
- Health イベントが 1 件も届かない。関数は呼ばれず、テーブルは空で、ログも書かれない
- ルール、空のキュー、空のテーブル、購読者のいるトピックには、置いてあるだけでかかる料金が無い

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 0 | Requests | no invocations | 0 | 1,000,000 | 0 |
| `dynamodb.write.on-demand` | 0 | WriteRequestUnits | no writes | 0 | - | 0 |
| `sns.delivery.email` | 0 | Notifications | no notices | 0 | - | 0 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## Health の通知: イベントが 40 回届く月

ID: `health-month` / 章: [44 Health: AWS 側の障害とメンテナンスを知る](/ja/chapters/44-health.md)

前提:

- 両方のスタックを合わせて、関数が 40 回呼ばれる。数時間続く障害が 1 件（30 分ごとの更新）と、予定された変更や通知が数件、という想定で、実測ではない
- 40 回のうち 30 回が通知になり、10 回は重複か古い更新として捨てられる
- 関数は 256 MB で、1 回あたり 1 秒と仮定（未計測）
- 台帳は 1 回につき強い整合性の読み取り 1 回（1 RRU）、通知 1 件につき書き込み 2 回（2 WRU）。アイテムは 1 KB 未満
- ログは 1 回の呼び出しあたり 2 KB と仮定（Lambda が書く行を含む。未計測）
- us-east-1 のスタックのぶんも、東京の単価で数えている。us-east-1 の単価は調べていない
- 通知のメール 30 通。SQS のデッドレターキューには何も入らない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 40 | Requests | 40 invocations | 0.000008 | 1,000,000 | 0 |
| `lambda.duration.arm` | 10 | Lambda-GB-Second | 40 x 1 s x 0.25 GB, in GB-seconds | 0.000133 | 400,000 | 0 |
| `dynamodb.read.on-demand` | 40 | ReadRequestUnits | 40 strongly consistent reads of an item under 4 KB | 0.000006 | - | 0.000006 |
| `dynamodb.write.on-demand` | 60 | WriteRequestUnits | 30 notices x 2 writes of an item under 1 KB | 0.000043 | - | 0.000043 |
| `sns.request` | 30 | Requests | 30 Publish requests | 0 | - | 0 |
| `sns.delivery.email` | 30 | Notifications | 30 email notifications to one address | 0 | - | 0 |
| `logs.ingest.standard` | 0 | GB | 40 x 2 KB, in GB | 0.000058 | 5 | 0 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## AihShieldEdge を 1 か月置く（リクエストなし）

ID: `shield-edge-month` / 章: [46 Shield: DDoS への備え、Standard と Advanced](/ja/chapters/46-shield.md)

前提:

- web ACL 1 つ、ルール 1 つ、アラーム 1 つ（参照するメトリクスは 1 つ）
- web ACL が検査したリクエストは 0 件
- Shield Advanced の保護は付けていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `waf.global.webacl` | 1 | Month | 1 web ACL | 5.00 | - | 5.00 |
| `waf.global.rule` | 1 | Month | 1 rate-based rule | 1.00 | - | 1.00 |
| `cloudwatch.alarm.standard.use1` | 1 | Alarms | 1 alarm on 1 metric, in us-east-1 | 0.10 | - | 0.10 |

- 定価の小計: **USD 6.10** / 月
- 毎月の無料枠適用後の小計: **USD 6.10** / 月
- 無料枠を確認できず、何も引いていない単価: `cloudwatch.alarm.standard.use1`, `waf.global.webacl`, `waf.global.rule`

## Shield Advanced を契約した 1 か月（データ転送なし）

ID: `shield-advanced-month` / 章: [46 Shield: DDoS への備え、Standard と Advanced](/ja/chapters/46-shield.md)

前提:

- 契約は 1 年の約束なので、この金額が 12 回かかる
- 保護したディストリビューションの web ACL とルールの月額は Price List で USD 0（Shield Protected の SKU）
- アラームは 2 つ（レートベースのルールと DDoSDetected）
- Shield Advanced のデータ転送料金、SRT を呼ぶのに要るサポートプランの料金は含めていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `shield.advanced.subscription` | 1 | month | 1 subscription for the payer account | 3000.00 | - | 3000.00 |
| `cloudwatch.alarm.standard.use1` | 2 | Alarms | 2 alarms on 1 metric each, in us-east-1 | 0.20 | - | 0.20 |

- 定価の小計: **USD 3000.20** / 月
- 毎月の無料枠適用後の小計: **USD 3000.20** / 月
- 無料枠を確認できず、何も引いていない単価: `shield.advanced.subscription`, `cloudwatch.alarm.standard.use1`

## 洪水の 1 時間: 20 アドレスから、防御なし

ID: `shield-flood-few-open` / 章: [46 Shield: DDoS への備え、Standard と Advanced](/ja/chapters/46-shield.md)

前提:

- 攻撃は 20 アドレスから各毎秒 250 件。web ACL もブレーキもキャッシュも無い
- 1 時間。利用者は 200 アドレスから合計で毎秒 100 件、うち 2 割がキャッシュできるルート
- 攻撃は 5 分目から 55 分目まで、合計で毎秒 5,000 件
- 応答 1 件は 1,024 バイト、関数の実行は 256 MB で 50 ms と仮定（計測値ではない）
- エッジは日本の料金。ブレーキが返した 429 のバイト数と、断られた呼び出しの Lambda 料金は数えていない
- examples/46-shield/src/flood.ts のモデルの出力で、実測ではない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 15,360,000 | Requests | 15360000 requests CloudFront answered or passed on | 18.43 | 10,000,000 | 6.43 |
| `cloudfront.jp.transfer` | 14.648 | GB | 15360000 answers x 1024 bytes | 1.67 | 1,024 | 0 |
| `lambda.request.arm` | 15,360,000 | Requests | 15360000 invocations | 3.07 | 1,000,000 | 2.87 |
| `lambda.duration.arm` | 192,000 | Lambda-GB-Second | 15360000 invocations x 50 ms x 256 MB | 2.56 | 400,000 | 0 |

- 定価の小計: **USD 25.73** / 月
- 毎月の無料枠適用後の小計: **USD 9.30** / 月

## 洪水の 1 時間: 20 アドレスから、レートベースのルール

ID: `shield-flood-few-rule` / 章: [46 Shield: DDoS への備え、Standard と Advanced](/ja/chapters/46-shield.md)

前提:

- 攻撃は 20 アドレスから各毎秒 250 件。ルールは 60 秒で 300 件、気づくまで 30 秒と仮定
- 1 時間。利用者は 200 アドレスから合計で毎秒 100 件、うち 2 割がキャッシュできるルート
- 攻撃は 5 分目から 55 分目まで、合計で毎秒 5,000 件
- 応答 1 件は 1,024 バイト、関数の実行は 256 MB で 50 ms と仮定（計測値ではない）
- エッジは日本の料金。ブレーキが返した 429 のバイト数と、断られた呼び出しの Lambda 料金は数えていない
- examples/46-shield/src/flood.ts のモデルの出力で、実測ではない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 515,000 | Requests | 515000 requests CloudFront answered or passed on | 0.62 | 10,000,000 | 0 |
| `cloudfront.jp.transfer` | 0.491 | GB | 515000 answers x 1024 bytes | 0.06 | 1,024 | 0 |
| `waf.global.request` | 15,360,000 | Request | 15360000 requests inspected, blocked or not | 9.22 | - | 9.22 |
| `lambda.request.arm` | 515,000 | Requests | 515000 invocations | 0.10 | 1,000,000 | 0 |
| `lambda.duration.arm` | 6,437.5 | Lambda-GB-Second | 515000 invocations x 50 ms x 256 MB | 0.09 | 400,000 | 0 |

- 定価の小計: **USD 10.08** / 月
- 毎月の無料枠適用後の小計: **USD 9.22** / 月
- 無料枠を確認できず、何も引いていない単価: `waf.global.request`

## 洪水の 1 時間: 20,000 アドレスから、レートベースのルール

ID: `shield-flood-many-rule` / 章: [46 Shield: DDoS への備え、Standard と Advanced](/ja/chapters/46-shield.md)

前提:

- 攻撃は 20,000 アドレスから各 4 秒に 1 件。どのアドレスもルールの上限に届かない
- 1 時間。利用者は 200 アドレスから合計で毎秒 100 件、うち 2 割がキャッシュできるルート
- 攻撃は 5 分目から 55 分目まで、合計で毎秒 5,000 件
- 応答 1 件は 1,024 バイト、関数の実行は 256 MB で 50 ms と仮定（計測値ではない）
- エッジは日本の料金。ブレーキが返した 429 のバイト数と、断られた呼び出しの Lambda 料金は数えていない
- examples/46-shield/src/flood.ts のモデルの出力で、実測ではない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 15,360,000 | Requests | 15360000 requests CloudFront answered or passed on | 18.43 | 10,000,000 | 6.43 |
| `cloudfront.jp.transfer` | 14.648 | GB | 15360000 answers x 1024 bytes | 1.67 | 1,024 | 0 |
| `waf.global.request` | 15,360,000 | Request | 15360000 requests inspected, blocked or not | 9.22 | - | 9.22 |
| `lambda.request.arm` | 15,360,000 | Requests | 15360000 invocations | 3.07 | 1,000,000 | 2.87 |
| `lambda.duration.arm` | 192,000 | Lambda-GB-Second | 15360000 invocations x 50 ms x 256 MB | 2.56 | 400,000 | 0 |

- 定価の小計: **USD 34.95** / 月
- 毎月の無料枠適用後の小計: **USD 18.52** / 月
- 無料枠を確認できず、何も引いていない単価: `waf.global.request`

## 洪水の 1 時間: 20,000 アドレスから、ルールとブレーキ

ID: `shield-flood-many-brake` / 章: [46 Shield: DDoS への備え、Standard と Advanced](/ja/chapters/46-shield.md)

前提:

- 攻撃は 20,000 アドレスから各 4 秒に 1 件。予約済み同時実行数 20（function URL は毎秒 200 件まで）
- 1 時間。利用者は 200 アドレスから合計で毎秒 100 件、うち 2 割がキャッシュできるルート
- 攻撃は 5 分目から 55 分目まで、合計で毎秒 5,000 件
- 応答 1 件は 1,024 バイト、関数の実行は 256 MB で 50 ms と仮定（計測値ではない）
- エッジは日本の料金。ブレーキが返した 429 のバイト数と、断られた呼び出しの Lambda 料金は数えていない
- examples/46-shield/src/flood.ts のモデルの出力で、実測ではない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 15,360,000 | Requests | 15360000 requests CloudFront answered or passed on | 18.43 | 10,000,000 | 6.43 |
| `cloudfront.jp.transfer` | 0.629 | GB | 660019 answers x 1024 bytes | 0.07 | 1,024 | 0 |
| `waf.global.request` | 15,360,000 | Request | 15360000 requests inspected, blocked or not | 9.22 | - | 9.22 |
| `lambda.request.arm` | 660,019 | Requests | 660019 invocations | 0.13 | 1,000,000 | 0 |
| `lambda.duration.arm` | 8,250.238 | Lambda-GB-Second | 660019 invocations x 50 ms x 256 MB | 0.11 | 400,000 | 0 |

- 定価の小計: **USD 27.96** / 月
- 毎月の無料枠適用後の小計: **USD 15.65** / 月
- 無料枠を確認できず、何も引いていない単価: `waf.global.request`

## 洪水の 1 時間: キャッシュされるルートへ 20,000 アドレスから

ID: `shield-flood-cached-cache` / 章: [46 Shield: DDoS への備え、Standard と Advanced](/ja/chapters/46-shield.md)

前提:

- 攻撃は 20,000 アドレスから各 4 秒に 1 件、すべて /health へ。キャッシュは 5 秒、エッジは 1 か所と仮定
- 1 時間。利用者は 200 アドレスから合計で毎秒 100 件、うち 2 割がキャッシュできるルート
- 攻撃は 5 分目から 55 分目まで、合計で毎秒 5,000 件
- 応答 1 件は 1,024 バイト、関数の実行は 256 MB で 50 ms と仮定（計測値ではない）
- エッジは日本の料金。ブレーキが返した 429 のバイト数と、断られた呼び出しの Lambda 料金は数えていない
- examples/46-shield/src/flood.ts のモデルの出力で、実測ではない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 15,360,000 | Requests | 15360000 requests CloudFront answered or passed on | 18.43 | 10,000,000 | 6.43 |
| `cloudfront.jp.transfer` | 14.648 | GB | 15360000 answers x 1024 bytes | 1.67 | 1,024 | 0 |
| `lambda.request.arm` | 288,720 | Requests | 288720 invocations | 0.06 | 1,000,000 | 0 |
| `lambda.duration.arm` | 3,609 | Lambda-GB-Second | 288720 invocations x 50 ms x 256 MB | 0.05 | 400,000 | 0 |

- 定価の小計: **USD 20.21** / 月
- 毎月の無料枠適用後の小計: **USD 6.43** / 月

## 洪水が 30 日続いたら: 防御なし

ID: `shield-flood-month-open` / 章: [46 Shield: DDoS への備え、Standard と Advanced](/ja/chapters/46-shield.md)

前提:

- 毎秒 5,000 件が 30 日続き、すべてが関数まで届く（129 億 6,000 万件）。利用者のぶんは含めていない
- web ACL もブレーキもキャッシュも無い。モデルは使わず、件数に単価を掛けただけ
- 応答 1 件は 1,024 バイト、関数の実行は 256 MB で 50 ms と仮定（計測値ではない）
- Lambda がこの流量を処理し続けられる前提。アカウントの同時実行数のクォータ（32章）は考慮していない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 12,960,000,000 | Requests | 12960000000 requests CloudFront answered or passed on | 15552.00 | 10,000,000 | 15540.00 |
| `cloudfront.jp.transfer` | 12,359.619 | GB | 12960000000 answers x 1024 bytes | 1356.01 | 1,024 | 1264.87 |
| `lambda.request.arm` | 12,960,000,000 | Requests | 12960000000 invocations | 2592.00 | 1,000,000 | 2591.80 |
| `lambda.duration.arm` | 162,000,000 | Lambda-GB-Second | 12960000000 invocations x 50 ms x 256 MB | 2160.01 | 400,000 | 2154.68 |

- 定価の小計: **USD 21660.02** / 月
- 毎月の無料枠適用後の小計: **USD 21551.35** / 月

## Step Functions: デプロイ済みで、1 回も実行しない月

ID: `sfn-idle` / 章: [47 Step Functions: 状態機械、retry と catch、Map、待ち合わせ、saga](/ja/chapters/47-step-functions.md)

前提:

- ステートマシン、テーブル（オンデマンド）、バケット、キュー、トピック、ロググループは、置いてあるだけでは課金されない
- バケットにもテーブルにも何も入っていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `sfn.standard.transition` | 0 | StateTransitions | no execution started | 0 | 4,000 | 0 |
| `sfn.express.request` | 0 | Requests | no execution started | 0 | - | 0 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月
- 無料枠を確認できず、何も引いていない単価: `sfn.express.request`

## Step Functions: 取り込みを月に 1,000 回（Standard、すべて成功）

ID: `sfn-import-1k` / 章: [47 Step Functions: 状態機械、retry と catch、Map、待ち合わせ、saga](/ja/chapters/47-step-functions.md)

前提:

- 1 回の実行は CreateNote、AttachFile、WaitForScan、Verdict、Publish、Notify、Imported を 1 回ずつ通る。開始と終了を足して状態遷移は 9 と数える（料金ページの例の数え方。実測ではない）
- 再試行、補償処理、redrive は起きない。起きれば、そのぶん状態遷移が増える
- DynamoDB の書き込みは PutItem と UpdateItem の 2 回で、アイテムは 1 KB 以下（1 回 1 unit）
- S3 はアップロードの PUT と、取り込みの COPY が 1 回ずつ
- SQS は、送信、受信、削除が 1 回ずつ。空の受信は数えていない
- 未算入: 添付ファイルの保存料金、通知の配送先ごとの料金、スキャンをする側の料金

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `sfn.standard.transition` | 9,000 | StateTransitions | 1,000 executions x 9 transitions | 0.23 | 4,000 | 0.13 |
| `dynamodb.write.on-demand` | 2,000 | WriteRequestUnits | 1,000 x (PutItem + UpdateItem) | 0.001430 | - | 0.001430 |
| `s3.request.tier1` | 2,000 | Requests | 1,000 x (PUT of the upload + COPY) | 0.01 | - | 0.01 |
| `sqs.request.standard` | 3,000 | Requests | 1,000 x (send + receive + delete) | 0.001200 | 1,000,000 | 0 |
| `sns.request` | 1,000 | Requests | one publish per import | 0 | - | 0 |

- 定価の小計: **USD 0.24** / 月
- 毎月の無料枠適用後の小計: **USD 0.14** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.request.tier1`

## Step Functions: 10 件の照会を月に 100,000 回（Express）

ID: `sfn-digest-express-100k` / 章: [47 Step Functions: 状態機械、retry と catch、Map、待ち合わせ、saga](/ja/chapters/47-step-functions.md)

前提:

- 1 回の実行は 10 件のノートを GetItem で読む。300 ミリ秒かかると仮定（計測した値ではない）
- メモリは 64 MB として課金される（50 MB と、定義と入出力の大きさの合計が 64 MB に収まる）
- GetItem は結果整合で、4 KB 以下のアイテムにつき 0.5 unit
- ログは ERROR だけで、失敗は起きない。ログの取り込みは 0

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `sfn.express.request` | 100,000 | Requests | one request per execution | 0.10 | - | 0.10 |
| `sfn.express.duration` | 1,875 | GB-Seconds | 100,000 x 0.3 s x 0.0625 GB, in GB-seconds | 0.03 | - | 0.03 |
| `dynamodb.read.on-demand` | 500,000 | ReadRequestUnits | 100,000 x 10 GetItem x 0.5 units | 0.07 | - | 0.07 |

- 定価の小計: **USD 0.20** / 月
- 毎月の無料枠適用後の小計: **USD 0.20** / 月
- 無料枠を確認できず、何も引いていない単価: `sfn.express.request`, `sfn.express.duration`

## Step Functions: 同じ照会を Standard で動かしたとき

ID: `sfn-digest-standard-100k` / 章: [47 Step Functions: 状態機械、retry と catch、Map、待ち合わせ、saga](/ja/chapters/47-step-functions.md)

前提:

- 仕事は「10 件の照会を月に 100,000 回（Express）」と同じ
- 状態遷移は、Map が 1、10 回の GetNote が 10、開始と終了で 2、合わせて 13 と数える。Map の繰り返しがどう数えられるかは料金ページに書かれておらず、この数は見積もりで、実測ではない
- Standard は実行の時間には課金されない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `sfn.standard.transition` | 1,300,000 | StateTransitions | 100,000 executions x 13 transitions | 32.50 | 4,000 | 32.40 |
| `dynamodb.read.on-demand` | 500,000 | ReadRequestUnits | 100,000 x 10 GetItem x 0.5 units | 0.07 | - | 0.07 |

- 定価の小計: **USD 32.57** / 月
- 毎月の無料枠適用後の小計: **USD 32.47** / 月

## Athena: デプロイ済みで、クエリを 1 回も実行しない月

ID: `athena-idle` / 章: [49 Athena: workgroup、partition、CTAS、Iceberg、ログを引く](/ja/chapters/49-athena.md)

前提:

- ワークグループ、保存したクエリ 6 個、ロール、空のバケットだけがある
- 派生テーブルを作っていないので、Glue Data Catalog のオブジェクトも S3 のオブジェクトも増えない
- キャパシティ予約は使わない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `athena.scanned` | 0 | Terabytes | no query | 0 | - | 0 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月
- 無料枠を確認できず、何も引いていない単価: `athena.scanned`

## Athena: 月 1,000 回、日付で絞って gzip の JSON を 1 日ぶん読む

ID: `athena-1000-pruned` / 章: [49 Athena: workgroup、partition、CTAS、Iceberg、ログを引く](/ja/chapters/49-athena.md)

前提:

- 1 日 100 万件の記録が 365 日ぶんあるテーブル。gzip 後は 1 件 58.68 バイト（26章のサンプル 5,000 件の実測）で、1 日ぶんは 58,684,400 バイト
- クエリは日付で 1 日に絞る。JSON なのでその日のファイルをすべて読み、MB 単位に切り上げて 56 MB として課金される
- S3 へのリクエスト、クエリ結果の保存、Glue へのリクエストは含めていない（Athena がクエリ 1 回に行うリクエストの数は未確認）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `athena.scanned` | 0.053 | Terabytes | 1,000 queries x 56 MB | 0.27 | - | 0.27 |

- 定価の小計: **USD 0.27** / 月
- 毎月の無料枠適用後の小計: **USD 0.27** / 月
- 無料枠を確認できず、何も引いていない単価: `athena.scanned`

## Athena: 同じ 1,000 回を、日付の条件なしで、上限のないワークグループで実行する

ID: `athena-1000-unpruned` / 章: [49 Athena: workgroup、partition、CTAS、Iceberg、ログを引く](/ja/chapters/49-athena.md)

前提:

- テーブルは同じ。日付の条件がないので 365 日ぶんの 21,419,806,000 バイトを読み、20,428 MB として課金される
- LIMIT を付けても、並べ替えや集計のあるクエリは全体を読む前提（LIMIT だけのクエリが早く止まるかどうかは未確認）
- 1 回のクエリの読む量に上限を付けていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `athena.scanned` | 19.482 | Terabytes | 1,000 queries x 20,428 MB | 97.41 | - | 97.41 |

- 定価の小計: **USD 97.41** / 月
- 毎月の無料枠適用後の小計: **USD 97.41** / 月
- 無料枠を確認できず、何も引いていない単価: `athena.scanned`

## Athena: 同じ 1,000 回が、この章のワークグループの上限（1 GiB）で取り消される

ID: `athena-1000-cancelled` / 章: [49 Athena: workgroup、partition、CTAS、Iceberg、ログを引く](/ja/chapters/49-athena.md)

前提:

- どのクエリも 1 GiB を読んだところで取り消され、答えは返らない
- 取り消されたクエリは読んだぶんだけ課金される。読んだ量を上限ちょうどの 1 GiB として計算（上限をどれだけ超えてから止まるかは未確認）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `athena.scanned` | 0.977 | Terabytes | 1,000 queries x 1 GiB | 4.88 | - | 4.88 |

- 定価の小計: **USD 4.88** / 月
- 毎月の無料枠適用後の小計: **USD 4.88** / 月
- 無料枠を確認できず、何も引いていない単価: `athena.scanned`

## Athena: 月 1,000 回、Parquet の 1 日ぶんから 2 列だけ読む

ID: `athena-1000-parquet` / 章: [49 Athena: workgroup、partition、CTAS、Iceberg、ログを引く](/ja/chapters/49-athena.md)

前提:

- 同じ記録を Parquet にしたテーブル。at と status の 2 列は 1 件あたり 6.38 バイト（26章のサンプルを手元のライブラリで書いた実測。Athena が書く Parquet の大きさは未確認）で、1 日ぶんは 6,384,400 バイト
- 10 MB に届かないので、どのクエリも最低の 10 MB として課金される

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `athena.scanned` | 0.01 | Terabytes | 1,000 queries x 10 MB minimum | 0.05 | - | 0.05 |

- 定価の小計: **USD 0.05** / 月
- 毎月の無料枠適用後の小計: **USD 0.05** / 月
- 無料枠を確認できず、何も引いていない単価: `athena.scanned`

## Athena: 最小のキャパシティ予約（4 DPU）を 1 か月持ち続ける

ID: `athena-capacity-minimum` / 章: [49 Athena: workgroup、partition、CTAS、Iceberg、ログを引く](/ja/chapters/49-athena.md)

前提:

- この章のスタックは作らない。比較のためだけの計算
- 4 DPU を 730 時間。クエリを 1 回も実行しなくても同じ金額
- 予約したキャパシティで実行するクエリが、読んだ量でも課金されるかどうかは、この章では確かめていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `athena.capacity.dpu-hour` | 2,920 | DPU-Hour | 4 DPUs x 730 hours | 1255.60 | - | 1255.60 |

- 定価の小計: **USD 1255.60** / 月
- 毎月の無料枠適用後の小計: **USD 1255.60** / 月

## AgentCore Runtime: 1,000 セッション、アイドル 5 分で終了

ID: `agentcore-sessions-idle-5` / 章: [50 AgentCore: エージェントの実行環境、記憶、ツール、認証](/ja/chapters/50-agentcore.md)

前提:

- 会話 4 分のあと、スタックの設定どおり 5 分アイドルで終了。1 セッション 9 分
- platformVersion は既定の V1。1 か月に 1,000 セッション
- 1 セッションで CPU を使う時間は合計 18 秒、1 vCPU（モデルやツールの応答を待つあいだは CPU に課金されない、という料金ページの説明に立った仮定。実測ではない）
- メモリは 1 セッションあたり平均 0.6 GB（仮定。実測ではない。課金の下限は 128 MB）
- モデルの呼び出し（36章）、AgentCore Memory の短期記憶（東京の単価を確認できていない）、DynamoDB、CloudWatch Logs、データ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `agentcore.runtime.v1.vcpu.hour` | 5 | vCPU-Hours | 1,000 sessions x 18 s x 1 vCPU / 3,600 | 0.45 | - | 0.45 |
| `agentcore.runtime.v1.memory.gb-hour` | 90 | GB-Hours | 1,000 sessions x 9 min x 0.6 GB / 60 | 0.85 | - | 0.85 |

- 定価の小計: **USD 1.30** / 月
- 毎月の無料枠適用後の小計: **USD 1.30** / 月

## AgentCore Runtime: 1,000 セッション、アイドル 15 分（既定）で終了

ID: `agentcore-sessions-idle-15` / 章: [50 AgentCore: エージェントの実行環境、記憶、ツール、認証](/ja/chapters/50-agentcore.md)

前提:

- 会話 4 分のあと、既定の 15 分アイドルで終了。1 セッション 19 分
- platformVersion は既定の V1。1 か月に 1,000 セッション
- 1 セッションで CPU を使う時間は合計 18 秒、1 vCPU（モデルやツールの応答を待つあいだは CPU に課金されない、という料金ページの説明に立った仮定。実測ではない）
- メモリは 1 セッションあたり平均 0.6 GB（仮定。実測ではない。課金の下限は 128 MB）
- モデルの呼び出し（36章）、AgentCore Memory の短期記憶（東京の単価を確認できていない）、DynamoDB、CloudWatch Logs、データ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `agentcore.runtime.v1.vcpu.hour` | 5 | vCPU-Hours | 1,000 sessions x 18 s x 1 vCPU / 3,600 | 0.45 | - | 0.45 |
| `agentcore.runtime.v1.memory.gb-hour` | 190 | GB-Hours | 1,000 sessions x 19 min x 0.6 GB / 60 | 1.80 | - | 1.80 |

- 定価の小計: **USD 2.24** / 月
- 毎月の無料枠適用後の小計: **USD 2.24** / 月

## 通話: 2 人で 1 時間を、月に 8 回

ID: `calls-one-to-one` / 章: [51 Chime SDK: 自分のアプリに音声とビデオの通話を入れる](/ja/chapters/51-chime-sdk.md)

前提:

- メディアリージョンは東京。standard のセッション（映像は 720p まで）
- 2 人とも 60 分ずっと接続している。音声だけでも映像つきでも同じ単価
- API Gateway、Lambda、DynamoDB、Cognito、CloudWatch Logs の料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `chime.sdk.attendee-minute` | 960 | minutes | 8 calls x 2 attendees x 60 minutes | 1.63 | - | 1.63 |

- 定価の小計: **USD 1.63** / 月
- 毎月の無料枠適用後の小計: **USD 1.63** / 月
- 無料枠を確認できず、何も引いていない単価: `chime.sdk.attendee-minute`

## 通話: 5 人で 30 分を、月に 20 回

ID: `calls-team-daily` / 章: [51 Chime SDK: 自分のアプリに音声とビデオの通話を入れる](/ja/chapters/51-chime-sdk.md)

前提:

- 「2 人で 1 時間」と同じ仮定で、人数と回数だけが違う

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `chime.sdk.attendee-minute` | 3,000 | minutes | 20 calls x 5 attendees x 30 minutes | 5.10 | - | 5.10 |

- 定価の小計: **USD 5.10** / 月
- 毎月の無料枠適用後の小計: **USD 5.10** / 月
- 無料枠を確認できず、何も引いていない単価: `chime.sdk.attendee-minute`

## 閉じ忘れ: 1 人が接続したまま、ミーティングの上限の 24 時間が過ぎた

ID: `calls-tab-left-open` / 章: [51 Chime SDK: 自分のアプリに音声とビデオの通話を入れる](/ja/chapters/51-chime-sdk.md)

前提:

- 通話のあと 1 つのタブだけが接続したまま残った。誰かが接続しているあいだ、ミーティングは終わらない
- 24 時間でミーティングが終わる（ドキュメントの上限）。それまでの 1,440 分が課金される

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `chime.sdk.attendee-minute` | 1,440 | minutes | 1 attendee x 24 hours x 60 minutes | 2.45 | - | 2.45 |

- 定価の小計: **USD 2.45** / 月
- 毎月の無料枠適用後の小計: **USD 2.45** / 月
- 無料枠を確認できず、何も引いていない単価: `chime.sdk.attendee-minute`

## EFS: デプロイして何も書かずに 1 か月

ID: `efs-idle` / 章: [53 EFS: いくつもの実行環境から同時にマウントするファイルシステム](/ja/chapters/53-efs.md)

前提:

- 既定の構成。Regional のファイルシステム、Elastic スループット、バックアップなし
- ファイルシステムの計量サイズは、空のルートディレクトリ 1 つの 6 KiB（EFS のドキュメントの値）
- マウントターゲット 2 つとアクセスポイントには、Price List に SKU がない。関数は 1 回も呼ばれない
- 11章のスタックは既定の構成（NAT ゲートウェイなし、インターフェースエンドポイントなし）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `efs.standard.storage` | 0 | GB-Mo | 6 KiB metered for the empty root directory, the whole month | 0.000002 | - | 0.000002 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月
- 無料枠を確認できず、何も引いていない単価: `efs.standard.storage`

## EFS: ノート 100 件を置き、1 か月使う

ID: `efs-practice-month` / 章: [53 EFS: いくつもの実行環境から同時にマウントするファイルシステム](/ja/chapters/53-efs.md)

前提:

- ノート 100 件。どれも 4 KiB 以下なので、1 件はメタデータ 2 KiB とデータ 4 KiB の 6 KiB。ディレクトリ 4 つ（ルート、アクセスポイントのルート、notes、incoming）も 6 KiB ずつと仮定
- 書き込みは月 1,000 回。データの操作は最初の 32 KiB までが 1 単位として計量されるので、1 回 32 KiB
- 一覧は月 10,000 回。この章の実装は一覧のたびに 100 件のファイルをすべて読むので、1 回 100 × 32 KiB
- メタデータの操作（ディレクトリの一覧、ファイルの作成、rename、属性の取得）は、回数を数えていないので未算入。0 ではない
- 関数は月 11,000 回、1 回 0.1 秒、256 MB と仮定（計測していない）。HTTP API のリクエストも同数
- ログ、データ転送は未算入。無料枠は差し引いていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `efs.standard.storage` | 0.001 | GB-Mo | (100 notes + 4 directories) x 6 KiB | 0.000214 | - | 0.000214 |
| `efs.elastic.write` | 0.031 | GB | 1,000 writes x 32 KiB metered | 0.002136 | - | 0.002136 |
| `efs.elastic.read` | 30.518 | GB | 10,000 lists x 100 files x 32 KiB metered | 1.22 | - | 1.22 |
| `lambda.request.arm` | 11,000 | Requests | 11,000 invocations | 0.002200 | 1,000,000 | 0 |
| `lambda.duration.arm` | 275 | Lambda-GB-Second | 11,000 x 0.1 s x 0.25 GB (assumed) | 0.003667 | 400,000 | 0 |
| `apigw.http.request` | 11,000 | Requests | 11,000 requests | 0.01 | - | 0.01 |

- 定価の小計: **USD 1.24** / 月
- 毎月の無料枠適用後の小計: **USD 1.24** / 月
- 無料枠を確認できず、何も引いていない単価: `apigw.http.request`, `efs.standard.storage`

## Kinesis: デプロイ済みで、1 件も書かない月（provisioned、shard 1 つ）

ID: `kinesis-idle` / 章: [54 Kinesis: Data Streams、shard、順序、読み直し](/ja/chapters/54-kinesis.md)

前提:

- provisioned の stream に shard が 1 つ。730 時間ずっと存在する
- 関数は、レコードが無いあいだ起動しない。event source mapping が shard を読みにいくこと自体には、provisioned の stream では料金が付かない（Price List に GetRecords の単価が無い）
- stream は AWS 管理のキー（aws/kinesis）で暗号化する。キーそのものは無料だが、Kinesis が代わりに呼ぶ KMS の API は請求される、と Kinesis のガイドにある。1 つの認証情報で先頭から読み続けるとき 5 分に約 12 回という同じページの目安を、そのまま 1 か月ぶん（105,120 回）数えた。請求書では確かめていない
- アラームは 3 つ。アカウント全体で最初の 10 個は無料の枠に入る
- 未算入: 空の履歴のテーブルと空のキュー（どちらも 0）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `kinesis.shard-hour` | 730 | ShardHour | 1 shard x 730 h | 14.23 | - | 14.23 |
| `cloudwatch.alarm.standard` | 3 | Alarms | three standard alarms | 0.30 | 10 | 0 |
| `kms.request` | 105,120 | Requests | 12 calls every 5 minutes x 12 x 730 h, as the Kinesis guide estimates for one credential reading from the tip | 0.32 | 20,000 | 0.26 |

- 定価の小計: **USD 14.85** / 月
- 毎月の無料枠適用後の小計: **USD 14.49** / 月
- 無料枠を確認できず、何も引いていない単価: `kinesis.shard-hour`

## Kinesis: 同じスタックを on-demand（Standard）にして、1 件も書かない月

ID: `kinesis-idle-on-demand` / 章: [54 Kinesis: Data Streams、shard、順序、読み直し](/ja/chapters/54-kinesis.md)

前提:

- stream を on-demand の Standard にした場合。この章のスタックはこの設定ではデプロイしない。比べるための計算
- stream が 1 本、730 時間。書き込みも読み取りも 0 GB
- stream は AWS 管理のキー（aws/kinesis）で暗号化する。キーそのものは無料だが、Kinesis が代わりに呼ぶ KMS の API は請求される、と Kinesis のガイドにある。1 つの認証情報で先頭から読み続けるとき 5 分に約 12 回という同じページの目安を、そのまま 1 か月ぶん（105,120 回）数えた。請求書では確かめていない
- アラームは 3 つ

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `kinesis.on-demand.stream-hour` | 730 | StreamHr | 1 stream x 730 h | 37.96 | - | 37.96 |
| `cloudwatch.alarm.standard` | 3 | Alarms | three standard alarms | 0.30 | 10 | 0 |
| `kms.request` | 105,120 | Requests | 12 calls every 5 minutes x 12 x 730 h, as the Kinesis guide estimates for one credential reading from the tip | 0.32 | 20,000 | 0.26 |

- 定価の小計: **USD 38.58** / 月
- 毎月の無料枠適用後の小計: **USD 38.22** / 月
- 無料枠を確認できず、何も引いていない単価: `kinesis.on-demand.stream-hour`

## Kinesis: 月 1,000,000 件のリビジョン（provisioned、shard 1 つ）

ID: `kinesis-small` / 章: [54 Kinesis: Data Streams、shard、順序、読み直し](/ja/chapters/54-kinesis.md)

前提:

- provisioned の stream に shard が 1 つ。730 時間
- 1 か月に 1,000,000 件のリビジョンを書く。1 件は 0.2 KB で、25 KB の PUT payload unit 1 つに収まる
- 関数は平均 10 件ずつ受け取ると仮定して 100,000 回起動、1 回 200 ミリ秒、256 MB、arm64。再試行と重複はゼロとする
- 履歴のテーブルへの書き込みは 1 件につき 1 unit（アイテムは 1 KB 未満）
- ログは 1 回の起動につき 0.2 KB
- 未算入: 履歴のテーブルの保存料金（数 MB）、失敗用のキューと SNS（何も流れない前提）
- stream は AWS 管理のキー（aws/kinesis）で暗号化する。キーそのものは無料だが、Kinesis が代わりに呼ぶ KMS の API は請求される、と Kinesis のガイドにある。1 つの認証情報で先頭から読み続けるとき 5 分に約 12 回という同じページの目安を、そのまま 1 か月ぶん（105,120 回）数えた。請求書では確かめていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `kinesis.shard-hour` | 730 | ShardHour | 1 shard x 730 h | 14.23 | - | 14.23 |
| `kinesis.put-payload-unit` | 1,000,000 | PutRequest | one 25 KB unit per record | 0.02 | - | 0.02 |
| `lambda.request.arm` | 100,000 | Requests | 1,000,000 records in batches of 10 | 0.02 | 1,000,000 | 0 |
| `lambda.duration.arm` | 5,000 | Lambda-GB-Second | 100,000 x 0.2 s x 0.25 GB, in GB-seconds | 0.07 | 400,000 | 0 |
| `dynamodb.write.on-demand` | 1,000,000 | WriteRequestUnits | one conditional update per revision | 0.71 | - | 0.71 |
| `logs.ingest.standard` | 0.02 | GB | 100,000 invocations x 0.2 KB | 0.02 | 5 | 0 |
| `cloudwatch.alarm.standard` | 3 | Alarms | three standard alarms | 0.30 | 10 | 0 |
| `kms.request` | 105,120 | Requests | 12 calls every 5 minutes x 12 x 730 h, as the Kinesis guide estimates for one credential reading from the tip | 0.32 | 20,000 | 0.26 |

- 定価の小計: **USD 15.69** / 月
- 毎月の無料枠適用後の小計: **USD 15.23** / 月
- 無料枠を確認できず、何も引いていない単価: `kinesis.shard-hour`, `kinesis.put-payload-unit`

## Kinesis: 月 1,000,000 件のリビジョン（on-demand の Standard にした場合）

ID: `kinesis-small-on-demand` / 章: [54 Kinesis: Data Streams、shard、順序、読み直し](/ja/chapters/54-kinesis.md)

前提:

- stream を on-demand の Standard にした場合。比べるための計算
- 書き込みは 1 件を 1 KB に切り上げて数える（料金ページ）。1,000,000 KB = 0.9537 GB
- 読み取りは切り上げない。コンシューマーは 1 つで、1,000,000 × 0.2 KB = 0.1907 GB
- 関数は平均 10 件ずつ受け取ると仮定して 100,000 回起動、1 回 200 ミリ秒、256 MB、arm64。再試行と重複はゼロとする
- 履歴のテーブルへの書き込みは 1 件につき 1 unit（アイテムは 1 KB 未満）
- ログは 1 回の起動につき 0.2 KB
- 未算入: 履歴のテーブルの保存料金（数 MB）、失敗用のキューと SNS（何も流れない前提）
- stream は AWS 管理のキー（aws/kinesis）で暗号化する。キーそのものは無料だが、Kinesis が代わりに呼ぶ KMS の API は請求される、と Kinesis のガイドにある。1 つの認証情報で先頭から読み続けるとき 5 分に約 12 回という同じページの目安を、そのまま 1 か月ぶん（105,120 回）数えた。請求書では確かめていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `kinesis.on-demand.stream-hour` | 730 | StreamHr | 1 stream x 730 h | 37.96 | - | 37.96 |
| `kinesis.on-demand.ingest` | 0.954 | GB | 1,000,000 records x 1 KB (rounded up) / 1,048,576 | 0.10 | - | 0.10 |
| `kinesis.on-demand.retrieval` | 0.191 | GB | 1,000,000 records x 0.2 KB / 1,048,576, one consumer | 0.01 | - | 0.01 |
| `lambda.request.arm` | 100,000 | Requests | 1,000,000 records in batches of 10 | 0.02 | 1,000,000 | 0 |
| `lambda.duration.arm` | 5,000 | Lambda-GB-Second | 100,000 x 0.2 s x 0.25 GB, in GB-seconds | 0.07 | 400,000 | 0 |
| `dynamodb.write.on-demand` | 1,000,000 | WriteRequestUnits | one conditional update per revision | 0.71 | - | 0.71 |
| `logs.ingest.standard` | 0.02 | GB | 100,000 invocations x 0.2 KB | 0.02 | 5 | 0 |
| `cloudwatch.alarm.standard` | 3 | Alarms | three standard alarms | 0.30 | 10 | 0 |
| `kms.request` | 105,120 | Requests | 12 calls every 5 minutes x 12 x 730 h, as the Kinesis guide estimates for one credential reading from the tip | 0.32 | 20,000 | 0.26 |

- 定価の小計: **USD 39.50** / 月
- 毎月の無料枠適用後の小計: **USD 39.04** / 月
- 無料枠を確認できず、何も引いていない単価: `kinesis.on-demand.stream-hour`, `kinesis.on-demand.ingest`, `kinesis.on-demand.retrieval`

## Kinesis: On-demand Advantage を有効にしたアカウントの、1 か月の最低料金

ID: `kinesis-advantage-minimum` / 章: [54 Kinesis: Data Streams、shard、順序、読み直し](/ja/chapters/54-kinesis.md)

前提:

- On-demand Advantage はアカウント単位の設定で、有効にすると、そのリージョンの on-demand の stream 全体で、書き込み 25 MiB/秒と読み取り 25 MiB/秒ぶんを少なくとも支払う（ドキュメント）
- 25 MiB/秒 × 3,600 秒 × 730 時間 = 65,700,000 MiB = 64,160.16 GB。実際の使用量がこれより少なくても、差は同じ単価で請求される
- この章のスタックは、この設定を使わない。誰が有効にしてはいけないかを示すための計算

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `kinesis.advantage.ingest` | 64,160.16 | GB | 25 MiB/s x 3,600 s x 730 h, in GB | 2669.06 | - | 2669.06 |
| `kinesis.advantage.retrieval` | 64,160.16 | GB | 25 MiB/s x 3,600 s x 730 h, in GB | 1334.53 | - | 1334.53 |

- 定価の小計: **USD 4003.59** / 月
- 毎月の無料枠適用後の小計: **USD 4003.59** / 月
- 無料枠を確認できず、何も引いていない単価: `kinesis.advantage.ingest`, `kinesis.advantage.retrieval`

## Grafana のワークスペース: 作ったまま誰もサインインしない月

ID: `grafana-idle` / 章: [55 Grafana: Amazon Managed Grafana で dashboard と alert を持つ](/ja/chapters/55-grafana.md)

前提:

- ワークスペース 1 つ。料金ページの「ワークスペースごとに最低 1 つの Editor ライセンス」をそのまま数える
- 90 日の無料トライアル（アカウントあたり 5 人まで）は引いていない
- 誰もダッシュボードを開かないので、GetMetricData の呼び出しは無い
- 月の途中で作った、消したときの日割りの有無は確認できていない。1 か月ぶんで数える

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `grafana.user.editor` | 1 | Users | the minimum of one Editor license per workspace | 9.00 | - | 9.00 |

- 定価の小計: **USD 9.00** / 月
- 毎月の無料枠適用後の小計: **USD 9.00** / 月
- 無料枠を確認できず、何も引いていない単価: `grafana.user.editor`

## Grafana のワークスペース: 管理者 1 人、閲覧者 2 人、コードからの反映つき

ID: `grafana-small` / 章: [55 Grafana: Amazon Managed Grafana で dashboard と alert を持つ](/ja/chapters/55-grafana.md)

前提:

- その月にサインインした人が、管理者 1 人と閲覧者 2 人
- ダッシュボードを反映するサービスアカウント（Admin）が、その月に 1 回以上 API を呼んだ。料金の上では Editor 1 人ぶん
- ブラウザのタブ 1 つが、ダッシュボードを 1 日 8 時間、月 20 日開いたままにする。1 分ごとの再読み込みのたびに、23 個のメトリクスを GetMetricData で 1 回ずつ要求すると仮定（9,600 回 × 23 個）。Grafana が実際に 1 回の再読み込みで何個ぶん課金される呼び方をするかは未確認
- 無料トライアルと、GetMetricData の無料枠の有無は引いていない
- 19章のスタックそのものの料金と、IAM Identity Center や外部の IdP の料金は含めていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `grafana.user.editor` | 2 | Users | 1 admin who signed in + 1 service account with the Admin role | 18.00 | - | 18.00 |
| `grafana.user.viewer` | 2 | Users | 2 viewers who signed in | 10.00 | - | 10.00 |
| `cloudwatch.api.getmetricdata` | 220,800 | Metrics | 8 h x 20 days x 60 reloads x 23 metrics | 2.21 | - | 2.21 |

- 定価の小計: **USD 30.21** / 月
- 毎月の無料枠適用後の小計: **USD 30.21** / 月
- 無料枠を確認できず、何も引いていない単価: `grafana.user.editor`, `grafana.user.viewer`, `cloudwatch.api.getmetricdata`

## 画像の説明: デプロイ済みで呼ばれない月

ID: `nova-idle` / 章: [56 Nova: Amazon のモデルで文章、画像、動画、音声を扱う](/ja/chapters/56-nova.md)

前提:

- リクエストゼロ
- バケットにオブジェクトなし
- ログは 1 週間で失効し、保存量ゼロ

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## 画像の説明: 月 1,000 枚（Nova 2 Lite、jp. profile）

ID: `nova-describe-nova-2-lite` / 章: [56 Nova: Amazon のモデルで文章、画像、動画、音声を扱う](/ja/chapters/56-nova.md)

前提:

- 月 1,000 枚を 1 回ずつ説明する。2 回目以降の PUT は保存済みのものを返すので、モデルを呼ばない
- 入力は 1 枚あたり 320 トークンと仮定（画像 1 枚は 230 トークンの定額。残りの 90 は 2 つのプロンプトの見積もり）
- 出力は 1 枚あたり 60 トークンと仮定（上限は 300）
- Lambda は 256 MB、arm64、1 枚あたり平均 3 秒と仮定（推論を待つ時間も課金される）
- S3 は 1 枚あたり、書き込み 2 回（claim と説明）、読み出し 3 回（説明の有無、アップロードの確認、Bedrock による画像の取得を 1 回と仮定）
- 1 枚あたりログ 1 KB と仮定
- 説明文の保存量（1 件 1 KB 未満）とデータ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input` | 320 | 1K tokens | 1,000 images x 320 input tokens, in 1K tokens | 0.13 | - | 0.13 |
| `bedrock.nova-2-lite.output` | 60 | 1K tokens | 1,000 images x 60 output tokens, in 1K tokens | 0.20 | - | 0.20 |
| `lambda.request.arm` | 1,000 | Requests | one invocation per image | 0.000200 | 1,000,000 | 0 |
| `lambda.duration.arm` | 750 | Lambda-GB-Second | 1,000 x 3 s x 0.25 GB | 0.01 | 400,000 | 0 |
| `s3.request.tier1` | 2,000 | Requests | 1,000 x 2 PutObject | 0.01 | - | 0.01 |
| `s3.request.tier2` | 3,000 | Requests | 1,000 x 3 GET or HEAD | 0.001110 | - | 0.001110 |
| `logs.ingest.standard` | 0.001 | GB | 1,000 x 1 KB, in GB | 0.000725 | 5 | 0 |

- 定価の小計: **USD 0.35** / 月
- 毎月の無料枠適用後の小計: **USD 0.34** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.request.tier1`, `s3.request.tier2`, `bedrock.nova-2-lite.input`, `bedrock.nova-2-lite.output`

## 画像の説明: 1,000 枚すべてが出力の上限に達した場合の推論分

ID: `nova-describe-ceiling-nova-2-lite` / 章: [56 Nova: Amazon のモデルで文章、画像、動画、音声を扱う](/ja/chapters/56-nova.md)

前提:

- 1,000 枚すべてが maxTokens の 300 トークンまで出力
- 入力は 1 枚あたり 320 トークンと仮定
- 推論の分だけ

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input` | 320 | 1K tokens | 1,000 images x 320 input tokens, in 1K tokens | 0.13 | - | 0.13 |
| `bedrock.nova-2-lite.output` | 300 | 1K tokens | 1,000 images x 300 output tokens, in 1K tokens | 0.99 | - | 0.99 |

- 定価の小計: **USD 1.12** / 月
- 毎月の無料枠適用後の小計: **USD 1.12** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.nova-2-lite.input`, `bedrock.nova-2-lite.output`

## 要約: 17章と同じトークン数を Nova Lite で（推論の分だけ）

ID: `nova-summaries-nova-lite` / 章: [56 Nova: Amazon のモデルで文章、画像、動画、音声を扱う](/ja/chapters/56-nova.md)

前提:

- 月 1,000 件の要約
- 入力は 1 件あたり 2,000 トークン、出力は 150 トークンと仮定（17章の表と同じ）
- トークンの数え方はモデルごとに違う。単価の比較のための仮定
- 推論の分だけ。Lambda は含まない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-lite.input` | 2,000 | 1K tokens | 1,000 summaries x 2,000 input tokens, in 1K tokens | 0.14 | - | 0.14 |
| `bedrock.nova-lite.output` | 150 | 1K tokens | 1,000 summaries x 150 output tokens, in 1K tokens | 0.04 | - | 0.04 |

- 定価の小計: **USD 0.19** / 月
- 毎月の無料枠適用後の小計: **USD 0.19** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.nova-lite.input`, `bedrock.nova-lite.output`

## 要約: 17章と同じトークン数を Nova Micro で（推論の分だけ）

ID: `nova-summaries-nova-micro` / 章: [56 Nova: Amazon のモデルで文章、画像、動画、音声を扱う](/ja/chapters/56-nova.md)

前提:

- 月 1,000 件の要約
- 入力は 1 件あたり 2,000 トークン、出力は 150 トークンと仮定（17章の表と同じ）
- トークンの数え方はモデルごとに違う。単価の比較のための仮定
- 推論の分だけ。Lambda は含まない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-micro.input` | 2,000 | 1K tokens | 1,000 summaries x 2,000 input tokens, in 1K tokens | 0.08 | - | 0.08 |
| `bedrock.nova-micro.output` | 150 | 1K tokens | 1,000 summaries x 150 output tokens, in 1K tokens | 0.03 | - | 0.03 |

- 定価の小計: **USD 0.11** / 月
- 毎月の無料枠適用後の小計: **USD 0.11** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.nova-micro.input`, `bedrock.nova-micro.output`

## 要約: 17章と同じトークン数を Nova 2 Lite で（推論の分だけ）

ID: `nova-summaries-nova-2-lite` / 章: [56 Nova: Amazon のモデルで文章、画像、動画、音声を扱う](/ja/chapters/56-nova.md)

前提:

- 月 1,000 件の要約
- 入力は 1 件あたり 2,000 トークン、出力は 150 トークンと仮定（17章の表と同じ）
- トークンの数え方はモデルごとに違う。単価の比較のための仮定
- 推論の分だけ。Lambda は含まない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input` | 2,000 | 1K tokens | 1,000 summaries x 2,000 input tokens, in 1K tokens | 0.79 | - | 0.79 |
| `bedrock.nova-2-lite.output` | 150 | 1K tokens | 1,000 summaries x 150 output tokens, in 1K tokens | 0.50 | - | 0.50 |

- 定価の小計: **USD 1.29** / 月
- 毎月の無料枠適用後の小計: **USD 1.29** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.nova-2-lite.input`, `bedrock.nova-2-lite.output`

## 読み上げ: デプロイ済みで、誰も聞かない月

ID: `polly-idle` / 章: [57 Polly: ノートを読み上げる](/ja/chapters/57-polly.md)

前提:

- AihPolly をデプロイ済みで、関数は 1 回も呼ばれない
- バケットは空。ライフサイクルルールが、前の月の音声をすべて消している
- ロググループには何も書かれない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `polly.neural.characters` | 0 | Characters | no synthesis | 0 | - | 0 |
| `lambda.request.arm` | 0 | Requests | no invocations | 0 | 1,000,000 | 0 |
| `s3.standard.storage` | 0 | GB-Mo | an empty bucket | 0 | - | 0 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `polly.neural.characters`

## 読み上げ: 1,000 回聞かれる月（neural の声）

ID: `polly-month` / 章: [57 Polly: ノートを読み上げる](/ja/chapters/57-polly.md)

前提:

- 「聞く」が月に 1,000 回押される。ノートは題と本文を合わせて平均 600 文字で、題と本文の 2 つの部分になる
- 1,000 回のうち 300 回は、キャッシュに音声がある文章（同じノートをもう一度聞く）。残りの 700 回が Polly を呼ぶ。この割合は仮定で、実測ではない
- 声は neural。700 回 × 600 文字で 420,000 文字。Polly が数える文字数を、1 文字 = 1 と仮定している（数え方は未確認）
- 関数は 256 MB。Polly を呼ぶリクエストは 3 秒、キャッシュだけで済むリクエストは 0.3 秒と仮定（未計測）
- S3 への書き込みは、合成した部分ごとに 2 回（claim と音声）。読み取りは、リクエストごとに部分の数だけの HEAD と、聞く人のブラウザからの GET
- 音声は 1 回ぶんで 0.3 MB と仮定（未計測。Polly の MP3 のビットレートを確認していない）。700 回ぶんが 30 日のあいだ残る
- 聞く人への転送は 1,000 回 × 0.3 MB。ログは 1 リクエスト 1 KB と仮定（未計測）
- 無料枠は適用していない。Polly の無料枠は期間つきで、2025-07-15 以降に作ったアカウントでは credits に変わっている

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `polly.neural.characters` | 420,000 | Characters | 700 listens x 600 characters | 6.72 | - | 6.72 |
| `lambda.request.arm` | 1,000 | Requests | 1,000 requests | 0.000200 | 1,000,000 | 0 |
| `lambda.duration.arm` | 547.5 | Lambda-GB-Second | (700 x 3 s + 300 x 0.3 s) x 0.25 GB, in GB-seconds | 0.01 | 400,000 | 0 |
| `s3.request.tier1` | 2,800 | Requests | 700 listens x 2 parts x 2 PUTs (claim, audio) | 0.01 | - | 0.01 |
| `s3.request.tier2` | 4,000 | Requests | 1,000 requests x 2 HEADs, and 1,000 listens x 2 GETs | 0.001480 | - | 0.001480 |
| `s3.standard.storage` | 0.21 | GB-Mo | 700 x 0.3 MB kept for 30 days, in GB-months | 0.01 | - | 0.01 |
| `datatransfer.out.internet` | 0.3 | GB | 1,000 listens x 0.3 MB, in GB | 0.03 | - | 0.03 |
| `logs.ingest.standard` | 0.001 | GB | 1,000 x 1 KB, in GB | 0.000722 | 5 | 0 |

- 定価の小計: **USD 6.78** / 月
- 毎月の無料枠適用後の小計: **USD 6.77** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `datatransfer.out.internet`, `s3.request.tier1`, `s3.request.tier2`, `polly.neural.characters`

## RDS: 既定のスタックを 730 時間置いておく

ID: `rds-practice-month` / 章: [59 RDS: PostgreSQL を運用する](/ja/chapters/59-rds.md)

前提:

- db.t4g.micro、Single-AZ、止めずに 730 時間
- gp3 を 20 GB
- マスターユーザーのシークレット 1 つ。RDS が管理するシークレットも通常のシークレットと同じ単価と仮定した（未確認）
- アラーム 1 つ
- リクエストは 0。Lambda、API Gateway、ログの取り込みは発生しない
- バックアップは無料の範囲（データベースのストレージと同じ量まで）に収まるとした
- CPU クレジットの超過分、データ転送は含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.t4g-micro.single-az` | 730 | Hrs | one instance for 730 hours | 18.25 | - | 18.25 |
| `rds.postgres.gp3.storage` | 20 | GB-Mo | 20 GB provisioned for the month | 2.76 | - | 2.76 |
| `secretsmanager.secret` | 1 | Secrets | the master user secret, assumed to be billed as an ordinary secret | 0.40 | - | 0.40 |
| `cloudwatch.alarm.standard` | 1 | Alarms | one standard-resolution alarm on FreeStorageSpace | 0.10 | 10 | 0 |

- 定価の小計: **USD 21.51** / 月
- 毎月の無料枠適用後の小計: **USD 21.41** / 月
- 無料枠を確認できず、何も引いていない単価: `rds.postgres.t4g-micro.single-az`, `rds.postgres.gp3.storage`, `secretsmanager.secret`

## RDS: 1 か月ずっと止まっていたとした場合

ID: `rds-stopped-month` / 章: [59 RDS: PostgreSQL を運用する](/ja/chapters/59-rds.md)

前提:

- インスタンスの時間は 0。実際には 7 日で自動的に起動するので、この金額にはならない
- gp3 を 20 GB。止まっていても課金される
- シークレットとアラームは残る

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.gp3.storage` | 20 | GB-Mo | 20 GB provisioned for the month | 2.76 | - | 2.76 |
| `secretsmanager.secret` | 1 | Secrets | the master user secret, assumed to be billed as an ordinary secret | 0.40 | - | 0.40 |
| `cloudwatch.alarm.standard` | 1 | Alarms | one standard-resolution alarm on FreeStorageSpace | 0.10 | 10 | 0 |

- 定価の小計: **USD 3.26** / 月
- 毎月の無料枠適用後の小計: **USD 3.16** / 月
- 無料枠を確認できず、何も引いていない単価: `rds.postgres.gp3.storage`, `secretsmanager.secret`

## RDS: production のプロファイル（Multi-AZ）を 730 時間

ID: `rds-production-month` / 章: [59 RDS: PostgreSQL を運用する](/ja/chapters/59-rds.md)

前提:

- db.t4g.micro、Multi-AZ（待機 1 台）、730 時間。インスタンスクラスは既定のまま
- gp3 を 20 GB、Multi-AZ の単価
- シークレット 1 つ、アラーム 1 つ
- バックアップは無料の範囲に収まるとした

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.t4g-micro.multi-az` | 730 | Hrs | one Multi-AZ deployment for 730 hours | 36.50 | - | 36.50 |
| `rds.postgres.gp3.storage.multi-az` | 20 | GB-Mo | 20 GB provisioned for the month | 5.52 | - | 5.52 |
| `secretsmanager.secret` | 1 | Secrets | the master user secret, assumed to be billed as an ordinary secret | 0.40 | - | 0.40 |
| `cloudwatch.alarm.standard` | 1 | Alarms | one standard-resolution alarm on FreeStorageSpace | 0.10 | 10 | 0 |

- 定価の小計: **USD 42.52** / 月
- 毎月の無料枠適用後の小計: **USD 42.42** / 月
- 無料枠を確認できず、何も引いていない単価: `rds.postgres.t4g-micro.multi-az`, `rds.postgres.gp3.storage.multi-az`, `secretsmanager.secret`

## RDS: リードレプリカを 1 台足して 730 時間

ID: `rds-replica-month` / 章: [59 RDS: PostgreSQL を運用する](/ja/chapters/59-rds.md)

前提:

- db.t4g.micro、Single-AZ を 2 台（プライマリとレプリカ）、730 時間ずつ
- gp3 を 20 GB ずつ、計 40 GB
- CloudFormation が作るシークレット 1 つ、アラーム 1 つ

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.t4g-micro.single-az` | 1,460 | Hrs | two instances for 730 hours | 36.50 | - | 36.50 |
| `rds.postgres.gp3.storage` | 40 | GB-Mo | 2 x 20 GB provisioned for the month | 5.52 | - | 5.52 |
| `secretsmanager.secret` | 1 | Secrets | the master user secret, assumed to be billed as an ordinary secret | 0.40 | - | 0.40 |
| `cloudwatch.alarm.standard` | 1 | Alarms | one standard-resolution alarm on FreeStorageSpace | 0.10 | 10 | 0 |

- 定価の小計: **USD 42.52** / 月
- 毎月の無料枠適用後の小計: **USD 42.42** / 月
- 無料枠を確認できず、何も引いていない単価: `rds.postgres.t4g-micro.single-az`, `rds.postgres.gp3.storage`, `secretsmanager.secret`

## RDS Proxy: db.t4g.micro の前に 1 つ置いて 730 時間

ID: `rds-proxy-month` / 章: [59 RDS: PostgreSQL を運用する](/ja/chapters/59-rds.md)

前提:

- db.t4g.micro は 2 vCPU（Price List の属性）。最低料金も 2 vCPU 分
- プロキシの分だけ。インスタンスとプロキシ用のシークレットは含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.proxy.postgres.vcpu-hour` | 1,460 | Hrs | 2 vCPUs x 730 hours | 26.28 | - | 26.28 |

- 定価の小計: **USD 26.28** / 月
- 毎月の無料枠適用後の小計: **USD 26.28** / 月
- 無料枠を確認できず、何も引いていない単価: `rds.proxy.postgres.vcpu-hour`

## RDS Extended Support: db.t4g.micro を 1〜2 年目の単価で 730 時間

ID: `rds-extended-support-month` / 章: [59 RDS: PostgreSQL を運用する](/ja/chapters/59-rds.md)

前提:

- 2 vCPU、Single-AZ、730 時間
- 単価は PostgreSQL 13 のもの。Price List に載っているのは、すでに Extended Support に入った版だけ
- インスタンスとストレージの料金に上乗せされる分だけ

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.extended-support.yr1-yr2` | 1,460 | vCPU-hour | 2 vCPUs x 730 hours | 175.20 | - | 175.20 |

- 定価の小計: **USD 175.20** / 月
- 毎月の無料枠適用後の小計: **USD 175.20** / 月
- 無料枠を確認できず、何も引いていない単価: `rds.postgres.extended-support.yr1-yr2`

## RDS Extended Support: 同じインスタンスを 3 年目の単価で 730 時間

ID: `rds-extended-support-year3-month` / 章: [59 RDS: PostgreSQL を運用する](/ja/chapters/59-rds.md)

前提:

- 2 vCPU、Single-AZ、730 時間
- 単価は PostgreSQL 13 の 3 年目

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.extended-support.yr3` | 1,460 | vCPU-hour | 2 vCPUs x 730 hours | 350.40 | - | 350.40 |

- 定価の小計: **USD 350.40** / 月
- 毎月の無料枠適用後の小計: **USD 350.40** / 月
- 無料枠を確認できず、何も引いていない単価: `rds.postgres.extended-support.yr3`

## RDS: Multi-AZ DB cluster のいちばん小さいクラスを 730 時間

ID: `rds-multi-az-cluster-month` / 章: [59 RDS: PostgreSQL を運用する](/ja/chapters/59-rds.md)

前提:

- db.c6gd.medium の Multi-AZ (readable standbys) の単価 x 730 時間
- この単価が 3 台分をまとめたものかどうかは確認していない。db.m6gd.large では Single-AZ の 3 倍より少し安いので、まとめたものと読んだ
- ストレージは含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.c6gd-medium.multi-az-cluster` | 730 | Hrs | one Multi-AZ DB cluster for 730 hours | 239.37 | - | 239.37 |

- 定価の小計: **USD 239.37** / 月
- 毎月の無料枠適用後の小計: **USD 239.37** / 月
- 無料枠を確認できず、何も引いていない単価: `rds.postgres.c6gd-medium.multi-az-cluster`

## RDS: 無料の範囲を 10 GB 超えたバックアップ

ID: `rds-backup-overage` / 章: [59 RDS: PostgreSQL を運用する](/ja/chapters/59-rds.md)

前提:

- 20 GB のストレージに対して、バックアップと手動スナップショットが合わせて 30 GB あった月
- 超過は 10 GB

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.backup.charged` | 10 | GB-Mo | 30 GB of backups - 20 GB free | 0.95 | - | 0.95 |

- 定価の小計: **USD 0.95** / 月
- 毎月の無料枠適用後の小計: **USD 0.95** / 月
- 無料枠を確認できず、何も引いていない単価: `rds.postgres.backup.charged`

## Aurora（60章の既定の構成）: 1 か月ずっと止まっていた場合

ID: `aurora-paused-month` / 章: [60 Aurora: storage と compute が分かれた PostgreSQL](/ja/chapters/60-aurora.md)

前提:

- 最小 0 ACU。1 か月のあいだ一度も接続がなく、再開もしなかったと仮定
- 実際には保守のために Aurora がインスタンスを再開することがあり、その時間は課金される
- データは 1 GB、Aurora Standard
- Aurora が管理するシークレットが 1 つ
- バックアップの超過分、VPC の料金（11章）は含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu` | 0 | ACU-Hr | paused for all 730 hours | 0 | - | 0 |
| `aurora.postgres.storage` | 1 | GB-Mo | 1 GB stored for the month | 0.12 | - | 0.12 |
| `secretsmanager.secret` | 1 | Secrets | the master user secret | 0.40 | - | 0.40 |

- 定価の小計: **USD 0.52** / 月
- 毎月の無料枠適用後の小計: **USD 0.52** / 月
- 無料枠を確認できず、何も引いていない単価: `secretsmanager.secret`

## Aurora（60章の既定の構成）: 練習で合計 10 時間だけ起きていた月

ID: `aurora-practice-month` / 章: [60 Aurora: storage と compute が分かれた PostgreSQL](/ja/chapters/60-aurora.md)

前提:

- 起きていた時間は合計 10 時間。そのあいだずっと上限の 1 ACU だったと置く（上側の見積もり）
- I/O は 100 万回、Data API の呼び出しは 1 万回と置く。測った値ではない
- データは 1 GB、Aurora Standard、シークレット 1 つ
- バックアップの超過分、VPC の料金（11章）は含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu` | 10 | ACU-Hr | 1 ACU x 10 hours | 1.50 | - | 1.50 |
| `aurora.postgres.storage` | 1 | GB-Mo | 1 GB stored for the month | 0.12 | - | 0.12 |
| `aurora.postgres.io` | 1,000,000 | IOs | 1 million I/O requests (assumed) | 0.24 | - | 0.24 |
| `aurora.postgres.data-api` | 10,000 | API Calls | 10,000 Data API calls (assumed) | 0.004200 | - | 0.004200 |
| `secretsmanager.secret` | 1 | Secrets | the master user secret | 0.40 | - | 0.40 |

- 定価の小計: **USD 2.26** / 月
- 毎月の無料枠適用後の小計: **USD 2.26** / 月
- 無料枠を確認できず、何も引いていない単価: `aurora.postgres.io`, `aurora.postgres.data-api`, `secretsmanager.secret`

## Aurora（60章の既定の構成）: 一度も止まらず、上限の 1 ACU のままだった月

ID: `aurora-awake-month` / 章: [60 Aurora: storage と compute が分かれた PostgreSQL](/ja/chapters/60-aurora.md)

前提:

- 接続が開いたままなどの理由で auto-pause が働かず、730 時間ずっと上限の 1 ACU だったと置く。この構成でのインスタンスの料金の上限
- I/O は含めない
- データは 1 GB、Aurora Standard、シークレット 1 つ

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu` | 730 | ACU-Hr | 1 ACU x 730 hours | 109.50 | - | 109.50 |
| `aurora.postgres.storage` | 1 | GB-Mo | 1 GB stored for the month | 0.12 | - | 0.12 |
| `secretsmanager.secret` | 1 | Secrets | the master user secret | 0.40 | - | 0.40 |

- 定価の小計: **USD 110.02** / 月
- 毎月の無料枠適用後の小計: **USD 110.02** / 月
- 無料枠を確認できず、何も引いていない単価: `secretsmanager.secret`

## Aurora Standard: 平均 1 ACU、100 GB、I/O が月 3 億回

ID: `aurora-standard-300m-io` / 章: [60 Aurora: storage と compute が分かれた PostgreSQL](/ja/chapters/60-aurora.md)

前提:

- writer 1 台が 730 時間、平均 1 ACU
- データは 100 GB
- I/O は 3 億回と置く。測った値ではない
- シークレット、バックアップ、VPC の料金は含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu` | 730 | ACU-Hr | 1 ACU x 730 hours | 109.50 | - | 109.50 |
| `aurora.postgres.storage` | 100 | GB-Mo | 100 GB stored for the month | 12.00 | - | 12.00 |
| `aurora.postgres.io` | 300,000,000 | IOs | 300 million I/O requests (assumed) | 72.00 | - | 72.00 |

- 定価の小計: **USD 193.50** / 月
- 毎月の無料枠適用後の小計: **USD 193.50** / 月
- 無料枠を確認できず、何も引いていない単価: `aurora.postgres.io`

## Aurora I/O-Optimized: 平均 1 ACU、100 GB、I/O が月 3 億回

ID: `aurora-io-optimized-300m-io` / 章: [60 Aurora: storage と compute が分かれた PostgreSQL](/ja/chapters/60-aurora.md)

前提:

- writer 1 台が 730 時間、平均 1 ACU
- データは 100 GB
- I/O は何回でも課金されない
- シークレット、バックアップ、VPC の料金は含めない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu.io-optimized` | 730 | ACU-Hr | 1 ACU x 730 hours | 146.00 | - | 146.00 |
| `aurora.postgres.storage.io-optimized` | 100 | GB-Mo | 100 GB stored for the month | 27.00 | - | 27.00 |

- 定価の小計: **USD 173.00** / 月
- 毎月の無料枠適用後の小計: **USD 173.00** / 月
- 無料枠を確認できず、何も引いていない単価: `aurora.postgres.serverless-v2.acu.io-optimized`, `aurora.postgres.storage.io-optimized`

## FIFO キューとワーカー: デプロイ済みで、コマンドが 1 件も来ない月

ID: `sqs-idle` / 章: [61 SQS: FIFO、visibility timeout、batch、redrive](/ja/chapters/61-sqs.md)

前提:

- アラームは 2 つ（DLQ の件数、いちばん古いメッセージの年齢）
- Lambda は、空のキューを 20 秒のロングポーリングで、同時に 5 本読み続けると仮定する。5 × 730 × 3,600 ÷ 20 = 657,000 回。公式ドキュメントが書いているのは「トラフィックが少ないときは 5 つの同時実行まで戻す」ことと「maximum concurrency を設定すると 2 までの削減は使えない」ことで、受信の回数や待ち時間は書いていない。請求書でもメトリクスでも確かめていない
- コマンドが無いので、関数の実行、DynamoDB、ログは 0。テーブルは空

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.alarm.standard` | 2 | Alarms | two alarms, one metric each | 0.20 | 10 | 0 |
| `sqs.request.fifo` | 657,000 | Requests | 5 polls x 730 h x 3,600 s / 20 s (assumed) | 0.33 | 1,000,000 | 0 |

- 定価の小計: **USD 0.53** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## FIFO キューとワーカー: 月 100,000 件のコマンド

ID: `sqs-small` / 章: [61 SQS: FIFO、visibility timeout、batch、redrive](/ja/chapters/61-sqs.md)

前提:

- コマンドは 1 件ずつ送る（SendMessageBatch を使わない）。どれも 64 KB 未満なので、送信は 100,000 リクエスト
- 受信はバッチにならず、1 件につき ReceiveMessage 1 回と DeleteMessage 1 回と仮定する。200,000 リクエスト。重複、再試行、DLQ への退避はゼロ
- 空のキューの読み取りは、使っていない月と同じ 657,000 回と仮定する
- ワーカーは 100,000 回起動し、1 回 100 ミリ秒、256 MB、arm64
- 1 件のコマンドは、目印とノートの 2 つを書くトランザクション。どちらも 1 KB 以下で、トランザクションの書き込みは 1 KB あたり 2 unit なので 4 unit
- ログは 1 件につき 0.3 KB
- 未算入: テーブルの保存料金（目印は 30 日で消える。数十 MB）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.alarm.standard` | 2 | Alarms | two alarms, one metric each | 0.20 | 10 | 0 |
| `sqs.request.fifo` | 957,000 | Requests | 657,000 empty receives (assumed) + 100,000 x (send + receive + delete) | 0.48 | 1,000,000 | 0 |
| `lambda.request.arm` | 100,000 | Requests | one invocation per command | 0.02 | 1,000,000 | 0 |
| `lambda.duration.arm` | 2,500 | Lambda-GB-Second | 100,000 x 0.1 s x 0.25 GB, in GB-seconds | 0.03 | 400,000 | 0 |
| `dynamodb.write.on-demand` | 400,000 | WriteRequestUnits | 100,000 x 2 items x 2 units | 0.29 | - | 0.29 |
| `logs.ingest.standard` | 0.03 | GB | 100,000 x 0.3 KB, in GB | 0.02 | 5 | 0 |

- 定価の小計: **USD 1.04** / 月
- 毎月の無料枠適用後の小計: **USD 0.29** / 月

## キューを自分の KMS の鍵で暗号化した場合に増える分（1 か月）

ID: `sqs-kms-option` / 章: [61 SQS: FIFO、visibility timeout、batch、redrive](/ja/chapters/61-sqs.md)

前提:

- この章のスタックは SQS が管理する鍵（SSE-SQS）を使うので、この費用はかからない。自分で管理する鍵に替えた場合の見積もり
- 鍵は 1 つ。コマンドのキューだけを数える（DLQ のぶんは入れていない）
- SQS の開発者ガイドの式 R = (B / D) × (2P + C)。B は 730 時間 = 2,628,000 秒、D は既定の 300 秒、送る主体 P は 1、受け取る主体 C は 1。8,760 × 3 = 26,280 回
- ガイドは、実際の回数はこの式より多くなりうると書いている

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `kms.key` | 1 | Keys | one customer managed key | 1.00 | - | 1.00 |
| `kms.request` | 26,280 | Requests | (2,628,000 / 300) x (2 x 1 + 1) | 0.08 | 20,000 | 0.02 |

- 定価の小計: **USD 1.08** / 月
- 毎月の無料枠適用後の小計: **USD 1.02** / 月
- 無料枠を確認できず、何も引いていない単価: `kms.key`

## CI Runner: ジョブが 1 件も無い 1 か月

ID: `ci-runners-idle` / 章: [62 CI Runner: GitHub Actions と GitLab Runner を自分の AWS で動かす](/ja/chapters/62-ci-runners.md)

前提:

- シークレット 2 つ（webhook のシークレットと GitHub App の秘密鍵）
- 15 分ごとの見回りの Lambda が 2,920 回、1 回 1 秒（仮定）、256 MB
- タスク、受信の Lambda、DynamoDB の書き込み、ログは 0

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `secretsmanager.secret` | 2 | Secrets | webhook secret and app private key | 0.80 | - | 0.80 |
| `lambda.request.arm` | 2,920 | Requests | one sweep every 15 min | 0.000584 | 1,000,000 | 0 |
| `lambda.duration.arm` | 730 | Lambda-GB-Second | 2920 sweeps x 1 s (assumed) x 0.25 GB | 0.01 | 400,000 | 0 |
| `scheduler.invocation` | 2,920 | Invocations | 2920 invocations | 0 | - | 0 |

- 定価の小計: **USD 0.81** / 月
- 毎月の無料枠適用後の小計: **USD 0.80** / 月
- 無料枠を確認できず、何も引いていない単価: `secretsmanager.secret`

## CI Runner: 5 分のジョブを 1,000 件（Fargate）

ID: `ci-runners-1000-jobs` / 章: [62 CI Runner: GitHub Actions と GitLab Runner を自分の AWS で動かす](/ja/chapters/62-ci-runners.md)

前提:

- 2 vCPU、8 GB、arm64 のタスクを 1 ジョブにつき 6 分（ジョブ 5 分と、イメージの取得と登録の 1 分。1 分は計っていない仮定）
- タスクごとにパブリック IPv4 アドレス 1 つ
- 受信の Lambda は配送 3,000 回、1 回 1 秒（仮定）、256 MB。DynamoDB の書き込みは 2,000 回。Secrets Manager の呼び出しは 4,000 回
- シークレットの月額、ログ、データ転送、エフェメラルストレージの追加ぶんは未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 200 | hours | 1000 jobs x 6 min x 2 vCPU | 8.09 | - | 8.09 |
| `fargate.arm.memory.gb-hour` | 800 | hours | 1000 jobs x 6 min x 8 GB | 3.54 | - | 3.54 |
| `vpc.public-ipv4.in-use.hour` | 100 | Hrs | 1000 jobs x 6 min, one address per task | 0.50 | - | 0.50 |
| `lambda.request.arm` | 3,000 | Requests | 3 deliveries per job (queued, in_progress, completed) | 0.000600 | 1,000,000 | 0 |
| `lambda.duration.arm` | 750 | Lambda-GB-Second | 3,000 deliveries x 1 s (assumed) x 0.25 GB | 0.01 | 400,000 | 0 |
| `dynamodb.write.on-demand` | 2,000 | WriteRequestUnits | claim and complete, one write each per job | 0.001430 | - | 0.001430 |
| `secretsmanager.api` | 4,000 | API Requests | the webhook secret per delivery, the private key per launch | 0.02 | - | 0.02 |

- 定価の小計: **USD 12.16** / 月
- 毎月の無料枠適用後の小計: **USD 12.15** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `secretsmanager.api`

## CI Runner: 同じ 1,000 件を CodeBuild で

ID: `ci-runners-codebuild-1000-jobs` / 章: [62 CI Runner: GitHub Actions と GitLab Runner を自分の AWS で動かす](/ja/chapters/62-ci-runners.md)

前提:

- arm1.small のオンデマンドで 1 ジョブにつき 6 分（Fargate と同じ仮定。CodeBuild の起動にかかる時間は計っていない）
- 無料枠はビルド 100 分
- arm1.small の大きさは Fargate のタスクと同じではない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `codebuild.arm1.small.minute` | 6,000 | minutes | 1,000 jobs x 6 minutes | 25.50 | 100 | 25.07 |

- 定価の小計: **USD 25.50** / 月
- 毎月の無料枠適用後の小計: **USD 25.08** / 月

## Agent Sandbox: タスクを 1 つも動かさずに 1 か月

ID: `agent-sandbox-idle` / 章: [63 Agent Sandbox: コーディングエージェントを AWS の隔離環境で動かす](/ja/chapters/63-agent-sandbox.md)

前提:

- リーパーの関数を 1 分ごとに 730 時間ぶん（43,800 回）、1 回 0.2 秒、256 MB（仮定）
- EventBridge Scheduler の呼び出し 43,800 回
- リポジトリにイメージ 0.5 GB（仮定。一度もビルドしていないので実測ではない）
- ログ、11章の VPC の料金、タスクとモデルの料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 43,800 | Requests | 730 hours x 60 runs | 0.01 | 1,000,000 | 0 |
| `lambda.duration.arm` | 2,190 | Lambda-GB-Second | 43,800 runs x 0.2 s x 0.25 GB | 0.03 | 400,000 | 0 |
| `scheduler.invocation` | 43,800 | Invocations | 43,800 invocations | 0 | - | 0 |
| `ecr.storage` | 0.5 | GB-Mo | one image, assumed 0.5 GB | 0.05 | - | 0.05 |

- 定価の小計: **USD 0.09** / 月
- 毎月の無料枠適用後の小計: **USD 0.05** / 月
- 無料枠を確認できず、何も引いていない単価: `ecr.storage`

## Agent Sandbox: 30 分のタスク 1 つ

ID: `agent-sandbox-job` / 章: [63 Agent Sandbox: コーディングエージェントを AWS の隔離環境で動かす](/ja/chapters/63-agent-sandbox.md)

前提:

- Fargate のタスク 1 つ（1 vCPU、4 GB、arm64、オンデマンド）を 30 分
- モデルは Claude Haiku 4.5。入力 40 万、キャッシュ読み出し 200 万、キャッシュ書き込み 30 万、出力 6 万トークン（すべて仮定。エージェントを動かしていないので実測ではない）
- ログ、データ転送、NAT や エンドポイントの料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 0.5 | hours | 1 vCPU x 0.5 hours | 0.02 | - | 0.02 |
| `fargate.arm.memory.gb-hour` | 2 | hours | 4 GB x 0.5 hours | 0.01 | - | 0.01 |
| `bedrock.claude-haiku-4-5.input` | 0.4 | 1M tokens | 400,000 input tokens (assumed) | 0.44 | - | 0.44 |
| `bedrock.claude-haiku-4-5.cache-read` | 2 | 1M tokens | 2,000,000 cache-read tokens (assumed) | 0.22 | - | 0.22 |
| `bedrock.claude-haiku-4-5.cache-write` | 0.3 | 1M tokens | 300,000 cache-write tokens (assumed) | 0.41 | - | 0.41 |
| `bedrock.claude-haiku-4-5.output` | 0.06 | 1M tokens | 60,000 output tokens (assumed) | 0.33 | - | 0.33 |

- 定価の小計: **USD 1.43** / 月
- 毎月の無料枠適用後の小計: **USD 1.43** / 月
- 無料枠を確認できず、何も引いていない単価: `bedrock.claude-haiku-4-5.cache-read`, `bedrock.claude-haiku-4-5.cache-write`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `bedrock.claude-haiku-4-5.input`, `bedrock.claude-haiku-4-5.output`

## Agent Sandbox の出口: インターフェースエンドポイントだけ

ID: `agent-sandbox-egress-endpoints` / 章: [63 Agent Sandbox: コーディングエージェントを AWS の隔離環境で動かす](/ja/chapters/63-agent-sandbox.md)

前提:

- bedrock-runtime、ecr.api、ecr.dkr、logs の 4 つを 2 つの AZ に 730 時間
- データ処理料は未算入。Git ホストとパッケージレジストリには届かない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `vpc.endpoint.interface.hour` | 5,840 | Hrs | 4 endpoints x 2 zones x 730 hours | 81.76 | - | 81.76 |

- 定価の小計: **USD 81.76** / 月
- 毎月の無料枠適用後の小計: **USD 81.76** / 月

## Agent Sandbox の出口: このスタックの modelEndpoint だけ

ID: `agent-sandbox-egress-model-endpoint` / 章: [63 Agent Sandbox: コーディングエージェントを AWS の隔離環境で動かす](/ja/chapters/63-agent-sandbox.md)

前提:

- bedrock-runtime のエンドポイント 1 つを 2 つの AZ に 730 時間。データ処理料は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `vpc.endpoint.interface.hour` | 1,460 | Hrs | 1 endpoint x 2 zones x 730 hours | 20.44 | - | 20.44 |

- 定価の小計: **USD 20.44** / 月
- 毎月の無料枠適用後の小計: **USD 20.44** / 月

## Agent Sandbox の出口: NAT Gateway

ID: `agent-sandbox-egress-nat` / 章: [63 Agent Sandbox: コーディングエージェントを AWS の隔離環境で動かす](/ja/chapters/63-agent-sandbox.md)

前提:

- NAT Gateway 1 つと、その Elastic IP アドレス 1 つを 730 時間
- データ処理料は未算入。宛先はポート 443 であること以外、何も絞られない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `nat.gateway.hour` | 730 | Hrs | 1 NAT gateway x 730 hours | 45.26 | - | 45.26 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 Elastic IP address x 730 hours | 3.65 | - | 3.65 |

- 定価の小計: **USD 48.91** / 月
- 毎月の無料枠適用後の小計: **USD 48.91** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`

## Agent Sandbox の出口: Network Firewall と NAT Gateway

ID: `agent-sandbox-egress-firewall` / 章: [63 Agent Sandbox: コーディングエージェントを AWS の隔離環境で動かす](/ja/chapters/63-agent-sandbox.md)

前提:

- ファイアウォールのエンドポイント 1 つ（AZ 1 つ）を 730 時間
- 同じ経路に置いた NAT Gateway の時間料金とデータ処理料は、料金ページの記載どおり免除されるものとして未算入。Elastic IP アドレスは算入
- ファイアウォールのデータ処理料（1 GB あたり USD 0.065）は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `network-firewall.endpoint.hour` | 730 | Hourly | 1 firewall endpoint x 730 hours | 288.35 | - | 288.35 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 Elastic IP address x 730 hours | 3.65 | - | 3.65 |

- 定価の小計: **USD 292.00** / 月
- 毎月の無料枠適用後の小計: **USD 292.00** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`

## Agent Sandbox の出口: 自分で動かすプロキシ

ID: `agent-sandbox-egress-proxy` / 章: [63 Agent Sandbox: コーディングエージェントを AWS の隔離環境で動かす](/ja/chapters/63-agent-sandbox.md)

前提:

- t4g.micro のインスタンス 1 つとパブリック IPv4 アドレス 1 つを 730 時間
- ボリューム、データ転送、プロキシを運用する手間は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-micro.linux.hour` | 730 | Hrs | 1 instance x 730 hours | 7.88 | - | 7.88 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 public IPv4 address x 730 hours | 3.65 | - | 3.65 |

- 定価の小計: **USD 11.53** / 月
- 毎月の無料枠適用後の小計: **USD 11.53** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `ec2.t4g-micro.linux.hour`

## Isolates: 1 件も処理しないまま 1 か月

ID: `isolates-idle` / 章: [64 Isolates: V8 isolate の実行環境を AWS でセルフホストする](/ja/chapters/64-isolates.md)

前提:

- `-c imageTag=...` でデプロイした既定の構成。タスク 1 つ（0.25 vCPU、0.5 GB、arm64）をパブリックサブネットで 730 時間
- ロードバランサー 1 台を 730 時間。LCU は未算入
- パブリック IPv4 アドレス 3 つ（ロードバランサーのノード 2 つと、タスク 1 つ）
- リポジトリの保存料、ログ、データ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 182.5 | hours | 1 tasks x 0.25 vCPU x 730 hours | 7.38 | - | 7.38 |
| `fargate.arm.memory.gb-hour` | 365 | hours | 1 tasks x 0.5 GB x 730 hours | 1.61 | - | 1.61 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,190 | Hrs | (2 load balancer nodes + 1 tasks) x 730 hours | 10.95 | - | 10.95 |

- 定価の小計: **USD 37.68** / 月
- 毎月の無料枠適用後の小計: **USD 37.68** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`

## Isolates: 1 日だけ置く

ID: `isolates-one-day` / 章: [64 Isolates: V8 isolate の実行環境を AWS でセルフホストする](/ja/chapters/64-isolates.md)

前提:

- `isolates-idle` の構成を 24 時間
- リポジトリの保存料、ログ、データ転送、LCU は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 6 | hours | 1 tasks x 0.25 vCPU x 24 hours | 0.24 | - | 0.24 |
| `fargate.arm.memory.gb-hour` | 12 | hours | 1 tasks x 0.5 GB x 24 hours | 0.05 | - | 0.05 |
| `alb.hour` | 24 | Hrs | 1 load balancer x 24 hours | 0.58 | - | 0.58 |
| `vpc.public-ipv4.in-use.hour` | 72 | Hrs | (2 load balancer nodes + 1 tasks) x 24 hours | 0.36 | - | 0.36 |

- 定価の小計: **USD 1.24** / 月
- 毎月の無料枠適用後の小計: **USD 1.24** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`

## Isolates: リポジトリだけ

ID: `isolates-repository-only` / 章: [64 Isolates: V8 isolate の実行環境を AWS でセルフホストする](/ja/chapters/64-isolates.md)

前提:

- `-c imageTag` を付けずにデプロイした状態。ロードバランサーもタスクも無い
- イメージ 1 つで 0.1 GB と仮定（イメージを一度もビルドしていないので、実際の大きさは測っていない。workerd のバイナリだけで、展開後 139 MB、圧縮した配布物で 40 MB ある）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ecr.storage` | 0.1 | GB-Mo | 0.1 GB stored (assumption) | 0.01 | - | 0.01 |

- 定価の小計: **USD 0.01** / 月
- 毎月の無料枠適用後の小計: **USD 0.01** / 月
- 無料枠を確認できず、何も引いていない単価: `ecr.storage`

## Isolates: 月 1,500 万リクエストを workerd と Fargate で

ID: `isolates-load-fargate` / 章: [64 Isolates: V8 isolate の実行環境を AWS でセルフホストする](/ja/chapters/64-isolates.md)

前提:

- `isolates-idle` の構成のまま、タスクは 1 つ
- 1 リクエストあたり CPU 時間 7 ms。月の平均では 0.25 vCPU の 16% にあたる。瞬間的な集中は考えていない
- LCU は新しい接続の数で数えた。1 リクエストにつき接続 1 本と仮定すると毎秒 5.7 本で 0.228 LCU、730 時間で 166.7 LCU 時間
- ログ、データ転送、リポジトリの保存料は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 182.5 | hours | 1 tasks x 0.25 vCPU x 730 hours | 7.38 | - | 7.38 |
| `fargate.arm.memory.gb-hour` | 365 | hours | 1 tasks x 0.5 GB x 730 hours | 1.61 | - | 1.61 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,190 | Hrs | (2 load balancer nodes + 1 tasks) x 730 hours | 10.95 | - | 10.95 |
| `alb.lcu.hour` | 166.7 | LCU-Hrs | 0.228 LCU x 730 hours (assumption: one new connection per request) | 1.33 | - | 1.33 |

- 定価の小計: **USD 39.02** / 月
- 毎月の無料枠適用後の小計: **USD 39.02** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `alb.lcu.hour`

## Isolates: 同じ月 1,500 万リクエストを 04章の構成で

ID: `isolates-load-lambda` / 章: [64 Isolates: V8 isolate の実行環境を AWS でセルフホストする](/ja/chapters/64-isolates.md)

前提:

- API Gateway の HTTP API と、256 MB、arm64 の Lambda 関数
- Lambda は CPU 時間ではなく実行時間に課金する。1 リクエストの実行時間は、04章のシナリオと同じ 50 ms と仮定した
- ログとデータ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 15,000,000 | Requests | one HTTP API request each | 19.35 | - | 19.35 |
| `lambda.request.arm` | 15,000,000 | Requests | one invocation per request | 3.00 | 1,000,000 | 2.80 |
| `lambda.duration.arm` | 187,500 | Lambda-GB-Second | 15000000 x 0.05 s x 0.25 GB, in GB-seconds | 2.50 | 400,000 | 0 |

- 定価の小計: **USD 24.85** / 月
- 毎月の無料枠適用後の小計: **USD 22.15** / 月
- 無料枠を確認できず、何も引いていない単価: `apigw.http.request`

## Nitro: エンクレーブ対応のインスタンスと鍵を 1 か月置いたまま

ID: `nitro-idle-running` / 章: [68 Nitro: EC2 を支えるしくみ、Nitro Enclaves、Graviton](/ja/chapters/68-nitro.md)

前提:

- c6g.large 1 台を起動したまま 730 時間。エンクレーブは起動していてもいなくても同じ
- ルートボリュームは 8 GiB の gp3（23章と同じ仮定。AMI が決める値で、確かめていない）
- customer managed key が 1 つ。リクエストは 0 件
- パブリックサブネットに置き、自動割り当てのパブリック IPv4 アドレスを 1 つ持つ
- 11章のネットワークの料金、データ転送、KMS のリクエストは含まない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.c6g-large.linux.hour` | 730 | Hrs | 1 c6g.large x 730 hours | 62.49 | - | 62.49 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 public IPv4 address x 730 hours | 3.65 | - | 3.65 |
| `ebs.gp3.storage` | 8 | GB-Mo | 8 GiB root (assumed), 730 of 730 hours | 0.77 | - | 0.77 |
| `kms.key` | 1 | Keys | 1 customer managed key, 730 of 730 hours | 1.00 | - | 1.00 |

- 定価の小計: **USD 67.91** / 月
- 毎月の無料枠適用後の小計: **USD 67.91** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `ec2.c6g-large.linux.hour`, `kms.key`, `ebs.gp3.storage`

## Nitro: インスタンスを停止して 1 か月

ID: `nitro-idle-stopped` / 章: [68 Nitro: EC2 を支えるしくみ、Nitro Enclaves、Graviton](/ja/chapters/68-nitro.md)

前提:

- c6g.large 1 台を停止したまま 730 時間。エンクレーブは起動していてもいなくても同じ
- ルートボリュームは 8 GiB の gp3（23章と同じ仮定。AMI が決める値で、確かめていない）
- customer managed key が 1 つ。リクエストは 0 件
- 自動割り当てのパブリック IPv4 アドレスは、停止すると解放される
- 11章のネットワークの料金、データ転送、KMS のリクエストは含まない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ebs.gp3.storage` | 8 | GB-Mo | 8 GiB root (assumed), 730 of 730 hours | 0.77 | - | 0.77 |
| `kms.key` | 1 | Keys | 1 customer managed key, 730 of 730 hours | 1.00 | - | 1.00 |

- 定価の小計: **USD 1.77** / 月
- 毎月の無料枠適用後の小計: **USD 1.77** / 月
- 無料枠を確認できず、何も引いていない単価: `kms.key`, `ebs.gp3.storage`

## 本番向けの設定がノート API に足す料金: 月 100 万リクエスト

ID: `ready-added-small` / 章: [33 Production Readiness: 本番に出す前の点検](/ja/chapters/33-production-readiness.md)

前提:

- 19章の obs-small と同じ流量。ログは 1 リクエストあたり 1 KB で、月 0.953674 GB を取り込む
- ログの保持を 7 日から 90 日に延ばす。月平均の保存量を、取り込み量の 90/30 と 7/30 の差と仮定
- テーブルの大きさは 1 GB。PITR の保存量はテーブルと同じ 1 GB と仮定（変更の記録のぶんは未確認で、含めていない）
- 削除保護、DeletionPolicy、UpdateReplacePolicy には、Price List に対応する項目がない
- アラーム、メトリクス、トレースは 19章の計算のとおりで、ここには含めていない。通知先のメールの料金も含めていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.pitr.storage` | 1 | GB-Mo | 1 GB table, PITR storage assumed equal to it | 0.23 | - | 0.23 |
| `logs.storage` | 2.638 | GB-Mo | 0.953674 GB x (90 - 7)/30, in GB-month | 0.09 | 5 | 0 |

- 定価の小計: **USD 0.32** / 月
- 毎月の無料枠適用後の小計: **USD 0.23** / 月

## EKS: スタックだけをデプロイして 1 か月（マニフェストは未適用）

ID: `eks-control-plane-only` / 章: [34 Kubernetes: EKS、Auto Mode、Pod Identity、ALB](/ja/chapters/34-eks.md)

前提:

- 標準サポートのバージョンのクラスター 1 つを 730 時間
- 組み込みのノードプールを無効にしているので、ノードもロードバランサーも無い

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `eks.cluster.hour` | 730 | Hours | 1 cluster x 730 hours | 73.00 | - | 73.00 |

- 定価の小計: **USD 73.00** / 月
- 毎月の無料枠適用後の小計: **USD 73.00** / 月
- 無料枠を確認できず、何も引いていない単価: `eks.cluster.hour`

## EKS: 既定の構成でアプリを動かしたまま 1 か月

ID: `eks-idle` / 章: [34 Kubernetes: EKS、Auto Mode、Pod Identity、ALB](/ja/chapters/34-eks.md)

前提:

- 標準サポートのバージョンのクラスター 1 つを 730 時間
- ノードは t4g.medium（arm64、オンデマンド）が AZ ごとに 1 つで 2 つ。Auto Mode の管理料金を含む
- ノードのエフェメラルストレージは 20 GB ずつで gp3 と仮定。ルートボリュームの大きさは確認できず、未算入
- ALB 1 つを 730 時間。LCU は未算入
- パブリック IPv4 アドレスは ALB のノード 2 つと EKS のノード 2 つで 4 つ
- ログ、データ転送、T4g の CPU クレジットの超過分、12章のリポジトリの保存料金、ノードプールが増やしたノードは未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `eks.cluster.hour` | 730 | Hours | 1 cluster x 730 hours | 73.00 | - | 73.00 |
| `ec2.t4g-medium.linux.hour` | 1,460 | Hrs | 2 t4g.medium nodes x 730 hours | 63.07 | - | 63.07 |
| `eks.auto.t4g-medium.hour` | 1,460 | hours | 2 nodes managed by Auto Mode x 730 hours | 7.56 | - | 7.56 |
| `ebs.gp3.storage` | 40 | GB-Mo | 2 nodes x 20 GB of ephemeral storage (gp3 assumed) | 3.84 | - | 3.84 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,920 | Hrs | (2 load balancer nodes + 2 nodes) x 730 hours | 14.60 | - | 14.60 |

- 定価の小計: **USD 179.81** / 月
- 毎月の無料枠適用後の小計: **USD 179.81** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `eks.cluster.hour`, `eks.auto.t4g-medium.hour`, `ec2.t4g-medium.linux.hour`, `alb.hour`, `ebs.gp3.storage`

## EKS: 既定の構成でアプリを動かして 1 日

ID: `eks-one-day` / 章: [34 Kubernetes: EKS、Auto Mode、Pod Identity、ALB](/ja/chapters/34-eks.md)

前提:

- eks-idle と同じ構成を 24 時間

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `eks.cluster.hour` | 24 | Hours | 1 cluster x 24 hours | 2.40 | - | 2.40 |
| `ec2.t4g-medium.linux.hour` | 48 | Hrs | 2 t4g.medium nodes x 24 hours | 2.07 | - | 2.07 |
| `eks.auto.t4g-medium.hour` | 48 | hours | 2 nodes managed by Auto Mode x 24 hours | 0.25 | - | 0.25 |
| `ebs.gp3.storage` | 1.315 | GB-Mo | 2 nodes x 20 GB of ephemeral storage (gp3 assumed) | 0.13 | - | 0.13 |
| `alb.hour` | 24 | Hrs | 1 load balancer x 24 hours | 0.58 | - | 0.58 |
| `vpc.public-ipv4.in-use.hour` | 96 | Hrs | (2 load balancer nodes + 2 nodes) x 24 hours | 0.48 | - | 0.48 |

- 定価の小計: **USD 5.91** / 月
- 毎月の無料枠適用後の小計: **USD 5.91** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `eks.cluster.hour`, `eks.auto.t4g-medium.hour`, `ec2.t4g-medium.linux.hour`, `alb.hour`, `ebs.gp3.storage`

## EKS: ノードをプライベートサブネットに置き、NAT Gateway 1 つで出る

ID: `eks-private-nodes` / 章: [34 Kubernetes: EKS、Auto Mode、Pod Identity、ALB](/ja/chapters/34-eks.md)

前提:

- `--node-subnets private`、11章を `-c egress=nat` でデプロイ
- ノードは t4g.medium（arm64、オンデマンド）が AZ ごとに 1 つで 2 つ。Auto Mode の管理料金を含む
- ノードのエフェメラルストレージは 20 GB ずつで gp3 と仮定。ルートボリュームの大きさは確認できず、未算入
- ALB 1 つを 730 時間。LCU は未算入
- ノードはパブリック IPv4 アドレスを持たない。ALB のノード 2 つと NAT Gateway の Elastic IP アドレスで 3 つ
- NAT Gateway を通るデータは月 2 GB と仮定
- ログ、データ転送、T4g の CPU クレジットの超過分、12章のリポジトリの保存料金、ノードプールが増やしたノードは未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `eks.cluster.hour` | 730 | Hours | 1 cluster x 730 hours | 73.00 | - | 73.00 |
| `ec2.t4g-medium.linux.hour` | 1,460 | Hrs | 2 t4g.medium nodes x 730 hours | 63.07 | - | 63.07 |
| `eks.auto.t4g-medium.hour` | 1,460 | hours | 2 nodes managed by Auto Mode x 730 hours | 7.56 | - | 7.56 |
| `ebs.gp3.storage` | 40 | GB-Mo | 2 nodes x 20 GB of ephemeral storage (gp3 assumed) | 3.84 | - | 3.84 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,190 | Hrs | (2 load balancer nodes + 1 NAT gateway) x 730 hours | 10.95 | - | 10.95 |
| `nat.gateway.hour` | 730 | Hrs | 1 NAT gateway x 730 hours | 45.26 | - | 45.26 |
| `nat.gateway.data` | 2 | GB | 2 GB processed (assumption) | 0.12 | - | 0.12 |

- 定価の小計: **USD 221.55** / 月
- 毎月の無料枠適用後の小計: **USD 221.55** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `eks.cluster.hour`, `eks.auto.t4g-medium.hour`, `ec2.t4g-medium.linux.hour`, `alb.hour`, `ebs.gp3.storage`

## EKS: 延長サポートに入ったバージョンのまま 1 か月

ID: `eks-extended-support` / 章: [34 Kubernetes: EKS、Auto Mode、Pod Identity、ALB](/ja/chapters/34-eks.md)

前提:

- eks-idle と同じ構成
- upgradePolicy が EXTENDED で、バージョンが標準サポートを過ぎている。時間あたり USD 0.50 が上乗せされる

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `eks.cluster.hour` | 730 | Hours | 1 cluster x 730 hours | 73.00 | - | 73.00 |
| `eks.cluster.extended-support.hour` | 730 | Hours | 1 cluster in extended support x 730 hours | 365.00 | - | 365.00 |
| `ec2.t4g-medium.linux.hour` | 1,460 | Hrs | 2 t4g.medium nodes x 730 hours | 63.07 | - | 63.07 |
| `eks.auto.t4g-medium.hour` | 1,460 | hours | 2 nodes managed by Auto Mode x 730 hours | 7.56 | - | 7.56 |
| `ebs.gp3.storage` | 40 | GB-Mo | 2 nodes x 20 GB of ephemeral storage (gp3 assumed) | 3.84 | - | 3.84 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,920 | Hrs | (2 load balancer nodes + 2 nodes) x 730 hours | 14.60 | - | 14.60 |

- 定価の小計: **USD 544.81** / 月
- 毎月の無料枠適用後の小計: **USD 544.81** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `eks.cluster.hour`, `eks.cluster.extended-support.hour`, `eks.auto.t4g-medium.hour`, `ec2.t4g-medium.linux.hour`, `alb.hour`, `ebs.gp3.storage`

## Distributed SQL: 既定のスタック（ノードなし）を 1 か月

ID: `distsql-foundation` / 章: [66 Distributed SQL: 分散 DB を EC2 でセルフホストする](/ja/chapters/66-distributed-sql.md)

前提:

- `-c nodes=3` を付けずにデプロイ。バケット、ロール、セキュリティグループだけ
- バケットに、ノード用のアーカイブ 0.48 GB を置いたまま

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3.standard.storage` | 0.48 | GB-Mo | the release archive for the nodes | 0.01 | - | 0.01 |

- 定価の小計: **USD 0.01** / 月
- 毎月の無料枠適用後の小計: **USD 0.01** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`

## Distributed SQL: 3 ノードを動かしたまま、クエリなしで 1 か月

ID: `distsql-cluster-idle` / 章: [66 Distributed SQL: 分散 DB を EC2 でセルフホストする](/ja/chapters/66-distributed-sql.md)

前提:

- `-c nodes=3`、t4g.medium を 3 台、730 時間
- ルートボリュームは 8 GiB と仮定（AMI が決める。実際の大きさは確かめていない）。データボリュームは 1 台 20 GiB。どちらも gp3 で、追加料金のかからない IOPS とスループットの範囲
- 11章のネットワークを 3 つのゾーンで作り、Systems Manager のインターフェースエンドポイント 3 つ（ssm、ssmmessages、ec2messages）を 3 つのゾーンに置いたまま
- CPU クレジットは standard なので、ベースラインを超えた分の課金はない
- バケットには、ノード用のアーカイブ 0.48 GB だけ

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-medium.linux.hour` | 2,190 | Hrs | 3 t4g.medium x 730 hours | 94.61 | - | 94.61 |
| `ebs.gp3.storage` | 84 | GB-Mo | 3 x (8 GiB root, assumed + 20 GiB data) | 8.06 | - | 8.06 |
| `vpc.endpoint.interface.hour` | 6,570 | Hrs | 3 interface endpoints x 3 zones x 730 hours | 91.98 | - | 91.98 |
| `s3.standard.storage` | 0.48 | GB-Mo | the release archive for the nodes | 0.01 | - | 0.01 |

- 定価の小計: **USD 194.66** / 月
- 毎月の無料枠適用後の小計: **USD 194.66** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `ec2.t4g-medium.linux.hour`, `ebs.gp3.storage`

## Distributed SQL: 3 ノードで、毎秒 10 件の書き込みを 1 か月

ID: `distsql-cluster-load` / 章: [66 Distributed SQL: 分散 DB を EC2 でセルフホストする](/ja/chapters/66-distributed-sql.md)

前提:

- `-c nodes=3`、t4g.medium を 3 台、730 時間
- ルートボリュームは 8 GiB と仮定（AMI が決める。実際の大きさは確かめていない）。データボリュームは 1 台 20 GiB。どちらも gp3 で、追加料金のかからない IOPS とスループットの範囲
- 11章のネットワークを 3 つのゾーンで作り、Systems Manager のインターフェースエンドポイント 3 つ（ssm、ssmmessages、ec2messages）を 3 つのゾーンに置いたまま
- CPU クレジットは standard なので、ベースラインを超えた分の課金はない
- バケットには、ノード用のアーカイブ 0.48 GB だけ
- 毎秒 10 件の書き込みが 730 時間。1 件が複製で運ぶ量を 2,000 バイトと仮定（測っていない）
- tablet のリーダーは、別のゾーンにいる 2 つのフォロワーへ書き込みを送る。ゾーンをまたぐ転送は送る側と受ける側の両方で計量されるので、1 バイトが 4 回数えられる
- ハートビート、トランザクションの状態の記録、別のゾーンのリーダーへ回される読み取り、クライアントとノードのあいだの転送は入れていない。実際はこれより多い

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-medium.linux.hour` | 2,190 | Hrs | 3 t4g.medium x 730 hours | 94.61 | - | 94.61 |
| `ebs.gp3.storage` | 84 | GB-Mo | 3 x (8 GiB root, assumed + 20 GiB data) | 8.06 | - | 8.06 |
| `vpc.endpoint.interface.hour` | 6,570 | Hrs | 3 interface endpoints x 3 zones x 730 hours | 91.98 | - | 91.98 |
| `s3.standard.storage` | 0.48 | GB-Mo | the release archive for the nodes | 0.01 | - | 0.01 |
| `datatransfer.regional` | 210.24 | GB | 10 writes/s x 2000 bytes x 730 hours, to 2 followers, metered out and in | 2.10 | - | 2.10 |

- 定価の小計: **USD 196.77** / 月
- 毎月の無料枠適用後の小計: **USD 196.77** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `ec2.t4g-medium.linux.hour`, `datatransfer.regional`, `ebs.gp3.storage`

## Distributed SQL: スタックを消したあとに残るデータボリューム

ID: `distsql-retained-after-destroy` / 章: [66 Distributed SQL: 分散 DB を EC2 でセルフホストする](/ja/chapters/66-distributed-sql.md)

前提:

- 既定の `stateOnDestroy=retain` で作った `-c nodes=3` のスタックを消してから 730 時間
- 残るのは 20 GiB のデータボリューム 3 つ。ルートボリュームはインスタンスと一緒に消える
- 残したバケットの保管料と、11章のスタックに残したエンドポイントは入れていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ebs.gp3.storage` | 60 | GB-Mo | 3 retained data volumes x 20 GiB | 5.76 | - | 5.76 |

- 定価の小計: **USD 5.76** / 月
- 毎月の無料枠適用後の小計: **USD 5.76** / 月
- 無料枠を確認できず、何も引いていない単価: `ebs.gp3.storage`

## Aurora DSQL: 毎秒 10 件の書き込みと 90 件の読み取りを 1 か月

ID: `distsql-dsql-same-load` / 章: [66 Distributed SQL: 分散 DB を EC2 でセルフホストする](/ja/chapters/66-distributed-sql.md)

前提:

- 毎秒 10 件の書き込みと 90 件の読み取りが 730 時間
- 1 件あたりの DPU は 13章の仮定と同じ（読み取り 0.00675、書き込み 0.18525）。この負荷で測った値ではない
- データは 10 GB
- バックアップ、Lambda、ネットワークは入れていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dsql.dpu` | 6,464,880 | DPU | 10 writes/s x 0.18525 DPU + 90 reads/s x 0.00675 DPU, for 730 hours | 64.65 | 100,000 | 63.65 |
| `dsql.storage` | 10 | GB-Month | 10 GB stored | 4.00 | 1 | 3.60 |

- 定価の小計: **USD 68.65** / 月
- 毎月の無料枠適用後の小計: **USD 67.25** / 月

## Aurora Serverless v2: 止めずに動かす最小の構成で 1 か月、データ 10 GB

ID: `distsql-aurora-floor` / 章: [66 Distributed SQL: 分散 DB を EC2 でセルフホストする](/ja/chapters/66-distributed-sql.md)

前提:

- Aurora PostgreSQL、writer 1 つが最小の 0.5 ACU のまま 730 時間
- 0.5 ACU でこの章の負荷をさばけるかは確かめていない。足りなければ ACU が増え、その分だけ高くなる
- Aurora Standard。I/O の料金は入れていない（件数を見積もる根拠がない）
- データは 10 GB

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu` | 365 | ACU-Hr | 0.5 ACU x 730 hours | 54.75 | - | 54.75 |
| `aurora.postgres.storage` | 10 | GB-Mo | 10 GB stored | 1.20 | - | 1.20 |

- 定価の小計: **USD 55.95** / 月
- 毎月の無料枠適用後の小計: **USD 55.95** / 月

## Firecracker を試すホスト: 2 時間で消す

ID: `firecracker-host-two-hours` / 章: [67 Firecracker: Lambda と Fargate の下で動く microVM](/ja/chapters/67-firecracker.md)

前提:

- -c run=true でデプロイし、2 時間後に destroy
- c7i.large 1 台、パブリック IPv4 アドレス 1 つ、16 GiB の gp3 ルートボリューム
- ダウンロードのデータ転送、S3 のキット（数十 KB）、Session Manager は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.c7i-large.linux.hour` | 2 | Hrs | 1 c7i.large x 2 hours | 0.22 | - | 0.22 |
| `vpc.public-ipv4.in-use.hour` | 2 | Hrs | 1 public IPv4 address x 2 hours | 0.01 | - | 0.01 |
| `ebs.gp3.storage` | 0.044 | GB-Mo | 16 GiB x 2 / 730 of a month | 0.004205 | - | 0.004205 |

- 定価の小計: **USD 0.24** / 月
- 毎月の無料枠適用後の小計: **USD 0.24** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `ec2.c7i-large.linux.hour`, `ebs.gp3.storage`

## Firecracker を試すホスト: 消し忘れて 1 か月

ID: `firecracker-host-month` / 章: [67 Firecracker: Lambda と Fargate の下で動く microVM](/ja/chapters/67-firecracker.md)

前提:

- -c run=true でデプロイしたまま 730 時間
- c7i.large 1 台、パブリック IPv4 アドレス 1 つ、16 GiB の gp3 ルートボリューム
- 11章のネットワークに NAT Gateway やエンドポイントを置いていない場合。データ転送は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.c7i-large.linux.hour` | 730 | Hrs | 1 c7i.large x 730 hours | 82.02 | - | 82.02 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 public IPv4 address x 730 hours | 3.65 | - | 3.65 |
| `ebs.gp3.storage` | 16 | GB-Mo | 16 GiB for the month | 1.54 | - | 1.54 |

- 定価の小計: **USD 87.20** / 月
- 毎月の無料枠適用後の小計: **USD 87.20** / 月
- 無料枠を確認できず、何も引いていない単価: `vpc.public-ipv4.in-use.hour`, `ec2.c7i-large.linux.hour`, `ebs.gp3.storage`

## 参考: c5.metal で 2 時間

ID: `firecracker-metal-two-hours` / 章: [67 Firecracker: Lambda と Fargate の下で動く microVM](/ja/chapters/67-firecracker.md)

前提:

- Firecracker の手引きが例に挙げる c5.metal を 2 時間。このスタックは作らない
- インスタンスの時間料金だけ

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.c5-metal.linux.hour` | 2 | Hrs | 1 c5.metal x 2 hours | 10.27 | - | 10.27 |

- 定価の小計: **USD 10.27** / 月
- 毎月の無料枠適用後の小計: **USD 10.27** / 月
- 無料枠を確認できず、何も引いていない単価: `ec2.c5-metal.linux.hour`

## 非同期の検査と掃除: デプロイ済みで、画像が 1 枚もない月

ID: `async-idle` / 章: [08 Queue: SQS、DLQ、冪等性、Scheduler](/ja/chapters/08-async.md)

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

ID: `async-pipeline-small` / 章: [08 Queue: SQS、DLQ、冪等性、Scheduler](/ja/chapters/08-async.md)

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

ID: `async-housekeeping-10k` / 章: [08 Queue: SQS、DLQ、冪等性、Scheduler](/ja/chapters/08-async.md)

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

## SSR: デプロイ済みで誰も来ない月

ID: `ssr-idle` / 章: [09 SSR: BFF、Nuxt をリージョンの Lambda で動かす](/ja/chapters/09-ssr.md)

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

ID: `ssr-small` / 章: [09 SSR: BFF、Nuxt をリージョンの Lambda で動かす](/ja/chapters/09-ssr.md)

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

## コンテナ: repository だけ（image tag なしで deploy）

ID: `containers-repository-only` / 章: [12 Containers: ECR、ECS/Fargate、ALB](/ja/chapters/12-containers.md)

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

ID: `containers-idle` / 章: [12 Containers: ECR、ECS/Fargate、ALB](/ja/chapters/12-containers.md)

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

ID: `containers-one-day` / 章: [12 Containers: ECR、ECS/Fargate、ALB](/ja/chapters/12-containers.md)

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

ID: `containers-small` / 章: [12 Containers: ECR、ECS/Fargate、ALB](/ja/chapters/12-containers.md)

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

ID: `containers-private-nat` / 章: [12 Containers: ECR、ECS/Fargate、ALB](/ja/chapters/12-containers.md)

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

ID: `containers-private-endpoints` / 章: [12 Containers: ECR、ECS/Fargate、ALB](/ja/chapters/12-containers.md)

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

## Aurora DSQL: 1 GB のデータを置いて、誰も問い合わせない月

ID: `sql-dsql-idle` / 章: [13 SQL: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2](/ja/chapters/13-sql.md)

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

ID: `sql-dsql-small` / 章: [13 SQL: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2](/ja/chapters/13-sql.md)

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

ID: `sql-rds-min` / 章: [13 SQL: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2](/ja/chapters/13-sql.md)

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

ID: `sql-aurora-min` / 章: [13 SQL: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2](/ja/chapters/13-sql.md)

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

ID: `sql-aurora-paused` / 章: [13 SQL: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2](/ja/chapters/13-sql.md)

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

## 長い処理: デプロイ済みで、ノートが 1 件もない月

ID: `export-idle` / 章: [16 Workflow: ECS task、Step Functions、Lambda durable functions、AWS Batch](/ja/chapters/16-long-jobs.md)

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

ID: `export-daily-10k-coarse` / 章: [16 Workflow: ECS task、Step Functions、Lambda durable functions、AWS Batch](/ja/chapters/16-long-jobs.md)

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

ID: `export-daily-10k-fine` / 章: [16 Workflow: ECS task、Step Functions、Lambda durable functions、AWS Batch](/ja/chapters/16-long-jobs.md)

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

ID: `export-daily-10k-durable` / 章: [16 Workflow: ECS task、Step Functions、Lambda durable functions、AWS Batch](/ja/chapters/16-long-jobs.md)

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

ID: `export-step-fargate-1h` / 章: [16 Workflow: ECS task、Step Functions、Lambda durable functions、AWS Batch](/ja/chapters/16-long-jobs.md)

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

## 監視つきノート API: デプロイ済みで呼ばれない月

ID: `obs-idle` / 章: [19 Observability: CloudWatch、OpenTelemetry、RUM、Synthetics](/ja/chapters/19-observability.md)

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

ID: `obs-small` / 章: [19 Observability: CloudWatch、OpenTelemetry、RUM、Synthetics](/ja/chapters/19-observability.md)

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

ID: `obs-one-more-line` / 章: [19 Observability: CloudWatch、OpenTelemetry、RUM、Synthetics](/ja/chapters/19-observability.md)

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

ID: `obs-one-more-metric` / 章: [19 Observability: CloudWatch、OpenTelemetry、RUM、Synthetics](/ja/chapters/19-observability.md)

前提:

- dimension なしの custom metric を 1 つ、毎時間データ点が届く状態で 1 か月
- dimension を付けると、値の組み合わせ 1 つごとに 1 メトリクスと数える

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.metric.custom` | 1 | Metrics | 1 metric for a full month | 0.30 | 10 | 0 |

- 定価の小計: **USD 0.30** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## Synthetics: 5 分ごとの canary 1 つ

ID: `obs-canary-5min` / 章: [19 Observability: CloudWatch、OpenTelemetry、RUM、Synthetics](/ja/chapters/19-observability.md)

前提:

- 730 時間 x 毎時 12 回 = 8,760 回の実行
- canary が使う Lambda、S3、ログ、メトリクスの料金は未算入

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.synthetics.run` | 8,760 | Runs | 730 h x 12 runs | 16.64 | 100 | 16.45 |

- 定価の小計: **USD 16.64** / 月
- 毎月の無料枠適用後の小計: **USD 16.45** / 月

## RUM: 月 1 万回の訪問を全件収集

ID: `obs-rum-small` / 章: [19 Observability: CloudWatch、OpenTelemetry、RUM、Synthetics](/ja/chapters/19-observability.md)

前提:

- 1 回の訪問で 20 イベント（料金ページの計算例と同じ数）、session の収集率 100%
- 初回の無料トライアル（100 万イベント、1 回限り）は引いていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.rum.event` | 200,000 | Events | 10,000 visits x 20 events | 2.00 | - | 2.00 |

- 定価の小計: **USD 2.00** / 月
- 毎月の無料枠適用後の小計: **USD 2.00** / 月
- 無料枠を確認できず、何も引いていない単価: `cloudwatch.rum.event`

## 変更を届ける: stack と CI の role を置いて、誰も呼ばない月

ID: `ship-idle` / 章: [20 CI/CD: OIDC、環境、preview、rollback、drift](/ja/chapters/20-shipping.md)

前提:

- API へのリクエストゼロ。log は失効して保存量ゼロ
- CloudFormation は AWS:: の resource type に追加料金なし。IAM の role と OIDC provider は IAM の一部で、追加料金なし
- deploy も drift 検出も 0 回
- GitHub Actions の料金は AWS の請求ではないので含めていない

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月

## 変更を届ける: 1 日 1 回のデプロイを 1 年続けて、asset を一度も片付けない

ID: `ship-assets-year` / 章: [20 CI/CD: OIDC、環境、preview、rollback、drift](/ja/chapters/20-shipping.md)

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

ID: `recovery-keep` / 章: [22 Backup: PITR、snapshot、S3 versioning、AWS Backup](/ja/chapters/22-recovery.md)

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

ID: `recovery-drill` / 章: [22 Backup: PITR、snapshot、S3 versioning、AWS Backup](/ja/chapters/22-recovery.md)

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

ID: `recovery-backup-optin` / 章: [22 Backup: PITR、snapshot、S3 versioning、AWS Backup](/ja/chapters/22-recovery.md)

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

ID: `recovery-replica-optin` / 章: [22 Backup: PITR、snapshot、S3 versioning、AWS Backup](/ja/chapters/22-recovery.md)

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

## EC2: private subnet で 1 か月動かしたまま

ID: `ec2-private-running` / 章: [23 VM: EC2、SSM、EBS、プロセス運用](/ja/chapters/23-ec2.md)

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

ID: `ec2-private-stopped` / 章: [23 VM: EC2、SSM、EBS、プロセス運用](/ja/chapters/23-ec2.md)

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

ID: `ec2-public-running` / 章: [23 VM: EC2、SSM、EBS、プロセス運用](/ja/chapters/23-ec2.md)

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

ID: `ec2-public-stopped` / 章: [23 VM: EC2、SSM、EBS、プロセス運用](/ja/chapters/23-ec2.md)

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

## Ledger: デプロイ済みで追記のない月

ID: `ledger-idle` / 章: [58 Ledger: QLDB のいまと、検証できる追記専用の台帳](/ja/chapters/58-ledger.md)

前提:

- 既定のスタック。台帳に 1,000 件、テーブルは 1 MB 未満。ダイジェストは 1 件だけあり、新しい追記はない
- ダイジェストの関数は 1 時間に 1 回、月 730 回動く。1 回につき、バージョンの一覧 1 回、最新のダイジェストの取得 1 回、テーブルへの強整合の Query 1 回（4 KB 以下）。追記がないので PutObject はしない
- 関数は 256 MB で 0.5 秒かかると仮定（計測値ではない）。ログは 1 回 300 バイト
- 1 時間ごとのルールが関数を呼ぶこと自体の料金は、価格表のどの項目に当たるか確認できなかったので入れていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.storage` | 0.001 | GB-Mo | 1 MB in the table, in GB-month | 0 | - | 0 |
| `dynamodb.read.on-demand` | 730 | ReadRequestUnits | 730 runs, one strongly consistent Query of 4 KB or less each: 1 unit | 0.000104 | - | 0.000104 |
| `s3.request.tier1` | 730 | Requests | 730 ListObjectVersions requests | 0.003431 | - | 0.003431 |
| `s3.request.tier2` | 730 | Requests | 730 GetObject requests for the newest digest | 0.000270 | - | 0.000270 |
| `s3.standard.storage` | 0 | GB-Mo | One digest of about 150 bytes, rounded up to 1 KB | 0.000000 | - | 0.000000 |
| `lambda.request.arm` | 730 | Requests | 730 scheduled invocations | 0.000146 | 1,000,000 | 0 |
| `lambda.duration.arm` | 91.25 | Lambda-GB-Second | 730 x 0.5 s x 0.25 GB | 0.001217 | 400,000 | 0 |
| `logs.ingest.standard` | 0 | GB | 730 x 300 bytes | 0.000167 | 5 | 0 |

- 定価の小計: **USD 0.01** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `s3.request.tier1`, `s3.request.tier2`

## Ledger: 月 10 万件の追記

ID: `ledger-month` / 章: [58 Ledger: QLDB のいまと、検証できる追記専用の台帳](/ja/chapters/58-ledger.md)

前提:

- 月 10 万件の追記。1 件は 300 バイト前後で 1 KB 以下。追記 1 回は、末尾を読む強整合の Query 1 回（1 ユニット）と、書き込み 1 回（1 ユニット）。PartiQL の INSERT が PutItem と同じユニットで課金されるかは確認していない。番号の取り合いによるやり直しは 0 と仮定
- ダイジェストは 1 時間ごとに 730 回。1 回に新しい 137 件（約 41 KB）を強整合で読むので 11 ユニット。S3 へは、バージョンの一覧 1 回、最新のダイジェストの取得 1 回、PutObject 1 回。一覧は月のあいだ 1 ページに収まる
- 月に 1 回、全体を監査する。10 万件（30 MB）の読み取りで 7,500 ユニット、ダイジェスト 730 件の取得と一覧 1 回
- 関数は 256 MB で 0.5 秒かかると仮定（計測値ではない）。ログは 1 回 300 バイト。テーブルは 30 MB、ダイジェストは合わせて 1 MB 未満

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.write.on-demand` | 100,000 | WriteRequestUnits | 100,000 entries of 1 KB or less: 1 unit each | 0.07 | - | 0.07 |
| `dynamodb.read.on-demand` | 115,530 | ReadRequestUnits | 100,000 tail reads at 1 unit, 730 digest runs at 11 units (8,030), one audit of 30 MB at 1 unit per 4 KB (7,500) | 0.02 | - | 0.02 |
| `dynamodb.storage` | 0.03 | GB-Mo | 30 MB in the table, in GB-month | 0 | - | 0 |
| `s3.request.tier1` | 1,461 | Requests | 730 ListObjectVersions and 730 PutObject from the function, one listing by the audit | 0.01 | - | 0.01 |
| `s3.request.tier2` | 1,460 | Requests | 730 GetObject from the function, 730 from the audit | 0.000540 | - | 0.000540 |
| `s3.standard.storage` | 0.001 | GB-Mo | 730 digests of about 150 bytes, rounded up to 1 MB | 0.000025 | - | 0.000025 |
| `lambda.request.arm` | 730 | Requests | 730 scheduled invocations | 0.000146 | 1,000,000 | 0 |
| `lambda.duration.arm` | 91.25 | Lambda-GB-Second | 730 x 0.5 s x 0.25 GB | 0.001217 | 400,000 | 0 |
| `logs.ingest.standard` | 0 | GB | 730 x 300 bytes | 0.000167 | 5 | 0 |

- 定価の小計: **USD 0.10** / 月
- 毎月の無料枠適用後の小計: **USD 0.10** / 月
- 無料枠を確認できず、何も引いていない単価: `s3.standard.storage`, `s3.request.tier1`, `s3.request.tier2`

## ECR: スタックを置いただけで、イメージが 1 つも無い月

ID: `ecr-idle` / 章: [52 ECR: tag と digest、lifecycle、scan、複製、pull through cache](/ja/chapters/52-ecr.md)

前提:

- AihEcr を既定の設定（リポジトリだけ）でデプロイ済み
- イメージを 1 つもプッシュしていない。保存量は 0

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ecr.storage` | 0 | GB-Mo | 0 GB stored | 0 | - | 0 |

- 定価の小計: **USD 0.00** / 月
- 毎月の無料枠適用後の小計: **USD 0.00** / 月
- 無料枠を確認できず、何も引いていない単価: `ecr.storage`

## ECR: ライフサイクルポリシーが残す上限まで溜まった状態

ID: `ecr-kept` / 章: [52 ECR: tag と digest、lifecycle、scan、複製、pull through cache](/ja/chapters/52-ecr.md)

前提:

- ポリシーが残すのは、リリース 20 個と、新しいほうから 30 個。重なりが無いとして 50 個
- イメージ 1 つを 0.15 GB と仮定（イメージはビルドしていないので未計測）。イメージどうしで共有されるレイヤーが保存量にどう数えられるかは確認していないので、イメージごとに全量を数えている
- 取得は同じリージョンの Fargate からで、データ転送は USD 0

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ecr.storage` | 7.5 | GB-Mo | 50 images x 0.15 GB | 0.75 | - | 0.75 |

- 定価の小計: **USD 0.75** / 月
- 毎月の無料枠適用後の小計: **USD 0.75** / 月
- 無料枠を確認できず、何も引いていない単価: `ecr.storage`

## ECR: ライフサイクルポリシーなしで 1 年たった時点の月額

ID: `ecr-unpruned` / 章: [52 ECR: tag と digest、lifecycle、scan、複製、pull through cache](/ja/chapters/52-ecr.md)

前提:

- 平日に 1 日 5 回プッシュし、何も消さない。月 20 日で 12 か月、1,200 個
- イメージ 1 つを 0.15 GB と仮定（イメージはビルドしていないので未計測）。イメージどうしで共有されるレイヤーが保存量にどう数えられるかは確認していないので、イメージごとに全量を数えている
- 1 年たった時点の 1 か月ぶん。それまでの月の合計ではない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ecr.storage` | 180 | GB-Mo | 1,200 images x 0.15 GB | 18.00 | - | 18.00 |

- 定価の小計: **USD 18.00** / 月
- 毎月の無料枠適用後の小計: **USD 18.00** / 月
- 無料枠を確認できず、何も引いていない単価: `ecr.storage`

## ECR: enhanced scanning を有効にした月

ID: `ecr-enhanced-scan` / 章: [52 ECR: tag と digest、lifecycle、scan、複製、pull through cache](/ja/chapters/52-ecr.md)

前提:

- 月に 100 回プッシュし、それぞれ最初の検査が 1 回
- 残っている 50 個のイメージが、月に 4 回ずつ検査し直されると仮定。検査し直しが何回起きるかは新しい脆弱性の公開しだいで、この回数に根拠はない
- Inspector の無料トライアルは引いていない

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `inspector.image.initial-scan` | 100 | Resource-assessment | 100 pushes | 11.00 | - | 11.00 |
| `inspector.image.rescan` | 200 | Resource-assessment | 50 images x 4 re-scans (assumption) | 2.00 | - | 2.00 |

- 定価の小計: **USD 13.00** / 月
- 毎月の無料枠適用後の小計: **USD 13.00** / 月
- 無料枠を確認できず、何も引いていない単価: `inspector.image.initial-scan`, `inspector.image.rescan`

## ECR: 大阪リージョンへ複製する月のデータ転送

ID: `ecr-replicate-osaka` / 章: [52 ECR: tag と digest、lifecycle、scan、複製、pull through cache](/ja/chapters/52-ecr.md)

前提:

- 月に 100 回プッシュし、すべて大阪へ複製される
- イメージ 1 つを 0.15 GB と仮定（イメージはビルドしていないので未計測）。イメージどうしで共有されるレイヤーが保存量にどう数えられるかは確認していないので、イメージごとに全量を数えている
- 大阪側の保存料金は含めていない（大阪の単価は確認していない）

| 単価 ID | 数量 | 単位 | 数量の根拠 | 定価 | 無料枠 | 無料枠適用後 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `datatransfer.tokyo-osaka` | 15 | GB | 100 images x 0.15 GB | 1.35 | - | 1.35 |

- 定価の小計: **USD 1.35** / 月
- 毎月の無料枠適用後の小計: **USD 1.35** / 月
- 無料枠を確認できず、何も引いていない単価: `datatransfer.tokyo-osaka`

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
| `ses.outbound.message` | ap-northeast-1 | APN1-Recipients | Count | 0 - ∞: 0.0001000000 | 2026-09-11 | 2026-10-11 |
| `sns.request` | ap-northeast-1 | APN1-Requests-Tier1 | Requests | 0 - 1,000,000: 0.0000000000<br>1,000,000 - ∞: 0.0000005000 | 2026-09-15 | 2026-10-11 |
| `sns.delivery.lambda` | ap-northeast-1 | APN1-DeliveryAttempts-LAMBDA | Notifications | 0 - ∞: 0.0000000000 | 2026-09-15 | 2026-10-11 |
| `cloudfront.kvs.read` | global | KeyValueStore-EdgeReads | EdgeReads | 0 - 2,000,000: 0.0000000000<br>2,000,000 - ∞: 0.0000000300 | 2026-10-03 | 2026-10-11 |
| `cloudfront.kvs.api` | global | KeyValueStore-APIOperations | API Requests | 0 - ∞: 0.0010000000 | 2026-10-03 | 2026-10-11 |
| `lambdaedge.jp.request` | global | APN1-Lambda-Edge-Request | Request | 0 - ∞: 0.0000006000 | 2026-10-03 | 2026-10-11 |
| `lambdaedge.jp.duration` | global | APN1-Lambda-Edge-GB-Second | Lambda-GB-Second | 0 - ∞: 0.0000500100 | 2026-10-03 | 2026-10-11 |
| `datatransfer.out.internet` | ap-northeast-1 | APN1-DataTransfer-Out-Bytes | GB | 0 - 10,240: 0.1140000000<br>10,240 - 51,200: 0.0890000000<br>51,200 - 153,600: 0.0860000000<br>153,600 - ∞: 0.0840000000 | 2026-09-16 | 2026-10-11 |
| `elasticache.serverless.valkey.storage` | ap-northeast-1 | APN1-CachedData:Valkey | GB-Hours | 0 - ∞: 0.1010000000 | 2026-09-14 | 2026-10-12 |
| `elasticache.serverless.valkey.ecpu` | ap-northeast-1 | APN1-ElastiCacheProcessingUnits:Valkey | ElastiCacheProcessingUnit | 0 - ∞: 0.0000000027 | 2026-09-14 | 2026-10-12 |
| `elasticache.node.valkey.t4g-micro` | ap-northeast-1 | APN1-NodeUsage:cache.t4g.micro | Hrs | 0 - ∞: 0.0200000000 | 2026-09-14 | 2026-10-12 |
| `events.custom-event` | ap-northeast-1 | APN1-Event-64K-Chunks | 64K-Chunks | 0 - ∞: 0.0000010000 | 2026-09-24 | 2026-10-13 |
| `events.pipe-request` | ap-northeast-1 | APN1-Request-64K-Chunks | 64K-Chunks | 0 - ∞: 0.0000005000 | 2026-09-24 | 2026-10-13 |
| `events.archive.processing` | ap-northeast-1 | APN1-ArchivedEvents-Bytes | GigaBytes | 0 - ∞: 0.1300000000 | 2026-09-24 | 2026-10-13 |
| `events.archive.storage` | ap-northeast-1 | APN1-TimedStorage-ByteHrs | GB-Mo | 0 - ∞: 0.0250000000 | 2026-09-24 | 2026-10-13 |
| `firehose.ingest.direct-put` | ap-northeast-1 | APN1-BilledBytes | GB | 0 - 512,000: 0.0360000000<br>512,000 - 2,048,000: 0.0310000000<br>2,048,000 - ∞: 0.0250000000 | 2026-09-11 | 2026-10-13 |
| `firehose.format-conversion` | ap-northeast-1 | APN1-DFCBilledBytes | GB | 0 - ∞: 0.0220000000 | 2026-09-11 | 2026-10-13 |
| `firehose.dynamic-partitioning.gb` | ap-northeast-1 | APN1-DPBytesDelivered | GB | 0 - ∞: 0.0320000000 | 2026-09-11 | 2026-10-13 |
| `firehose.dynamic-partitioning.object` | ap-northeast-1 | APN1-S3DeliveryObjectCount | Objects | 0 - ∞: 0.0000080000 | 2026-09-11 | 2026-10-13 |
| `firehose.dynamic-partitioning.jq-hour` | ap-northeast-1 | APN1-MetadataProcessingDuration | hours | 0 - ∞: 0.1120000000 | 2026-09-11 | 2026-10-13 |
| `athena.scanned` | ap-northeast-1 | APN1-DataScannedInTB | Terabytes | 0 - ∞: 5.0000000000 | 2026-09-11 | 2026-10-13 |
| `glue.catalog.storage` | ap-northeast-1 | APN1-Catalog-Storage | Obj-Month | 0 - ∞: 0.0000100000 | 2026-10-06 | 2026-10-13 |
| `glue.catalog.request` | ap-northeast-1 | APN1-Catalog-Request | Request | 0 - ∞: 0.0000010000 | 2026-10-06 | 2026-10-13 |
| `s3vectors.storage` | ap-northeast-1 | APN1-Vectors-TimedStorage-ByteHrs | GB-Mo | 0 - ∞: 0.0660000000 | 2026-09-28 | 2026-10-13 |
| `s3vectors.put` | ap-northeast-1 | APN1-Vectors-Put-Bytes | GB | 0 - ∞: 0.2190000000 | 2026-09-28 | 2026-10-13 |
| `s3vectors.query.request` | ap-northeast-1 | APN1-Vectors-Request-Tier3 | Requests | 0 - ∞: 0.0000027000 | 2026-09-28 | 2026-10-13 |
| `s3vectors.query.processed.tier1` | ap-northeast-1 | APN1-Vectors-Query-ProcessedBytes-Tier1 | GB | 0 - ∞: 0.0000042780 | 2026-09-28 | 2026-10-13 |
| `s3vectors.request.other` | ap-northeast-1 | APN1-Vectors-Request-Tier1 | Requests | 0 - ∞: 0.0000600000 | 2026-09-28 | 2026-10-13 |
| `opensearch.serverless.ocu.indexing` | ap-northeast-1 | APN1-IndexingOCU | OCU-hours | 0 - ∞: 0.3340000000 | 2026-09-27 | 2026-10-13 |
| `opensearch.serverless.ocu.search` | ap-northeast-1 | APN1-SearchOCU | OCU-hours | 0 - ∞: 0.3340000000 | 2026-09-27 | 2026-10-13 |
| `bedrock.titan-embed-text-v2.input` | ap-northeast-1 | APN1-TitanEmbeddingV2-Text-input-tokens | 1K tokens | 0 - ∞: 0.0000290000 | 2026-10-10 | 2026-10-13 |
| `dynamodb.replicated-write` | ap-northeast-1 | APN1-ReplWriteRequestUnits | ReplicatedWriteRequestUnits | 0 - ∞: 0.0000007150 | 2026-09-11 | 2026-10-13 |
| `dynamodb.replicated-write.osaka` | ap-northeast-3 | APN3-ReplWriteRequestUnits | ReplicatedWriteRequestUnits | 0 - ∞: 0.0000007150 | 2026-09-11 | 2026-10-13 |
| `dynamodb.storage.osaka` | ap-northeast-3 | APN3-TimedStorage-ByteHrs | GB-Mo | 0 - 25: 0.0000000000<br>25 - ∞: 0.2850000000 | 2026-09-11 | 2026-10-13 |
| `dynamodb.pitr.storage.osaka` | ap-northeast-3 | APN3-TimedPITRStorage-ByteHrs | GB-Mo | 0 - ∞: 0.2280000000 | 2026-09-11 | 2026-10-13 |
| `s3.rtc.tokyo-osaka` | ap-northeast-1 | APN1-APN3-S3RTC-Out-Bytes | GB | 0 - ∞: 0.0150000000 | 2026-09-28 | 2026-10-13 |
| `route53.health-check.aws` | global | Health-Check-AWS | Mo | 0 - 50: 0.0000000000<br>50 - ∞: 0.5000000000 | 2026-09-11 | 2026-10-13 |
| `route53.health-check.option.aws` | global | Health-Check-Option-AWS | Mo | 0 - ∞: 1.0000000000 | 2026-09-11 | 2026-10-13 |
| `route53.hosted-zone` | global | HostedZone | HostedZone | 0 - 25: 0.5000000000<br>25 - ∞: 0.1000000000 | 2026-09-11 | 2026-10-13 |
| `lambda.provisioned.arm` | ap-northeast-1 | APN1-Lambda-Provisioned-Concurrency-ARM | Lambda-GB-Second | 0 - ∞: 0.0000043068 | 2026-10-09 | 2026-10-13 |
| `lambda.duration.provisioned.arm` | ap-northeast-1 | APN1-Lambda-Provisioned-GB-Second-ARM | Lambda-GB-Second | 0 - ∞: 0.0000100492 | 2026-10-09 | 2026-10-13 |
| `lambda.provisioned.x86` | ap-northeast-1 | APN1-Lambda-Provisioned-Concurrency | Lambda-GB-Second | 0 - ∞: 0.0000053835 | 2026-10-09 | 2026-10-13 |
| `lambda.duration.provisioned.x86` | ap-northeast-1 | APN1-Lambda-Provisioned-GB-Second | Lambda-GB-Second | 0 - ∞: 0.0000125615 | 2026-10-09 | 2026-10-13 |
| `dynamodb.streams.read` | ap-northeast-1 | APN1-Streams-Requests | Requests | 0 - 2,500,000: 0.0000000000<br>2,500,000 - ∞: 0.0000002280 | 2026-09-11 | 2026-10-13 |
| `cloudwatch.contributor-insights.dynamodb.rule` | ap-northeast-1 | APN1-CW:ContributorRulesManaged | Rule-Hour | 0 - ∞: 0.5000000000 | 2026-10-07 | 2026-10-13 |
| `cloudwatch.contributor-insights.dynamodb.event` | ap-northeast-1 | APN1-CW:ContributorEventsManaged | Events | 0 - ∞: 0.0000000340 | 2026-10-07 | 2026-10-13 |
| `appconfig.request` | ap-northeast-1 | APN1-AppConfig-Requests | Configuration Requests | 0 - ∞: 0.0000002000 | 2026-10-08 | 2026-10-13 |
| `appconfig.received` | ap-northeast-1 | APN1-AppConfig-Deployments | Configuration Received | 0 - ∞: 0.0008000000 | 2026-10-08 | 2026-10-13 |
| `costexplorer.api.request` | us-east-1 | USE1-APIRequest | Request | 0 - ∞: 0.0100000000 | 2026-09-11 | 2026-10-13 |
| `ec2.m6g-large.linux.hour` | ap-northeast-1 | APN1-BoxUsage:m6g.large | Hrs | 0 - ∞: 0.0990000000 | 2026-10-09 | 2026-10-13 |
| `ec2.m7g-large.linux.hour` | ap-northeast-1 | APN1-BoxUsage:m7g.large | Hrs | 0 - ∞: 0.1054000000 | 2026-10-09 | 2026-10-13 |
| `lambda.managed-instances.m6g-large.management.hour` | ap-northeast-1 | APN1-Lambda-Managed-Instances-m6g.large-Management-Hours | Hours | 0 - ∞: 0.0148500000 | 2026-10-09 | 2026-10-13 |
| `lambda.managed-instances.m7g-large.management.hour` | ap-northeast-1 | APN1-Lambda-Managed-Instances-m7g.large-Management-Hours | Hours | 0 - ∞: 0.0158100000 | 2026-10-09 | 2026-10-13 |
| `lambda.managed-instances.request.arm` | ap-northeast-1 | APN1-Lambda-Managed-Instances-Request-ARM | Requests | 0 - ∞: 0.0000002000 | 2026-10-09 | 2026-10-13 |
| `bedrock.nova-2-lite.cache-read` | ap-northeast-1 | APN1-Nova2.0Lite-cache-read-input-token-count | 1K tokens | 0 - ∞: 0.0000990000 | 2026-10-10 | 2026-10-13 |
| `bedrock.nova-2-lite.cache-write` | ap-northeast-1 | APN1-Nova2.0Lite-cache-write-input-token-count | 1K tokens | 0 - ∞: 0.0000000000 | 2026-10-10 | 2026-10-13 |
| `bedrock.nova-2-lite.input.batch` | ap-northeast-1 | APN1-Nova2.0Lite-input-tokens-batch | 1K tokens | 0 - ∞: 0.0001980000 | 2026-10-10 | 2026-10-13 |
| `bedrock.nova-2-lite.output.batch` | ap-northeast-1 | APN1-Nova2.0Lite-output-tokens-batch | 1K tokens | 0 - ∞: 0.0016555000 | 2026-10-10 | 2026-10-13 |
| `bedrock.nova-2-lite.input.flex` | ap-northeast-1 | APN1-Nova2.0Lite-input-tokens-flex | 1K tokens | 0 - ∞: 0.0001980000 | 2026-10-10 | 2026-10-13 |
| `bedrock.nova-2-lite.output.flex` | ap-northeast-1 | APN1-Nova2.0Lite-output-tokens-flex | 1K tokens | 0 - ∞: 0.0016555000 | 2026-10-10 | 2026-10-13 |
| `bedrock.claude-haiku-4-5.cache-read` | ap-northeast-1 | APN1-MP:APN1_CacheReadInputTokenCount-Units | 1M tokens | 0 - ∞: 0.1100000000 | 2026-10-12 | 2026-10-13 |
| `bedrock.claude-haiku-4-5.cache-write` | ap-northeast-1 | APN1-MP:APN1_CacheWriteInputTokenCount-Units | 1M tokens | 0 - ∞: 1.3750000000 | 2026-10-12 | 2026-10-13 |
| `bedrock.claude-haiku-4-5.cache-write-1h` | ap-northeast-1 | APN1-MP:APN1_CacheWrite1hInputTokenCount-Units | 1M tokens | 0 - ∞: 2.2000000000 | 2026-10-12 | 2026-10-13 |
| `bedrock.claude-haiku-4-5.input.batch` | ap-northeast-1 | APN1-MP:APN1_InputTokenCount_Batch-Units | 1M tokens | 0 - ∞: 0.5500000000 | 2026-10-12 | 2026-10-13 |
| `bedrock.claude-haiku-4-5.output.batch` | ap-northeast-1 | APN1-MP:APN1_OutputTokenCount_Batch-Units | 1M tokens | 0 - ∞: 2.7500000000 | 2026-10-12 | 2026-10-13 |
| `bedrock.guardrail.sensitive-information` | ap-northeast-1 | APN1-Guardrail-SensitiveInformationPolicyPaidUnitsConsumed | TextUnit | 0 - ∞: 0.0001000000 | 2026-10-10 | 2026-10-13 |
| `bedrock.guardrail.content` | ap-northeast-1 | APN1-Guardrail-ContentPolicyUnitsConsumed | TextUnit | 0 - ∞: 0.0001500000 | 2026-10-10 | 2026-10-13 |
| `datasync.basic.gb.osaka` | ap-northeast-3 | APN3-Transferred-Bytes | GB | 0 - ∞: 0.0125000000 | 2026-09-11 | 2026-10-13 |
| `datasync.enhanced.gb.osaka` | ap-northeast-3 | APN3-Transferred-Bytes-Enhanced | GB | 0 - ∞: 0.0150000000 | 2026-09-11 | 2026-10-13 |
| `datasync.enhanced.execution.osaka` | ap-northeast-3 | APN3-Task-Executions-Enhanced | Task-Executions | 0 - ∞: 0.5500000000 | 2026-09-11 | 2026-10-13 |
| `s3.request.tier1.osaka` | ap-northeast-3 | APN3-Requests-Tier1 | Requests | 0 - ∞: 0.0000047000 | 2026-09-28 | 2026-10-13 |
| `s3.request.tier2.osaka` | ap-northeast-3 | APN3-Requests-Tier2 | Requests | 0 - ∞: 0.0000003700 | 2026-09-28 | 2026-10-13 |
| `datatransfer.tokyo-osaka` | ap-northeast-1 | APN1-APN3-AWS-Out-Bytes | GB | 0 - ∞: 0.0900000000 | 2026-09-16 | 2026-10-13 |
| `s3.standard.storage.osaka` | ap-northeast-3 | APN3-TimedStorage-ByteHrs | GB-Mo | 0 - 51,200: 0.0250000000<br>51,200 - 512,000: 0.0240000000<br>512,000 - ∞: 0.0230000000 | 2026-09-28 | 2026-10-13 |
| `dms.serverless.dcu1.hour` | ap-northeast-1 | APN1-DMSServerlessRepCapacityUsg:1 | DCU-Hr | 0 - ∞: 0.1144126570 | 2026-09-11 | 2026-10-13 |
| `dms.instance.t3.micro.hour` | ap-northeast-1 | APN1-InstanceUsg:dms.t3.micro | Hrs | 0 - ∞: 0.0280000000 | 2026-09-11 | 2026-10-13 |
| `dms.instance.t3.medium.hour` | ap-northeast-1 | APN1-InstanceUsg:dms.t3.medium | Hrs | 0 - ∞: 0.1120000000 | 2026-09-11 | 2026-10-13 |
| `drs.source-server.hour` | ap-northeast-1 | APN1-DRS-Replication | Replication-hour | 0 - ∞: 0.0280000000 | 2026-09-11 | 2026-10-13 |
| `ec2.t3-small.linux.hour` | ap-northeast-1 | APN1-BoxUsage:t3.small | Hrs | 0 - ∞: 0.0272000000 | 2026-10-09 | 2026-10-13 |
| `ebs.magnetic.storage` | ap-northeast-1 | APN1-EBS:VolumeUsage | GB-Mo | 0 - ∞: 0.0800000000 | 2026-10-09 | 2026-10-13 |
| `fargate.ephemeral-storage.gb-hour` | ap-northeast-1 | APN1-Fargate-EphemeralStorage-GB-Hours | GB-Hours | 0 - ∞: 0.0001330000 | 2026-09-11 | 2026-10-13 |
| `fms.policy.global.wafv2` | global | Policy-WAF | Month | 0 - ∞: 100.0000000000 | 2026-09-11 | 2026-10-13 |
| `fms.policy.apne1.sg-content-audit` | ap-northeast-1 | APN1-Policy-Security-Group | Month | 0 - ∞: 100.0000000000 | 2026-09-11 | 2026-10-13 |
| `config.use1.item.continuous` | us-east-1 | ConfigurationItemRecorded | ConfigurationItemRecorded | 0 - ∞: 0.0030000000 | 2026-09-11 | 2026-10-13 |
| `config.use1.rule.evaluation` | us-east-1 | USE1-ConfigRuleEvaluations | ConfigRuleEvaluations | 0 - 100,000: 0.0010000000<br>100,000 - 500,000: 0.0008000000<br>500,000 - ∞: 0.0005000000 | 2026-09-11 | 2026-10-13 |
| `config.rule.evaluation` | ap-northeast-1 | APN1-ConfigRuleEvaluations | ConfigRuleEvaluations | 0 - 100,000: 0.0010000000<br>100,000 - 500,000: 0.0008000000<br>500,000 - ∞: 0.0005000000 | 2026-09-11 | 2026-10-13 |
| `networkfirewall.endpoint.hour` | ap-northeast-1 | APN1-Endpoint-Hour | Hourly | 0 - ∞: 0.3950000000 | 2026-09-11 | 2026-10-13 |
| `glue.etl.dpu-hour` | ap-northeast-1 | APN1-ETL-DPU-Hour | DPU-Hour | 0 - ∞: 0.4400000000 | 2026-10-06 | 2026-10-13 |
| `glue.etl.flex.dpu-hour` | ap-northeast-1 | APN1-ETL-Flex-DPU-Hour | DPU-Hour | 0 - ∞: 0.2900000000 | 2026-10-06 | 2026-10-13 |
| `glue.etl.gen2.dpu-hour` | ap-northeast-1 | APN1-ETL-DPU-Hour-Gen2 | DPU-Hour | 0 - ∞: 0.3080000000 | 2026-10-06 | 2026-10-13 |
| `glue.crawler.dpu-hour` | ap-northeast-1 | APN1-Crawler-DPU-Hour | DPU-Hour | 0 - ∞: 0.4400000000 | 2026-10-06 | 2026-10-13 |
| `sns.delivery.email` | ap-northeast-1 | APN1-DeliveryAttempts-SMTP | Notifications | 0 - 1,000: 0.0000000000<br>1,000 - ∞: 0.0000200000 | 2026-09-15 | 2026-10-13 |
| `shield.advanced.subscription` | global | Shield-Monthly-Fee | month | 0 - 1: 3000.0000000000<br>1 - ∞: 0.0000000000 | 2026-09-16 | 2026-10-13 |
| `shield.advanced.transfer.cloudfront` | global | Global-DataTransfer-Shield-Bytes | GB | 0 - 102,400: 0.0250000000<br>102,400 - 512,000: 0.0200000000<br>512,000 - 1,024,001: 0.0150000000<br>1,024,001 - ∞: 0.0100000000 | 2026-09-16 | 2026-10-13 |
| `waf.global.amr.antiddos` | global | Global-AMR-AntiDDoS | Month | 0 - ∞: 20.0000000000 | 2026-09-14 | 2026-10-13 |
| `waf.global.amr.antiddos.request` | global | Global-AMR-AntiDDoS-Request | Request | 0 - ∞: 0.0000001500 | 2026-09-14 | 2026-10-13 |
| `cloudwatch.alarm.standard.use1` | us-east-1 | CW:AlarmMonitorUsage | Alarms | 0 - ∞: 0.1000000000 | 2026-10-07 | 2026-10-13 |
| `sfn.express.request` | ap-northeast-1 | APN1-StepFunctions-Request | Requests | 0 - ∞: 0.0000010000 | 2026-09-11 | 2026-10-13 |
| `sfn.express.duration` | ap-northeast-1 | APN1-StepFunctions-GB-Second | GB-Seconds | 0 - 3,600,000: 0.0000166700<br>3,600,000 - 18,000,000: 0.0000083300<br>18,000,000 - ∞: 0.0000045600 | 2026-09-11 | 2026-10-13 |
| `athena.capacity.dpu-hour` | ap-northeast-1 | APN1-ReservedCapacityInDPUHours | DPU-Hour | 0 - ∞: 0.4300000000 | 2026-09-11 | 2026-10-13 |
| `agentcore.runtime.v1.vcpu.hour` | ap-northeast-1 | APN1-Runtime:Consumption-based:vCPU | vCPU-Hours | 0 - ∞: 0.0895000000 | 2026-10-06 | 2026-10-13 |
| `agentcore.runtime.v1.memory.gb-hour` | ap-northeast-1 | APN1-Runtime:Consumption-based:Memory | GB-Hours | 0 - ∞: 0.0094500000 | 2026-10-06 | 2026-10-13 |
| `agentcore.runtime.v2.vcpu.hour` | ap-northeast-1 | APN1-Runtime:Consumption-based:vCPU-v2 | vCPU-Hours | 0 - ∞: 0.1276000000 | 2026-10-06 | 2026-10-13 |
| `agentcore.runtime.v2.memory.gb-hour` | ap-northeast-1 | APN1-Runtime:Consumption-based:Memory-v2 | GB-Hours | 0 - ∞: 0.0169000000 | 2026-10-06 | 2026-10-13 |
| `chime.sdk.attendee-minute` | ap-northeast-1 | APN1-Chime-SDK-attendee-minutes | minutes | 0 - ∞: 0.0017000000 | 2026-09-11 | 2026-10-13 |
| `efs.standard.storage` | ap-northeast-1 | APN1-TimedStorage-ByteHrs | GB-Mo | 0 - ∞: 0.3600000000 | 2026-09-11 | 2026-10-13 |
| `efs.onezone.storage` | ap-northeast-1 | APN1-TimedStorage-Z-ByteHrs | GB-Mo | 0 - ∞: 0.1920000000 | 2026-09-11 | 2026-10-13 |
| `efs.ia.storage` | ap-northeast-1 | APN1-IATimedStorage-ByteHrs | GB-Mo | 0 - ∞: 0.0272000000 | 2026-09-11 | 2026-10-13 |
| `efs.ia.storage.elastic` | ap-northeast-1 | APN1-IATimedStorage-ET-ByteHrs | GB-Mo | 0 - ∞: 0.0200000000 | 2026-09-11 | 2026-10-13 |
| `efs.archive.storage` | ap-northeast-1 | APN1-ArchiveTimedStorage-ByteHrs | GB-Mo | 0 - ∞: 0.0100000000 | 2026-09-11 | 2026-10-13 |
| `efs.elastic.read` | ap-northeast-1 | APN1-ETDataAccess-Bytes | GB | 0 - ∞: 0.0400000000 | 2026-09-11 | 2026-10-13 |
| `efs.elastic.write` | ap-northeast-1 | APN1-ETDataAccess-Bytes | GB | 0 - ∞: 0.0700000000 | 2026-09-11 | 2026-10-13 |
| `efs.ia.read` | ap-northeast-1 | APN1-IADataAccess-Bytes | GB | 0 - ∞: 0.0120000000 | 2026-09-11 | 2026-10-13 |
| `efs.provisioned.throughput` | ap-northeast-1 | APN1-ProvisionedTP-MiBpsHrs | MiBps-Mo | 0 - ∞: 7.2000000000 | 2026-09-11 | 2026-10-13 |
| `kinesis.shard-hour` | ap-northeast-1 | APN1-Storage-ShardHour | ShardHour | 0 - ∞: 0.0195000000 | 2026-09-11 | 2026-10-13 |
| `kinesis.put-payload-unit` | ap-northeast-1 | APN1-PutRequestPayloadUnits | PutRequest | 0 - ∞: 0.0000000215 | 2026-09-11 | 2026-10-13 |
| `kinesis.extended-retention.shard-hour` | ap-northeast-1 | APN1-Extended-ShardHour | ShardHour | 0 - ∞: 0.0260000000 | 2026-09-11 | 2026-10-13 |
| `kinesis.efo.consumer-shard-hour` | ap-northeast-1 | APN1-EnhancedFanoutHour | ConsumerShardHour | 0 - ∞: 0.0195000000 | 2026-09-11 | 2026-10-13 |
| `kinesis.efo.retrieval` | ap-northeast-1 | APN1-ReadBytes | GB | 0 - ∞: 0.0169000000 | 2026-09-11 | 2026-10-13 |
| `kinesis.on-demand.stream-hour` | ap-northeast-1 | APN1-OnDemand-StreamHour | StreamHr | 0 - ∞: 0.0520000000 | 2026-09-11 | 2026-10-13 |
| `kinesis.on-demand.ingest` | ap-northeast-1 | APN1-OnDemand-BilledIncomingBytes | GB | 0 - ∞: 0.1040000000 | 2026-09-11 | 2026-10-13 |
| `kinesis.advantage.ingest` | ap-northeast-1 | APN1-Advantage-BilledIncomingBytes | GB | 0 - ∞: 0.0416000000 | 2026-09-11 | 2026-10-13 |
| `kinesis.advantage.retrieval` | ap-northeast-1 | APN1-Advantage-BilledOutgoingBytes | GB | 0 - ∞: 0.0208000000 | 2026-09-11 | 2026-10-13 |
| `kinesis.on-demand.retrieval` | ap-northeast-1 | APN1-OnDemand-BilledOutgoingBytes | GB | 0 - ∞: 0.0520000000 | 2026-09-11 | 2026-10-13 |
| `grafana.user.editor` | ap-northeast-1 | APN1-Grafana:EditorUser | Users | 0 - ∞: 9.0000000000 | 2026-09-11 | 2026-10-13 |
| `grafana.user.viewer` | ap-northeast-1 | APN1-Grafana:ViewerUser | Users | 0 - ∞: 5.0000000000 | 2026-09-11 | 2026-10-13 |
| `cloudwatch.api.getmetricdata` | ap-northeast-1 | APN1-CW:GMD-Metrics | Metrics | 0 - ∞: 0.0000100000 | 2026-10-07 | 2026-10-13 |
| `bedrock.nova-lite.input` | ap-northeast-1 | APN1-NovaLite-input-tokens | 1K tokens | 0 - ∞: 0.0000720000 | 2026-10-10 | 2026-10-13 |
| `bedrock.nova-lite.output` | ap-northeast-1 | APN1-NovaLite-output-tokens | 1K tokens | 0 - ∞: 0.0002880000 | 2026-10-10 | 2026-10-13 |
| `bedrock.nova-micro.input` | ap-northeast-1 | APN1-NovaMicro-input-tokens | 1K tokens | 0 - ∞: 0.0000420000 | 2026-10-10 | 2026-10-13 |
| `bedrock.nova-micro.output` | ap-northeast-1 | APN1-NovaMicro-output-tokens | 1K tokens | 0 - ∞: 0.0001680000 | 2026-10-10 | 2026-10-13 |
| `bedrock.nova-pro.input` | ap-northeast-1 | APN1-NovaPro-input-tokens | 1K tokens | 0 - ∞: 0.0009600000 | 2026-10-10 | 2026-10-13 |
| `bedrock.nova-pro.output` | ap-northeast-1 | APN1-NovaPro-output-tokens | 1K tokens | 0 - ∞: 0.0038400000 | 2026-10-10 | 2026-10-13 |
| `bedrock.nova-2-sonic.speech.input` | ap-northeast-1 | APN1-NovaSonic2.0-speech-input-tokens | 1K tokens | 0 - ∞: 0.0036300000 | 2026-10-10 | 2026-10-13 |
| `bedrock.nova-2-sonic.speech.output` | ap-northeast-1 | APN1-NovaSonic2.0-speech-output-tokens | 1K tokens | 0 - ∞: 0.0145200000 | 2026-10-10 | 2026-10-13 |
| `polly.neural.characters` | ap-northeast-1 | APN1-SynthesizeSpeechNeural-Characters | Characters | 0 - ∞: 0.0000160000 | 2026-09-11 | 2026-10-13 |
| `polly.standard.characters` | ap-northeast-1 | APN1-SynthesizeSpeech-Characters | Characters | 0 - ∞: 0.0000040000 | 2026-09-11 | 2026-10-13 |
| `rds.postgres.t4g-micro.multi-az` | ap-northeast-1 | APN1-Multi-AZUsage:db.t4g.micro | Hrs | 0 - ∞: 0.0500000000 | 2026-10-06 | 2026-10-13 |
| `rds.postgres.gp3.storage.multi-az` | ap-northeast-1 | APN1-RDS:Multi-AZ-GP3-Storage | GB-Mo | 0 - ∞: 0.2760000000 | 2026-10-06 | 2026-10-13 |
| `rds.postgres.c6gd-medium.multi-az-cluster` | ap-northeast-1 | APN1-Multi-AZClusterUsage:db.c6gd.medium | Hrs | 0 - ∞: 0.3279000000 | 2026-10-06 | 2026-10-13 |
| `rds.proxy.postgres.vcpu-hour` | ap-northeast-1 | APN1-RDS:ProxyUsage | Hrs | 0 - ∞: 0.0180000000 | 2026-10-06 | 2026-10-13 |
| `rds.postgres.backup.charged` | ap-northeast-1 | APN1-RDS:ChargedBackupUsage | GB-Mo | 0 - ∞: 0.0950000000 | 2026-10-06 | 2026-10-13 |
| `rds.postgres.extended-support.yr1-yr2` | ap-northeast-1 | APN1-ExtendedSupport:Yr1-Yr2:PostgreSQL13 | vCPU-hour | 0 - ∞: 0.1200000000 | 2026-10-06 | 2026-10-13 |
| `rds.postgres.extended-support.yr3` | ap-northeast-1 | APN1-ExtendedSupport:Yr3:PostgreSQL13 | vCPU-hour | 0 - ∞: 0.2400000000 | 2026-10-06 | 2026-10-13 |
| `aurora.postgres.serverless-v2.acu.io-optimized` | ap-northeast-1 | APN1-Aurora:ServerlessV2IOOptimizedUsage | ACU-Hr | 0 - ∞: 0.2000000000 | 2026-10-06 | 2026-10-13 |
| `aurora.postgres.storage.io-optimized` | ap-northeast-1 | APN1-Aurora:IO-OptimizedStorageUsage | GB-Mo | 0 - ∞: 0.2700000000 | 2026-10-06 | 2026-10-13 |
| `aurora.postgres.io` | ap-northeast-1 | APN1-Aurora:StorageIOUsage | IOs | 0 - ∞: 0.0000002400 | 2026-10-06 | 2026-10-13 |
| `aurora.postgres.data-api` | ap-northeast-1 | APN1-RDS:Data-API-Usage | API Calls | 0 - 1,000,000,000: 0.0000004200<br>1,000,000,000 - ∞: 0.0000002400 | 2026-10-06 | 2026-10-13 |
| `sqs.request.fifo` | ap-northeast-1 | APN1-Requests-FIFO-Tier1 | Requests | 0 - 100,000,000,000: 0.0000005000<br>100,000,000,000 - 200,000,000,000: 0.0000004600<br>200,000,000,000 - ∞: 0.0000004200 | 2026-09-11 | 2026-10-13 |
| `codebuild.arm1.small.minute` | ap-northeast-1 | APN1-Build-Min:ARM:g1.small | minutes | 0 - ∞: 0.0042500000 | 2026-09-11 | 2026-10-13 |
| `codebuild.general1.small.minute` | ap-northeast-1 | APN1-Build-Min:Linux:g1.small | minutes | 0 - ∞: 0.0050000000 | 2026-09-11 | 2026-10-13 |
| `network-firewall.endpoint.hour` | ap-northeast-1 | APN1-Endpoint-Hour | Hourly | 0 - ∞: 0.3950000000 | 2026-09-11 | 2026-10-13 |
| `network-firewall.data.gb` | ap-northeast-1 | APN1-Traffic-GB-Processed | GB | 0 - ∞: 0.0650000000 | 2026-09-11 | 2026-10-13 |
| `ec2.t3-micro.linux.hour` | ap-northeast-1 | APN1-BoxUsage:t3.micro | Hrs | 0 - ∞: 0.0136000000 | 2026-10-09 | 2026-10-13 |
| `ec2.c6g-large.linux.hour` | ap-northeast-1 | APN1-BoxUsage:c6g.large | Hrs | 0 - ∞: 0.0856000000 | 2026-10-09 | 2026-10-13 |
| `ec2.c6i-large.linux.hour` | ap-northeast-1 | APN1-BoxUsage:c6i.large | Hrs | 0 - ∞: 0.1070000000 | 2026-10-09 | 2026-10-13 |
| `ec2.c6i-xlarge.linux.hour` | ap-northeast-1 | APN1-BoxUsage:c6i.xlarge | Hrs | 0 - ∞: 0.2140000000 | 2026-10-09 | 2026-10-13 |
| `eks.cluster.hour` | ap-northeast-1 | APN1-AmazonEKS-Hours:perCluster | Hours | 0 - ∞: 0.1000000000 | 2026-09-28 | 2026-10-13 |
| `eks.cluster.extended-support.hour` | ap-northeast-1 | APN1-AmazonEKS-Hours:extendedSupport | Hours | 0 - ∞: 0.5000000000 | 2026-09-28 | 2026-10-13 |
| `eks.auto.t4g-medium.hour` | ap-northeast-1 | APN1-EKS-Auto:t4g.medium-management-hours | hours | 0 - ∞: 0.0051800000 | 2026-09-28 | 2026-10-13 |
| `ec2.t4g-medium.linux.hour` | ap-northeast-1 | APN1-BoxUsage:t4g.medium | Hrs | 0 - ∞: 0.0432000000 | 2026-10-09 | 2026-10-13 |
| `datatransfer.regional` | ap-northeast-1 | APN1-DataTransfer-Regional-Bytes | GB | 0 - ∞: 0.0100000000 | 2026-09-16 | 2026-10-13 |
| `ec2.c7i-large.linux.hour` | ap-northeast-1 | APN1-BoxUsage:c7i.large | Hrs | 0 - ∞: 0.1123500000 | 2026-10-09 | 2026-10-13 |
| `ec2.c8i-large.linux.hour` | ap-northeast-1 | APN1-BoxUsage:c8i.large | Hrs | 0 - ∞: 0.1179700000 | 2026-10-09 | 2026-10-13 |
| `ec2.c5-metal.linux.hour` | ap-northeast-1 | APN1-BoxUsage:c5.metal | Hrs | 0 - ∞: 5.1360000000 | 2026-10-09 | 2026-10-13 |
| `sqs.request.standard` | ap-northeast-1 | APN1-Requests-Tier1 | Requests | 0 - 100,000,000,000: 0.0000004000<br>100,000,000,000 - 200,000,000,000: 0.0000003500<br>200,000,000,000 - ∞: 0.0000003200 | 2026-09-11 | 2026-10-12 |
| `scheduler.invocation` | ap-northeast-1 | APN1-ScheduledInvocation | Invocations | 0 - 14,000,000: 0.0000000000<br>14,000,000 - ∞: 0.0000012500 | 2026-09-24 | 2026-10-12 |
| `lambda.streaming.arm` | ap-northeast-1 | APN1-Lambda-Streaming-Response-Processed-Bytes-ARM | Processed-Gigabytes | 0 - ∞: 0.0080000000 | 2026-10-09 | 2026-10-11 |
| `fargate.arm.vcpu.hour` | ap-northeast-1 | APN1-Fargate-ARM-vCPU-Hours:perCPU | hours | 0 - ∞: 0.0404500000 | 2026-09-11 | 2026-10-12 |
| `fargate.arm.memory.gb-hour` | ap-northeast-1 | APN1-Fargate-ARM-GB-Hours | hours | 0 - ∞: 0.0044200000 | 2026-09-11 | 2026-10-12 |
| `fargate.x86.vcpu.hour` | ap-northeast-1 | APN1-Fargate-vCPU-Hours:perCPU | hours | 0 - ∞: 0.0505600000 | 2026-09-11 | 2026-10-12 |
| `fargate.x86.memory.gb-hour` | ap-northeast-1 | APN1-Fargate-GB-Hours | hours | 0 - ∞: 0.0055300000 | 2026-09-11 | 2026-10-12 |
| `alb.hour` | ap-northeast-1 | APN1-LoadBalancerUsage | Hrs | 0 - ∞: 0.0243000000 | 2026-09-11 | 2026-10-12 |
| `alb.lcu.hour` | ap-northeast-1 | APN1-LCUUsage | LCU-Hrs | 0 - ∞: 0.0080000000 | 2026-09-11 | 2026-10-12 |
| `ecr.storage` | ap-northeast-1 | APN1-TimedStorage-ByteHrs | GB-Mo | 0 - ∞: 0.1000000000 | 2026-09-11 | 2026-10-12 |
| `dsql.dpu` | ap-northeast-1 | APN1-DSQL-DistributedProcessingUnits | DPU | 0 - ∞: 0.0000100000 | 2026-09-11 | 2026-10-11 |
| `dsql.storage` | ap-northeast-1 | APN1-DSQL-Storage-ByteHrs | GB-Month | 0 - ∞: 0.4000000000 | 2026-09-11 | 2026-10-11 |
| `rds.postgres.t4g-micro.single-az` | ap-northeast-1 | APN1-InstanceUsage:db.t4g.micro | Hrs | 0 - ∞: 0.0250000000 | 2026-10-06 | 2026-10-11 |
| `rds.postgres.gp3.storage` | ap-northeast-1 | APN1-RDS:GP3-Storage | GB-Mo | 0 - ∞: 0.1380000000 | 2026-10-06 | 2026-10-11 |
| `aurora.postgres.serverless-v2.acu` | ap-northeast-1 | APN1-Aurora:ServerlessV2Usage | ACU-Hr | 0 - ∞: 0.1500000000 | 2026-10-06 | 2026-10-11 |
| `aurora.postgres.storage` | ap-northeast-1 | APN1-Aurora:StorageUsage | GB-Mo | 0 - ∞: 0.1200000000 | 2026-10-06 | 2026-10-11 |
| `sfn.standard.transition` | ap-northeast-1 | APN1-StateTransition | StateTransitions | 0 - ∞: 0.0000250000 | 2026-09-11 | 2026-10-12 |
| `lambda.durable.operation` | ap-northeast-1 | APN1-Lambda-Durable-Execution-Operations | DurableOperations | 0 - ∞: 0.0000106000 | 2026-10-09 | 2026-10-12 |
| `lambda.durable.written` | ap-northeast-1 | APN1-Lambda-Durable-Execution-Written-Bytes | GigaBytes | 0 - ∞: 0.3300000000 | 2026-10-09 | 2026-10-12 |
| `lambda.durable.retained` | ap-northeast-1 | APN1-Lambda-Durable-Execution-TimedStorage-ByteHrs | GigaBytesMonth | 0 - ∞: 0.2000000000 | 2026-10-09 | 2026-10-12 |
| `bedrock.nova-2-lite.input` | ap-northeast-1 | APN1-Nova2.0Lite-input-tokens | 1K tokens | 0 - ∞: 0.0003960000 | 2026-10-10 | 2026-10-11 |
| `bedrock.nova-2-lite.output` | ap-northeast-1 | APN1-Nova2.0Lite-output-tokens | 1K tokens | 0 - ∞: 0.0033110000 | 2026-10-10 | 2026-10-11 |
| `bedrock.claude-haiku-4-5.input` | ap-northeast-1 | APN1-MP:APN1_InputTokenCount-Units | 1M tokens | 0 - ∞: 1.1000000000 | 2026-10-08 | 2026-10-11 |
| `bedrock.claude-haiku-4-5.output` | ap-northeast-1 | APN1-MP:APN1_OutputTokenCount-Units | 1M tokens | 0 - ∞: 5.5000000000 | 2026-10-08 | 2026-10-11 |
| `cloudwatch.metric.custom` | ap-northeast-1 | APN1-CW:MetricMonitorUsage | Metrics | 0 - 10,000: 0.3000000000<br>10,000 - 250,000: 0.1000000000<br>250,000 - 1,000,000: 0.0500000000<br>1,000,000 - ∞: 0.0200000000 | 2026-10-07 | 2026-10-12 |
| `cloudwatch.alarm.standard` | ap-northeast-1 | APN1-CW:AlarmMonitorUsage | Alarms | 0 - ∞: 0.1000000000 | 2026-10-07 | 2026-10-12 |
| `logs.insights.scanned` | ap-northeast-1 | APN1-DataScanned-Bytes | GB | 0 - ∞: 0.0076000000 | 2026-10-07 | 2026-10-12 |
| `xray.trace.recorded` | ap-northeast-1 | APN1-XRay-TracesStored | traces | 0 - ∞: 0.0000050000 | 2026-09-11 | 2026-10-12 |
| `xray.trace.retrieved` | ap-northeast-1 | APN1-XRay-TracesAccessed | traces | 0 - ∞: 0.0000005000 | 2026-09-11 | 2026-10-12 |
| `cloudwatch.rum.event` | ap-northeast-1 | APN1-CW:RUM-events | Events | 0 - ∞: 0.0000100000 | 2026-10-07 | 2026-10-12 |
| `cloudwatch.synthetics.run` | ap-northeast-1 | APN1-CW:Canary-runs | Runs | 0 - ∞: 0.0019000000 | 2026-10-07 | 2026-10-12 |
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
| `ec2.t4g-micro.linux.hour` | ap-northeast-1 | APN1-BoxUsage:t4g.micro | Hrs | 0 - ∞: 0.0108000000 | 2026-10-09 | 2026-10-12 |
| `ec2.t4g-small.linux.hour` | ap-northeast-1 | APN1-BoxUsage:t4g.small | Hrs | 0 - ∞: 0.0216000000 | 2026-10-09 | 2026-10-12 |
| `ec2.t4g.cpu-credit` | ap-northeast-1 | APN1-CPUCredits:t4g | vCPU-Hours | 0 - ∞: 0.0400000000 | 2026-10-09 | 2026-10-12 |
| `ebs.gp3.storage` | ap-northeast-1 | APN1-EBS:VolumeUsage.gp3 | GB-Mo | 0 - ∞: 0.0960000000 | 2026-10-09 | 2026-10-12 |
| `ebs.snapshot.storage` | ap-northeast-1 | APN1-EBS:SnapshotUsage | GB-Mo | 0 - ∞: 0.0500000000 | 2026-10-09 | 2026-10-12 |
| `ecr.storage.archive` | ap-northeast-1 | APN1-TimedStorage-Archive-ByteHrs | GB-Mo | 0 - 153,600: 0.1000000000<br>153,600 - ∞: 0.0700000000 | 2026-09-11 | 2026-10-13 |
| `ecr.archive.retrieval` | ap-northeast-1 | APN1-Retrieval-Archive | GB | 0 - ∞: 0.0300000000 | 2026-09-11 | 2026-10-13 |
| `ecr.signing` | ap-northeast-1 | APN1-AsyncActions-ImageSigning | Count | 0 - ∞: 0.0200000000 | 2026-09-11 | 2026-10-13 |
| `inspector.image.initial-scan` | ap-northeast-1 | APN1-container-image-initial-scan | Resource-assessment | 0 - ∞: 0.1100000000 | 2026-09-11 | 2026-10-13 |
| `inspector.image.rescan` | ap-northeast-1 | APN1-container-image-re-scan | Resource-assessment | 0 - ∞: 0.0100000000 | 2026-09-11 | 2026-10-13 |

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
| `glue.catalog.storage` | 1,000,000 | `aws-price-list-glue` | Objects. From the Global-Catalog-Storage USD 0 tier (0 to 1,000,000). |
| `glue.catalog.request` | 1,000,000 | `aws-price-list-glue` | Requests. From the Global-Catalog-Request USD 0 tier (0 to 1,000,000). |
| `sqs.request.fifo` | 1,000,000 | `sqs61-pricing-page` | The same 1 million requests a month that sqs.request.standard lists: the pricing page gives one allowance for standard and FIFO queues together (Price List: Global-Requests, queue type Any). A scenario with both kinds of request must not count it twice. |
| `codebuild.arm1.small.minute` | 100 | `cir-cb-pricing` | 100 build minutes a month, shared between general1.small and arm1.small. The pricing page says it does not expire after 12 months. |
| `sqs.request.standard` | 1,000,000 | `sqs-pricing` | 1 million requests a month for all customers, counted across all Regions and shared by every queue in the account. |
| `lambda.streaming.arm` | 100 | `lambda-pricing` | GB streamed beyond the first 6 MB of each request. From the pricing page and the Global-Lambda-Streaming-Response-Processed-Bytes USD 0 tier (0 to 100). |
| `dsql.dpu` | 100,000 | `dsql-pricing` | First 100,000 DPUs each month. The pricing page does not say whether it expires. |
| `dsql.storage` | 1 | `dsql-pricing` | First GB of storage each month. The pricing page does not say whether it expires. |
| `sfn.standard.transition` | 4,000 | `sfn-pricing` | 4,000 state transitions a month. The pricing page says it does not expire and applies to existing and new customers; the Price List has a matching USD 0 tier (Global-StateTransition, 0 to 4,000). |
| `cloudwatch.metric.custom` | 10 | `aws-price-list-cloudwatch-observability` | Metrics. From the Global-CW:MetricMonitorUsage USD 0 tier; the pricing page lists 10 custom and detailed monitoring metrics. |
| `cloudwatch.alarm.standard` | 10 | `aws-price-list-cloudwatch-observability` | Alarm metrics. From the Global-CW:AlarmMonitorUsage USD 0 tier; standard-resolution alarms that list metrics directly. |
| `logs.insights.scanned` | 5 | `aws-price-list-cloudwatch-observability` | GB. From the Global-DataScanned-Bytes USD 0 tier. |
| `cloudwatch.synthetics.run` | 100 | `aws-price-list-cloudwatch-observability` | Runs. From the Global-CW:Canary-runs USD 0 tier. |
| `xray.trace.recorded` | 100,000 | `aws-price-list-xray` | Traces. From the Global-XRay-TracesStored USD 0 tier. |
| `xray.trace.retrieved` | 1,000,000 | `aws-price-list-xray` | Traces. From the Global-XRay-TracesAccessed USD 0 tier, shared by retrieved and scanned traces. |
| `kms.request` | 20,000 | `kms-pricing` | Calculated across all Regions. Requests on asymmetric keys and GenerateDataKeyPair are excluded. |

確認できなかった無料枠（0 としてではなく「不明」として扱い、何も引かない）:

- `apigw.http.request`: A free allowance for HTTP API requests was not confirmed from a primary source for accounts on the current Free Tier model, so none is applied.
- `s3.standard.storage`: No always-free S3 allowance was confirmed; none is applied.
- `ivs.input.basic`: The pricing page gives new customers 5 hours of basic input a month for their first 12 months. It is not an always-free allowance and does not apply to every account, so nothing is deducted.
- `ivs.output.sd.ap`: The pricing page gives new customers 100 hours of SD or audio-only output a month for their first 12 months. Not always-free, so nothing is deducted.
- `vpc.public-ipv4.in-use.hour`: The VPC user guide gives Free Tier customers 750 hours of public IPv4 usage with the EC2 service. Whether a NAT gateway's Elastic IP address counts, and for how long the allowance lasts, was not confirmed; nothing is deducted.
- `ses.outbound.message`: The SES pricing page describes Free Tier credits for new customers, whose terms depend on the account, and no monthly count of free messages. None is applied.
- `cloudfront.kvs.api`: The pay-as-you-go pricing page lists no free allowance for KeyValueStore API operations; none is applied.
- `datatransfer.out.internet`: The price list calls the first tier "beyond the global free tier". The size of that free tier, and whether it applies to every account, was not confirmed from a primary source, so none is applied.
- `s3.request.tier1`: No always-free S3 request allowance was confirmed; none is applied.
- `s3.request.tier2`: No always-free S3 request allowance was confirmed; none is applied.
- `events.custom-event`: No always-free allowance for custom events was found on the EventBridge pricing page (read 2026-10-13).
- `events.pipe-request`: No always-free allowance for Pipes requests was found on the EventBridge pricing page (read 2026-10-13).
- `events.archive.processing`: No always-free allowance for archive processing was found on the EventBridge pricing page (read 2026-10-13).
- `events.archive.storage`: No always-free allowance for archive storage was found on the EventBridge pricing page (read 2026-10-13).
- `s3vectors.storage`: The S3 pricing page names no monthly free allowance for S3 Vectors storage; none is applied.
- `s3vectors.put`: The S3 pricing page names no monthly free allowance for S3 Vectors PUT bytes; none is applied.
- `s3vectors.query.request`: The S3 pricing page names no monthly free allowance for S3 Vectors query requests; none is applied.
- `s3vectors.query.processed.tier1`: The S3 pricing page names no monthly free allowance for data processed by S3 Vectors queries; none is applied.
- `s3vectors.request.other`: The S3 pricing page names no monthly free allowance for other S3 Vectors requests; none is applied.
- `opensearch.serverless.ocu.indexing`: No always-free allowance for OpenSearch Serverless OCUs was confirmed; none is applied.
- `opensearch.serverless.ocu.search`: No always-free allowance for OpenSearch Serverless OCUs was confirmed; none is applied.
- `bedrock.titan-embed-text-v2.input`: No always-free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source; none is applied.
- `dynamodb.replicated-write.osaka`: No free allowance for replicated write request units was looked for or confirmed; none is applied.
- `datatransfer.tokyo-osaka`: No free allowance for inter-Region data transfer was looked for or confirmed; none is applied.
- `s3.rtc.tokyo-osaka`: No free allowance for Replication Time Control was looked for or confirmed; none is applied.
- `cloudwatch.contributor-insights.dynamodb.rule`: The price list has a global USD 0 tier for one Contributor Insights rule, but it is not labelled for the DynamoDB-managed rules; none is applied.
- `cloudwatch.contributor-insights.dynamodb.event`: The price list has a global USD 0 tier for one million Contributor Insights events, but it is not labelled for the DynamoDB-managed events; none is applied.
- `appconfig.request`: The bulk price list has no USD 0 tier for AppConfig, and no free allowance was confirmed elsewhere; none is applied.
- `appconfig.received`: The bulk price list has no USD 0 tier for AppConfig, and no free allowance was confirmed elsewhere; none is applied.
- `costexplorer.api.request`: No free allowance for Cost Explorer API requests was found on the pricing page or in the Price List. None is applied.
- `lambda.managed-instances.request.arm`: The Lambda pricing page does not say whether the monthly free tier of one million requests covers requests to functions on Managed Instances. Nothing is deducted.
- `ec2.m6g-large.linux.hour`: No free tier statement for m6g.large was found, and Savings Plans or Reserved Instance rates depend on the commitment. List price only.
- `ec2.m7g-large.linux.hour`: No free tier statement for m7g.large was found, and Savings Plans or Reserved Instance rates depend on the commitment. List price only.
- `bedrock.nova-2-lite.cache-read`: No always-free allowance for Amazon Bedrock inference or Guardrails was confirmed from a primary source; none is applied.
- `bedrock.nova-2-lite.cache-write`: No always-free allowance for Amazon Bedrock inference or Guardrails was confirmed from a primary source; none is applied.
- `bedrock.nova-2-lite.input.batch`: No always-free allowance for Amazon Bedrock inference or Guardrails was confirmed from a primary source; none is applied.
- `bedrock.nova-2-lite.output.batch`: No always-free allowance for Amazon Bedrock inference or Guardrails was confirmed from a primary source; none is applied.
- `bedrock.nova-2-lite.input.flex`: No always-free allowance for Amazon Bedrock inference or Guardrails was confirmed from a primary source; none is applied.
- `bedrock.nova-2-lite.output.flex`: No always-free allowance for Amazon Bedrock inference or Guardrails was confirmed from a primary source; none is applied.
- `bedrock.claude-haiku-4-5.cache-read`: No always-free allowance for Amazon Bedrock inference or Guardrails was confirmed from a primary source; none is applied.
- `bedrock.claude-haiku-4-5.cache-write`: No always-free allowance for Amazon Bedrock inference or Guardrails was confirmed from a primary source; none is applied.
- `bedrock.claude-haiku-4-5.cache-write-1h`: No always-free allowance for Amazon Bedrock inference or Guardrails was confirmed from a primary source; none is applied.
- `bedrock.claude-haiku-4-5.input.batch`: No always-free allowance for Amazon Bedrock inference or Guardrails was confirmed from a primary source; none is applied.
- `bedrock.claude-haiku-4-5.output.batch`: No always-free allowance for Amazon Bedrock inference or Guardrails was confirmed from a primary source; none is applied.
- `bedrock.guardrail.sensitive-information`: No always-free allowance for Amazon Bedrock inference or Guardrails was confirmed from a primary source; none is applied.
- `bedrock.guardrail.content`: No always-free allowance for Amazon Bedrock inference or Guardrails was confirmed from a primary source; none is applied.
- `datasync.basic.gb.osaka`: No free allowance for DataSync was found on its pricing page; none is applied.
- `datasync.enhanced.gb.osaka`: No free allowance for DataSync was found on its pricing page; none is applied.
- `datasync.enhanced.execution.osaka`: No free allowance for DataSync was found on its pricing page; none is applied.
- `dms.serverless.dcu1.hour`: No free allowance for AWS DMS Serverless capacity was found on the pricing page; none is applied.
- `dms.instance.t3.micro.hour`: The pricing page ties free dms.t3.micro hours to accounts that joined the Free Tier before July 15, 2025, and gives later accounts credits instead. Which applies to the reader's account was not determined, so none is applied.
- `dms.instance.t3.medium.hour`: No free allowance for this instance class was found on the pricing page; none is applied.
- `drs.source-server.hour`: Neither the pricing page nor the Price List mentions a free allowance for Elastic Disaster Recovery. Whether Free Tier credits apply to an account was not confirmed; nothing is deducted.
- `ec2.t3-small.linux.hour`: Free Tier eligibility of the replication server was not confirmed; nothing is deducted.
- `ebs.magnetic.storage`: Free Tier eligibility of staging disks was not confirmed; nothing is deducted.
- `fms.policy.global.wafv2`: No free allowance for Firewall Manager policies was found on the pricing page; none is applied.
- `fms.policy.apne1.sg-content-audit`: No free allowance for Firewall Manager policies was found on the pricing page; none is applied.
- `config.use1.item.continuous`: No free allowance for AWS Config was looked for or confirmed; none is applied.
- `config.use1.rule.evaluation`: No free allowance for AWS Config was looked for or confirmed; none is applied.
- `config.rule.evaluation`: No free allowance for AWS Config was looked for or confirmed; none is applied.
- `networkfirewall.endpoint.hour`: No free allowance for AWS Network Firewall was looked for or confirmed; none is applied.
- `glue.etl.dpu-hour`: No always-free allowance for these DPU-hours appears in the Price List or on the AWS Glue pricing page (read 2026-10-13). None is applied.
- `glue.etl.flex.dpu-hour`: No always-free allowance for these DPU-hours appears in the Price List or on the AWS Glue pricing page (read 2026-10-13). None is applied.
- `glue.etl.gen2.dpu-hour`: No always-free allowance for these DPU-hours appears in the Price List or on the AWS Glue pricing page (read 2026-10-13). None is applied.
- `glue.crawler.dpu-hour`: No always-free allowance for these DPU-hours appears in the Price List or on the AWS Glue pricing page (read 2026-10-13). None is applied.
- `shield.advanced.subscription`: No free allowance or trial for the Shield Advanced subscription was found on the pricing page or in the Price List. None is applied.
- `shield.advanced.transfer.cloudfront`: No free allowance for Shield Advanced data transfer out was found. None is applied.
- `waf.global.amr.antiddos`: No free allowance for the Anti-DDoS managed rule group was found for the pay-as-you-go model. None is applied.
- `waf.global.amr.antiddos.request`: No free allowance for requests processed by the Anti-DDoS managed rule group was found. None is applied.
- `cloudwatch.alarm.standard.use1`: The Price List has a global USD 0 tier for the first 10 alarm metrics. Whether an alarm in us-east-1 shares it with alarms in ap-northeast-1 was not confirmed, so nothing is deducted here.
- `sfn.express.request`: The pricing page names a free tier for state transitions only. No free allowance for Express requests was found on it (read 2026-10-13).
- `sfn.express.duration`: The pricing page names a free tier for state transitions only. No free allowance for Express duration was found on it (read 2026-10-13).
- `athena.scanned`: Neither the Price List nor the pricing page shows a monthly free allowance for Athena SQL queries; none is applied.
- `chime.sdk.attendee-minute`: The Amazon Chime SDK pricing page names no free allowance for WebRTC media, and the Price List has no zero-priced tier. Nothing is deducted.
- `efs.standard.storage`: The EFS pricing page gives new customers 5 GB of Standard storage on a Regional file system for 12 months, and accounts created from July 15, 2025 Free Tier credits instead. Neither is an always-free allowance, and which applies to a given account was not confirmed; nothing is deducted.
- `kinesis.shard-hour`: The Kinesis Data Streams pricing page says the service is not available in AWS Free Tier (read 2026-10-13); nothing is deducted.
- `kinesis.put-payload-unit`: The Kinesis Data Streams pricing page says the service is not available in AWS Free Tier (read 2026-10-13); nothing is deducted.
- `kinesis.extended-retention.shard-hour`: The Kinesis Data Streams pricing page says the service is not available in AWS Free Tier (read 2026-10-13); nothing is deducted.
- `kinesis.efo.consumer-shard-hour`: The Kinesis Data Streams pricing page says the service is not available in AWS Free Tier (read 2026-10-13); nothing is deducted.
- `kinesis.efo.retrieval`: The Kinesis Data Streams pricing page says the service is not available in AWS Free Tier (read 2026-10-13); nothing is deducted.
- `kinesis.on-demand.stream-hour`: The Kinesis Data Streams pricing page says the service is not available in AWS Free Tier (read 2026-10-13); nothing is deducted.
- `kinesis.on-demand.ingest`: The Kinesis Data Streams pricing page says the service is not available in AWS Free Tier (read 2026-10-13); nothing is deducted.
- `kinesis.advantage.ingest`: The Kinesis Data Streams pricing page says the service is not available in AWS Free Tier (read 2026-10-13); nothing is deducted.
- `kinesis.advantage.retrieval`: The Kinesis Data Streams pricing page says the service is not available in AWS Free Tier (read 2026-10-13); nothing is deducted.
- `kinesis.on-demand.retrieval`: The Kinesis Data Streams pricing page says the service is not available in AWS Free Tier (read 2026-10-13); nothing is deducted.
- `grafana.user.editor`: The pricing page describes a 90-day free trial with up to five free users per account, not a monthly allowance. None is applied.
- `grafana.user.viewer`: The pricing page describes a 90-day free trial with up to five free users per account, not a monthly allowance. None is applied.
- `cloudwatch.api.getmetricdata`: Whether any monthly free allowance covers metrics requested through GetMetricData was not confirmed. None is applied.
- `bedrock.nova-lite.input`: No free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source.
- `bedrock.nova-lite.output`: No free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source.
- `bedrock.nova-micro.input`: No free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source.
- `bedrock.nova-micro.output`: No free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source.
- `bedrock.nova-pro.input`: No free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source.
- `bedrock.nova-pro.output`: No free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source.
- `bedrock.nova-2-sonic.speech.input`: No free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source.
- `bedrock.nova-2-sonic.speech.output`: No free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source.
- `polly.neural.characters`: The pricing page gives 1 million characters a month for the first 12 months only, and says accounts created since 2025-07-15 receive credits instead. Not an always-free allowance; none is applied.
- `polly.standard.characters`: The pricing page gives 5 million characters a month without a time limit, while the FAQ speaks of the first 12 months, and accounts created since 2025-07-15 receive credits instead. Not confirmed as always-free; none is applied.
- `rds.postgres.t4g-micro.multi-az`: The two AWS pages on the RDS free tier disagree (750 hours for a year on the pricing page, credits on the free tier page), and which applies depends on the account. Nothing is applied.
- `rds.postgres.gp3.storage.multi-az`: The two AWS pages on the RDS free tier disagree (750 hours for a year on the pricing page, credits on the free tier page), and which applies depends on the account. Nothing is applied.
- `rds.postgres.c6gd-medium.multi-az-cluster`: The two AWS pages on the RDS free tier disagree (750 hours for a year on the pricing page, credits on the free tier page), and which applies depends on the account. Nothing is applied.
- `rds.proxy.postgres.vcpu-hour`: The two AWS pages on the RDS free tier disagree (750 hours for a year on the pricing page, credits on the free tier page), and which applies depends on the account. Nothing is applied.
- `rds.postgres.backup.charged`: The two AWS pages on the RDS free tier disagree (750 hours for a year on the pricing page, credits on the free tier page), and which applies depends on the account. Nothing is applied.
- `rds.postgres.extended-support.yr1-yr2`: The two AWS pages on the RDS free tier disagree (750 hours for a year on the pricing page, credits on the free tier page), and which applies depends on the account. Nothing is applied.
- `rds.postgres.extended-support.yr3`: The two AWS pages on the RDS free tier disagree (750 hours for a year on the pricing page, credits on the free tier page), and which applies depends on the account. Nothing is applied.
- `aurora.postgres.serverless-v2.acu.io-optimized`: Whether any free tier or credit applies to Aurora was not checked while writing chapter 60.
- `aurora.postgres.storage.io-optimized`: Whether any free tier or credit applies to Aurora was not checked while writing chapter 60.
- `aurora.postgres.io`: Whether any free tier or credit applies to Aurora was not checked while writing chapter 60.
- `aurora.postgres.data-api`: Whether any free tier or credit applies to the Data API was not checked while writing chapter 60.
- `codebuild.general1.small.minute`: The 100 free build minutes are shared with arm1.small and are applied there; nothing is deducted here.
- `ec2.t3-micro.linux.hour`: Free Tier offers for EC2 depend on when the account was created and on the instance type; none is applied. List price only.
- `ec2.c6g-large.linux.hour`: Free Tier offers for EC2 depend on when the account was created and on the instance type; none is applied. List price only.
- `ec2.c6i-large.linux.hour`: Free Tier offers for EC2 depend on when the account was created and on the instance type; none is applied. List price only.
- `ec2.c6i-xlarge.linux.hour`: Free Tier offers for EC2 depend on when the account was created and on the instance type; none is applied. List price only.
- `eks.cluster.hour`: The EKS pricing page lists no free allowance for the cluster hour; none is applied.
- `eks.cluster.extended-support.hour`: The EKS pricing page lists no free allowance; none is applied.
- `eks.auto.t4g-medium.hour`: The EKS pricing page lists no free allowance for Auto Mode; none is applied.
- `ec2.t4g-medium.linux.hour`: Free tier offers for EC2 depend on when the account was created and on the instance type; none is applied.
- `datatransfer.regional`: The price list has a separate Global-DataTransfer-Regional-Bytes line at $0 "under the monthly global free tier" for the first GB. Whether and how it applies to a given account was not determined, so none is applied.
- `ec2.c7i-large.linux.hour`: No free tier statement for this instance type was found, and Savings Plans or Reserved Instance rates depend on the commitment. List price only.
- `ec2.c8i-large.linux.hour`: No free tier statement for this instance type was found, and Savings Plans or Reserved Instance rates depend on the commitment. List price only.
- `ec2.c5-metal.linux.hour`: No free tier statement for this instance type was found, and Savings Plans or Reserved Instance rates depend on the commitment. List price only.
- `fargate.arm.vcpu.hour`: The Fargate pricing page lists no free allowance; none is applied.
- `fargate.arm.memory.gb-hour`: The Fargate pricing page lists no free allowance; none is applied.
- `alb.hour`: The pricing page gives new AWS customers 750 load balancer hours a month. It is not an always-free allowance and does not apply to every account, so nothing is deducted.
- `alb.lcu.hour`: The pricing page gives new AWS customers 15 LCUs. It is not an always-free allowance, so nothing is deducted.
- `ecr.storage`: The pricing page gives new ECR customers 500 MB a month of private storage for one year. Not always-free, so nothing is deducted.
- `rds.postgres.t4g-micro.single-az`: The RDS free tier terms were not checked while writing chapter 13.
- `rds.postgres.gp3.storage`: The RDS free tier terms were not checked while writing chapter 13.
- `lambda.durable.operation`: The Lambda pricing page names no free allowance for durable execution; none is applied.
- `lambda.durable.written`: The Lambda pricing page names no free allowance for durable execution; none is applied.
- `lambda.durable.retained`: The Lambda pricing page names no free allowance for durable execution; none is applied.
- `bedrock.nova-2-lite.input`: No always-free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source; none is applied.
- `bedrock.nova-2-lite.output`: No always-free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source; none is applied.
- `bedrock.claude-haiku-4-5.input`: No always-free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source; none is applied.
- `bedrock.claude-haiku-4-5.output`: No always-free allowance for Amazon Bedrock on-demand inference was confirmed from a primary source; none is applied.
- `cloudwatch.rum.event`: The pricing page describes a one-time free trial of 1 million web RUM events per account, not a monthly allowance. None is applied.
- `secretsmanager.secret`: No monthly free allowance for secrets was found on the pricing page or in the price list; none is applied.
- `secretsmanager.api`: No monthly free allowance for Secrets Manager API requests was found on the pricing page or in the price list; none is applied.
- `kms.key`: The KMS free tier covers requests, not keys; none is applied.
- `waf.global.webacl`: No free allowance for web ACLs was confirmed for the pay-as-you-go model. CloudFront's flat-rate pricing plans cover the web ACL, its rules, and its request fees for the distribution in the plan (documentation read 2026-10-13); this chapter prices pay-as-you-go only.
- `waf.global.rule`: No free allowance for rules was confirmed for the pay-as-you-go model; none is applied.
- `waf.global.request`: No free allowance for inspected requests was confirmed for the pay-as-you-go model; none is applied.
- `guardduty.cloudtrail.event`: GuardDuty has a 30-day free trial per account, not a monthly allowance; none is applied.
- `inspector.lambda.standard`: Inspector has a 15-day free trial for new accounts, not a monthly allowance; none is applied.
- `config.item.continuous`: No free allowance for configuration items was found on the pricing page; none is applied.
- `dynamodb.restore`: No free allowance for restores was looked for or confirmed; none is applied.
- `backup.dynamodb.warm`: No free allowance for AWS Backup storage was looked for or confirmed; none is applied.
- `ec2.t4g-micro.linux.hour`: The EC2 user guide mentions Free Tier use of t4g.micro and t4g.small for accounts on the credit-based Free Tier. Which accounts qualify, and for how long, was not confirmed; nothing is deducted.
- `ebs.gp3.storage`: The EBS pricing page mentions 30 GB of storage under the AWS Free Tier and, for accounts created from July 15, 2025, Free Tier credits instead. Which applies to a given account was not confirmed; nothing is deducted.
- `inspector.image.initial-scan`: Inspector has a free trial for new accounts, not a monthly allowance; none is applied.
- `inspector.image.rescan`: Inspector has a free trial for new accounts, not a monthly allowance; none is applied.
- `ecr.storage.archive`: No free allowance for archive storage was found; none is applied.
- `ecr.archive.retrieval`: No free allowance for archive retrieval was found; none is applied.
- `ecr.signing`: No free allowance for managed signing was found; none is applied.
