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

## Notes API and table: deployed, but never called for a month

ID: `notes-idle` / chapter: [05 Persist Notes: DynamoDB](/en/chapters/05-dynamodb.md)

Assumptions:

- No requests
- 10 MB of notes in the table; point-in-time recovery off

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.storage` | 0.01 | GB-Mo | 10 MB stored, in GB-month | 0 | - | 0 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Notes API and table: 1,000,000 requests a month

ID: `notes-small` / chapter: [05 Persist Notes: DynamoDB](/en/chapters/05-dynamodb.md)

Assumptions:

- Mix: 70% list, 20% single-note reads, 8% creates and updates, 2% deletes
- A list page is 20 notes of 1 KB, 20 KB in total. Eventually consistent, so 0.5 read request units per 4 KB: 2.5 units per call
- A single-note read is strongly consistent: 1 unit. Writes and deletes are under 1 KB: 1 unit each
- Updates refused by a conflict consume write request units too; this calculation assumes no conflicts
- Lambda averages 60 ms at 256 MB on arm64. Logs as assumed in chapter 04
- 1 GB stored in the table. Data transfer out for responses is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 1,000,000 | Requests | 1,000,000 requests | 1.29 | - | 1.29 |
| `lambda.request.arm` | 1,000,000 | Requests | one invocation per request | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 15,000 | Lambda-GB-Second | 1,000,000 x 0.06 s x 0.25 GB, in GB-seconds | 0.20 | 400,000 | 0 |
| `logs.ingest.standard` | 0.477 | GB | 1,000,000 x 0.5 KB, in GB | 0.36 | 5 | 0 |
| `logs.storage` | 0.111 | GB-Mo | 0.477 GB x 7/30, in GB-month | 0.003663 | 5 | 0 |
| `dynamodb.read.on-demand` | 1,950,000 | ReadRequestUnits | 700,000 lists x 2.5 + 200,000 reads x 1 | 0.28 | - | 0.28 |
| `dynamodb.write.on-demand` | 100,000 | WriteRequestUnits | 80,000 creates and updates + 20,000 deletes | 0.07 | - | 0.07 |
| `dynamodb.storage` | 1 | GB-Mo | 1 GB stored, in GB-month | 0 | - | 0 |

- List subtotal: **USD 2.41** / month
- Subtotal after monthly free allowance: **USD 1.64** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `apigw.http.request`

## Notes app with sign-in: 1,000,000 requests and 100 MAUs a month

ID: `notes-app-small` / chapter: [06 Add Login: Cognito and Authorization](/en/chapters/06-auth.md)

Assumptions:

- API and table as assumed in "Notes API and table: 1,000,000 requests a month"
- 100 users signed in during the month, on the Essentials plan
- Email charges and SPA delivery (CloudFront and S3) are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
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

- List subtotal: **USD 3.91** / month
- Subtotal after monthly free allowance: **USD 1.64** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `apigw.http.request`

## Live streaming: four 2-hour streams a month, 100 viewers each watching half

ID: `live-monthly-100` / chapter: [18 A Live-Streaming Recipe: IVS](/en/chapters/18-live.md)

Assumptions:

- A BASIC channel fed 720p. BASIC has one rendition, so every viewing hour is billed as HD
- Each time, 100 viewers watch an average of 1 of the 2 hours (the IVS documentation's rule of thumb that 50% of a stream is delivered)
- Every viewer is served at the 'Japan, Hong Kong, SEA' rate
- EventBridge, Lambda, CloudWatch Logs, and hosting the player page are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.basic` | 8 | hours | 4 streams x 2 hours of input | 1.60 | - | 1.60 |
| `ivs.output.hd.ap` | 400 | hours | 4 streams x 100 viewers x 1 hour watched | 36.80 | - | 36.80 |

- List subtotal: **USD 38.40** / month
- Subtotal after monthly free allowance: **USD 38.40** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ivs.input.basic`

## Live streaming: the same streams with 1,000 viewers each

ID: `live-monthly-1000` / chapter: [18 A Live-Streaming Recipe: IVS](/en/chapters/18-live.md)

Assumptions:

- As assumed in the 100-viewer scenario, with ten times the viewers

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.basic` | 8 | hours | 4 streams x 2 hours of input | 1.60 | - | 1.60 |
| `ivs.output.hd.ap` | 4,000 | hours | 4 streams x 1,000 viewers x 1 hour watched | 368.00 | - | 368.00 |

- List subtotal: **USD 369.60** / month
- Subtotal after monthly free allowance: **USD 369.60** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ivs.input.basic`

## Left running: 48 hours of input to a BASIC channel

ID: `live-left-on-weekend` / chapter: [18 A Live-Streaming Recipe: IVS](/en/chapters/18-live.md)

Assumptions:

- No viewers. The encoder kept sending for 48 hours, the longest a single stream lasts

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.basic` | 48 | hours | 48 hours of input | 9.60 | - | 9.60 |

- List subtotal: **USD 9.60** / month
- Subtotal after monthly free allowance: **USD 9.60** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ivs.input.basic`

## Left running: a month of input to a BASIC channel

ID: `live-left-on-month-basic` / chapter: [18 A Live-Streaming Recipe: IVS](/en/chapters/18-live.md)

Assumptions:

- No viewers. The encoder kept reconnecting and sent for all 730 hours

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.basic` | 730 | hours | 730 hours of input | 146.00 | - | 146.00 |

- List subtotal: **USD 146.00** / month
- Subtotal after monthly free allowance: **USD 146.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ivs.input.basic`

## Left running: a month of input to a STANDARD channel

ID: `live-left-on-month-standard` / chapter: [18 A Live-Streaming Recipe: IVS](/en/chapters/18-live.md)

Assumptions:

- No viewers. The same month had the channel been the default type, STANDARD

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.standard` | 730 | hours | 730 hours of input | 1460.00 | - | 1460.00 |

- List subtotal: **USD 1460.00** / month
- Subtotal after monthly free allowance: **USD 1460.00** / month

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
| `cognito.essentials.mau` | 10,000 | `cognito-pricing` | MAUs per account or organization, shared with the Lite plan. Direct sign-in users only. |

Allowances that could not be confirmed (treated as unknown, not as zero; nothing is deducted):

- `apigw.http.request`: A free allowance for HTTP API requests was not confirmed from a primary source for accounts on the current Free Tier model, so none is applied.
- `s3.standard.storage`: No always-free S3 allowance was confirmed; none is applied.
- `ivs.input.basic`: The pricing page gives new customers 5 hours of basic input a month for their first 12 months. It is not an always-free allowance and does not apply to every account, so nothing is deducted.
- `ivs.output.sd.ap`: The pricing page gives new customers 100 hours of SD or audio-only output a month for their first 12 months. Not always-free, so nothing is deducted.
