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

確認できなかった無料枠（0 としてではなく「不明」として扱い、何も引かない）:

- `apigw.http.request`: A free allowance for HTTP API requests was not confirmed from a primary source for accounts on the current Free Tier model, so none is applied.
- `s3.standard.storage`: No always-free S3 allowance was confirmed; none is applied.
