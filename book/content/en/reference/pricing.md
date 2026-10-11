---
title: "Pricing Worksheets"
generated: true
---

<!-- Generated file. Do not edit. Source: data/pricing/*.json (tools/src/book/generate.ts) -->

# Pricing Worksheets

Every price figure in this book is computed by `tools/src/pricing/calc.ts` from the inputs and unit prices on this page. Currency is USD, a month is 730 hours, the plan is on-demand (pay-as-you-go), and tax is excluded. The usage numbers are assumptions made for illustration, not an estimate for your application.

"List" is the amount before any free allowance, credit, or discount. "After monthly free allowance" subtracts only the always-free allowances confirmed from a primary source, and holds only when nothing else in the account uses those allowances. Credits are not reflected.

## Book site: published, but nobody reads it for a month

ID: `book-site-idle` / chapter: [03 Publish a SPA: A Private S3 Origin and CloudFront](/en/chapters/03-spa.md)

Assumptions:

- No traffic and no publishes
- 50 MB of build output in the bucket

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3.standard.storage` | 0.05 | GB-Mo | 50 MB stored for the month, in GB-month | 0.001250 | - | 0.001250 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`

## Book site: 20,000 page views a month

ID: `book-site-small` / chapter: [03 Publish a SPA: A Private S3 Origin and CloudFront](/en/chapters/03-spa.md)

Assumptions:

- Each page view is 1 HTML request plus, on a first visit, 7 assets: assumed 6 requests and 150 KB on average
- Served entirely from Japan edge locations over HTTPS
- One third of requests assumed to reach the origin through cache misses and revalidation
- 10 publishes a month, 200 object PUTs each
- The CloudFront Function runs on every page and asset request
- No standard logging, WAF, or custom domain

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 120,000 | Requests | 20,000 page views x 6 requests | 0.14 | 10,000,000 | 0 |
| `cloudfront.jp.transfer` | 2.861 | GB | 20,000 page views x 150 KB, in GB | 0.33 | 1,024 | 0 |
| `cloudfront.function.execution` | 120,000 | FunctionExecutions | one execution per viewer request | 0 | 2,000,000 | 0 |
| `s3.request.tier2` | 40,000 | Requests | one third of 120,000 requests reach S3 as GET | 0.01 | - | 0.01 |
| `s3.request.tier1` | 2,000 | Requests | 10 publishes x 200 PUTs | 0.01 | - | 0.01 |
| `s3.standard.storage` | 0.05 | GB-Mo | 50 MB, in GB-month | 0.001250 | - | 0.001250 |

- List subtotal: **USD 0.50** / month
- Subtotal after monthly free allowance: **USD 0.03** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`

## HTTP API: deployed, but never called for a month

ID: `http-api-idle` / chapter: [04 Add an HTTP API: Lambda and API Gateway HTTP API](/en/chapters/04-http-api.md)

Assumptions:

- No requests
- Logs expire after a week; nothing is stored

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## HTTP API: 1,000,000 requests a month

ID: `http-api-small` / chapter: [04 Add an HTTP API: Lambda and API Gateway HTTP API](/en/chapters/04-http-api.md)

Assumptions:

- Every request reaches Lambda (none assumed rejected by API Gateway)
- 50 ms average duration, 256 MB, arm64
- 0.5 KB of logs per request (one application line plus Lambda's START/END/REPORT lines)
- 7-day log retention; average stored volume assumed to be 7/30 of the monthly ingest
- Data transfer out for responses is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 1,000,000 | Requests | 1,000,000 requests | 1.29 | - | 1.29 |
| `lambda.request.arm` | 1,000,000 | Requests | one invocation per request | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 12,500 | Lambda-GB-Second | 1,000,000 x 0.05 s x 0.25 GB, in GB-seconds | 0.17 | 400,000 | 0 |
| `logs.ingest.standard` | 0.477 | GB | 1,000,000 x 0.5 KB, in GB | 0.36 | 5 | 0 |
| `logs.storage` | 0.111 | GB-Mo | 0.477 GB x 7/30, in GB-month | 0.003663 | 5 | 0 |

- List subtotal: **USD 2.02** / month
- Subtotal after monthly free allowance: **USD 1.29** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `apigw.http.request`

## Unit prices

| ID | Region | usageType | Unit | Tiers (from - to: USD) | Offer published | Checked |
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

Every unit price comes from the AWS Price List bulk API (each `sourceUrl` is recorded in `data/pricing/unit-prices.json`). CloudFront prices are those for Japan edge locations.

## Monthly free allowances

| Price ID | Quantity | Source | Note |
| --- | ---: | --- | --- |
| `lambda.request.arm` | 1,000,000 | `lambda-pricing` | Shared across architectures. The pricing page does not say whether it expires. |
| `lambda.duration.arm` | 400,000 | `lambda-pricing` | GB-seconds. Shared across architectures. |
| `cloudfront.jp.transfer` | 1,024 | `cloudfront-pricing-payg` | 1 TB of data transfer out, all edge regions combined, pay-as-you-go only. |
| `cloudfront.jp.request.https` | 10,000,000 | `cloudfront-pricing-payg` | HTTP and HTTPS requests combined, all edge regions combined. |
| `cloudfront.function.execution` | 2,000,000 | `cloudfront-pricing-payg` | Already a USD 0 tier in the price list; listed so the worksheet shows it. |
| `cloudfront.invalidation` | 1,000 | `cloudfront-pricing-payg` | Already a USD 0 tier in the price list. |
| `logs.ingest.standard` | 5 | `aws-price-list-cloudwatch` | GB. From the Global-DataProcessing-Bytes USD 0 tier. |
| `logs.storage` | 5 | `aws-price-list-cloudwatch` | GB-month. From the Global-TimedStorage-ByteHrs USD 0 tier. |

Allowances that could not be confirmed (treated as unknown, not as zero; nothing is deducted):

- `apigw.http.request`: A free allowance for HTTP API requests was not confirmed from a primary source for accounts on the current Free Tier model, so none is applied.
- `s3.standard.storage`: No always-free S3 allowance was confirmed; none is applied.
