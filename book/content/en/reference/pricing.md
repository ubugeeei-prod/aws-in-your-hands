---
title: "Pricing Worksheets"
generated: true
---

<!-- Generated file. Do not edit. Source: data/pricing/*.json (tools/src/book/generate.ts) -->

# Pricing Worksheets

Every price figure in this book is computed by `tools/src/pricing/calc.ts` from the inputs and unit prices on this page. Currency is USD, a month is 730 hours, the plan is on-demand (pay-as-you-go), and tax is excluded. The usage numbers are assumptions made for illustration, not an estimate for your application.

"List" is the amount before any free allowance, credit, or discount. "After monthly free allowance" subtracts only the always-free allowances confirmed from a primary source, and holds only when nothing else in the account uses those allowances. Credits are not reflected.

## Book site: published, but nobody reads it for a month

ID: `book-site-idle` / chapter: [03 Static Hosting: A Private S3 Origin and CloudFront](/en/chapters/03-spa.md)

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

ID: `book-site-small` / chapter: [03 Static Hosting: A Private S3 Origin and CloudFront](/en/chapters/03-spa.md)

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
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `s3.request.tier1`, `s3.request.tier2`

## HTTP API: deployed, but never called for a month

ID: `http-api-idle` / chapter: [04 HTTP API: Lambda and API Gateway HTTP API](/en/chapters/04-http-api.md)

Assumptions:

- No requests
- Logs expire after a week; nothing is stored

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## HTTP API: 1,000,000 requests a month

ID: `http-api-small` / chapter: [04 HTTP API: Lambda and API Gateway HTTP API](/en/chapters/04-http-api.md)

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

ID: `notes-idle` / chapter: [05 KV Store: DynamoDB](/en/chapters/05-dynamodb.md)

Assumptions:

- No requests
- 10 MB of notes in the table; point-in-time recovery off

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.storage` | 0.01 | GB-Mo | 10 MB stored, in GB-month | 0 | - | 0 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Notes API and table: 1,000,000 requests a month

ID: `notes-small` / chapter: [05 KV Store: DynamoDB](/en/chapters/05-dynamodb.md)

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

ID: `notes-app-small` / chapter: [06 Auth: Cognito and Authorization](/en/chapters/06-auth.md)

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

ID: `live-monthly-100` / chapter: [18 Live Streaming: IVS](/en/chapters/18-live.md)

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

ID: `live-monthly-1000` / chapter: [18 Live Streaming: IVS](/en/chapters/18-live.md)

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

ID: `live-left-on-weekend` / chapter: [18 Live Streaming: IVS](/en/chapters/18-live.md)

Assumptions:

- No viewers. The encoder kept sending for 48 hours, the longest a single stream lasts

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.basic` | 48 | hours | 48 hours of input | 9.60 | - | 9.60 |

- List subtotal: **USD 9.60** / month
- Subtotal after monthly free allowance: **USD 9.60** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ivs.input.basic`

## Left running: a month of input to a BASIC channel

ID: `live-left-on-month-basic` / chapter: [18 Live Streaming: IVS](/en/chapters/18-live.md)

Assumptions:

- No viewers. The encoder kept reconnecting and sent for all 730 hours

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.basic` | 730 | hours | 730 hours of input | 146.00 | - | 146.00 |

- List subtotal: **USD 146.00** / month
- Subtotal after monthly free allowance: **USD 146.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ivs.input.basic`

## Left running: a month of input to a STANDARD channel

ID: `live-left-on-month-standard` / chapter: [18 Live Streaming: IVS](/en/chapters/18-live.md)

Assumptions:

- No viewers. The same month had the channel been the default type, STANDARD

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ivs.input.standard` | 730 | hours | 730 hours of input | 1460.00 | - | 1460.00 |

- List subtotal: **USD 1460.00** / month
- Subtotal after monthly free allowance: **USD 1460.00** / month

## Network: add one NAT gateway

ID: `network-nat-single` / chapter: [11 Network: VPC, Subnets, NAT, and Endpoints](/en/chapters/11-network.md)

Assumptions:

- `-c egress=nat`: one NAT gateway left running for 730 hours
- The one Elastic IP address that the NAT gateway holds
- 10 GB a month assumed through the NAT gateway (about what pulling container images and shipping logs takes)
- Data transfer out to the internet and across zones is not included
- The VPC, subnets, route tables, internet gateway, and gateway endpoints have no charge

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `nat.gateway.hour` | 730 | Hrs | 1 NAT gateway x 730 hours | 45.26 | - | 45.26 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 Elastic IP address x 730 hours | 3.65 | - | 3.65 |
| `nat.gateway.data` | 10 | GB | 10 GB processed (assumption) | 0.62 | - | 0.62 |

- List subtotal: **USD 49.53** / month
- Subtotal after monthly free allowance: **USD 49.53** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`

## Network: add a NAT gateway per zone

ID: `network-nat-per-az` / chapter: [11 Network: VPC, Subnets, NAT, and Endpoints](/en/chapters/11-network.md)

Assumptions:

- `-c egress=nat-per-az`: one NAT gateway in each of two zones, left running for 730 hours
- The two Elastic IP addresses they hold
- 10 GB a month assumed through the NAT gateways in total
- Data transfer out to the internet is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `nat.gateway.hour` | 1,460 | Hrs | 2 NAT gateways x 730 hours | 90.52 | - | 90.52 |
| `vpc.public-ipv4.in-use.hour` | 1,460 | Hrs | 2 Elastic IP addresses x 730 hours | 7.30 | - | 7.30 |
| `nat.gateway.data` | 10 | GB | 10 GB processed (assumption) | 0.62 | - | 0.62 |

- List subtotal: **USD 98.44** / month
- Subtotal after monthly free allowance: **USD 98.44** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`

## Network: add three interface endpoints

ID: `network-interface-endpoints` / chapter: [11 Network: VPC, Subnets, NAT, and Endpoints](/en/chapters/11-network.md)

Assumptions:

- `-c interfaceEndpoints=ecr.api,ecr.dkr,logs`: three endpoints in two zones, left running for 730 hours
- 10 GB a month assumed through the endpoints in total
- Traffic to S3 goes through the gateway endpoint at no charge
- No NAT gateway

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `vpc.endpoint.interface.hour` | 4,380 | Hrs | 3 interface endpoints x 2 zones x 730 hours | 61.32 | - | 61.32 |
| `vpc.endpoint.interface.data` | 10 | GB | 10 GB processed (assumption) | 0.10 | - | 0.10 |

- List subtotal: **USD 61.42** / month
- Subtotal after monthly free allowance: **USD 61.42** / month

## Notification mail: deployed, but nothing sent for a month

ID: `email-idle` / chapter: [15 Email: SES](/en/chapters/15-email.md)

Assumptions:

- No mail sent, no events
- 10 MB of records in the table (suppressions and unexpired notification records)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.storage` | 0.01 | GB-Mo | 10 MB stored, in GB-month | 0 | - | 0 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Notification mail: 10,000 messages a month

ID: `email-small` / chapter: [15 Email: SES](/en/chapters/15-email.md)

Assumptions:

- One recipient per notification, no attachments; 10,000 messages a month
- 1,000 repeated requests for a notification already handled (nothing is sent, but the API and the function run)
- One SES event per message (a delivery, a bounce or a complaint)
- The sending function averages 300 ms and the event function 50 ms, both at 256 MB on arm64
- Three DynamoDB writes per message (claim, sent, event) and one per repeated request; one eventually consistent read per request, plus one strongly consistent read per repeated request
- 0.5 KB of logs per request and per event
- Data transfer out, dedicated IPs and Virtual Deliverability Manager are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
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

- List subtotal: **USD 1.06** / month
- Subtotal after monthly free allowance: **USD 1.04** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `apigw.http.request`, `ses.outbound.message`

## Edge example: 1,000,000 requests a month

ID: `edge-small` / chapter: [10 Edge: CloudFront Functions, KeyValueStore, and Lambda@Edge](/en/chapters/10-edge.md)

Assumptions:

- Served entirely from Japan edge locations over HTTPS, 20 KB per request on average
- 10% home page, 20% other pages, 70% files; the function reads KeyValueStore 3, 2, and 1 times respectively
- The CloudFront Function runs on every request
- One third of requests assumed to reach the origin through cache misses and revalidation
- edge:kvs:sync 20 times a month (1 Describe, 1 ListKeys, 1 UpdateKeys) and edge:kvs:plan 10 times (1 Describe, 1 ListKeys)
- Lambda@Edge runs only for 10,000 POST /digest requests, assumed 128 MB and 50 ms on average
- Lambda@Edge logs in CloudWatch Logs, standard logging, WAF, and a custom domain are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 1,000,000 | Requests | 1,000,000 viewer requests | 1.20 | 10,000,000 | 0 |
| `cloudfront.jp.transfer` | 19.073 | GB | 1,000,000 requests x 20 KB, in GB | 2.17 | 1,024 | 0 |
| `cloudfront.function.execution` | 1,000,000 | FunctionExecutions | one execution per viewer request | 0 | 2,000,000 | 0 |
| `cloudfront.kvs.read` | 1,400,000 | EdgeReads | 100,000 x 3 + 200,000 x 2 + 700,000 x 1 reads | 0 | 2,000,000 | 0 |
| `cloudfront.kvs.api` | 80 | API Requests | 20 syncs x 3 calls + 10 dry runs x 2 calls | 0.08 | - | 0.08 |
| `lambdaedge.jp.request` | 10,000 | Request | 10,000 POST /digest requests | 0.01 | - | 0.01 |
| `lambdaedge.jp.duration` | 62.5 | Lambda-GB-Second | 10,000 x 0.05 s x 0.125 GB | 0.003126 | - | 0.003126 |
| `s3.request.tier2` | 333,333 | Requests | one third of 1,000,000 requests reach S3 as GET | 0.12 | - | 0.12 |

- List subtotal: **USD 3.59** / month
- Subtotal after monthly free allowance: **USD 0.21** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `cloudfront.kvs.api`, `s3.request.tier2`

## Image attachments: 10,000 uploads and 100,000 views a month

ID: `uploads-small` / chapter: [07 File Upload: Presigned URLs and S3](/en/chapters/07-uploads.md)

Assumptions:

- Counts only what is added on top of the notes app of chapter 06
- Each image is 1 MB. 10,000 are uploaded in the month and every one is attached. 10 GB are stored at the end of the month
- Opening a note calls the attachment list once and loads one image, 100,000 times a month. The browser cache is assumed not to help
- Requests to S3: 10,000 upload POSTs, 10,000 HeadObject calls, and 100,000 image GETs. Removing the tag is not billed. Delete requests are not included
- The API serves 10,000 permits, 10,000 finishes, and 100,000 lists: 120,000 requests. Lambda averages 60 ms at 256 MB on arm64
- DynamoDB reads: 2 units for a permit, 3 for a finish, 2 for a list. One write unit per finish
- Data transfer for uploads (internet to S3) is 0. Unfinished uploads, tag storage, and the LIST requests of a sweep are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
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

- List subtotal: **USD 11.76** / month
- Subtotal after monthly free allowance: **USD 11.67** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `apigw.http.request`, `s3.standard.storage`, `datatransfer.out.internet`, `s3.request.tier1`, `s3.request.tier2`

## KV and cache: the default stack (DynamoDB), deployed but never called for a month

ID: `kv-idle-dynamodb` / chapter: [14 Cache: Key-Value Stores, DynamoDB, ElastiCache/Valkey, and Edge Configuration](/en/chapters/14-kv-cache.md)

Assumptions:

- No requests
- The table holds only items waiting to expire; 1 MB assumed, generously
- No ElastiCache cache exists

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.storage` | 0.001 | GB-Mo | 1 MB stored, in GB-month | 0 | - | 0 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## KV and cache: ElastiCache Serverless (Valkey), deployed but never called for a month

ID: `kv-idle-valkey-serverless` / chapter: [14 Cache: Key-Value Stores, DynamoDB, ElastiCache/Valkey, and Edge Configuration](/en/chapters/14-kv-cache.md)

Assumptions:

- `-c store=valkey`: the cache left in place for 730 hours with no requests
- Less than 100 MB stored, so the Valkey minimum of 100 MB (computed as 0.1 GB) is metered
- No snapshots, no data transfer

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `elasticache.serverless.valkey.storage` | 73 | GB-Hours | 0.1 GB minimum x 730 hours, in GB-hours | 7.37 | - | 7.37 |

- List subtotal: **USD 7.37** / month
- Subtotal after monthly free allowance: **USD 7.37** / month

## For comparison: one node-based Valkey node (cache.t4g.micro) left running for a month

ID: `kv-idle-valkey-node` / chapter: [14 Cache: Key-Value Stores, DynamoDB, ElastiCache/Valkey, and Edge Configuration](/en/chapters/14-kv-cache.md)

Assumptions:

- Not something this chapter's stack creates; computed only to compare prices
- One node without a replica for 730 hours. It needs a VPC, which itself is free
- Backups and data transfer are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `elasticache.node.valkey.t4g-micro` | 730 | Hrs | 1 node x 730 hours | 14.60 | - | 14.60 |

- List subtotal: **USD 14.60** / month
- Subtotal after monthly free allowance: **USD 14.60** / month

## KV and cache: one million requests a month on DynamoDB

ID: `kv-used-dynamodb` / chapter: [14 Cache: Key-Value Stores, DynamoDB, ElastiCache/Valkey, and Edge Configuration](/en/chapters/14-kv-cache.md)

Assumptions:

- One million `GET /items` a month, all within the rate limit (a refused request consumes one write unit too)
- Rate limit: one UpdateItem per request (under 1 KB, one write unit), fixed window
- Cache read: one eventually consistent GetItem per request (under 4 KB, half a read unit)
- Cache refill: assumed to happen every time the 30-second TTL runs out, 87,600 times a month; each takes three write units (take the lock, write the value, release the lock) and half a read unit for the re-check
- Lambda on arm64 with 256 MB and an assumed average of 30 ms; 0.5 KB of logs per request
- 1 MB stored in the table. Data transfer out to the internet is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 1,000,000 | Requests | 1,000,000 requests | 1.29 | - | 1.29 |
| `lambda.request.arm` | 1,000,000 | Requests | 1,000,000 invocations | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 7,500 | Lambda-GB-Second | 1,000,000 x 0.03 s x 0.25 GB | 0.10 | 400,000 | 0 |
| `dynamodb.write.on-demand` | 1,262,800 | WriteRequestUnits | 1,000,000 counter updates + 87,600 refills x 3 writes | 0.90 | - | 0.90 |
| `dynamodb.read.on-demand` | 543,800 | ReadRequestUnits | (1,000,000 + 87,600) eventually consistent reads x 0.5 | 0.08 | - | 0.08 |
| `dynamodb.storage` | 0.001 | GB-Mo | 1 MB stored, in GB-month | 0 | - | 0 |
| `logs.ingest.standard` | 0.477 | GB | 1,000,000 x 0.5 KB, in GB | 0.36 | 5 | 0 |
| `logs.storage` | 0.111 | GB-Mo | about 7 days of logs kept, in GB-month | 0.003663 | 5 | 0 |

- List subtotal: **USD 2.94** / month
- Subtotal after monthly free allowance: **USD 2.27** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `apigw.http.request`

## KV and cache: one million requests a month on ElastiCache Serverless (Valkey)

ID: `kv-used-valkey` / chapter: [14 Cache: Key-Value Stores, DynamoDB, ElastiCache/Valkey, and Edge Configuration](/en/chapters/14-kv-cache.md)

Assumptions:

- One million `GET /items` a month
- Less than 100 MB stored: the 100 MB minimum (computed as 0.1 GB) for 730 hours
- 10 ECPUs per request assumed, on the generous side; how many ECPUs a script (EVAL) really uses was not measured
- Lambda on arm64 with 256 MB and an assumed average of 30 ms; 0.5 KB of logs per request
- Data transfer to the public endpoint (USD 0.01 per GB on the application side) and out to the internet is not included
- The DynamoDB table stays in the stack but is not read or written in this setup

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 1,000,000 | Requests | 1,000,000 requests | 1.29 | - | 1.29 |
| `lambda.request.arm` | 1,000,000 | Requests | 1,000,000 invocations | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 7,500 | Lambda-GB-Second | 1,000,000 x 0.03 s x 0.25 GB | 0.10 | 400,000 | 0 |
| `elasticache.serverless.valkey.storage` | 73 | GB-Hours | 0.1 GB minimum x 730 hours, in GB-hours | 7.37 | - | 7.37 |
| `elasticache.serverless.valkey.ecpu` | 10,000,000 | ElastiCacheProcessingUnit | 1,000,000 requests x 10 ECPUs (assumption) | 0.03 | - | 0.03 |
| `logs.ingest.standard` | 0.477 | GB | 1,000,000 x 0.5 KB, in GB | 0.36 | 5 | 0 |
| `logs.storage` | 0.111 | GB-Mo | about 7 days of logs kept, in GB-month | 0.003663 | 5 | 0 |

- List subtotal: **USD 9.36** / month
- Subtotal after monthly free allowance: **USD 8.69** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `apigw.http.request`

## celld: one node running for a month

ID: `celld-one-node-running` / chapter: [24 Self-hosting: celld on AWS](/en/chapters/24-celld.md)

Assumptions:

- `-c nodes=1`: one t4g.small running for 730 hours
- Three interface endpoints (ssm, ssmmessages, ec2messages) in two zones, left in the chapter 11 stack
- S3 requests are estimated from the intervals in celld's documentation (per node: a lease renewal about every 3.3 s, a fleet sample read every 5 s, a deployment pointer read every 30 s). Not measured, and requests caused by active cells are not included
- The root volume is assumed to be 8 GiB (the AMI decides; the real size was not checked). Each node's data volume is 8 GiB. Both are gp3 within the IOPS and throughput that carry no extra charge
- CPU credits are in standard mode, so nothing is billed for use above the baseline
- Session Manager and Run Command have no additional charge on EC2 instances
- S3 storage, data transfer, snapshots, and the backup bucket are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-small.linux.hour` | 730 | Hrs | 1 t4g.small x 730 hours | 15.77 | - | 15.77 |
| `ebs.gp3.storage` | 16 | GB-Mo | 1 x (8 GiB root, assumed + 8 GiB data), 730 of 730 hours | 1.54 | - | 1.54 |
| `s3.request.tier1` | 788,400 | Requests | 1 node(s) x one lease renewal about every 3.3 s (estimated from the documented interval) | 3.71 | - | 3.71 |
| `s3.request.tier2` | 613,200 | Requests | 1 node(s) x (fleet sample every 5 s + deployment pointer every 30 s), estimated | 0.23 | - | 0.23 |
| `vpc.endpoint.interface.hour` | 4,380 | Hrs | 3 interface endpoints x 2 zones x 730 hours | 61.32 | - | 61.32 |

- List subtotal: **USD 82.56** / month
- Subtotal after monthly free allowance: **USD 82.56** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.request.tier1`, `s3.request.tier2`, `ebs.gp3.storage`

## celld: three nodes running for a month

ID: `celld-three-nodes-running` / chapter: [24 Self-hosting: celld on AWS](/en/chapters/24-celld.md)

Assumptions:

- `-c nodes=3`: three t4g.small running for 730 hours
- Three interface endpoints (ssm, ssmmessages, ec2messages) in two zones, left in the chapter 11 stack
- S3 requests are estimated from the intervals in celld's documentation (per node: a lease renewal about every 3.3 s, a fleet sample read every 5 s, a deployment pointer read every 30 s). Not measured, and requests caused by active cells are not included
- The root volume is assumed to be 8 GiB (the AMI decides; the real size was not checked). Each node's data volume is 8 GiB. Both are gp3 within the IOPS and throughput that carry no extra charge
- CPU credits are in standard mode, so nothing is billed for use above the baseline
- Session Manager and Run Command have no additional charge on EC2 instances
- S3 storage, data transfer, snapshots, and the backup bucket are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-small.linux.hour` | 2,190 | Hrs | 3 t4g.small x 730 hours | 47.30 | - | 47.30 |
| `ebs.gp3.storage` | 48 | GB-Mo | 3 x (8 GiB root, assumed + 8 GiB data), 730 of 730 hours | 4.61 | - | 4.61 |
| `s3.request.tier1` | 2,365,200 | Requests | 3 node(s) x one lease renewal about every 3.3 s (estimated from the documented interval) | 11.12 | - | 11.12 |
| `s3.request.tier2` | 1,839,600 | Requests | 3 node(s) x (fleet sample every 5 s + deployment pointer every 30 s), estimated | 0.68 | - | 0.68 |
| `vpc.endpoint.interface.hour` | 4,380 | Hrs | 3 interface endpoints x 2 zones x 730 hours | 61.32 | - | 61.32 |

- List subtotal: **USD 125.03** / month
- Subtotal after monthly free allowance: **USD 125.03** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.request.tier1`, `s3.request.tier2`, `ebs.gp3.storage`

## celld: three nodes stopped for a month

ID: `celld-three-nodes-stopped` / chapter: [24 Self-hosting: celld on AWS](/en/chapters/24-celld.md)

Assumptions:

- The three instances of `-c nodes=3` stopped for 730 hours. The volumes and the interface endpoints in the chapter 11 stack remain
- The root volume is assumed to be 8 GiB (the AMI decides; the real size was not checked). Each node's data volume is 8 GiB. Both are gp3 within the IOPS and throughput that carry no extra charge
- CPU credits are in standard mode, so nothing is billed for use above the baseline
- Session Manager and Run Command have no additional charge on EC2 instances
- S3 storage, data transfer, snapshots, and the backup bucket are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ebs.gp3.storage` | 48 | GB-Mo | 3 x (8 GiB root, assumed + 8 GiB data), 730 of 730 hours | 4.61 | - | 4.61 |
| `vpc.endpoint.interface.hour` | 4,380 | Hrs | 3 interface endpoints x 2 zones x 730 hours | 61.32 | - | 61.32 |

- List subtotal: **USD 65.93** / month
- Subtotal after monthly free allowance: **USD 65.93** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ebs.gp3.storage`

## celld: the data volumes left after destroying the stack (three nodes)

ID: `celld-retained-after-destroy` / chapter: [24 Self-hosting: celld on AWS](/en/chapters/24-celld.md)

Assumptions:

- 730 hours after destroying a `-c nodes=3` stack with the default `stateOnDestroy=retain`, and after removing the chapter 11 interface endpoints
- What remains: three 8 GiB data volumes. Root volumes go with their instances
- Storage in the two retained buckets is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ebs.gp3.storage` | 24 | GB-Mo | 3 retained data volume(s) x 8 GiB, 730 of 730 hours | 2.30 | - | 2.30 |

- List subtotal: **USD 2.30** / month
- Subtotal after monthly free allowance: **USD 2.30** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ebs.gp3.storage`

## Event wiring: deployed, with no note changing, for a month

ID: `events-idle` / chapter: [25 Events: EventBridge, SNS, Pipes, Archive and Replay](/en/chapters/25-events.md)

Assumptions:

- Counts only what is added on top of chapter 08's stack
- The pipe polls a shard of the stream four times a second (the documentation's base rate). One shard and an unchanged rate for the month are assumed: 4 x 3,600 x 730 = 10,512,000 reads
- These reads are assumed to be billed as DynamoDB Streams read request units. The pricing page exempts GetRecords calls from Lambda triggers and global tables only, and does not name Pipes. This was not checked on a bill
- No events, so Pipes requests, custom events, the archive, function runs, and SNS are all 0
- Not included: the SQS requests Lambda makes while long-polling the counter's empty queue (the documentation gives no rate, as in chapter 08)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.streams.read` | 10,512,000 | Requests | 4 polls a second x 3,600 s x 730 h, one shard | 1.83 | - | 1.83 |

- List subtotal: **USD 1.83** / month
- Subtotal after monthly free allowance: **USD 1.83** / month

## Event wiring: 10,000 note changes and 10,000 inspections a month

ID: `events-small` / chapter: [25 Events: EventBridge, SNS, Pipes, Archive and Replay](/en/chapters/25-events.md)

Assumptions:

- 10,000 note changes (6,000 created, 3,000 updated, 1,000 deleted) and 10,000 inspection records, 100 of them rejected. No duplicates and no retries
- The stream is assumed to be polled 10,512,000 times, as in the idle month
- 20,000 records pass the pipe. One per batch and each under 64 KB, so 20,000 Pipes requests, 20,000 runs of the shaping function, and 20,000 custom events
- The archive takes in 0.01 GB (20,000 events of 0.5 KB) and holds seven days of it (7/30 of the month)
- The timeline runs 10,000 times and writes once each. The counter receives 7,000 events through its queue (three SQS requests per message) and writes two items in a transaction for each (a transactional write is 2 units per KB, so 4 units)
- Every function run is taken as 100 ms at 256 MB on arm64. The counter is taken to run once per message
- The 100 rejections are published to SNS 100 times and reach the inbox queue 100 times (100 SQS SendMessage requests)
- 0.5 KB of logs per function run
- Not included: empty receives on the counter's queue, and the storage of the projections table (a few MB)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
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

- List subtotal: **USD 1.93** / month
- Subtotal after monthly free allowance: **USD 1.89** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `events.custom-event`, `events.pipe-request`, `events.archive.processing`, `events.archive.storage`

## Event wiring: replaying seven days of the archive to every rule

ID: `events-replay` / chapter: [25 Events: EventBridge, SNS, Pipes, Archive and Replay](/en/chapters/25-events.md)

Assumptions:

- Replays seven days of the 20,000-a-month example: 4,667 events. A replayed event is billed at the custom event price
- The 2,333 that match the timeline's rule and the 1,633 that match the counter's run those functions again, 100 ms at 256 MB each
- A refused conditional write is taken to use 1 unit: 2,333 for the timeline. What a cancelled transaction consumes was not confirmed, so the counter is counted as if it had succeeded: 4 units each, 6,532
- Three SQS requests per counter message. The 23 rejections do not reach SNS: the rule for notices lets no replayed event through

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `events.custom-event` | 4,667 | 64K-Chunks | 20,000 x 7/30 events replayed | 0.004667 | - | 0.004667 |
| `lambda.request.arm` | 3,966 | Requests | timeline 2,333 + counter 1,633 | 0.000793 | 1,000,000 | 0 |
| `lambda.duration.arm` | 99.15 | Lambda-GB-Second | 3,966 x 0.1 s x 0.25 GB | 0.001322 | 400,000 | 0 |
| `dynamodb.write.on-demand` | 8,865 | WriteRequestUnits | timeline 2,333 x 1 + counter 1,633 x 4 | 0.01 | - | 0.01 |
| `sqs.request.standard` | 4,899 | Requests | counter 1,633 x 3 | 0.001960 | 1,000,000 | 0 |

- List subtotal: **USD 0.02** / month
- Subtotal after monthly free allowance: **USD 0.01** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `events.custom-event`

## Request records: deployed, but never called for a month

ID: `analytics-idle` / chapter: [26 Analytics: Firehose, S3, Glue, and Athena](/en/chapters/26-analytics.md)

Assumptions:

- No requests: no record reaches Firehose and no object is written
- No query is run
- The Glue Data Catalog holds one database and one table
- The API, Lambda and DynamoDB themselves are priced in chapters 04 and 05 and are not included here

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `glue.catalog.storage` | 2 | Obj-Month | 1 database + 1 table | 0.000020 | 1,000,000 | 0 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Request records: 1 million requests a month, gzip JSON

ID: `analytics-1m-json` / chapter: [26 Analytics: Firehose, S3, Glue, and Athena](/en/chapters/26-analytics.md)

Assumptions:

- One record per request; duplicates from retries are not counted
- A record is 242 bytes (the mean of 5,000 sample records). Firehose bills in 5 KB steps (5 KB taken as 5,120 bytes)
- A 60-second buffer: one object a minute at most, 43,800 in 730 hours
- Gzip leaves 24.3% of the bytes (measured on the sample). Objects expire after 90 days, so three months' worth is stored
- 100 queries a month, each reading three days of partitions and less than the 10 MB minimum
- Athena is assumed to make one GET per object (the real number was not confirmed): 100 queries x 3 days x 1,440 objects
- Query result storage, Glue requests and Firehose's error log are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `firehose.ingest.direct-put` | 4.768 | GB | 1,000,000 records x 5,120 bytes | 0.17 | - | 0.17 |
| `s3.request.tier1` | 43,800 | Requests | one PUT per delivered object, one object a minute | 0.21 | - | 0.21 |
| `s3.standard.storage` | 0.164 | GB-Mo | 0.054703 GB a month, kept 90 days | 0.004103 | - | 0.004103 |
| `athena.scanned` | 0.001 | Terabytes | 100 queries x 10 MB minimum | 0.004770 | - | 0.004770 |
| `s3.request.tier2` | 432,000 | Requests | 100 queries x 4,320 objects, one GET each (assumed) | 0.16 | - | 0.16 |
| `glue.catalog.storage` | 2 | Obj-Month | 1 database + 1 table | 0.000020 | 1,000,000 | 0 |

- List subtotal: **USD 0.55** / month
- Subtotal after monthly free allowance: **USD 0.55** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `s3.request.tier1`, `s3.request.tier2`, `athena.scanned`

## Request records: 1 million requests a month, Parquet

ID: `analytics-1m-parquet` / chapter: [26 Analytics: Firehose, S3, Glue, and Athena](/en/chapters/26-analytics.md)

Assumptions:

- The same number and size of records as the JSON scenario
- Format conversion is billed on the same 5 KB-stepped volume as ingestion
- A 300-second buffer: one object every five minutes at most, 8,760 in 730 hours
- A Parquet file takes 84.6 bytes per record (measured on a sample written by a library on the laptop; the size of Firehose's own files was not confirmed)
- 100 queries a month, each under the 10 MB minimum
- Athena is assumed to make one GET per object (it may make several for Parquet; not confirmed): 100 queries x 3 days x 288 objects

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `firehose.ingest.direct-put` | 4.768 | GB | 1,000,000 records x 5,120 bytes | 0.17 | - | 0.17 |
| `firehose.format-conversion` | 4.768 | GB | the same billed volume | 0.10 | - | 0.10 |
| `s3.request.tier1` | 8,760 | Requests | one PUT per delivered object, one object every 5 minutes | 0.04 | - | 0.04 |
| `s3.standard.storage` | 0.236 | GB-Mo | 0.078752 GB a month, kept 90 days | 0.01 | - | 0.01 |
| `athena.scanned` | 0.001 | Terabytes | 100 queries x 10 MB minimum | 0.004770 | - | 0.004770 |
| `s3.request.tier2` | 86,400 | Requests | 100 queries x 864 objects, one GET each (assumed) | 0.03 | - | 0.03 |
| `glue.catalog.storage` | 2 | Obj-Month | 1 database + 1 table | 0.000020 | 1,000,000 | 0 |

- List subtotal: **USD 0.36** / month
- Subtotal after monthly free allowance: **USD 0.36** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `s3.request.tier1`, `s3.request.tier2`, `athena.scanned`

## What dynamic partitioning would add (not used in this chapter)

ID: `analytics-dynamic-partitioning-extra` / chapter: [26 Analytics: Firehose, S3, Glue, and Athena](/en/chapters/26-analytics.md)

Assumptions:

- 1 million records of 242 bytes a month: 0.225 GB delivered
- The date is the only partitioning key; one object a minute, 43,800 objects
- JQ processing time could not be estimated and is not included (0.112 per hour)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `firehose.dynamic-partitioning.gb` | 0.225 | GB | 1,000,000 records x 242 bytes | 0.01 | - | 0.01 |
| `firehose.dynamic-partitioning.object` | 43,800 | Objects | one object a minute | 0.35 | - | 0.35 |

- List subtotal: **USD 0.36** / month
- Subtotal after monthly free allowance: **USD 0.36** / month

## Request records: 30 days at the throttling limit

ID: `analytics-flood-json` / chapter: [26 Analytics: Firehose, S3, Glue, and Athena](/en/chapters/26-analytics.md)

Assumptions:

- The stage throttles at 10 requests a second: at most 25.92 million reach the function in 30 days, and each makes one record
- Records of 242 bytes, billed in 5 KB steps; gzip leaves 24.3%
- One object a minute: 43,200 objects
- No queries. The API, Lambda and DynamoDB are priced in chapter 19's flood scenario

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `firehose.ingest.direct-put` | 123.596 | GB | 25,920,000 records x 5,120 bytes | 4.45 | - | 4.45 |
| `s3.request.tier1` | 43,200 | Requests | one PUT per delivered object | 0.20 | - | 0.20 |
| `s3.standard.storage` | 4.254 | GB-Mo | 1.417893 GB a month, kept 90 days | 0.11 | - | 0.11 |

- List subtotal: **USD 4.76** / month
- Subtotal after monthly free allowance: **USD 4.76** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `s3.request.tier1`

## Search: deployed, with no writes and no searches for a month

ID: `search-idle` / chapter: [27 Search: Full-Text, Vectors, and RAG](/en/chapters/27-search.md)

Assumptions:

- Assumed 1,000 indexed notes with 2 passages each on average (2,000 vectors)
- Assumed 4.2 KB per vector (1,024 dimensions x 4 bytes, a key of about 30 bytes, about 70 bytes of metadata)
- No writes, searches, or answers
- DynamoDB storage stays inside its 25 GB free tier (1,000 notes of about 2 KB)
- The empty dead-letter queue and logs that expire after 7 days cost nothing

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3vectors.storage` | 0.008 | GB-Mo | 2,000 vectors x 4.2 KB, in GB | 0.000529 | - | 0.000529 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3vectors.storage`

## Search: 1,000 writes, 10,000 searches, and 1,000 answers a month

ID: `search-month` / chapter: [27 Search: Full-Text, Vectors, and RAG](/en/chapters/27-search.md)

Assumptions:

- The same 2,000-vector index as search-idle
- 1,000 writes, each assumed to be 2 passages of 400 tokens (the ratio of Japanese characters to tokens was not checked)
- One PutVectors call per write, each assumed to be billed at the 128 KB minimum
- 10,000 searches, each query assumed to embed as 30 tokens
- Each search assumed to read 10 notes of the owner, about 20 KB (3 read units)
- 1,000 of the searches go on to an answer, assumed at 2,500 input and 150 output tokens
- Lambda at 256 MB on arm64: assumed 0.5 s per search, 4 s per answer, 1 s per indexed write
- Assumed 1 KB of logs per request
- Data transfer and bytes returned by queries (free up to 512 KB per query) are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
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

- List subtotal: **USD 1.62** / month
- Subtotal after monthly free allowance: **USD 1.58** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3vectors.storage`, `s3vectors.put`, `s3vectors.query.request`, `s3vectors.query.processed.tier1`, `bedrock.titan-embed-text-v2.input`, `bedrock.nova-2-lite.input`, `bedrock.nova-2-lite.output`

## Comparison: the minimum for one OpenSearch Serverless Classic collection kept for a month

ID: `search-opensearch-classic-minimum` / chapter: [27 Search: Full-Text, Vectors, and RAG](/en/chapters/27-search.md)

Assumptions:

- The first Classic collection in an account, with redundancy (the default): at least 2 OCUs (1 indexing, 1 search)
- 730 hours, no requests
- Storage is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `opensearch.serverless.ocu.indexing` | 730 | OCU-hours | 1 OCU x 730 h | 243.82 | - | 243.82 |
| `opensearch.serverless.ocu.search` | 730 | OCU-hours | 1 OCU x 730 h | 243.82 | - | 243.82 |

- List subtotal: **USD 487.64** / month
- Subtotal after monthly free allowance: **USD 487.64** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `opensearch.serverless.ocu.indexing`, `opensearch.serverless.ocu.search`

## Comparison: the minimum for a Classic collection without standby replicas

ID: `search-opensearch-classic-dev` / chapter: [27 Search: Full-Text, Vectors, and RAG](/en/chapters/27-search.md)

Assumptions:

- No standby replicas (dev-test): at least 1 OCU (0.5 indexing, 0.5 search)
- 730 hours, no requests
- Storage is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `opensearch.serverless.ocu.indexing` | 365 | OCU-hours | 0.5 OCU x 730 h | 121.91 | - | 121.91 |
| `opensearch.serverless.ocu.search` | 365 | OCU-hours | 0.5 OCU x 730 h | 121.91 | - | 121.91 |

- List subtotal: **USD 243.82** / month
- Subtotal after monthly free allowance: **USD 243.82** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `opensearch.serverless.ocu.indexing`, `opensearch.serverless.ocu.search`

## Multi-Region: what the second Region adds in a month (1 GB table, 10 GB of images)

ID: `mr-second-region` / chapter: [28 Multi-Region: Global Tables, S3 Replication, and Route 53](/en/chapters/28-multi-region.md)

Assumptions:

- The two default stacks: a 1 GB table in each Region, with point-in-time recovery on both replicas
- 100,000 writes a month, each 1 KB or less. The Osaka replica is billed the same number of replicated write request units. Writes on the Tokyo side become replicated write request units at the same unit price, so they are not counted as added
- 10 GB of images with a copy in Osaka; 1 GB in 10,000 objects is newly replicated each month. Replication PUTs are computed at Osaka's ordinary PUT price
- Reads, Lambda, API Gateway, logs, and storage on the Tokyo side are left out. DynamoDB storage in Osaka falls inside the first 25 GB, which is priced at USD 0

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.replicated-write.osaka` | 100,000 | ReplicatedWriteRequestUnits | 100,000 writes of 1 KB or less, replicated to Osaka | 0.07 | - | 0.07 |
| `dynamodb.storage.osaka` | 1 | GB-Mo | 1 GB replica in Osaka, in GB-month | 0 | - | 0 |
| `dynamodb.pitr.storage.osaka` | 1 | GB-Mo | 1 GB replica under PITR in Osaka, in GB-month | 0.23 | - | 0.23 |
| `s3.standard.storage.osaka` | 10 | GB-Mo | 10 GB of replicas in Osaka, in GB-month | 0.25 | - | 0.25 |
| `s3.request.tier1.osaka` | 10,000 | Requests | 10,000 replication PUT requests into Osaka | 0.05 | - | 0.05 |
| `datatransfer.tokyo-osaka` | 1 | GB | 1 GB replicated from Tokyo to Osaka | 0.09 | - | 0.09 |

- List subtotal: **USD 0.69** / month
- Subtotal after monthly free allowance: **USD 0.69** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `dynamodb.replicated-write.osaka`, `datatransfer.tokyo-osaka`

## Multi-Region: what the domain option adds in a month

ID: `mr-dns` / chapter: [28 Multi-Region: Global Tables, S3 Replication, and Route 53](/en/chapters/28-multi-region.md)

Assumptions:

- The two stacks with `-c domain=...`: two HTTPS health checks at a 30-second interval
- The base charge for a health check of an AWS endpoint falls inside the first 50, priced at USD 0. HTTPS is billed as one optional feature per health check
- One hosted zone. If you already own the zone, this line adds nothing
- Queries to alias records are free. Charges for the ACM certificates and the API Gateway custom domain names were not looked up and are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `route53.health-check.aws` | 2 | Mo | 2 health checks of AWS endpoints, per month | 0 | - | 0 |
| `route53.health-check.option.aws` | 2 | Mo | HTTPS on each of the 2 health checks, per month | 2.00 | - | 2.00 |
| `route53.hosted-zone` | 1 | HostedZone | 1 public hosted zone, per month | 0.50 | - | 0.50 |

- List subtotal: **USD 2.50** / month
- Subtotal after monthly free allowance: **USD 2.50** / month

## Multi-Region: what S3 Replication Time Control adds in a month

ID: `mr-rtc` / chapter: [28 Multi-Region: Global Tables, S3 Replication, and Route 53](/en/chapters/28-multi-region.md)

Assumptions:

- `-c rtc=on`, with one replication rule from Tokyo to Osaka
- 1 GB replicated in the month
- Assumes four replication metrics (bytes pending, operations pending, operations failed, replication latency) billed for the whole month. The real number per rule, and whether they are billed in a month with nothing to replicate, was not confirmed

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3.rtc.tokyo-osaka` | 1 | GB | 1 GB replicated under Replication Time Control | 0.01 | - | 0.01 |
| `cloudwatch.metric.custom` | 4 | Metrics | 4 replication metrics, per month (assumed count) | 1.20 | 10 | 0 |

- List subtotal: **USD 1.22** / month
- Subtotal after monthly free allowance: **USD 0.02** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.rtc.tokyo-osaka`

## Lambda Tuning: deployed with the defaults, never called for a month

ID: `tune-idle` / chapter: [29 Lambda Tuning: Cold Starts, Memory, Concurrency, and Bundles](/en/chapters/29-lambda-tuning.md)

Assumptions:

- No requests
- No provisioned concurrency (the default). Reserved concurrency costs nothing either way
- Logs expire after 7 days; nothing is stored

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Lambda Tuning: 1,000,000 invocations a month at 256 MB and 50 ms

ID: `tune-1m-256` / chapter: [29 Lambda Tuning: Cold Starts, Memory, Concurrency, and Bundles](/en/chapters/29-lambda-tuning.md)

Assumptions:

- Lambda only. API Gateway, DynamoDB and logs are priced in chapters 04, 05 and 19 and are not included here
- arm64, 256 MB, 50 ms billed per invocation (the assumption of chapter 04)
- No cold starts

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 1,000,000 | Requests | 1,000,000 invocations | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 12,500 | Lambda-GB-Second | 1,000,000 x 0.05 s x 0.25 GB, in GB-seconds | 0.17 | 400,000 | 0 |

- List subtotal: **USD 0.37** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Lambda Tuning: 1,000,000 invocations a month at 1,024 MB, still 50 ms

ID: `tune-1m-1024` / chapter: [29 Lambda Tuning: Cold Starts, Memory, Concurrency, and Bundles](/en/chapters/29-lambda-tuning.md)

Assumptions:

- Lambda only. API Gateway, DynamoDB and logs are priced in chapters 04, 05 and 19 and are not included here
- arm64, 1,024 MB. Assumes four times the memory left the duration at 50 ms, as when most of it is waiting on the network
- No cold starts

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 1,000,000 | Requests | 1,000,000 invocations | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 50,000 | Lambda-GB-Second | 1,000,000 x 0.05 s x 1 GB, in GB-seconds | 0.67 | 400,000 | 0 |

- List subtotal: **USD 0.87** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Lambda Tuning: 1,000,000 invocations a month, 1% of them cold

ID: `tune-1m-cold` / chapter: [29 Lambda Tuning: Cold Starts, Memory, Concurrency, and Bundles](/en/chapters/29-lambda-tuning.md)

Assumptions:

- Lambda only. API Gateway, DynamoDB and logs are priced in chapters 04, 05 and 19 and are not included here
- arm64, 256 MB, 50 ms in the handler
- Assumes 1% (10,000) start cold with 300 ms of initialization each. The 300 ms is an assumption, not a measurement
- Initialization is billed at the same rate as duration (since August 1, 2025)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 1,000,000 | Requests | 1,000,000 invocations | 0.20 | 1,000,000 | 0 |
| `lambda.duration.arm` | 13,250 | Lambda-GB-Second | 12,500 + 10,000 x 0.3 s x 0.25 GB, in GB-seconds | 0.18 | 400,000 | 0 |

- List subtotal: **USD 0.38** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Lambda Tuning: provisioned concurrency of 1 kept for a month (what it costs unused)

ID: `tune-provisioned-1` / chapter: [29 Lambda Tuning: Cold Starts, Memory, Concurrency, and Bundles](/en/chapters/29-lambda-tuning.md)

Assumptions:

- Deployed with -c provisionedConcurrency=1 at 256 MB on arm64 and left for 730 hours
- No requests. Requests and duration are charged on top when it is called
- The Lambda free tier does not apply to a function with provisioned concurrency

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.provisioned.arm` | 657,000 | Lambda-GB-Second | 1 x 0.25 GB x 2,628,000 s, in GB-seconds | 2.83 | - | 2.83 |

- List subtotal: **USD 2.83** / month
- Subtotal after monthly free allowance: **USD 2.83** / month

## Lambda Tuning: a 1,024 MB function held at the stage throttle for 30 days

ID: `tune-flood-1024` / chapter: [29 Lambda Tuning: Cold Starts, Memory, Concurrency, and Bundles](/en/chapters/29-lambda-tuning.md)

Assumptions:

- Lambda only. The other lines are those of chapter 19's flood table
- Held at the stage throttle of 10 a second for 30 days: 25,920,000 invocations
- 60 ms each at 1,024 MB on arm64: chapter 19's assumption with four times the memory

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 25,920,000 | Requests | 10 a second x 2,592,000 s | 5.18 | 1,000,000 | 4.98 |
| `lambda.duration.arm` | 1,555,200 | Lambda-GB-Second | 25,920,000 x 0.06 s x 1 GB, in GB-seconds | 20.74 | 400,000 | 15.40 |

- List subtotal: **USD 25.92** / month
- Subtotal after monthly free allowance: **USD 20.39** / month

## Lambda Tuning: held at the stage throttle while every invocation runs to the timeout

ID: `tune-flood-stalled` / chapter: [29 Lambda Tuning: Cold Starts, Memory, Concurrency, and Bundles](/en/chapters/29-lambda-tuning.md)

Assumptions:

- Lambda only. An arithmetic upper bound, not checked against a bill
- Held at the stage throttle of 10 a second for 30 days: 25,920,000 invocations
- Assumes the downstream does not answer and every invocation is billed up to the 10-second function timeout. 256 MB, arm64
- No reserved concurrency: concurrency reaches 10 x 10 = 100

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 25,920,000 | Requests | 10 a second x 2,592,000 s | 5.18 | 1,000,000 | 4.98 |
| `lambda.duration.arm` | 64,800,000 | Lambda-GB-Second | 25,920,000 x 10 s x 0.25 GB, in GB-seconds | 864.00 | 400,000 | 858.67 |

- List subtotal: **USD 869.19** / month
- Subtotal after monthly free allowance: **USD 863.65** / month

## Lambda Tuning: the same situation with a reserved concurrency of 5

ID: `tune-flood-stalled-reserved` / chapter: [29 Lambda Tuning: Cold Starts, Memory, Concurrency, and Bundles](/en/chapters/29-lambda-tuning.md)

Assumptions:

- Lambda only. An arithmetic upper bound, not checked against a bill
- -c reservedConcurrency=5: at most five environments; requests beyond them are refused without running the function
- Five environments running 10-second invocations without pause for 30 days: 1,296,000 invocations, 256 MB, arm64

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 1,296,000 | Requests | 5 environments x 2,592,000 s / 10 s | 0.26 | 1,000,000 | 0.06 |
| `lambda.duration.arm` | 3,240,000 | Lambda-GB-Second | 5 x 2,592,000 s x 0.25 GB, in GB-seconds | 43.20 | 400,000 | 37.87 |

- List subtotal: **USD 43.46** / month
- Subtotal after monthly free allowance: **USD 37.93** / month

## Data Modeling: deployed, but unused for a month

ID: `modeling-idle` / chapter: [30 Data Modeling: Single-Table Design, GSIs, Streams, and Transactions in DynamoDB](/en/chapters/30-data-modeling.md)

Assumptions:

- The default stack, Contributor Insights off
- 10 MB in the table and its index together; no reads or writes
- No changes on the stream, so the function is never invoked. Lambda's polling of the stream is not charged

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.storage` | 0.01 | GB-Mo | 10 MB stored in the table and the index, in GB-month | 0 | - | 0 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Data Modeling: one million reads and writes a month

ID: `modeling-month` / chapter: [30 Data Modeling: Single-Table Design, GSIs, Streams, and Transactions in DynamoDB](/en/chapters/30-data-modeling.md)

Assumptions:

- One million operations a month: 60% recent list, 10% tag list, 20% note with attachments, 5% edits (one in five also changes the title), 3% creates, 1% attachments added, 1% deletes
- Every item is 1 KB or less, a list page 8 KB or less, a note with its attachments 4 KB or less. Three tags a note, no slug, one attachment on a deleted note
- Each item in a transaction is counted as 2 units, including one that is only a condition (ConditionCheck). Whether a ConditionCheck is billed as a write or a read was not confirmed
- The stream function is assumed to be invoked once for each of the 150,000 changes to tag items, at 256 MB for 50 ms (not measured). 200 bytes of log per invocation
- 1 GB in the table and the index. Contributor Insights off. No conflicts and no retries

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.read.on-demand` | 960,000 | ReadRequestUnits | 600,000 recent lists and 100,000 tag lists at 1 unit (8 KB, eventually consistent), 200,000 collections at 1 unit (4 KB, strongly consistent), 60,000 reads before an edit or a delete at 1 unit | 0.14 | - | 0.14 |
| `dynamodb.write.on-demand` | 1,190,000 | WriteRequestUnits | creates 30,000 x 11 (5 items x 2, index 1); plain edits 40,000 x 3 (1, index 2); renames 10,000 x 10 (4 items x 2, index 2); attachments 10,000 x 4; deletes 10,000 x 12 (5 items x 2, index 1, one attachment); stream consumer 120,000 x 4 (2 items x 2) | 0.85 | - | 0.85 |
| `dynamodb.storage` | 1 | GB-Mo | 1 GB in the table and the index, in GB-month | 0 | - | 0 |
| `lambda.request.arm` | 150,000 | Requests | one invocation per tag item change: 90,000 inserts, 30,000 removes, 30,000 rewrites after a rename | 0.03 | 1,000,000 | 0 |
| `lambda.duration.arm` | 1,875 | Lambda-GB-Second | 150,000 x 0.05 s x 0.25 GB | 0.03 | 400,000 | 0 |
| `logs.ingest.standard` | 0.03 | GB | 150,000 x 200 bytes, in GB | 0.02 | 5 | 0 |

- List subtotal: **USD 1.07** / month
- Subtotal after monthly free allowance: **USD 0.99** / month

## Data Modeling: a month with Contributor Insights on (-c insights=on)

ID: `modeling-insights` / chapter: [30 Data Modeling: Single-Table Design, GSIs, Streams, and Transactions in DynamoDB](/en/chapters/30-data-modeling.md)

Assumptions:

- Enabled on the table only, in the mode that counts throttled keys only. The table has a sort key, so there are two rules
- No request is throttled, so there are no events
- Enabling it on the index too would add two more rules

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.contributor-insights.dynamodb.rule` | 2 | Rule-Hour | 2 rules for one month | 1.00 | - | 1.00 |
| `cloudwatch.contributor-insights.dynamodb.event` | 0 | Events | no throttled requests | 0 | - | 0 |

- List subtotal: **USD 1.00** / month
- Subtotal after monthly free allowance: **USD 1.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `cloudwatch.contributor-insights.dynamodb.rule`, `cloudwatch.contributor-insights.dynamodb.event`

## Progressive delivery: deployed for a month and never called

ID: `progressive-idle` / chapter: [31 Progressive Delivery: Aliases, Canaries, Blue/Green, and Feature Flags](/en/chapters/31-progressive-delivery.md)

Assumptions:

- The default stack: two standard-resolution alarms
- No requests. The function never starts, so the extension never calls AppConfig
- No logs are written

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.alarm.standard` | 2 | Alarms | 2 alarms, one metric each, for one month | 0.20 | 10 | 0 |

- List subtotal: **USD 0.20** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Progressive delivery: a month of flags and alarms (one execution environment always warm, 1,000 cold starts)

ID: `progressive-flags-month` / chapter: [31 Progressive Delivery: Aliases, Canaries, Blue/Green, and Feature Flags](/en/chapters/31-progressive-delivery.md)

Assumptions:

- One execution environment is invoked for all 730 hours, and the extension asks AppConfig every 45 seconds: 730 × 3,600 ÷ 45 = 58,400 requests
- 1,000 configurations received: one per cold start, and one per flag deployment for an environment that is running. This way of counting is read from the unit name in the price list and a note in the documentation, and was not checked against a bill
- API Gateway, Lambda, and logs cost what they do in chapter 04 and are left out

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.alarm.standard` | 2 | Alarms | 2 alarms, one metric each, for one month | 0.20 | 10 | 0 |
| `appconfig.request` | 58,400 | Configuration Requests | 730 h x 3600 s / 45 s poll interval | 0.01 | - | 0.01 |
| `appconfig.received` | 1,000 | Configuration Received | 1,000 configurations received | 0.80 | - | 0.80 |

- List subtotal: **USD 1.01** / month
- Subtotal after monthly free allowance: **USD 0.81** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `appconfig.request`, `appconfig.received`

## Notes API with its limits: deployed, but never called for a month

ID: `limits-idle` / chapter: [32 Limits: Quotas, Throttling, Retries, Load Tests, and Cost Breakdown](/en/chapters/32-limits.md)

Assumptions:

- No requests: no usage for API Gateway, Lambda, DynamoDB or logs
- The one alarm refers to one metric (Lambda's Throttles)
- One budget with no action; the Price List gives USD 0.00 for BudgetsUsage
- Reserved concurrency and the stage's throttle settings are not charged for
- The Cost Explorer API is never called

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.alarm.standard` | 1 | Alarms | 1 alarm on 1 metric | 0.10 | 10 | 0 |

- List subtotal: **USD 0.10** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Reading cost by tag from the script once a day for a month

ID: `limits-cost-report` / chapter: [32 Limits: Quotas, Throttling, Retries, Load Tests, and Cost Breakdown](/en/chapters/32-limits.md)

Assumptions:

- vp run limits:cost once a day for 30 days; each run is one Cost Explorer API request
- The result fits in one page (a second page would be another request; the script does not fetch one)
- Opening Cost Explorer in the console is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `costexplorer.api.request` | 30 | Request | 30 runs x 1 request | 0.30 | - | 0.30 |

- List subtotal: **USD 0.30** / month
- Subtotal after monthly free allowance: **USD 0.30** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `costexplorer.api.request`

## Lambda Managed Instances: a month without one request

ID: `lmi-idle` / chapter: [35 Lambda Managed Instances: Lambda on EC2 Capacity You Choose](/en/chapters/35-lambda-managed-instances.md)

Assumptions:

- The default layout, assuming Lambda launches three m6g.large instances (its guide says three by default when a function version is published; not checked on AWS)
- EC2 On-Demand list price, and Lambda's management fee of 15% of it
- One interface endpoint for CloudWatch Logs in two zones, left in the chapter 11 stack
- The EBS volumes of the instances (size not confirmed), API Gateway, logs, and data transfer are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.m6g-large.linux.hour` | 2,190 | Hrs | 3 m6g.large x 730 hours | 216.81 | - | 216.81 |
| `lambda.managed-instances.m6g-large.management.hour` | 2,190 | Hours | management fee, 3 m6g.large x 730 hours | 32.52 | - | 32.52 |
| `vpc.endpoint.interface.hour` | 1,460 | Hrs | 1 interface endpoint x 2 zones x 730 hours | 20.44 | - | 20.44 |

- List subtotal: **USD 269.77** / month
- Subtotal after monthly free allowance: **USD 269.77** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ec2.m6g-large.linux.hour`

## Lambda Managed Instances: left for one day

ID: `lmi-one-day` / chapter: [35 Lambda Managed Instances: Lambda on EC2 Capacity You Choose](/en/chapters/35-lambda-managed-instances.md)

Assumptions:

- The default layout, assuming Lambda launches three m6g.large instances (its guide says three by default when a function version is published; not checked on AWS)
- One interface endpoint for CloudWatch Logs in two zones, left in the chapter 11 stack
- The EBS volumes of the instances (size not confirmed), API Gateway, logs, and data transfer are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.m6g-large.linux.hour` | 72 | Hrs | 3 m6g.large x 24 hours | 7.13 | - | 7.13 |
| `lambda.managed-instances.m6g-large.management.hour` | 72 | Hours | management fee, 3 m6g.large x 24 hours | 1.07 | - | 1.07 |
| `vpc.endpoint.interface.hour` | 48 | Hrs | 1 interface endpoint x 2 zones x 24 hours | 0.67 | - | 0.67 |

- List subtotal: **USD 8.87** / month
- Subtotal after monthly free allowance: **USD 8.87** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ec2.m6g-large.linux.hour`

## Lambda Managed Instances: a month at the vCPU ceiling

ID: `lmi-ceiling` / chapter: [35 Lambda Managed Instances: Lambda on EC2 Capacity You Choose](/en/chapters/35-lambda-managed-instances.md)

Assumptions:

- maxVCpuCount is 12, so at most six m6g.large (2 vCPUs each). All six running for 730 hours
- One interface endpoint for CloudWatch Logs in two zones, left in the chapter 11 stack
- The EBS volumes of the instances (size not confirmed), API Gateway, logs, and data transfer are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.m6g-large.linux.hour` | 4,380 | Hrs | 6 m6g.large x 730 hours | 433.62 | - | 433.62 |
| `lambda.managed-instances.m6g-large.management.hour` | 4,380 | Hours | management fee, 6 m6g.large x 730 hours | 65.04 | - | 65.04 |
| `vpc.endpoint.interface.hour` | 1,460 | Hrs | 1 interface endpoint x 2 zones x 730 hours | 20.44 | - | 20.44 |

- List subtotal: **USD 519.10** / month
- Subtotal after monthly free allowance: **USD 519.10** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ec2.m6g-large.linux.hour`

## Lambda Managed Instances: a month of steady load

ID: `lmi-steady` / chapter: [35 Lambda Managed Instances: Lambda on EC2 Capacity You Choose](/en/chapters/35-lambda-managed-instances.md)

Assumptions:

- 100 million requests a month at 200 ms each on average (7.6 requests in flight on average)
- Assumes three m6g.large can carry this load (it depends on CPU time per request, and was not measured)
- One interface endpoint for CloudWatch Logs in two zones, left in the chapter 11 stack
- The EBS volumes of the instances (size not confirmed), API Gateway, logs, and data transfer are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.managed-instances.request.arm` | 100,000,000 | Requests | 100 million requests | 20.00 | - | 20.00 |
| `ec2.m6g-large.linux.hour` | 2,190 | Hrs | 3 m6g.large x 730 hours | 216.81 | - | 216.81 |
| `lambda.managed-instances.m6g-large.management.hour` | 2,190 | Hours | management fee, 3 m6g.large x 730 hours | 32.52 | - | 32.52 |
| `vpc.endpoint.interface.hour` | 1,460 | Hrs | 1 interface endpoint x 2 zones x 730 hours | 20.44 | - | 20.44 |

- List subtotal: **USD 289.77** / month
- Subtotal after monthly free allowance: **USD 289.77** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `lambda.managed-instances.request.arm`, `ec2.m6g-large.linux.hour`

## Comparison: the same month on standard Lambda (arm64, 256 MB)

ID: `lmi-compare-standard-256mb` / chapter: [35 Lambda Managed Instances: Lambda on EC2 Capacity You Choose](/en/chapters/35-lambda-managed-instances.md)

Assumptions:

- 100 million requests a month at 200 ms each on average (7.6 requests in flight on average)
- Memory is 256 MB. Billed duration is assumed to stay at 200 ms per request (memory changes duration, and none of it was measured)
- List price before the free tier. API Gateway, logs, and data transfer are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 100,000,000 | Requests | 100 million requests | 20.00 | 1,000,000 | 19.80 |
| `lambda.duration.arm` | 5,000,000 | Lambda-GB-Second | 100 million x 0.2 s x 256 MB | 66.67 | 400,000 | 61.33 |

- List subtotal: **USD 86.67** / month
- Subtotal after monthly free allowance: **USD 81.13** / month

## Comparison: the same month on standard Lambda (arm64, 1 GB)

ID: `lmi-compare-standard-1gb` / chapter: [35 Lambda Managed Instances: Lambda on EC2 Capacity You Choose](/en/chapters/35-lambda-managed-instances.md)

Assumptions:

- 100 million requests a month at 200 ms each on average (7.6 requests in flight on average)
- Memory is 1 GB. Billed duration is assumed to stay at 200 ms per request (memory changes duration, and none of it was measured)
- List price before the free tier. API Gateway, logs, and data transfer are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 100,000,000 | Requests | 100 million requests | 20.00 | 1,000,000 | 19.80 |
| `lambda.duration.arm` | 20,000,000 | Lambda-GB-Second | 100 million x 0.2 s x 1 GB | 266.67 | 400,000 | 261.33 |

- List subtotal: **USD 286.67** / month
- Subtotal after monthly free allowance: **USD 281.13** / month

## Comparison: the same month on standard Lambda (arm64, 2 GB)

ID: `lmi-compare-standard-2gb` / chapter: [35 Lambda Managed Instances: Lambda on EC2 Capacity You Choose](/en/chapters/35-lambda-managed-instances.md)

Assumptions:

- 100 million requests a month at 200 ms each on average (7.6 requests in flight on average)
- Memory is 2 GB. Billed duration is assumed to stay at 200 ms per request (memory changes duration, and none of it was measured)
- List price before the free tier. API Gateway, logs, and data transfer are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 100,000,000 | Requests | 100 million requests | 20.00 | 1,000,000 | 19.80 |
| `lambda.duration.arm` | 40,000,000 | Lambda-GB-Second | 100 million x 0.2 s x 2 GB | 533.34 | 400,000 | 528.00 |

- List subtotal: **USD 553.34** / month
- Subtotal after monthly free allowance: **USD 547.80** / month

## Comparison: the same three m6g.large as plain EC2 for a month

ID: `lmi-compare-ec2` / chapter: [35 Lambda Managed Instances: Lambda on EC2 Capacity You Choose](/en/chapters/35-lambda-managed-instances.md)

Assumptions:

- Three m6g.large for 730 hours
- Volumes, a load balancer, public IPv4 addresses, and data transfer are not included. Patching, process supervision, and scaling become your work

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.m6g-large.linux.hour` | 2,190 | Hrs | 3 m6g.large x 730 hours | 216.81 | - | 216.81 |

- List subtotal: **USD 216.81** / month
- Subtotal after monthly free allowance: **USD 216.81** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ec2.m6g-large.linux.hour`

## Comparison: three Fargate tasks of the same shape (2 vCPUs, 8 GB) for a month

ID: `lmi-compare-fargate` / chapter: [35 Lambda Managed Instances: Lambda on EC2 Capacity You Choose](/en/chapters/35-lambda-managed-instances.md)

Assumptions:

- Three arm64 Fargate tasks of 2 vCPUs and 8 GB each for 730 hours
- A load balancer, public IPv4 addresses, ECR, and data transfer are not included (chapter 12's scenarios have them)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 4,380 | hours | 3 tasks x 2 vCPUs x 730 hours | 177.17 | - | 177.17 |
| `fargate.arm.memory.gb-hour` | 17,520 | hours | 3 tasks x 8 GB x 730 hours | 77.44 | - | 77.44 |

- List subtotal: **USD 254.61** / month
- Subtotal after monthly free allowance: **USD 254.61** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`

## Notes assistant: deployed, but never called for a month

ID: `bedrock-idle` / chapter: [36 Bedrock: Tool Use, Structured Output, Guardrails, Prompt Caching, Inference Profiles, and Batch](/en/chapters/36-bedrock.md)

Assumptions:

- No requests
- The tables are empty; nothing is stored
- A guardrail is not billed for existing (billing is per text unit)
- Logs expire after a week; nothing is stored

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Notes assistant: 1,000 questions a month (Nova 2 Lite, jp. profile)

ID: `bedrock-assistant-nova-2-lite` / chapter: [36 Bedrock: Tool Use, Structured Output, Guardrails, Prompt Caching, Inference Profiles, and Batch](/en/chapters/36-bedrock.md)

Assumptions:

- 1,000 questions a month, assuming three model calls each (list, read one, answer)
- Assumed 4,000 input tokens per question over the three calls (the conversation is sent again every time; the real number is in the log's usage)
- Assumed 200 output tokens per question in total
- Calculated without prompt caching
- The guardrail has the sensitive information filter only; assumed 6 text units per question (one in and one out for each of three calls; how units are counted across several calls is not confirmed)
- Lambda at 256 MB on arm64, assumed 8 seconds per question
- DynamoDB assumed at 2 writes (reserve and settle the budget) and 3 reads per question
- Assumed 1 KB of logs per question
- Data transfer is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input` | 4,000 | 1K tokens | 1,000 questions x 4,000 input tokens, in 1K tokens | 1.58 | - | 1.58 |
| `bedrock.nova-2-lite.output` | 200 | 1K tokens | 1,000 questions x 200 output tokens, in 1K tokens | 0.66 | - | 0.66 |
| `bedrock.guardrail.sensitive-information` | 6,000 | TextUnit | 1,000 questions x 6 text units | 0.60 | - | 0.60 |
| `lambda.request.arm` | 1,000 | Requests | one invocation per question | 0.000200 | 1,000,000 | 0 |
| `lambda.duration.arm` | 2,000 | Lambda-GB-Second | 1,000 x 8 s x 0.25 GB | 0.03 | 400,000 | 0 |
| `dynamodb.write.on-demand` | 2,000 | WriteRequestUnits | 1,000 x 2 write request units | 0.001430 | - | 0.001430 |
| `dynamodb.read.on-demand` | 3,000 | ReadRequestUnits | 1,000 x 3 read request units | 0.000427 | - | 0.000427 |
| `logs.ingest.standard` | 0.001 | GB | 1,000 x 1 KB, in GB | 0.000725 | 5 | 0 |

- List subtotal: **USD 2.88** / month
- Subtotal after monthly free allowance: **USD 2.85** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.guardrail.sensitive-information`, `bedrock.nova-2-lite.input`, `bedrock.nova-2-lite.output`

## Prompt caching arithmetic: 1,000 conversations a month that send the same 2,000-token prefix four times, no cache (Nova 2 Lite)

ID: `bedrock-prefix-uncached-nova-2-lite` / chapter: [36 Bedrock: Tool Use, Structured Output, Guardrails, Prompt Caching, Inference Profiles, and Batch](/en/chapters/36-bedrock.md)

Assumptions:

- The 2,000-token prefix only; the rest of the input and the output are not included
- All four sends billed as ordinary input

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input` | 8,000 | 1K tokens | 1,000 x 4 x 2,000 tokens, in 1K tokens | 3.17 | - | 3.17 |

- List subtotal: **USD 3.17** / month
- Subtotal after monthly free allowance: **USD 3.17** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.nova-2-lite.input`

## Prompt caching arithmetic: the same conversations with a cache point (Nova 2 Lite)

ID: `bedrock-prefix-cached-nova-2-lite` / chapter: [36 Bedrock: Tool Use, Structured Output, Guardrails, Prompt Caching, Inference Profiles, and Batch](/en/chapters/36-bedrock.md)

Assumptions:

- Assumes the first send writes and the second to fourth read (a hit is never guaranteed)
- Assumes each send comes within 5 minutes of the one before

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.cache-write` | 2,000 | 1K tokens | 1,000 x 1 x 2,000 tokens, in 1K tokens | 0 | - | 0 |
| `bedrock.nova-2-lite.cache-read` | 6,000 | 1K tokens | 1,000 x 3 x 2,000 tokens, in 1K tokens | 0.59 | - | 0.59 |

- List subtotal: **USD 0.59** / month
- Subtotal after monthly free allowance: **USD 0.59** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.nova-2-lite.cache-read`, `bedrock.nova-2-lite.cache-write`

## Prompt caching arithmetic: 1,000 conversations a month that send the same 5,000-token prefix four times, no cache (Claude Haiku 4.5)

ID: `bedrock-prefix-uncached-claude-haiku-4-5` / chapter: [36 Bedrock: Tool Use, Structured Output, Guardrails, Prompt Caching, Inference Profiles, and Batch](/en/chapters/36-bedrock.md)

Assumptions:

- The 5,000-token prefix only (this model's minimum is 4,096 tokens)
- All four sends billed as ordinary input

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.claude-haiku-4-5.input` | 20 | 1M tokens | 1,000 x 4 x 5,000 tokens, in 1M tokens | 22.00 | - | 22.00 |

- List subtotal: **USD 22.00** / month
- Subtotal after monthly free allowance: **USD 22.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.claude-haiku-4-5.input`

## Prompt caching arithmetic: the same conversations with a cache point (Claude Haiku 4.5)

ID: `bedrock-prefix-cached-claude-haiku-4-5` / chapter: [36 Bedrock: Tool Use, Structured Output, Guardrails, Prompt Caching, Inference Profiles, and Batch](/en/chapters/36-bedrock.md)

Assumptions:

- Assumes the first send writes (5-minute TTL) and the second to fourth read (a hit is never guaranteed)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.claude-haiku-4-5.cache-write` | 5 | 1M tokens | 1,000 x 1 x 5,000 tokens, in 1M tokens | 6.88 | - | 6.88 |
| `bedrock.claude-haiku-4-5.cache-read` | 15 | 1M tokens | 1,000 x 3 x 5,000 tokens, in 1M tokens | 1.65 | - | 1.65 |

- List subtotal: **USD 8.53** / month
- Subtotal after monthly free allowance: **USD 8.53** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.claude-haiku-4-5.cache-read`, `bedrock.claude-haiku-4-5.cache-write`

## 10,000 summaries on demand (Nova 2 Lite, inference only)

ID: `bedrock-summaries-on-demand-nova-2-lite` / chapter: [36 Bedrock: Tool Use, Structured Output, Guardrails, Prompt Caching, Inference Profiles, and Batch](/en/chapters/36-bedrock.md)

Assumptions:

- Assumed 2,000 input and 150 output tokens each (chapter 17's assumption)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input` | 20,000 | 1K tokens | 10,000 x 2,000 tokens, in 1K tokens | 7.92 | - | 7.92 |
| `bedrock.nova-2-lite.output` | 1,500 | 1K tokens | 10,000 x 150 tokens, in 1K tokens | 4.97 | - | 4.97 |

- List subtotal: **USD 12.89** / month
- Subtotal after monthly free allowance: **USD 12.89** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.nova-2-lite.input`, `bedrock.nova-2-lite.output`

## The same 10,000 summaries as batch inference (Nova 2 Lite, inference only)

ID: `bedrock-summaries-batch-nova-2-lite` / chapter: [36 Bedrock: Tool Use, Structured Output, Guardrails, Prompt Caching, Inference Profiles, and Batch](/en/chapters/36-bedrock.md)

Assumptions:

- Token counts assumed equal to on demand
- S3 storage and request charges are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input.batch` | 20,000 | 1K tokens | 10,000 x 2,000 tokens, in 1K tokens | 3.96 | - | 3.96 |
| `bedrock.nova-2-lite.output.batch` | 1,500 | 1K tokens | 10,000 x 150 tokens, in 1K tokens | 2.48 | - | 2.48 |

- List subtotal: **USD 6.44** / month
- Subtotal after monthly free allowance: **USD 6.44** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.nova-2-lite.input.batch`, `bedrock.nova-2-lite.output.batch`

## Data movement: a month in which nothing changes (Basic mode, one execution a day)

ID: `move-quiet-month` / chapter: [38 Data Movement: DataSync, Data Pipeline Today, and Choosing How to Move Data](/en/chapters/38-data-movement.md)

Assumptions:

- 10,000 attachments, 10 GB in all, with chapter 07's keys (`u/<owner>/<note>/<attachment>`): 100 owners and 1,000 notes, so 1,101 prefixes that count as folders
- 30 executions, none of which has anything to copy
- The request counts are assumptions: per execution, one LIST per prefix and one HEAD per object on each side, and one tagging GET per object on the source. The documentation gives no counts
- Bucket storage, logs, Lambda, and SNS are left out

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `datasync.basic.gb.osaka` | 0 | GB | nothing copied | 0 | - | 0 |
| `s3.request.tier1` | 33,030 | Requests | source LIST: 1,101 prefixes x 30 executions | 0.16 | - | 0.16 |
| `s3.request.tier1.osaka` | 33,030 | Requests | archive LIST: 1,101 prefixes x 30 executions | 0.16 | - | 0.16 |
| `s3.request.tier2` | 600,000 | Requests | source HEAD and tagging GET: 2 x 10,000 objects x 30 executions | 0.22 | - | 0.22 |
| `s3.request.tier2.osaka` | 300,000 | Requests | archive HEAD: 10,000 objects x 30 executions | 0.11 | - | 0.11 |

- List subtotal: **USD 0.64** / month
- Subtotal after monthly free allowance: **USD 0.64** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.request.tier1`, `s3.request.tier2`, `datasync.basic.gb.osaka`

## Data movement: the first execution (10 GB from Tokyo to Osaka) and a month of storing the copy

ID: `move-first-copy` / chapter: [38 Data Movement: DataSync, Data Pipeline Today, and Choosing How to Move Data](/en/chapters/38-data-movement.md)

Assumptions:

- 10,000 attachments, 10 GB in all, with chapter 07's keys (`u/<owner>/<note>/<attachment>`): 100 owners and 1,000 notes, so 1,101 prefixes that count as folders
- One execution in Basic mode that copies everything
- The request counts are assumptions. Source: 1,101 LIST, 10,000 HEAD, 10,000 GET, 20,000 tagging GET. Archive: 1,101 LIST, 10,000 PUT, 10,000 HEAD for verification. Each object is taken to be written with one PUT
- Data transfer between Regions is counted as transfer out of the source Region
- Archive storage is 10 GB in S3 Standard for one month

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `datasync.basic.gb.osaka` | 10 | GB | 10 GB copied | 0.13 | - | 0.13 |
| `datatransfer.tokyo-osaka` | 10 | GB | 10 GB from Tokyo to Osaka | 0.90 | - | 0.90 |
| `s3.request.tier1` | 1,101 | Requests | source LIST | 0.01 | - | 0.01 |
| `s3.request.tier2` | 40,000 | Requests | source HEAD, GET, and tagging GET | 0.01 | - | 0.01 |
| `s3.request.tier1.osaka` | 11,101 | Requests | archive LIST and PUT | 0.05 | - | 0.05 |
| `s3.request.tier2.osaka` | 10,000 | Requests | archive HEAD | 0.003700 | - | 0.003700 |
| `s3.standard.storage.osaka` | 10 | GB-Mo | 10 GB in the archive, in GB-month | 0.25 | - | 0.25 |

- List subtotal: **USD 1.35** / month
- Subtotal after monthly free allowance: **USD 1.35** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.request.tier1`, `s3.request.tier2`, `datatransfer.tokyo-osaka`, `datasync.basic.gb.osaka`

## Data movement: the per-execution fee for the same month in Enhanced mode

ID: `move-enhanced-month` / chapter: [38 Data Movement: DataSync, Data Pipeline Today, and Choosing How to Move Data](/en/chapters/38-data-movement.md)

Assumptions:

- One execution a day, 30 in the month. An execution with nothing to copy is assumed to be charged the fee; the pricing page says neither that it is nor that it is not
- S3 requests are left out

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `datasync.enhanced.execution.osaka` | 30 | Task-Executions | 30 task executions | 16.50 | - | 16.50 |
| `datasync.enhanced.gb.osaka` | 0 | GB | nothing copied | 0 | - | 0 |

- List subtotal: **USD 16.50** / month
- Subtotal after monthly free allowance: **USD 16.50** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `datasync.enhanced.gb.osaka`, `datasync.enhanced.execution.osaka`

## Database Migration: the stack for a month, replication never started

ID: `dbmig-idle` / chapter: [39 Database Migration: DMS, Full Load, CDC, and Cutover](/en/chapters/39-database-migration.md)

Assumptions:

- The default stack: two secrets. The replication configuration exists and is never started
- The two databases and the chapter 11 VPC with its endpoints are left out
- That an unstarted configuration bills no DCU is read from the pricing page and the user guide, and was not confirmed on a bill

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `secretsmanager.secret` | 2 | Secrets | 2 secrets for a month | 0.80 | - | 0.80 |

- List subtotal: **USD 0.80** / month
- Subtotal after monthly free allowance: **USD 0.80** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `secretsmanager.secret`

## Database Migration: one week at 1 DCU, then cutover

ID: `dbmig-week` / chapter: [39 Database Migration: DMS, Full Load, CDC, and Cutover](/en/chapters/39-database-migration.md)

Assumptions:

- The replication runs 168 hours at 1 DCU, Single-AZ, and never scales up
- A Secrets Manager interface endpoint in two subnets for 168 hours
- Two secrets for a month. The two databases, data transfer, and logs are left out

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dms.serverless.dcu1.hour` | 168 | DCU-Hr | 168 hours at 1 DCU | 19.22 | - | 19.22 |
| `vpc.endpoint.interface.hour` | 336 | Hrs | 1 interface endpoint x 2 subnets x 168 hours | 4.70 | - | 4.70 |
| `secretsmanager.secret` | 2 | Secrets | 2 secrets for a month | 0.80 | - | 0.80 |

- List subtotal: **USD 24.73** / month
- Subtotal after monthly free allowance: **USD 24.73** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `dms.serverless.dcu1.hour`, `secretsmanager.secret`

## Database Migration: a month with the replication left running after the cutover

ID: `dbmig-forgotten` / chapter: [39 Database Migration: DMS, Full Load, CDC, and Cutover](/en/chapters/39-database-migration.md)

Assumptions:

- The replication keeps running for 730 hours at 1 DCU, Single-AZ
- A Secrets Manager interface endpoint in two subnets for 730 hours
- Two secrets. The databases are left out

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dms.serverless.dcu1.hour` | 730 | DCU-Hr | 730 hours at 1 DCU | 83.52 | - | 83.52 |
| `vpc.endpoint.interface.hour` | 1,460 | Hrs | 1 interface endpoint x 2 subnets x 730 hours | 20.44 | - | 20.44 |
| `secretsmanager.secret` | 2 | Secrets | 2 secrets for a month | 0.80 | - | 0.80 |

- List subtotal: **USD 104.76** / month
- Subtotal after monthly free allowance: **USD 104.76** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `dms.serverless.dcu1.hour`, `secretsmanager.secret`

## Database Migration: for comparison, a dms.t3.micro replication instance left in place for a month

ID: `dbmig-instance-idle` / chapter: [39 Database Migration: DMS, Full Load, CDC, and Cutover](/en/chapters/39-database-migration.md)

Assumptions:

- A layout this chapter's stack does not create: a Single-AZ dms.t3.micro for 730 hours with no task running
- No storage beyond the included 50 GB

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dms.instance.t3.micro.hour` | 730 | Hrs | 730 instance hours | 20.44 | - | 20.44 |

- List subtotal: **USD 20.44** / month
- Subtotal after monthly free allowance: **USD 20.44** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `dms.instance.t3.micro.hour`

## DRS: one server protected for a month, private subnets

ID: `dr-private-idle` / chapter: [40 Disaster Recovery: Elastic Disaster Recovery (DRS), Drills, and Failback](/en/chapters/40-disaster-recovery.md)

Assumptions:

- One source server, the chapter 23 instance, protected for 730 hours with no drill. Chapter 23 and chapter 11 are billed separately
- One replication server of the default type, t3.small. Staging disks match the source disks (8 GiB root as chapter 23 assumes, 8 GiB data) and are magnetic because they are under 125 GiB
- Snapshots: the pricing page's "one base snapshot the size of each source disk", taken as 16 GB. Incremental snapshots depend on the change rate and are not included
- Not included, amount unknown: the replication server's own root volume, I/O requests on magnetic volumes, endpoint data processing, data transfer between zones, surplus CPU credits of the t3
- The staging area is the private subnet of the second zone. This chapter's stack adds two interface endpoints (drs, ec2) in that zone only

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `drs.source-server.hour` | 730 | Replication-hour | 1 replicating source server x 730 hours | 20.44 | - | 20.44 |
| `ec2.t3-small.linux.hour` | 730 | Hrs | 1 t3.small replication server x 730 hours | 19.86 | - | 19.86 |
| `ebs.magnetic.storage` | 16 | GB-Mo | 16 GiB of staging disks (magnetic), 730 of 730 hours | 1.28 | - | 1.28 |
| `ebs.snapshot.storage` | 16 | GB-Mo | base snapshots the size of the source disks, 16 GB, 730 of 730 hours | 0.80 | - | 0.80 |
| `vpc.endpoint.interface.hour` | 1,460 | Hrs | 2 interface endpoints (drs, ec2) x 1 zone x 730 hours | 20.44 | - | 20.44 |

- List subtotal: **USD 62.82** / month
- Subtotal after monthly free allowance: **USD 62.82** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `drs.source-server.hour`, `ec2.t3-small.linux.hour`, `ebs.magnetic.storage`

## DRS: one server protected for a month, public subnets

ID: `dr-public-idle` / chapter: [40 Disaster Recovery: Elastic Disaster Recovery (DRS), Drills, and Failback](/en/chapters/40-disaster-recovery.md)

Assumptions:

- One source server, the chapter 23 instance, protected for 730 hours with no drill. Chapter 23 and chapter 11 are billed separately
- One replication server of the default type, t3.small. Staging disks match the source disks (8 GiB root as chapter 23 assumes, 8 GiB data) and are magnetic because they are under 125 GiB
- Snapshots: the pricing page's "one base snapshot the size of each source disk", taken as 16 GB. Incremental snapshots depend on the change rate and are not included
- Not included, amount unknown: the replication server's own root volume, I/O requests on magnetic volumes, endpoint data processing, data transfer between zones, surplus CPU credits of the t3
- `-c placement=public`. No endpoints; the replication server holds one public IPv4 address

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `drs.source-server.hour` | 730 | Replication-hour | 1 replicating source server x 730 hours | 20.44 | - | 20.44 |
| `ec2.t3-small.linux.hour` | 730 | Hrs | 1 t3.small replication server x 730 hours | 19.86 | - | 19.86 |
| `ebs.magnetic.storage` | 16 | GB-Mo | 16 GiB of staging disks (magnetic), 730 of 730 hours | 1.28 | - | 1.28 |
| `ebs.snapshot.storage` | 16 | GB-Mo | base snapshots the size of the source disks, 16 GB, 730 of 730 hours | 0.80 | - | 0.80 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 public IPv4 address on the replication server x 730 hours | 3.65 | - | 3.65 |

- List subtotal: **USD 46.03** / month
- Subtotal after monthly free allowance: **USD 46.03** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `drs.source-server.hour`, `ec2.t3-small.linux.hour`, `ebs.magnetic.storage`

## DRS: a drill instance kept for two hours

ID: `dr-drill-2h` / chapter: [40 Disaster Recovery: Elastic Disaster Recovery (DRS), Drills, and Failback](/en/chapters/40-disaster-recovery.md)

Assumptions:

- One t4g.micro drill instance and 16 GiB of volumes for two hours. The launch template decides the volume type; gp3 is an assumption
- The conversion server that runs for a few minutes per launch is not included. The pricing page puts it at generally under USD 0.05 per launch

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-micro.linux.hour` | 2 | Hrs | 1 t4g.micro drill instance x 2 hours | 0.02 | - | 0.02 |
| `ebs.gp3.storage` | 0.044 | GB-Mo | 16 GiB of volumes (gp3 assumed), 2 of 730 hours | 0.004208 | - | 0.004208 |

- List subtotal: **USD 0.03** / month
- Subtotal after monthly free allowance: **USD 0.03** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ec2.t4g-micro.linux.hour`, `ebs.gp3.storage`

## Fargate: the default configuration left running for a month

ID: `fargate-idle` / chapter: [41 Fargate: Task Sizing, Spot, Auto Scaling, Scheduled Tasks, and ECS Exec](/en/chapters/41-fargate.md)

Assumptions:

- Two tasks (0.25 vCPU, 0.5 GB, arm64, on demand) in public subnets for 730 hours
- One load balancer for 730 hours and four public IPv4 addresses (two load balancer nodes, two tasks). LCUs are not included
- The nightly job once a day, the 60-second minimum each time, at the on-demand rate (the Spot rate is not in the Price List). The job's public IPv4 address, half an hour a month, is not included
- 0.1 GB in the repository (assumption) and 30 Scheduler invocations
- Logs, data transfer, and tasks added by auto scaling are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 365.125 | hours | 2 tasks x 0.25 vCPU x 730 hours; nightly job: 30 runs x 60 s, 30 tasks x 0.25 vCPU x 0.016666666666666666 hours | 14.77 | - | 14.77 |
| `fargate.arm.memory.gb-hour` | 730.25 | hours | 2 tasks x 0.5 GB x 730 hours; nightly job: 30 runs x 60 s, 30 tasks x 0.5 GB x 0.016666666666666666 hours | 3.23 | - | 3.23 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,920 | Hrs | (2 load balancer nodes + 2 tasks) x 730 hours | 14.60 | - | 14.60 |
| `ecr.storage` | 0.1 | GB-Mo | one image, assumed 0.1 GB | 0.01 | - | 0.01 |
| `scheduler.invocation` | 30 | Invocations | 30 invocations | 0 | - | 0 |

- List subtotal: **USD 50.35** / month
- Subtotal after monthly free allowance: **USD 50.35** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `ecr.storage`

## Fargate: the default configuration for one day

ID: `fargate-one-day` / chapter: [41 Fargate: Task Sizing, Spot, Auto Scaling, Scheduled Tasks, and ECS Exec](/en/chapters/41-fargate.md)

Assumptions:

- The same configuration as fargate-idle for 24 hours, with one run of the job
- Image storage and Scheduler are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 12.004 | hours | 2 tasks x 0.25 vCPU x 24 hours; nightly job: 1 runs x 60 s, 1 tasks x 0.25 vCPU x 0.016666666666666666 hours | 0.49 | - | 0.49 |
| `fargate.arm.memory.gb-hour` | 24.008 | hours | 2 tasks x 0.5 GB x 24 hours; nightly job: 1 runs x 60 s, 1 tasks x 0.5 GB x 0.016666666666666666 hours | 0.11 | - | 0.11 |
| `alb.hour` | 24 | Hrs | 1 load balancer x 24 hours | 0.58 | - | 0.58 |
| `vpc.public-ipv4.in-use.hour` | 96 | Hrs | (2 load balancer nodes + 2 tasks) x 24 hours | 0.48 | - | 0.48 |

- List subtotal: **USD 1.65** / month
- Subtotal after monthly free allowance: **USD 1.65** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`

## Fargate: a month at the auto scaling ceiling of six tasks

ID: `fargate-ceiling` / chapter: [41 Fargate: Task Sizing, Spot, Auto Scaling, Scheduled Tasks, and ECS Exec](/en/chapters/41-fargate.md)

Assumptions:

- An upper bound: six tasks for 730 hours, all at the on-demand rate. Three of them would be on Spot, whose rate is not in the Price List
- Eight public IPv4 addresses: two load balancer nodes and six tasks
- Otherwise as fargate-idle

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 1,095.125 | hours | 6 tasks x 0.25 vCPU x 730 hours; nightly job: 30 runs x 60 s, 30 tasks x 0.25 vCPU x 0.016666666666666666 hours | 44.30 | - | 44.30 |
| `fargate.arm.memory.gb-hour` | 2,190.25 | hours | 6 tasks x 0.5 GB x 730 hours; nightly job: 30 runs x 60 s, 30 tasks x 0.5 GB x 0.016666666666666666 hours | 9.68 | - | 9.68 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 5,840 | Hrs | (2 load balancer nodes + 6 tasks) x 730 hours | 29.20 | - | 29.20 |
| `ecr.storage` | 0.1 | GB-Mo | one image, assumed 0.1 GB | 0.01 | - | 0.01 |
| `scheduler.invocation` | 30 | Invocations | 30 invocations | 0 | - | 0 |

- List subtotal: **USD 100.93** / month
- Subtotal after monthly free allowance: **USD 100.93** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `ecr.storage`

## Comparison: 20 requests a second all month, on Lambda

ID: `fargate-vs-steady-lambda` / chapter: [41 Fargate: Task Sizing, Spot, Auto Scaling, Scheduled Tasks, and ECS Exec](/en/chapters/41-fargate.md)

Assumptions:

- 20 requests a second, 24 hours a day for 30 days: 51.84 million requests
- Chapter 04's shape: an HTTP API and an arm64 Lambda function with 512 MB, 50 ms per request on average
- Logs, data transfer, DynamoDB and the like are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 51,840,000 | Requests | 51840000 requests | 66.87 | - | 66.87 |
| `lambda.request.arm` | 51,840,000 | Requests | 51840000 requests | 10.37 | 1,000,000 | 10.17 |
| `lambda.duration.arm` | 1,296,000 | Lambda-GB-Second | 51840000 requests x 50 ms x 0.5 GB | 17.28 | 400,000 | 11.95 |

- List subtotal: **USD 94.52** / month
- Subtotal after monthly free allowance: **USD 88.99** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `apigw.http.request`

## Comparison: 20 requests a second all month, on Fargate

ID: `fargate-vs-steady-fargate` / chapter: [41 Fargate: Task Sizing, Spot, Auto Scaling, Scheduled Tasks, and ECS Exec](/en/chapters/41-fargate.md)

Assumptions:

- 20 requests a second, 24 hours a day for 30 days; two tasks for 730 hours
- Chapter 12's shape: tasks (0.25 vCPU, 0.5 GB, arm64, on demand) in public subnets behind a load balancer
- LCUs from new connections, one connection per request
- Whether two tasks can answer this many requests was not measured (an assumption)
- Logs, data transfer, and image storage are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 365 | hours | 2 tasks x 0.25 vCPU x 730 hours | 14.76 | - | 14.76 |
| `fargate.arm.memory.gb-hour` | 730 | hours | 2 tasks x 0.5 GB x 730 hours | 3.23 | - | 3.23 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `alb.lcu.hour` | 576 | LCU-Hrs | 20 new connections/s / 25 x 720 hours | 4.61 | - | 4.61 |
| `vpc.public-ipv4.in-use.hour` | 2,920 | Hrs | (2 load balancer nodes + 2 tasks) x 730 hours + 0 tasks x 720 hours | 14.60 | - | 14.60 |

- List subtotal: **USD 54.94** / month
- Subtotal after monthly free allowance: **USD 54.94** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `alb.lcu.hour`

## Comparison: the same load on two t4g.small EC2 instances

ID: `fargate-vs-steady-ec2` / chapter: [41 Fargate: Task Sizing, Spot, Auto Scaling, Scheduled Tasks, and ECS Exec](/en/chapters/41-fargate.md)

Assumptions:

- Two of chapter 23's t4g.small instances, each with 8 GB of gp3, in public subnets behind the same load balancer
- The cost of owning OS updates, container replacement, and the instance count is not in the amount
- Extra t4g CPU credits, logs, data transfer, and snapshots are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-small.linux.hour` | 1,460 | Hrs | 2 instances x 730 hours | 31.54 | - | 31.54 |
| `ebs.gp3.storage` | 16 | GB-Mo | 2 volumes x 8 GB | 1.54 | - | 1.54 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `alb.lcu.hour` | 576 | LCU-Hrs | 20 new connections/s / 25 x 720 hours | 4.61 | - | 4.61 |
| `vpc.public-ipv4.in-use.hour` | 2,920 | Hrs | (2 load balancer nodes + 2 instances) x 730 hours | 14.60 | - | 14.60 |

- List subtotal: **USD 70.02** / month
- Subtotal after monthly free allowance: **USD 70.02** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `alb.hour`, `alb.lcu.hour`, `ebs.gp3.storage`

## Comparison: 20 requests a second for two hours a day, on Lambda

ID: `fargate-vs-spiky-lambda` / chapter: [41 Fargate: Task Sizing, Spot, Auto Scaling, Scheduled Tasks, and ECS Exec](/en/chapters/41-fargate.md)

Assumptions:

- 20 requests a second for two hours a day, 30 days: 4.32 million requests. Nothing in the other 22 hours
- Chapter 04's shape: an HTTP API and an arm64 Lambda function with 512 MB, 50 ms per request on average
- Logs, data transfer, DynamoDB and the like are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 4,320,000 | Requests | 4320000 requests | 5.57 | - | 5.57 |
| `lambda.request.arm` | 4,320,000 | Requests | 4320000 requests | 0.86 | 1,000,000 | 0.66 |
| `lambda.duration.arm` | 108,000 | Lambda-GB-Second | 4320000 requests x 50 ms x 0.5 GB | 1.44 | 400,000 | 0 |

- List subtotal: **USD 7.88** / month
- Subtotal after monthly free allowance: **USD 6.24** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `apigw.http.request`

## Comparison: 20 requests a second for two hours a day, on Fargate

ID: `fargate-vs-spiky-fargate` / chapter: [41 Fargate: Task Sizing, Spot, Auto Scaling, Scheduled Tasks, and ECS Exec](/en/chapters/41-fargate.md)

Assumptions:

- Two tasks for 730 hours, and two more added by auto scaling for the two busy hours
- Chapter 12's shape: tasks (0.25 vCPU, 0.5 GB, arm64, on demand) in public subnets behind a load balancer
- LCUs from new connections, one connection per request
- Logs, data transfer, and image storage are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 395 | hours | 2 tasks x 0.25 vCPU x 730 hours + 2 tasks x 0.25 vCPU x 60 hours | 15.98 | - | 15.98 |
| `fargate.arm.memory.gb-hour` | 790 | hours | 2 tasks x 0.5 GB x 730 hours + 2 tasks x 0.5 GB x 60 hours | 3.49 | - | 3.49 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `alb.lcu.hour` | 48 | LCU-Hrs | 20 new connections/s / 25 x 60 hours | 0.38 | - | 0.38 |
| `vpc.public-ipv4.in-use.hour` | 3,040 | Hrs | (2 load balancer nodes + 2 tasks) x 730 hours + 2 tasks x 60 hours | 15.20 | - | 15.20 |

- List subtotal: **USD 52.79** / month
- Subtotal after monthly free allowance: **USD 52.79** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `alb.lcu.hour`

## Firewall Manager: the two policies for a month, with no resource in scope

ID: `fwm-policies-only` / chapter: [42 Firewall Manager: One Policy for WAF, Security Groups, and Network Firewall across Accounts](/en/chapters/42-firewall-manager.md)

Assumptions:

- AihFirewallManager and AihFirewallManagerEdge deployed as they are, with automatic remediation off in both
- No CloudFront distribution and no security group in the OUs in scope. No web ACL is assumed to be created, because optimizeUnassociatedWebACL is true
- The policy fee for a whole month. Whether it is prorated when a policy is deleted mid-month was not confirmed
- Which Price List usage type an AWS WAF policy for CloudFront is billed under (Policy-WAF, USE1-Policy-WAF, or Policy) was not confirmed. All three are USD 100
- AWS Config, which is a prerequisite, Security Hub CSPM, and the notifier's Lambda, SNS, EventBridge, and CloudWatch Logs are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fms.policy.global.wafv2` | 1 | Month | 1 AWS WAF policy for CloudFront (Global) | 100.00 | - | 100.00 |
| `fms.policy.apne1.sg-content-audit` | 1 | Month | 1 security group content audit policy in ap-northeast-1 | 100.00 | - | 100.00 |

- List subtotal: **USD 200.00** / month
- Subtotal after monthly free allowance: **USD 200.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `fms.policy.global.wafv2`, `fms.policy.apne1.sg-content-audit`

## Firewall Manager: the two policies for a month in an organization of five accounts

ID: `fwm-small-org` / chapter: [42 Firewall Manager: One Policy for WAF, Security Groups, and Network Firewall across Accounts](/en/chapters/42-firewall-manager.md)

Assumptions:

- The organization: a management account, a Firewall Manager administrator account, and three workload accounts (dev, staging, prod). The policies cover the OU the three are in
- Each of the three has CloudFront distributions, and with automatic remediation on, the AWS WAF policy creates one web ACL per account
- The policy's two rule groups are counted as two rules per web ACL. How the rule groups Firewall Manager places in a member account's web ACL are metered was not confirmed on a bill
- One million requests inspected per web ACL in the month
- AWS Config records in four accounts: the three workloads and the administrator. 20 configuration items a month per account in us-east-1 and 200 in ap-northeast-1, assumed, not measured
- 100 evaluations a month of the AWS Config rule each policy creates, per account in scope, assumed, not measured
- Not included: Security Hub CSPM, S3 storage for AWS Config's records, and the notifier's Lambda, SNS, EventBridge, and CloudWatch Logs. Whether the policy fee is prorated was not confirmed

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
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

- List subtotal: **USD 226.04** / month
- Subtotal after monthly free allowance: **USD 226.04** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `fms.policy.global.wafv2`, `fms.policy.apne1.sg-content-audit`, `config.use1.item.continuous`, `config.use1.rule.evaluation`, `config.rule.evaluation`, `waf.global.webacl`, `waf.global.rule`, `waf.global.request`, `config.item.continuous`

## Firewall Manager: one endpoint created by a Network Firewall policy for a month (an order-of-magnitude example)

ID: `fwm-nfw-endpoint` / chapter: [42 Firewall Manager: One Policy for WAF, Security Groups, and Network Firewall across Accounts](/en/chapters/42-firewall-manager.md)

Assumptions:

- This chapter's stacks create no Network Firewall policy. This is only the hourly price of one of the firewall endpoints a distributed policy places in the VPCs in scope
- 730 hours. The per-GB processing charge and the policy's own monthly fee are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `networkfirewall.endpoint.hour` | 730 | Hourly | 1 endpoint x 730 hours | 288.35 | - | 288.35 |

- List subtotal: **USD 288.35** / month
- Subtotal after monthly free allowance: **USD 288.35** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `networkfirewall.endpoint.hour`

## The Glue job: deployed, and never run for a month

ID: `glue-idle` / chapter: [43 Glue: The Data Catalog, Crawlers, ETL Jobs, and Data Quality](/en/chapters/43-glue.md)

Assumptions:

- The job is never run. The trigger exists and is not activated
- The Data Catalog holds one database and two tables
- One alarm. The free allowance covers the first ten alarms of the account, this one among them
- The bucket is empty. The SNS topic has no subscription and delivers nothing

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `glue.catalog.storage` | 3 | Obj-Month | 1 database + 2 tables | 0.000030 | 1,000,000 | 0 |
| `cloudwatch.alarm.standard` | 1 | Alarms | 1 alarm on AWS/Events MatchedEvents | 0.10 | 10 | 0 |

- List subtotal: **USD 0.10** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## The Glue job: once a day, every run within a minute

ID: `glue-daily-minimum` / chapter: [43 Glue: The Data Catalog, Crawlers, ETL Jobs, and Data Quality](/en/chapters/43-glue.md)

Assumptions:

- 30 runs. Two G.1X workers, 2 DPUs
- Every run ends within 60 seconds and is billed the one-minute minimum. No run was timed: this is the floor
- S3 requests and storage, and logs, are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `glue.etl.dpu-hour` | 1 | DPU-Hour | 30 runs x 2 DPU x 60 s / 3600 | 0.44 | - | 0.44 |

- List subtotal: **USD 0.44** / month
- Subtotal after monthly free allowance: **USD 0.44** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `glue.etl.dpu-hour`

## The Glue job: once a day, three minutes a run

ID: `glue-daily-three-minutes` / chapter: [43 Glue: The Data Catalog, Crawlers, ETL Jobs, and Data Quality](/en/chapters/43-glue.md)

Assumptions:

- 30 runs. 2 DPUs
- Every run is assumed to be billed 180 seconds. Not a measured value

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `glue.etl.dpu-hour` | 3 | DPU-Hour | 30 runs x 2 DPU x 180 s / 3600 | 1.32 | - | 1.32 |

- List subtotal: **USD 1.32** / month
- Subtotal after monthly free allowance: **USD 1.32** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `glue.etl.dpu-hour`

## The Glue job: once a day, every run until its timeout

ID: `glue-daily-timeout` / chapter: [43 Glue: The Data Catalog, Crawlers, ETL Jobs, and Data Quality](/en/chapters/43-glue.md)

Assumptions:

- 30 runs. 2 DPUs
- Every run goes on until the job's 10-minute timeout: the ceiling with this stack's settings

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `glue.etl.dpu-hour` | 10 | DPU-Hour | 30 runs x 2 DPU x 600 s / 3600 | 4.40 | - | 4.40 |

- List subtotal: **USD 4.40** / month
- Subtotal after monthly free allowance: **USD 4.40** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `glue.etl.dpu-hour`

## A crawler run once a day (not in this stack)

ID: `glue-daily-crawler` / chapter: [43 Glue: The Data Catalog, Crawlers, ETL Jobs, and Data Quality](/en/chapters/43-glue.md)

Assumptions:

- 30 crawls, each billed the 10-minute minimum
- A crawl is assumed to use 2 DPUs, the figure in the pricing page's example. How many a crawler really uses was not confirmed

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `glue.crawler.dpu-hour` | 10 | DPU-Hour | 30 crawls x 2 DPU x 600 s / 3600 | 4.40 | - | 4.40 |

- List subtotal: **USD 4.40** / month
- Subtotal after monthly free allowance: **USD 4.40** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `glue.crawler.dpu-hour`

## Health notices: deployed, and no event arrives for a month

ID: `health-idle` / chapter: [44 Health: Knowing When the Problem Is on AWS's Side](/en/chapters/44-health.md)

Assumptions:

- Both AihHealth (Tokyo) and AihHealthGlobal (N. Virginia) are deployed
- No Health event arrives: the function is not invoked, the table is empty, and nothing is logged
- Rules, an empty queue, an empty table, and a topic with a subscriber carry no charge for merely existing

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 0 | Requests | no invocations | 0 | 1,000,000 | 0 |
| `dynamodb.write.on-demand` | 0 | WriteRequestUnits | no writes | 0 | - | 0 |
| `sns.delivery.email` | 0 | Notifications | no notices | 0 | - | 0 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Health notices: a month in which events arrive 40 times

ID: `health-month` / chapter: [44 Health: Knowing When the Problem Is on AWS's Side](/en/chapters/44-health.md)

Assumptions:

- The function is invoked 40 times across both stacks: one issue lasting a few hours with an update every 30 minutes, and a few scheduled changes and notices. An assumption, not a measurement
- 30 of the 40 become a notice; 10 are dropped as duplicates or stale updates
- The function has 256 MB and is assumed to run for 1 second each time (not measured)
- The ledger takes one strongly consistent read per invocation (1 RRU) and two writes per notice (2 WRU); items are under 1 KB
- 2 KB of logs per invocation is assumed, including the lines Lambda writes (not measured)
- The us-east-1 stack's share is counted at Tokyo prices; us-east-1 prices were not looked up
- 30 notices by email. Nothing reaches the SQS dead-letter queue

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 40 | Requests | 40 invocations | 0.000008 | 1,000,000 | 0 |
| `lambda.duration.arm` | 10 | Lambda-GB-Second | 40 x 1 s x 0.25 GB, in GB-seconds | 0.000133 | 400,000 | 0 |
| `dynamodb.read.on-demand` | 40 | ReadRequestUnits | 40 strongly consistent reads of an item under 4 KB | 0.000006 | - | 0.000006 |
| `dynamodb.write.on-demand` | 60 | WriteRequestUnits | 30 notices x 2 writes of an item under 1 KB | 0.000043 | - | 0.000043 |
| `sns.request` | 30 | Requests | 30 Publish requests | 0 | - | 0 |
| `sns.delivery.email` | 30 | Notifications | 30 email notifications to one address | 0 | - | 0 |
| `logs.ingest.standard` | 0 | GB | 40 x 2 KB, in GB | 0.000058 | 5 | 0 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## AihShieldEdge kept for a month, with no requests

ID: `shield-edge-month` / chapter: [46 Shield: Preparing for DDoS, Standard and Advanced](/en/chapters/46-shield.md)

Assumptions:

- One web ACL, one rule, one alarm on one metric
- The web ACL inspected no requests
- No Shield Advanced protection

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `waf.global.webacl` | 1 | Month | 1 web ACL | 5.00 | - | 5.00 |
| `waf.global.rule` | 1 | Month | 1 rate-based rule | 1.00 | - | 1.00 |
| `cloudwatch.alarm.standard.use1` | 1 | Alarms | 1 alarm on 1 metric, in us-east-1 | 0.10 | - | 0.10 |

- List subtotal: **USD 6.10** / month
- Subtotal after monthly free allowance: **USD 6.10** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `cloudwatch.alarm.standard.use1`, `waf.global.webacl`, `waf.global.rule`

## One month of a Shield Advanced subscription, with no data transfer

ID: `shield-advanced-month` / chapter: [46 Shield: Preparing for DDoS, Standard and Advanced](/en/chapters/46-shield.md)

Assumptions:

- The subscription is a commitment for a year, so this amount is charged twelve times
- The web ACL and rule of a protected distribution are USD 0 a month in the Price List (the Shield Protected SKUs)
- Two alarms (the rate-based rule and DDoSDetected)
- Shield Advanced data transfer fees and the Support plan needed to reach the SRT are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `shield.advanced.subscription` | 1 | month | 1 subscription for the payer account | 3000.00 | - | 3000.00 |
| `cloudwatch.alarm.standard.use1` | 2 | Alarms | 2 alarms on 1 metric each, in us-east-1 | 0.20 | - | 0.20 |

- List subtotal: **USD 3000.20** / month
- Subtotal after monthly free allowance: **USD 3000.20** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `shield.advanced.subscription`, `cloudwatch.alarm.standard.use1`

## An hour of flood: 20 addresses, no defence

ID: `shield-flood-few-open` / chapter: [46 Shield: Preparing for DDoS, Standard and Advanced](/en/chapters/46-shield.md)

Assumptions:

- The attack is 250 requests a second from each of 20 addresses. No web ACL, brake or cache
- One hour. Users: 200 addresses, 100 requests a second in all, a fifth of them for the cacheable route
- The attack runs from minute 5 to minute 55, at 5,000 requests a second in all
- One answer is assumed to be 1,024 bytes and one run of the function 50 ms at 256 MB (not measured)
- Edge prices for Japan. The bytes of a 429 from the brake, and any Lambda charge for a refused invocation, are not counted
- The output of the model in examples/46-shield/src/flood.ts, not a measurement

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 15,360,000 | Requests | 15360000 requests CloudFront answered or passed on | 18.43 | 10,000,000 | 6.43 |
| `cloudfront.jp.transfer` | 14.648 | GB | 15360000 answers x 1024 bytes | 1.67 | 1,024 | 0 |
| `lambda.request.arm` | 15,360,000 | Requests | 15360000 invocations | 3.07 | 1,000,000 | 2.87 |
| `lambda.duration.arm` | 192,000 | Lambda-GB-Second | 15360000 invocations x 50 ms x 256 MB | 2.56 | 400,000 | 0 |

- List subtotal: **USD 25.73** / month
- Subtotal after monthly free allowance: **USD 9.30** / month

## An hour of flood: 20 addresses, with the rate-based rule

ID: `shield-flood-few-rule` / chapter: [46 Shield: Preparing for DDoS, Standard and Advanced](/en/chapters/46-shield.md)

Assumptions:

- The attack is 250 requests a second from each of 20 addresses. The rule is 300 in 60 seconds, and is assumed to act after 30 seconds
- One hour. Users: 200 addresses, 100 requests a second in all, a fifth of them for the cacheable route
- The attack runs from minute 5 to minute 55, at 5,000 requests a second in all
- One answer is assumed to be 1,024 bytes and one run of the function 50 ms at 256 MB (not measured)
- Edge prices for Japan. The bytes of a 429 from the brake, and any Lambda charge for a refused invocation, are not counted
- The output of the model in examples/46-shield/src/flood.ts, not a measurement

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 515,000 | Requests | 515000 requests CloudFront answered or passed on | 0.62 | 10,000,000 | 0 |
| `cloudfront.jp.transfer` | 0.491 | GB | 515000 answers x 1024 bytes | 0.06 | 1,024 | 0 |
| `waf.global.request` | 15,360,000 | Request | 15360000 requests inspected, blocked or not | 9.22 | - | 9.22 |
| `lambda.request.arm` | 515,000 | Requests | 515000 invocations | 0.10 | 1,000,000 | 0 |
| `lambda.duration.arm` | 6,437.5 | Lambda-GB-Second | 515000 invocations x 50 ms x 256 MB | 0.09 | 400,000 | 0 |

- List subtotal: **USD 10.08** / month
- Subtotal after monthly free allowance: **USD 9.22** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `waf.global.request`

## An hour of flood: 20,000 addresses, with the rate-based rule

ID: `shield-flood-many-rule` / chapter: [46 Shield: Preparing for DDoS, Standard and Advanced](/en/chapters/46-shield.md)

Assumptions:

- The attack is one request every four seconds from each of 20,000 addresses. No address reaches the rule's limit
- One hour. Users: 200 addresses, 100 requests a second in all, a fifth of them for the cacheable route
- The attack runs from minute 5 to minute 55, at 5,000 requests a second in all
- One answer is assumed to be 1,024 bytes and one run of the function 50 ms at 256 MB (not measured)
- Edge prices for Japan. The bytes of a 429 from the brake, and any Lambda charge for a refused invocation, are not counted
- The output of the model in examples/46-shield/src/flood.ts, not a measurement

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 15,360,000 | Requests | 15360000 requests CloudFront answered or passed on | 18.43 | 10,000,000 | 6.43 |
| `cloudfront.jp.transfer` | 14.648 | GB | 15360000 answers x 1024 bytes | 1.67 | 1,024 | 0 |
| `waf.global.request` | 15,360,000 | Request | 15360000 requests inspected, blocked or not | 9.22 | - | 9.22 |
| `lambda.request.arm` | 15,360,000 | Requests | 15360000 invocations | 3.07 | 1,000,000 | 2.87 |
| `lambda.duration.arm` | 192,000 | Lambda-GB-Second | 15360000 invocations x 50 ms x 256 MB | 2.56 | 400,000 | 0 |

- List subtotal: **USD 34.95** / month
- Subtotal after monthly free allowance: **USD 18.52** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `waf.global.request`

## An hour of flood: 20,000 addresses, with the rule and the brake

ID: `shield-flood-many-brake` / chapter: [46 Shield: Preparing for DDoS, Standard and Advanced](/en/chapters/46-shield.md)

Assumptions:

- The attack is one request every four seconds from each of 20,000 addresses. Reserved concurrency 20 (the function URL takes 200 requests a second)
- One hour. Users: 200 addresses, 100 requests a second in all, a fifth of them for the cacheable route
- The attack runs from minute 5 to minute 55, at 5,000 requests a second in all
- One answer is assumed to be 1,024 bytes and one run of the function 50 ms at 256 MB (not measured)
- Edge prices for Japan. The bytes of a 429 from the brake, and any Lambda charge for a refused invocation, are not counted
- The output of the model in examples/46-shield/src/flood.ts, not a measurement

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 15,360,000 | Requests | 15360000 requests CloudFront answered or passed on | 18.43 | 10,000,000 | 6.43 |
| `cloudfront.jp.transfer` | 0.629 | GB | 660019 answers x 1024 bytes | 0.07 | 1,024 | 0 |
| `waf.global.request` | 15,360,000 | Request | 15360000 requests inspected, blocked or not | 9.22 | - | 9.22 |
| `lambda.request.arm` | 660,019 | Requests | 660019 invocations | 0.13 | 1,000,000 | 0 |
| `lambda.duration.arm` | 8,250.238 | Lambda-GB-Second | 660019 invocations x 50 ms x 256 MB | 0.11 | 400,000 | 0 |

- List subtotal: **USD 27.96** / month
- Subtotal after monthly free allowance: **USD 15.65** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `waf.global.request`

## An hour of flood: 20,000 addresses on the cached route

ID: `shield-flood-cached-cache` / chapter: [46 Shield: Preparing for DDoS, Standard and Advanced](/en/chapters/46-shield.md)

Assumptions:

- The attack is one request every four seconds from each of 20,000 addresses, all for /health. The cache lives 5 seconds, and one edge location is assumed
- One hour. Users: 200 addresses, 100 requests a second in all, a fifth of them for the cacheable route
- The attack runs from minute 5 to minute 55, at 5,000 requests a second in all
- One answer is assumed to be 1,024 bytes and one run of the function 50 ms at 256 MB (not measured)
- Edge prices for Japan. The bytes of a 429 from the brake, and any Lambda charge for a refused invocation, are not counted
- The output of the model in examples/46-shield/src/flood.ts, not a measurement

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 15,360,000 | Requests | 15360000 requests CloudFront answered or passed on | 18.43 | 10,000,000 | 6.43 |
| `cloudfront.jp.transfer` | 14.648 | GB | 15360000 answers x 1024 bytes | 1.67 | 1,024 | 0 |
| `lambda.request.arm` | 288,720 | Requests | 288720 invocations | 0.06 | 1,000,000 | 0 |
| `lambda.duration.arm` | 3,609 | Lambda-GB-Second | 288720 invocations x 50 ms x 256 MB | 0.05 | 400,000 | 0 |

- List subtotal: **USD 20.21** / month
- Subtotal after monthly free allowance: **USD 6.43** / month

## If the flood lasted 30 days: no defence

ID: `shield-flood-month-open` / chapter: [46 Shield: Preparing for DDoS, Standard and Advanced](/en/chapters/46-shield.md)

Assumptions:

- 5,000 requests a second for 30 days, every one of them reaching the function (12.96 billion). The users' own requests are not included
- No web ACL, brake or cache. No model: counts multiplied by unit prices
- One answer is assumed to be 1,024 bytes and one run of the function 50 ms at 256 MB (not measured)
- Assumes Lambda keeps up with that rate. The account's concurrency quota (chapter 32) is not considered

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudfront.jp.request.https` | 12,960,000,000 | Requests | 12960000000 requests CloudFront answered or passed on | 15552.00 | 10,000,000 | 15540.00 |
| `cloudfront.jp.transfer` | 12,359.619 | GB | 12960000000 answers x 1024 bytes | 1356.01 | 1,024 | 1264.87 |
| `lambda.request.arm` | 12,960,000,000 | Requests | 12960000000 invocations | 2592.00 | 1,000,000 | 2591.80 |
| `lambda.duration.arm` | 162,000,000 | Lambda-GB-Second | 12960000000 invocations x 50 ms x 256 MB | 2160.01 | 400,000 | 2154.68 |

- List subtotal: **USD 21660.02** / month
- Subtotal after monthly free allowance: **USD 21551.35** / month

## Step Functions: deployed, and never started, for a month

ID: `sfn-idle` / chapter: [47 Step Functions: State Machines, Retry and Catch, Map, Callbacks, and Sagas](/en/chapters/47-step-functions.md)

Assumptions:

- The state machines, the on-demand table, the bucket, the queue, the topic, and the log group cost nothing while they only exist
- Neither the bucket nor the table holds anything

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `sfn.standard.transition` | 0 | StateTransitions | no execution started | 0 | 4,000 | 0 |
| `sfn.express.request` | 0 | Requests | no execution started | 0 | - | 0 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `sfn.express.request`

## Step Functions: 1,000 imports a month (Standard, all succeeding)

ID: `sfn-import-1k` / chapter: [47 Step Functions: State Machines, Retry and Catch, Map, Callbacks, and Sagas](/en/chapters/47-step-functions.md)

Assumptions:

- One execution passes CreateNote, AttachFile, WaitForScan, Verdict, Publish, Notify and Imported once each. With start and end that is counted as 9 state transitions (the pricing page's way of counting; not measured)
- No retries, compensations or redrives. Each one would add state transitions
- Two DynamoDB writes, PutItem and UpdateItem, on an item of at most 1 KB (one unit each)
- S3 sees one PUT for the upload and one COPY for the import
- SQS sees one send, one receive and one delete. Empty receives are not counted
- Not included: storage of the attachments, delivery charges of the notice per subscriber, whatever does the scanning

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `sfn.standard.transition` | 9,000 | StateTransitions | 1,000 executions x 9 transitions | 0.23 | 4,000 | 0.13 |
| `dynamodb.write.on-demand` | 2,000 | WriteRequestUnits | 1,000 x (PutItem + UpdateItem) | 0.001430 | - | 0.001430 |
| `s3.request.tier1` | 2,000 | Requests | 1,000 x (PUT of the upload + COPY) | 0.01 | - | 0.01 |
| `sqs.request.standard` | 3,000 | Requests | 1,000 x (send + receive + delete) | 0.001200 | 1,000,000 | 0 |
| `sns.request` | 1,000 | Requests | one publish per import | 0 | - | 0 |

- List subtotal: **USD 0.24** / month
- Subtotal after monthly free allowance: **USD 0.14** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.request.tier1`

## Step Functions: 100,000 lookups of 10 notes a month (Express)

ID: `sfn-digest-express-100k` / chapter: [47 Step Functions: State Machines, Retry and Catch, Map, Callbacks, and Sagas](/en/chapters/47-step-functions.md)

Assumptions:

- One execution reads 10 notes with GetItem and is assumed to take 300 ms (not measured)
- Billed at 64 MB of memory (50 MB plus the definition and the payloads stays within 64 MB)
- GetItem is eventually consistent: 0.5 units for an item of at most 4 KB
- Logging is at ERROR and nothing fails, so nothing is ingested

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `sfn.express.request` | 100,000 | Requests | one request per execution | 0.10 | - | 0.10 |
| `sfn.express.duration` | 1,875 | GB-Seconds | 100,000 x 0.3 s x 0.0625 GB, in GB-seconds | 0.03 | - | 0.03 |
| `dynamodb.read.on-demand` | 500,000 | ReadRequestUnits | 100,000 x 10 GetItem x 0.5 units | 0.07 | - | 0.07 |

- List subtotal: **USD 0.20** / month
- Subtotal after monthly free allowance: **USD 0.20** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `sfn.express.request`, `sfn.express.duration`

## Step Functions: the same lookups as a Standard workflow

ID: `sfn-digest-standard-100k` / chapter: [47 Step Functions: State Machines, Retry and Catch, Map, Callbacks, and Sagas](/en/chapters/47-step-functions.md)

Assumptions:

- The same work as "100,000 lookups of 10 notes a month (Express)"
- State transitions are counted as 13: one for the Map, ten for the ten GetNote states, two for start and end. The pricing page does not say how Map iterations are counted; this is an estimate, not a measurement
- A Standard workflow is not billed for its duration

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `sfn.standard.transition` | 1,300,000 | StateTransitions | 100,000 executions x 13 transitions | 32.50 | 4,000 | 32.40 |
| `dynamodb.read.on-demand` | 500,000 | ReadRequestUnits | 100,000 x 10 GetItem x 0.5 units | 0.07 | - | 0.07 |

- List subtotal: **USD 32.57** / month
- Subtotal after monthly free allowance: **USD 32.47** / month

## Athena: deployed, and not one query run in the month

ID: `athena-idle` / chapter: [49 Athena: Workgroups, Partitions, CTAS, Iceberg, and Querying Logs](/en/chapters/49-athena.md)

Assumptions:

- Only the workgroup, six saved queries, the role and an empty bucket exist
- No derived table was created, so neither the Glue Data Catalog nor S3 holds anything more
- No capacity reservation

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `athena.scanned` | 0 | Terabytes | no query | 0 | - | 0 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `athena.scanned`

## Athena: 1,000 queries a month, each reading one day of gzip JSON

ID: `athena-1000-pruned` / chapter: [49 Athena: Workgroups, Partitions, CTAS, Iceberg, and Querying Logs](/en/chapters/49-athena.md)

Assumptions:

- A table with 365 days of one million records a day. A record takes 58.68 bytes after gzip (measured on chapter 26's 5,000 sample records), so a day is 58,684,400 bytes
- Each query names one day. The format is JSON, so the whole day is read, and billed as 56 MB after rounding up
- S3 requests, result storage and Glue requests are not included (how many requests Athena makes per query was not confirmed)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `athena.scanned` | 0.053 | Terabytes | 1,000 queries x 56 MB | 0.27 | - | 0.27 |

- List subtotal: **USD 0.27** / month
- Subtotal after monthly free allowance: **USD 0.27** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `athena.scanned`

## Athena: the same 1,000 queries without the date condition, in a workgroup with no limit

ID: `athena-1000-unpruned` / chapter: [49 Athena: Workgroups, Partitions, CTAS, Iceberg, and Querying Logs](/en/chapters/49-athena.md)

Assumptions:

- The same table. With no date condition a query reads all 365 days, 21,419,806,000 bytes, billed as 20,428 MB
- A query that sorts or aggregates is taken to read everything whether or not it has a LIMIT (whether a bare LIMIT stops early was not confirmed)
- No per-query limit on data scanned

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `athena.scanned` | 19.482 | Terabytes | 1,000 queries x 20,428 MB | 97.41 | - | 97.41 |

- List subtotal: **USD 97.41** / month
- Subtotal after monthly free allowance: **USD 97.41** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `athena.scanned`

## Athena: the same 1,000 queries cancelled by this chapter's workgroup at its 1 GiB limit

ID: `athena-1000-cancelled` / chapter: [49 Athena: Workgroups, Partitions, CTAS, Iceberg, and Querying Logs](/en/chapters/49-athena.md)

Assumptions:

- Every query is cancelled once it has read 1 GiB, and returns no answer
- A cancelled query is billed for what it read, taken here as exactly 1 GiB (how far past the limit a query gets before it stops was not confirmed)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `athena.scanned` | 0.977 | Terabytes | 1,000 queries x 1 GiB | 4.88 | - | 4.88 |

- List subtotal: **USD 4.88** / month
- Subtotal after monthly free allowance: **USD 4.88** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `athena.scanned`

## Athena: 1,000 queries a month, each reading two columns of one day of Parquet

ID: `athena-1000-parquet` / chapter: [49 Athena: Workgroups, Partitions, CTAS, Iceberg, and Querying Logs](/en/chapters/49-athena.md)

Assumptions:

- The same records as a Parquet table. The two columns at and status take 6.38 bytes a record (measured on chapter 26's sample written by a library on the laptop; the size of the Parquet Athena writes was not confirmed), so a day is 6,384,400 bytes
- That is under 10 MB, so every query is billed the 10 MB minimum

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `athena.scanned` | 0.01 | Terabytes | 1,000 queries x 10 MB minimum | 0.05 | - | 0.05 |

- List subtotal: **USD 0.05** / month
- Subtotal after monthly free allowance: **USD 0.05** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `athena.scanned`

## Athena: the smallest capacity reservation (4 DPUs) held for a month

ID: `athena-capacity-minimum` / chapter: [49 Athena: Workgroups, Partitions, CTAS, Iceberg, and Querying Logs](/en/chapters/49-athena.md)

Assumptions:

- Not created by this chapter's stack: computed for comparison only
- 4 DPUs for 730 hours. The same amount whether or not a query runs
- Whether queries that run on reserved capacity are also billed by data scanned was not checked for this chapter

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `athena.capacity.dpu-hour` | 2,920 | DPU-Hour | 4 DPUs x 730 hours | 1255.60 | - | 1255.60 |

- List subtotal: **USD 1255.60** / month
- Subtotal after monthly free allowance: **USD 1255.60** / month

## AgentCore Runtime: 1,000 sessions, ended after 5 idle minutes

ID: `agentcore-sessions-idle-5` / chapter: [50 AgentCore: A Runtime, Memory, Tools, and Identity for Agents](/en/chapters/50-agentcore.md)

Assumptions:

- 4 minutes of conversation, then ended after 5 idle minutes as the stack sets it: 9 minutes a session
- platformVersion left at the default V1. 1,000 sessions a month
- Each session uses 18 seconds of CPU in all, on 1 vCPU (an assumption resting on the pricing page's statement that CPU is not charged while waiting for the model or a tool; not measured)
- Memory averages 0.6 GB per session (assumed, not measured; the billing minimum is 128 MB)
- Model calls (chapter 36), AgentCore Memory's short-term memory (its Tokyo price is not confirmed), DynamoDB, CloudWatch Logs, and data transfer are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `agentcore.runtime.v1.vcpu.hour` | 5 | vCPU-Hours | 1,000 sessions x 18 s x 1 vCPU / 3,600 | 0.45 | - | 0.45 |
| `agentcore.runtime.v1.memory.gb-hour` | 90 | GB-Hours | 1,000 sessions x 9 min x 0.6 GB / 60 | 0.85 | - | 0.85 |

- List subtotal: **USD 1.30** / month
- Subtotal after monthly free allowance: **USD 1.30** / month

## AgentCore Runtime: 1,000 sessions, ended after the default 15 idle minutes

ID: `agentcore-sessions-idle-15` / chapter: [50 AgentCore: A Runtime, Memory, Tools, and Identity for Agents](/en/chapters/50-agentcore.md)

Assumptions:

- 4 minutes of conversation, then ended after the default 15 idle minutes: 19 minutes a session
- platformVersion left at the default V1. 1,000 sessions a month
- Each session uses 18 seconds of CPU in all, on 1 vCPU (an assumption resting on the pricing page's statement that CPU is not charged while waiting for the model or a tool; not measured)
- Memory averages 0.6 GB per session (assumed, not measured; the billing minimum is 128 MB)
- Model calls (chapter 36), AgentCore Memory's short-term memory (its Tokyo price is not confirmed), DynamoDB, CloudWatch Logs, and data transfer are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `agentcore.runtime.v1.vcpu.hour` | 5 | vCPU-Hours | 1,000 sessions x 18 s x 1 vCPU / 3,600 | 0.45 | - | 0.45 |
| `agentcore.runtime.v1.memory.gb-hour` | 190 | GB-Hours | 1,000 sessions x 19 min x 0.6 GB / 60 | 1.80 | - | 1.80 |

- List subtotal: **USD 2.24** / month
- Subtotal after monthly free allowance: **USD 2.24** / month

## Calls: two people for an hour, eight times a month

ID: `calls-one-to-one` / chapter: [51 Chime SDK: Real-Time Audio and Video in Your Own App](/en/chapters/51-chime-sdk.md)

Assumptions:

- The media Region is Tokyo. Standard sessions (video up to 720p)
- Both stay connected for all 60 minutes. Audio only and video are the same rate
- API Gateway, Lambda, DynamoDB, Cognito and CloudWatch Logs are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `chime.sdk.attendee-minute` | 960 | minutes | 8 calls x 2 attendees x 60 minutes | 1.63 | - | 1.63 |

- List subtotal: **USD 1.63** / month
- Subtotal after monthly free allowance: **USD 1.63** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `chime.sdk.attendee-minute`

## Calls: five people for 30 minutes, twenty times a month

ID: `calls-team-daily` / chapter: [51 Chime SDK: Real-Time Audio and Video in Your Own App](/en/chapters/51-chime-sdk.md)

Assumptions:

- As assumed in the two-person scenario, with other numbers of people and calls

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `chime.sdk.attendee-minute` | 3,000 | minutes | 20 calls x 5 attendees x 30 minutes | 5.10 | - | 5.10 |

- List subtotal: **USD 5.10** / month
- Subtotal after monthly free allowance: **USD 5.10** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `chime.sdk.attendee-minute`

## Left open: one tab stayed connected until the meeting's 24-hour limit

ID: `calls-tab-left-open` / chapter: [51 Chime SDK: Real-Time Audio and Video in Your Own App](/en/chapters/51-chime-sdk.md)

Assumptions:

- After a call, one tab stayed connected. A meeting does not end while anyone is connected
- The meeting ends at 24 hours, the documented limit. The 1,440 minutes until then are billed

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `chime.sdk.attendee-minute` | 1,440 | minutes | 1 attendee x 24 hours x 60 minutes | 2.45 | - | 2.45 |

- List subtotal: **USD 2.45** / month
- Subtotal after monthly free allowance: **USD 2.45** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `chime.sdk.attendee-minute`

## EFS: a month deployed with nothing written

ID: `efs-idle` / chapter: [53 EFS: A File System Several Things Mount at Once](/en/chapters/53-efs.md)

Assumptions:

- The default layout: a Regional file system, Elastic throughput, no backups
- The metered size is the 6 KiB of one empty root directory (the figure in the EFS guide)
- The two mount targets and the access point have no SKU in the Price List. The function is never invoked
- The chapter 11 stack is in its default layout (no NAT gateway, no interface endpoints)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `efs.standard.storage` | 0 | GB-Mo | 6 KiB metered for the empty root directory, the whole month | 0.000002 | - | 0.000002 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `efs.standard.storage`

## EFS: 100 notes kept and used for a month

ID: `efs-practice-month` / chapter: [53 EFS: A File System Several Things Mount at Once](/en/chapters/53-efs.md)

Assumptions:

- 100 notes of at most 4 KiB each, so 6 KiB per note (2 KiB of metadata, 4 KiB of data). Four directories (the root, the access point's root, notes, incoming) are assumed to be 6 KiB each
- 1,000 writes a month. A data operation is metered as one unit up to its first 32 KiB, so 32 KiB per write
- 10,000 list requests a month. This chapter's code reads all 100 files for every list, so 100 x 32 KiB each
- Metadata operations (directory listings, file creation, rename, attribute lookups) were not counted and are not included. They are not zero
- The function is assumed to run 11,000 times a month for 0.1 s at 256 MB (not measured), with as many HTTP API requests
- Logs and data transfer are not included. No free allowance is deducted

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `efs.standard.storage` | 0.001 | GB-Mo | (100 notes + 4 directories) x 6 KiB | 0.000214 | - | 0.000214 |
| `efs.elastic.write` | 0.031 | GB | 1,000 writes x 32 KiB metered | 0.002136 | - | 0.002136 |
| `efs.elastic.read` | 30.518 | GB | 10,000 lists x 100 files x 32 KiB metered | 1.22 | - | 1.22 |
| `lambda.request.arm` | 11,000 | Requests | 11,000 invocations | 0.002200 | 1,000,000 | 0 |
| `lambda.duration.arm` | 275 | Lambda-GB-Second | 11,000 x 0.1 s x 0.25 GB (assumed) | 0.003667 | 400,000 | 0 |
| `apigw.http.request` | 11,000 | Requests | 11,000 requests | 0.01 | - | 0.01 |

- List subtotal: **USD 1.24** / month
- Subtotal after monthly free allowance: **USD 1.24** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `apigw.http.request`, `efs.standard.storage`

## Kinesis: deployed, with nothing written, for a month (provisioned, one shard)

ID: `kinesis-idle` / chapter: [54 Kinesis: Data Streams, Shards, Ordering, and Replay](/en/chapters/54-kinesis.md)

Assumptions:

- One shard in a provisioned stream, existing for all 730 hours
- The function is not invoked while there are no records. In provisioned mode the event source mapping's reads are not billed by themselves (the Price List has no price per GetRecords call)
- The stream is encrypted with the AWS managed key (aws/kinesis). The key is free, but the Kinesis guide says the KMS API calls Kinesis makes are billed. The same page's estimate, about 12 calls every 5 minutes for one credential reading from the tip, is counted for the whole month (105,120). Not checked on a bill
- Three alarms. The first ten in the account fall in the free allowance
- Not included: the empty history table and the empty queue (both 0)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `kinesis.shard-hour` | 730 | ShardHour | 1 shard x 730 h | 14.23 | - | 14.23 |
| `cloudwatch.alarm.standard` | 3 | Alarms | three standard alarms | 0.30 | 10 | 0 |
| `kms.request` | 105,120 | Requests | 12 calls every 5 minutes x 12 x 730 h, as the Kinesis guide estimates for one credential reading from the tip | 0.32 | 20,000 | 0.26 |

- List subtotal: **USD 14.85** / month
- Subtotal after monthly free allowance: **USD 14.49** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `kinesis.shard-hour`

## Kinesis: the same stack with an on-demand (Standard) stream, nothing written, for a month

ID: `kinesis-idle-on-demand` / chapter: [54 Kinesis: Data Streams, Shards, Ordering, and Replay](/en/chapters/54-kinesis.md)

Assumptions:

- What the stream would cost in On-demand Standard mode. The chapter's stack is not deployed this way; this is for comparison
- One stream for 730 hours, with 0 GB written and read
- The stream is encrypted with the AWS managed key (aws/kinesis). The key is free, but the Kinesis guide says the KMS API calls Kinesis makes are billed. The same page's estimate, about 12 calls every 5 minutes for one credential reading from the tip, is counted for the whole month (105,120). Not checked on a bill
- Three alarms

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `kinesis.on-demand.stream-hour` | 730 | StreamHr | 1 stream x 730 h | 37.96 | - | 37.96 |
| `cloudwatch.alarm.standard` | 3 | Alarms | three standard alarms | 0.30 | 10 | 0 |
| `kms.request` | 105,120 | Requests | 12 calls every 5 minutes x 12 x 730 h, as the Kinesis guide estimates for one credential reading from the tip | 0.32 | 20,000 | 0.26 |

- List subtotal: **USD 38.58** / month
- Subtotal after monthly free allowance: **USD 38.22** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `kinesis.on-demand.stream-hour`

## Kinesis: 1,000,000 revisions a month (provisioned, one shard)

ID: `kinesis-small` / chapter: [54 Kinesis: Data Streams, Shards, Ordering, and Replay](/en/chapters/54-kinesis.md)

Assumptions:

- One shard in a provisioned stream for 730 hours
- 1,000,000 revisions are written in the month. Each is 0.2 KB and fits in one 25 KB PUT payload unit
- The function is assumed to receive 10 records at a time on average: 100,000 invocations of 200 ms at 256 MB on arm64. No retries and no duplicates
- One write unit per revision on the history table (items are under 1 KB)
- 0.2 KB of logs per invocation
- Not included: storage of the history table (a few MB), and the failure queue and SNS (nothing is assumed to flow through them)
- The stream is encrypted with the AWS managed key (aws/kinesis). The key is free, but the Kinesis guide says the KMS API calls Kinesis makes are billed. The same page's estimate, about 12 calls every 5 minutes for one credential reading from the tip, is counted for the whole month (105,120). Not checked on a bill

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `kinesis.shard-hour` | 730 | ShardHour | 1 shard x 730 h | 14.23 | - | 14.23 |
| `kinesis.put-payload-unit` | 1,000,000 | PutRequest | one 25 KB unit per record | 0.02 | - | 0.02 |
| `lambda.request.arm` | 100,000 | Requests | 1,000,000 records in batches of 10 | 0.02 | 1,000,000 | 0 |
| `lambda.duration.arm` | 5,000 | Lambda-GB-Second | 100,000 x 0.2 s x 0.25 GB, in GB-seconds | 0.07 | 400,000 | 0 |
| `dynamodb.write.on-demand` | 1,000,000 | WriteRequestUnits | one conditional update per revision | 0.71 | - | 0.71 |
| `logs.ingest.standard` | 0.02 | GB | 100,000 invocations x 0.2 KB | 0.02 | 5 | 0 |
| `cloudwatch.alarm.standard` | 3 | Alarms | three standard alarms | 0.30 | 10 | 0 |
| `kms.request` | 105,120 | Requests | 12 calls every 5 minutes x 12 x 730 h, as the Kinesis guide estimates for one credential reading from the tip | 0.32 | 20,000 | 0.26 |

- List subtotal: **USD 15.69** / month
- Subtotal after monthly free allowance: **USD 15.23** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `kinesis.shard-hour`, `kinesis.put-payload-unit`

## Kinesis: 1,000,000 revisions a month (with an On-demand Standard stream)

ID: `kinesis-small-on-demand` / chapter: [54 Kinesis: Data Streams, Shards, Ordering, and Replay](/en/chapters/54-kinesis.md)

Assumptions:

- What the same month would cost in On-demand Standard mode, for comparison
- Each record written is rounded up to 1 KB (pricing page): 1,000,000 KB = 0.9537 GB
- Reads are not rounded. One consumer: 1,000,000 x 0.2 KB = 0.1907 GB
- The function is assumed to receive 10 records at a time on average: 100,000 invocations of 200 ms at 256 MB on arm64. No retries and no duplicates
- One write unit per revision on the history table (items are under 1 KB)
- 0.2 KB of logs per invocation
- Not included: storage of the history table (a few MB), and the failure queue and SNS (nothing is assumed to flow through them)
- The stream is encrypted with the AWS managed key (aws/kinesis). The key is free, but the Kinesis guide says the KMS API calls Kinesis makes are billed. The same page's estimate, about 12 calls every 5 minutes for one credential reading from the tip, is counted for the whole month (105,120). Not checked on a bill

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
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

- List subtotal: **USD 39.50** / month
- Subtotal after monthly free allowance: **USD 39.04** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `kinesis.on-demand.stream-hour`, `kinesis.on-demand.ingest`, `kinesis.on-demand.retrieval`

## Kinesis: the least an account pays in a month with On-demand Advantage enabled

ID: `kinesis-advantage-minimum` / chapter: [54 Kinesis: Data Streams, Shards, Ordering, and Replay](/en/chapters/54-kinesis.md)

Assumptions:

- On-demand Advantage is an account-level setting. Once enabled, the account pays for at least 25 MiB/s of ingest and 25 MiB/s of retrieval across the Region's on-demand streams (documentation)
- 25 MiB/s x 3,600 s x 730 h = 65,700,000 MiB = 64,160.16 GB. Usage below it is billed as a shortfall at the same rate
- The chapter's stack does not use this setting. The arithmetic is here to show who must not enable it

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `kinesis.advantage.ingest` | 64,160.16 | GB | 25 MiB/s x 3,600 s x 730 h, in GB | 2669.06 | - | 2669.06 |
| `kinesis.advantage.retrieval` | 64,160.16 | GB | 25 MiB/s x 3,600 s x 730 h, in GB | 1334.53 | - | 1334.53 |

- List subtotal: **USD 4003.59** / month
- Subtotal after monthly free allowance: **USD 4003.59** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `kinesis.advantage.ingest`, `kinesis.advantage.retrieval`

## Grafana workspace: created, and nobody signs in for a month

ID: `grafana-idle` / chapter: [55 Grafana: Dashboards and Alerts with Amazon Managed Grafana](/en/chapters/55-grafana.md)

Assumptions:

- One workspace, counted as the pricing page states: a minimum of one Editor license per workspace
- The 90-day free trial (up to five users per account) is not subtracted
- Nobody opens a dashboard, so GetMetricData is never called
- Whether a workspace created or deleted mid-month is prorated could not be confirmed; a full month is counted

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `grafana.user.editor` | 1 | Users | the minimum of one Editor license per workspace | 9.00 | - | 9.00 |

- List subtotal: **USD 9.00** / month
- Subtotal after monthly free allowance: **USD 9.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `grafana.user.editor`

## Grafana workspace: one admin, two viewers, and pushes from code

ID: `grafana-small` / chapter: [55 Grafana: Dashboards and Alerts with Amazon Managed Grafana](/en/chapters/55-grafana.md)

Assumptions:

- One admin and two viewers signed in that month
- The service account that pushes the dashboard (Admin) called the API at least once that month; it is billed as one Editor
- One browser tab keeps the dashboard open 8 hours a day, 20 days a month. Each reload, once a minute, is assumed to request each of the 23 metrics once through GetMetricData (9,600 reloads times 23). How Grafana actually batches a reload was not confirmed
- Neither the free trial nor any free allowance for GetMetricData is subtracted
- Chapter 19's stack itself, and IAM Identity Center or an external IdP, are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `grafana.user.editor` | 2 | Users | 1 admin who signed in + 1 service account with the Admin role | 18.00 | - | 18.00 |
| `grafana.user.viewer` | 2 | Users | 2 viewers who signed in | 10.00 | - | 10.00 |
| `cloudwatch.api.getmetricdata` | 220,800 | Metrics | 8 h x 20 days x 60 reloads x 23 metrics | 2.21 | - | 2.21 |

- List subtotal: **USD 30.21** / month
- Subtotal after monthly free allowance: **USD 30.21** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `grafana.user.editor`, `grafana.user.viewer`, `cloudwatch.api.getmetricdata`

## Image descriptions: deployed, but never called for a month

ID: `nova-idle` / chapter: [56 Nova: Text, Images, Video, and Speech with Amazon's Models](/en/chapters/56-nova.md)

Assumptions:

- No requests
- No objects in the bucket
- Logs expire after a week; nothing is stored

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Image descriptions: 1,000 images a month (Nova 2 Lite, jp. profile)

ID: `nova-describe-nova-2-lite` / chapter: [56 Nova: Text, Images, Video, and Speech with Amazon's Models](/en/chapters/56-nova.md)

Assumptions:

- 1,000 images a month, each described once. Later PUTs return the stored description and do not call the model
- Assumed 320 input tokens per image (an image is a flat 230 tokens; the other 90 are an estimate for the two prompts)
- Assumed 60 output tokens per image (the limit is 300)
- Lambda at 256 MB on arm64, assumed 3 seconds each on average (waiting for the model is billed too)
- S3 per image: 2 writes (the claim and the description) and 3 reads (is there a description, the upload's metadata, and Bedrock fetching the image, assumed to be one request)
- Assumed 1 KB of logs per image
- Storage of the descriptions (under 1 KB each) and data transfer are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input` | 320 | 1K tokens | 1,000 images x 320 input tokens, in 1K tokens | 0.13 | - | 0.13 |
| `bedrock.nova-2-lite.output` | 60 | 1K tokens | 1,000 images x 60 output tokens, in 1K tokens | 0.20 | - | 0.20 |
| `lambda.request.arm` | 1,000 | Requests | one invocation per image | 0.000200 | 1,000,000 | 0 |
| `lambda.duration.arm` | 750 | Lambda-GB-Second | 1,000 x 3 s x 0.25 GB | 0.01 | 400,000 | 0 |
| `s3.request.tier1` | 2,000 | Requests | 1,000 x 2 PutObject | 0.01 | - | 0.01 |
| `s3.request.tier2` | 3,000 | Requests | 1,000 x 3 GET or HEAD | 0.001110 | - | 0.001110 |
| `logs.ingest.standard` | 0.001 | GB | 1,000 x 1 KB, in GB | 0.000725 | 5 | 0 |

- List subtotal: **USD 0.35** / month
- Subtotal after monthly free allowance: **USD 0.34** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.request.tier1`, `s3.request.tier2`, `bedrock.nova-2-lite.input`, `bedrock.nova-2-lite.output`

## Image descriptions: inference cost if all 1,000 hit the output limit

ID: `nova-describe-ceiling-nova-2-lite` / chapter: [56 Nova: Text, Images, Video, and Speech with Amazon's Models](/en/chapters/56-nova.md)

Assumptions:

- All 1,000 write up to the maxTokens of 300
- Assumed 320 input tokens per image
- Inference only

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input` | 320 | 1K tokens | 1,000 images x 320 input tokens, in 1K tokens | 0.13 | - | 0.13 |
| `bedrock.nova-2-lite.output` | 300 | 1K tokens | 1,000 images x 300 output tokens, in 1K tokens | 0.99 | - | 0.99 |

- List subtotal: **USD 1.12** / month
- Subtotal after monthly free allowance: **USD 1.12** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.nova-2-lite.input`, `bedrock.nova-2-lite.output`

## Summaries: chapter 17's token counts on Nova Lite (inference only)

ID: `nova-summaries-nova-lite` / chapter: [56 Nova: Text, Images, Video, and Speech with Amazon's Models](/en/chapters/56-nova.md)

Assumptions:

- 1,000 summaries a month
- Assumed 2,000 input tokens and 150 output tokens each (the same as chapter 17's table)
- Tokenizers differ by model; this is for comparing unit prices
- Inference only; Lambda is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-lite.input` | 2,000 | 1K tokens | 1,000 summaries x 2,000 input tokens, in 1K tokens | 0.14 | - | 0.14 |
| `bedrock.nova-lite.output` | 150 | 1K tokens | 1,000 summaries x 150 output tokens, in 1K tokens | 0.04 | - | 0.04 |

- List subtotal: **USD 0.19** / month
- Subtotal after monthly free allowance: **USD 0.19** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.nova-lite.input`, `bedrock.nova-lite.output`

## Summaries: chapter 17's token counts on Nova Micro (inference only)

ID: `nova-summaries-nova-micro` / chapter: [56 Nova: Text, Images, Video, and Speech with Amazon's Models](/en/chapters/56-nova.md)

Assumptions:

- 1,000 summaries a month
- Assumed 2,000 input tokens and 150 output tokens each (the same as chapter 17's table)
- Tokenizers differ by model; this is for comparing unit prices
- Inference only; Lambda is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-micro.input` | 2,000 | 1K tokens | 1,000 summaries x 2,000 input tokens, in 1K tokens | 0.08 | - | 0.08 |
| `bedrock.nova-micro.output` | 150 | 1K tokens | 1,000 summaries x 150 output tokens, in 1K tokens | 0.03 | - | 0.03 |

- List subtotal: **USD 0.11** / month
- Subtotal after monthly free allowance: **USD 0.11** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.nova-micro.input`, `bedrock.nova-micro.output`

## Summaries: chapter 17's token counts on Nova 2 Lite (inference only)

ID: `nova-summaries-nova-2-lite` / chapter: [56 Nova: Text, Images, Video, and Speech with Amazon's Models](/en/chapters/56-nova.md)

Assumptions:

- 1,000 summaries a month
- Assumed 2,000 input tokens and 150 output tokens each (the same as chapter 17's table)
- Tokenizers differ by model; this is for comparing unit prices
- Inference only; Lambda is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input` | 2,000 | 1K tokens | 1,000 summaries x 2,000 input tokens, in 1K tokens | 0.79 | - | 0.79 |
| `bedrock.nova-2-lite.output` | 150 | 1K tokens | 1,000 summaries x 150 output tokens, in 1K tokens | 0.50 | - | 0.50 |

- List subtotal: **USD 1.29** / month
- Subtotal after monthly free allowance: **USD 1.29** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.nova-2-lite.input`, `bedrock.nova-2-lite.output`

## Read aloud: deployed, and nobody listens for a month

ID: `polly-idle` / chapter: [57 Polly: Reading a Note Aloud](/en/chapters/57-polly.md)

Assumptions:

- AihPolly is deployed and the function is never invoked
- The bucket is empty: the lifecycle rules have removed last month's audio
- Nothing is written to the log group

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `polly.neural.characters` | 0 | Characters | no synthesis | 0 | - | 0 |
| `lambda.request.arm` | 0 | Requests | no invocations | 0 | 1,000,000 | 0 |
| `s3.standard.storage` | 0 | GB-Mo | an empty bucket | 0 | - | 0 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `polly.neural.characters`

## Read aloud: 1,000 listens in a month (a neural voice)

ID: `polly-month` / chapter: [57 Polly: Reading a Note Aloud](/en/chapters/57-polly.md)

Assumptions:

- Listen is pressed 1,000 times in the month. A note averages 600 characters, title and body together, and becomes two parts: the title and the body
- For 300 of the 1,000 the audio is already cached (the same note heard again). The other 700 call Polly. The ratio is an assumption, not a measurement
- A neural voice. 700 x 600 characters is 420,000 characters. One character of text is assumed to count as one for Polly (how it counts was not confirmed)
- The function has 256 MB. A request that calls Polly is assumed to take 3 seconds and one served from the cache 0.3 seconds (not measured)
- Two writes to S3 per synthesized part (the claim and the audio). Reads are one HEAD per part per request, and the GETs from the listener's browser
- The audio of one listen is assumed to be 0.3 MB (not measured; the bitrate of Polly's MP3 was not confirmed). 700 of them stay for the 30 days
- Transfer to listeners is 1,000 x 0.3 MB. Logs are assumed at 1 KB per request (not measured)
- No free tier is applied. Polly's is time-limited, and accounts created since 2025-07-15 receive credits instead

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `polly.neural.characters` | 420,000 | Characters | 700 listens x 600 characters | 6.72 | - | 6.72 |
| `lambda.request.arm` | 1,000 | Requests | 1,000 requests | 0.000200 | 1,000,000 | 0 |
| `lambda.duration.arm` | 547.5 | Lambda-GB-Second | (700 x 3 s + 300 x 0.3 s) x 0.25 GB, in GB-seconds | 0.01 | 400,000 | 0 |
| `s3.request.tier1` | 2,800 | Requests | 700 listens x 2 parts x 2 PUTs (claim, audio) | 0.01 | - | 0.01 |
| `s3.request.tier2` | 4,000 | Requests | 1,000 requests x 2 HEADs, and 1,000 listens x 2 GETs | 0.001480 | - | 0.001480 |
| `s3.standard.storage` | 0.21 | GB-Mo | 700 x 0.3 MB kept for 30 days, in GB-months | 0.01 | - | 0.01 |
| `datatransfer.out.internet` | 0.3 | GB | 1,000 listens x 0.3 MB, in GB | 0.03 | - | 0.03 |
| `logs.ingest.standard` | 0.001 | GB | 1,000 x 1 KB, in GB | 0.000722 | 5 | 0 |

- List subtotal: **USD 6.78** / month
- Subtotal after monthly free allowance: **USD 6.77** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `datatransfer.out.internet`, `s3.request.tier1`, `s3.request.tier2`, `polly.neural.characters`

## RDS: the default stack left running for 730 hours

ID: `rds-practice-month` / chapter: [59 RDS: Running PostgreSQL](/en/chapters/59-rds.md)

Assumptions:

- db.t4g.micro, Single-AZ, never stopped, 730 hours
- 20 GB of gp3
- One secret for the master user. A secret that RDS manages is assumed to cost what an ordinary secret costs (not confirmed)
- One alarm
- No requests, so nothing from Lambda, API Gateway, or log ingestion
- Backups are assumed to stay within the free allocation (as much as the database storage)
- Surplus CPU credits and data transfer are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.t4g-micro.single-az` | 730 | Hrs | one instance for 730 hours | 18.25 | - | 18.25 |
| `rds.postgres.gp3.storage` | 20 | GB-Mo | 20 GB provisioned for the month | 2.76 | - | 2.76 |
| `secretsmanager.secret` | 1 | Secrets | the master user secret, assumed to be billed as an ordinary secret | 0.40 | - | 0.40 |
| `cloudwatch.alarm.standard` | 1 | Alarms | one standard-resolution alarm on FreeStorageSpace | 0.10 | 10 | 0 |

- List subtotal: **USD 21.51** / month
- Subtotal after monthly free allowance: **USD 21.41** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `rds.postgres.t4g-micro.single-az`, `rds.postgres.gp3.storage`, `secretsmanager.secret`

## RDS: as if stopped for the whole month

ID: `rds-stopped-month` / chapter: [59 RDS: Running PostgreSQL](/en/chapters/59-rds.md)

Assumptions:

- No instance hours. In reality the instance starts by itself after 7 days, so this figure is never reached
- 20 GB of gp3, billed while stopped
- The secret and the alarm remain

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.gp3.storage` | 20 | GB-Mo | 20 GB provisioned for the month | 2.76 | - | 2.76 |
| `secretsmanager.secret` | 1 | Secrets | the master user secret, assumed to be billed as an ordinary secret | 0.40 | - | 0.40 |
| `cloudwatch.alarm.standard` | 1 | Alarms | one standard-resolution alarm on FreeStorageSpace | 0.10 | 10 | 0 |

- List subtotal: **USD 3.26** / month
- Subtotal after monthly free allowance: **USD 3.16** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `rds.postgres.gp3.storage`, `secretsmanager.secret`

## RDS: the production profile (Multi-AZ) for 730 hours

ID: `rds-production-month` / chapter: [59 RDS: Running PostgreSQL](/en/chapters/59-rds.md)

Assumptions:

- db.t4g.micro, Multi-AZ (one standby), 730 hours. The instance class is left at the default
- 20 GB of gp3 at the Multi-AZ rate
- One secret, one alarm
- Backups are assumed to stay within the free allocation

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.t4g-micro.multi-az` | 730 | Hrs | one Multi-AZ deployment for 730 hours | 36.50 | - | 36.50 |
| `rds.postgres.gp3.storage.multi-az` | 20 | GB-Mo | 20 GB provisioned for the month | 5.52 | - | 5.52 |
| `secretsmanager.secret` | 1 | Secrets | the master user secret, assumed to be billed as an ordinary secret | 0.40 | - | 0.40 |
| `cloudwatch.alarm.standard` | 1 | Alarms | one standard-resolution alarm on FreeStorageSpace | 0.10 | 10 | 0 |

- List subtotal: **USD 42.52** / month
- Subtotal after monthly free allowance: **USD 42.42** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `rds.postgres.t4g-micro.multi-az`, `rds.postgres.gp3.storage.multi-az`, `secretsmanager.secret`

## RDS: with one read replica, for 730 hours

ID: `rds-replica-month` / chapter: [59 RDS: Running PostgreSQL](/en/chapters/59-rds.md)

Assumptions:

- Two db.t4g.micro Single-AZ instances (primary and replica), 730 hours each
- 20 GB of gp3 each, 40 GB in all
- One secret created by CloudFormation, one alarm

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.t4g-micro.single-az` | 1,460 | Hrs | two instances for 730 hours | 36.50 | - | 36.50 |
| `rds.postgres.gp3.storage` | 40 | GB-Mo | 2 x 20 GB provisioned for the month | 5.52 | - | 5.52 |
| `secretsmanager.secret` | 1 | Secrets | the master user secret, assumed to be billed as an ordinary secret | 0.40 | - | 0.40 |
| `cloudwatch.alarm.standard` | 1 | Alarms | one standard-resolution alarm on FreeStorageSpace | 0.10 | 10 | 0 |

- List subtotal: **USD 42.52** / month
- Subtotal after monthly free allowance: **USD 42.42** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `rds.postgres.t4g-micro.single-az`, `rds.postgres.gp3.storage`, `secretsmanager.secret`

## RDS Proxy: one in front of a db.t4g.micro for 730 hours

ID: `rds-proxy-month` / chapter: [59 RDS: Running PostgreSQL](/en/chapters/59-rds.md)

Assumptions:

- db.t4g.micro has 2 vCPUs (the price list's attribute), which is also the minimum charge
- The proxy only. The instance and the proxy's own secret are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.proxy.postgres.vcpu-hour` | 1,460 | Hrs | 2 vCPUs x 730 hours | 26.28 | - | 26.28 |

- List subtotal: **USD 26.28** / month
- Subtotal after monthly free allowance: **USD 26.28** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `rds.proxy.postgres.vcpu-hour`

## RDS Extended Support: a db.t4g.micro at the year 1-2 rate for 730 hours

ID: `rds-extended-support-month` / chapter: [59 RDS: Running PostgreSQL](/en/chapters/59-rds.md)

Assumptions:

- 2 vCPUs, Single-AZ, 730 hours
- The rate is that of PostgreSQL 13. The price list carries rates only for versions already in Extended Support
- Only the amount added on top of the instance and its storage

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.extended-support.yr1-yr2` | 1,460 | vCPU-hour | 2 vCPUs x 730 hours | 175.20 | - | 175.20 |

- List subtotal: **USD 175.20** / month
- Subtotal after monthly free allowance: **USD 175.20** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `rds.postgres.extended-support.yr1-yr2`

## RDS Extended Support: the same instance at the year 3 rate for 730 hours

ID: `rds-extended-support-year3-month` / chapter: [59 RDS: Running PostgreSQL](/en/chapters/59-rds.md)

Assumptions:

- 2 vCPUs, Single-AZ, 730 hours
- The year 3 rate of PostgreSQL 13

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.extended-support.yr3` | 1,460 | vCPU-hour | 2 vCPUs x 730 hours | 350.40 | - | 350.40 |

- List subtotal: **USD 350.40** / month
- Subtotal after monthly free allowance: **USD 350.40** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `rds.postgres.extended-support.yr3`

## RDS: the smallest class of a Multi-AZ DB cluster for 730 hours

ID: `rds-multi-az-cluster-month` / chapter: [59 RDS: Running PostgreSQL](/en/chapters/59-rds.md)

Assumptions:

- The Multi-AZ (readable standbys) rate of db.c6gd.medium x 730 hours
- Whether this rate covers all three instances was not confirmed. For db.m6gd.large it is a little under three times the Single-AZ rate, so it was read as covering them
- Storage is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.c6gd-medium.multi-az-cluster` | 730 | Hrs | one Multi-AZ DB cluster for 730 hours | 239.37 | - | 239.37 |

- List subtotal: **USD 239.37** / month
- Subtotal after monthly free allowance: **USD 239.37** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `rds.postgres.c6gd-medium.multi-az-cluster`

## RDS: backups 10 GB beyond the free allocation

ID: `rds-backup-overage` / chapter: [59 RDS: Running PostgreSQL](/en/chapters/59-rds.md)

Assumptions:

- A month in which automated backups and manual snapshots add up to 30 GB against 20 GB of storage
- 10 GB beyond the allocation

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.backup.charged` | 10 | GB-Mo | 30 GB of backups - 20 GB free | 0.95 | - | 0.95 |

- List subtotal: **USD 0.95** / month
- Subtotal after monthly free allowance: **USD 0.95** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `rds.postgres.backup.charged`

## Aurora (chapter 60's default configuration): paused for the whole month

ID: `aurora-paused-month` / chapter: [60 Aurora: PostgreSQL with Storage and Compute Apart](/en/chapters/60-aurora.md)

Assumptions:

- 0 ACU minimum, assuming no connection and no resume for the whole month
- In practice Aurora resumes the instance for maintenance at times, and that time is billed
- 1 GB of data, Aurora Standard
- One secret managed by Aurora
- Backup storage beyond the free allocation and VPC charges (chapter 11) are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu` | 0 | ACU-Hr | paused for all 730 hours | 0 | - | 0 |
| `aurora.postgres.storage` | 1 | GB-Mo | 1 GB stored for the month | 0.12 | - | 0.12 |
| `secretsmanager.secret` | 1 | Secrets | the master user secret | 0.40 | - | 0.40 |

- List subtotal: **USD 0.52** / month
- Subtotal after monthly free allowance: **USD 0.52** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `secretsmanager.secret`

## Aurora (chapter 60's default configuration): awake for 10 hours of practice in the month

ID: `aurora-practice-month` / chapter: [60 Aurora: PostgreSQL with Storage and Compute Apart](/en/chapters/60-aurora.md)

Assumptions:

- Awake for 10 hours in total, taken to be at the 1 ACU maximum throughout (an upper estimate)
- 1 million I/O requests and 10,000 Data API calls are assumed, not measured
- 1 GB of data, Aurora Standard, one secret
- Backup storage beyond the free allocation and VPC charges (chapter 11) are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu` | 10 | ACU-Hr | 1 ACU x 10 hours | 1.50 | - | 1.50 |
| `aurora.postgres.storage` | 1 | GB-Mo | 1 GB stored for the month | 0.12 | - | 0.12 |
| `aurora.postgres.io` | 1,000,000 | IOs | 1 million I/O requests (assumed) | 0.24 | - | 0.24 |
| `aurora.postgres.data-api` | 10,000 | API Calls | 10,000 Data API calls (assumed) | 0.004200 | - | 0.004200 |
| `secretsmanager.secret` | 1 | Secrets | the master user secret | 0.40 | - | 0.40 |

- List subtotal: **USD 2.26** / month
- Subtotal after monthly free allowance: **USD 2.26** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `aurora.postgres.io`, `aurora.postgres.data-api`, `secretsmanager.secret`

## Aurora (chapter 60's default configuration): never paused, at the 1 ACU maximum all month

ID: `aurora-awake-month` / chapter: [60 Aurora: PostgreSQL with Storage and Compute Apart](/en/chapters/60-aurora.md)

Assumptions:

- Auto-pause never happens (a connection left open, for example) and the instance stays at the 1 ACU maximum for 730 hours: the ceiling of the instance charge in this configuration
- I/O is not included
- 1 GB of data, Aurora Standard, one secret

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu` | 730 | ACU-Hr | 1 ACU x 730 hours | 109.50 | - | 109.50 |
| `aurora.postgres.storage` | 1 | GB-Mo | 1 GB stored for the month | 0.12 | - | 0.12 |
| `secretsmanager.secret` | 1 | Secrets | the master user secret | 0.40 | - | 0.40 |

- List subtotal: **USD 110.02** / month
- Subtotal after monthly free allowance: **USD 110.02** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `secretsmanager.secret`

## Aurora Standard: 1 ACU on average, 100 GB, 300 million I/O requests a month

ID: `aurora-standard-300m-io` / chapter: [60 Aurora: PostgreSQL with Storage and Compute Apart](/en/chapters/60-aurora.md)

Assumptions:

- One writer for 730 hours at 1 ACU on average
- 100 GB of data
- 300 million I/O requests, assumed and not measured
- The secret, backups, and VPC charges are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu` | 730 | ACU-Hr | 1 ACU x 730 hours | 109.50 | - | 109.50 |
| `aurora.postgres.storage` | 100 | GB-Mo | 100 GB stored for the month | 12.00 | - | 12.00 |
| `aurora.postgres.io` | 300,000,000 | IOs | 300 million I/O requests (assumed) | 72.00 | - | 72.00 |

- List subtotal: **USD 193.50** / month
- Subtotal after monthly free allowance: **USD 193.50** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `aurora.postgres.io`

## Aurora I/O-Optimized: 1 ACU on average, 100 GB, 300 million I/O requests a month

ID: `aurora-io-optimized-300m-io` / chapter: [60 Aurora: PostgreSQL with Storage and Compute Apart](/en/chapters/60-aurora.md)

Assumptions:

- One writer for 730 hours at 1 ACU on average
- 100 GB of data
- I/O requests are not charged, however many
- The secret, backups, and VPC charges are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu.io-optimized` | 730 | ACU-Hr | 1 ACU x 730 hours | 146.00 | - | 146.00 |
| `aurora.postgres.storage.io-optimized` | 100 | GB-Mo | 100 GB stored for the month | 27.00 | - | 27.00 |

- List subtotal: **USD 173.00** / month
- Subtotal after monthly free allowance: **USD 173.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `aurora.postgres.serverless-v2.acu.io-optimized`, `aurora.postgres.storage.io-optimized`

## FIFO queue and worker: deployed, with no command, for a month

ID: `sqs-idle` / chapter: [61 SQS: FIFO, Visibility Timeout, Batches, and Redrive](/en/chapters/61-sqs.md)

Assumptions:

- Two alarms (messages in the dead-letter queue, age of the oldest message)
- Lambda is assumed to keep five long polls of 20 seconds going on the empty queue: 5 x 730 x 3,600 / 20 = 657,000 receives. What the documentation states is that Lambda scales back to five concurrent invokes at low traffic and that the reduction to two is not available with maximum concurrency; it gives neither a count of receives nor the wait time. Not checked on a bill or in a metric
- No commands, so function runs, DynamoDB, and logs are 0. The table is empty

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.alarm.standard` | 2 | Alarms | two alarms, one metric each | 0.20 | 10 | 0 |
| `sqs.request.fifo` | 657,000 | Requests | 5 polls x 730 h x 3,600 s / 20 s (assumed) | 0.33 | 1,000,000 | 0 |

- List subtotal: **USD 0.53** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## FIFO queue and worker: 100,000 commands a month

ID: `sqs-small` / chapter: [61 SQS: FIFO, Visibility Timeout, Batches, and Redrive](/en/chapters/61-sqs.md)

Assumptions:

- Commands are sent one at a time (no SendMessageBatch). Each is under 64 KB, so sending is 100,000 requests
- No batching on the way out: one ReceiveMessage and one DeleteMessage per command, 200,000 requests. No duplicates, retries, or dead letters
- The empty queue is assumed to be polled 657,000 times, as in the idle month
- The worker runs 100,000 times, 100 ms each at 256 MB on arm64
- A command is a transaction of two writes, the marker and the note. Each is under 1 KB and a transactional write is 2 units per KB, so 4 units
- 0.3 KB of logs per command
- Not included: the table's storage (markers expire after 30 days; tens of MB)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.alarm.standard` | 2 | Alarms | two alarms, one metric each | 0.20 | 10 | 0 |
| `sqs.request.fifo` | 957,000 | Requests | 657,000 empty receives (assumed) + 100,000 x (send + receive + delete) | 0.48 | 1,000,000 | 0 |
| `lambda.request.arm` | 100,000 | Requests | one invocation per command | 0.02 | 1,000,000 | 0 |
| `lambda.duration.arm` | 2,500 | Lambda-GB-Second | 100,000 x 0.1 s x 0.25 GB, in GB-seconds | 0.03 | 400,000 | 0 |
| `dynamodb.write.on-demand` | 400,000 | WriteRequestUnits | 100,000 x 2 items x 2 units | 0.29 | - | 0.29 |
| `logs.ingest.standard` | 0.03 | GB | 100,000 x 0.3 KB, in GB | 0.02 | 5 | 0 |

- List subtotal: **USD 1.04** / month
- Subtotal after monthly free allowance: **USD 0.29** / month

## What encrypting the queue with your own KMS key adds, for a month

ID: `sqs-kms-option` / chapter: [61 SQS: FIFO, Visibility Timeout, Batches, and Redrive](/en/chapters/61-sqs.md)

Assumptions:

- This chapter's stack uses the key SQS manages (SSE-SQS) and does not pay this. It is the estimate for switching to a key of your own
- One key. Only the command queue is counted, not the dead-letter queue
- The SQS developer guide's formula R = (B / D) x (2P + C), with B = 730 hours = 2,628,000 seconds, D = the default 300 seconds, one producing principal, one consuming principal: 8,760 x 3 = 26,280 calls
- The guide says actual calls can be higher than the formula gives

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `kms.key` | 1 | Keys | one customer managed key | 1.00 | - | 1.00 |
| `kms.request` | 26,280 | Requests | (2,628,000 / 300) x (2 x 1 + 1) | 0.08 | 20,000 | 0.02 |

- List subtotal: **USD 1.08** / month
- Subtotal after monthly free allowance: **USD 1.02** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `kms.key`

## CI runners: a month without a single job

ID: `ci-runners-idle` / chapter: [62 CI Runners: Self-Hosted GitHub Actions and GitLab Runners on AWS](/en/chapters/62-ci-runners.md)

Assumptions:

- Two secrets (the webhook secret and the GitHub App's private key)
- The sweeper Lambda every 15 minutes: 2,920 runs of one second (assumed) at 256 MB
- No task, no delivery, no DynamoDB write, no log

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `secretsmanager.secret` | 2 | Secrets | webhook secret and app private key | 0.80 | - | 0.80 |
| `lambda.request.arm` | 2,920 | Requests | one sweep every 15 min | 0.000584 | 1,000,000 | 0 |
| `lambda.duration.arm` | 730 | Lambda-GB-Second | 2920 sweeps x 1 s (assumed) x 0.25 GB | 0.01 | 400,000 | 0 |
| `scheduler.invocation` | 2,920 | Invocations | 2920 invocations | 0 | - | 0 |

- List subtotal: **USD 0.81** / month
- Subtotal after monthly free allowance: **USD 0.80** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `secretsmanager.secret`

## CI runners: 1,000 five-minute jobs on Fargate

ID: `ci-runners-1000-jobs` / chapter: [62 CI Runners: Self-Hosted GitHub Actions and GitLab Runners on AWS](/en/chapters/62-ci-runners.md)

Assumptions:

- A 2 vCPU, 8 GB, arm64 task for six minutes per job (five for the job, one for the image pull and registration; the one minute is an assumption, not a measurement)
- One public IPv4 address per task
- The receiver Lambda: 3,000 deliveries of one second (assumed) at 256 MB. 2,000 DynamoDB writes. 4,000 Secrets Manager calls
- The secrets' monthly fee, logs, data transfer and extra ephemeral storage are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 200 | hours | 1000 jobs x 6 min x 2 vCPU | 8.09 | - | 8.09 |
| `fargate.arm.memory.gb-hour` | 800 | hours | 1000 jobs x 6 min x 8 GB | 3.54 | - | 3.54 |
| `vpc.public-ipv4.in-use.hour` | 100 | Hrs | 1000 jobs x 6 min, one address per task | 0.50 | - | 0.50 |
| `lambda.request.arm` | 3,000 | Requests | 3 deliveries per job (queued, in_progress, completed) | 0.000600 | 1,000,000 | 0 |
| `lambda.duration.arm` | 750 | Lambda-GB-Second | 3,000 deliveries x 1 s (assumed) x 0.25 GB | 0.01 | 400,000 | 0 |
| `dynamodb.write.on-demand` | 2,000 | WriteRequestUnits | claim and complete, one write each per job | 0.001430 | - | 0.001430 |
| `secretsmanager.api` | 4,000 | API Requests | the webhook secret per delivery, the private key per launch | 0.02 | - | 0.02 |

- List subtotal: **USD 12.16** / month
- Subtotal after monthly free allowance: **USD 12.15** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `secretsmanager.api`

## CI runners: the same 1,000 jobs on CodeBuild

ID: `ci-runners-codebuild-1000-jobs` / chapter: [62 CI Runners: Self-Hosted GitHub Actions and GitLab Runners on AWS](/en/chapters/62-ci-runners.md)

Assumptions:

- On-demand arm1.small, six minutes per job (the same assumption as for Fargate; CodeBuild's start-up time was not measured)
- The free allowance is 100 build minutes
- arm1.small is not the same size as the Fargate task

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `codebuild.arm1.small.minute` | 6,000 | minutes | 1,000 jobs x 6 minutes | 25.50 | 100 | 25.07 |

- List subtotal: **USD 25.50** / month
- Subtotal after monthly free allowance: **USD 25.08** / month

## Agent Sandbox: a month without a single task

ID: `agent-sandbox-idle` / chapter: [63 Agent Sandbox: Running Coding Agents in an Isolated Environment on AWS](/en/chapters/63-agent-sandbox.md)

Assumptions:

- The reaper function once a minute for 730 hours (43,800 runs), 0.2 seconds each at 256 MB (assumption)
- 43,800 EventBridge Scheduler invocations
- One image of 0.5 GB in the repository (assumption: the image was never built, so this is not a measurement)
- Logs, chapter 11's VPC, tasks, and the model are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `lambda.request.arm` | 43,800 | Requests | 730 hours x 60 runs | 0.01 | 1,000,000 | 0 |
| `lambda.duration.arm` | 2,190 | Lambda-GB-Second | 43,800 runs x 0.2 s x 0.25 GB | 0.03 | 400,000 | 0 |
| `scheduler.invocation` | 43,800 | Invocations | 43,800 invocations | 0 | - | 0 |
| `ecr.storage` | 0.5 | GB-Mo | one image, assumed 0.5 GB | 0.05 | - | 0.05 |

- List subtotal: **USD 0.09** / month
- Subtotal after monthly free allowance: **USD 0.05** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ecr.storage`

## Agent Sandbox: one task of 30 minutes

ID: `agent-sandbox-job` / chapter: [63 Agent Sandbox: Running Coding Agents in an Isolated Environment on AWS](/en/chapters/63-agent-sandbox.md)

Assumptions:

- One Fargate task (1 vCPU, 4 GB, arm64, on demand) for 30 minutes
- Claude Haiku 4.5: 400 thousand input, 2 million cache-read, 300 thousand cache-write, and 60 thousand output tokens (all assumptions: no agent was run, so none of this is measured)
- Logs, data transfer, and the NAT gateway or endpoints are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 0.5 | hours | 1 vCPU x 0.5 hours | 0.02 | - | 0.02 |
| `fargate.arm.memory.gb-hour` | 2 | hours | 4 GB x 0.5 hours | 0.01 | - | 0.01 |
| `bedrock.claude-haiku-4-5.input` | 0.4 | 1M tokens | 400,000 input tokens (assumed) | 0.44 | - | 0.44 |
| `bedrock.claude-haiku-4-5.cache-read` | 2 | 1M tokens | 2,000,000 cache-read tokens (assumed) | 0.22 | - | 0.22 |
| `bedrock.claude-haiku-4-5.cache-write` | 0.3 | 1M tokens | 300,000 cache-write tokens (assumed) | 0.41 | - | 0.41 |
| `bedrock.claude-haiku-4-5.output` | 0.06 | 1M tokens | 60,000 output tokens (assumed) | 0.33 | - | 0.33 |

- List subtotal: **USD 1.43** / month
- Subtotal after monthly free allowance: **USD 1.43** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.claude-haiku-4-5.cache-read`, `bedrock.claude-haiku-4-5.cache-write`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `bedrock.claude-haiku-4-5.input`, `bedrock.claude-haiku-4-5.output`

## Agent Sandbox egress: interface endpoints only

ID: `agent-sandbox-egress-endpoints` / chapter: [63 Agent Sandbox: Running Coding Agents in an Isolated Environment on AWS](/en/chapters/63-agent-sandbox.md)

Assumptions:

- Four endpoints (bedrock-runtime, ecr.api, ecr.dkr, logs) in two Availability Zones for 730 hours
- Data processing is not included. The Git host and the package registry are out of reach

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `vpc.endpoint.interface.hour` | 5,840 | Hrs | 4 endpoints x 2 zones x 730 hours | 81.76 | - | 81.76 |

- List subtotal: **USD 81.76** / month
- Subtotal after monthly free allowance: **USD 81.76** / month

## Agent Sandbox egress: this stack's modelEndpoint alone

ID: `agent-sandbox-egress-model-endpoint` / chapter: [63 Agent Sandbox: Running Coding Agents in an Isolated Environment on AWS](/en/chapters/63-agent-sandbox.md)

Assumptions:

- One bedrock-runtime endpoint in two Availability Zones for 730 hours. Data processing is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `vpc.endpoint.interface.hour` | 1,460 | Hrs | 1 endpoint x 2 zones x 730 hours | 20.44 | - | 20.44 |

- List subtotal: **USD 20.44** / month
- Subtotal after monthly free allowance: **USD 20.44** / month

## Agent Sandbox egress: a NAT gateway

ID: `agent-sandbox-egress-nat` / chapter: [63 Agent Sandbox: Running Coding Agents in an Isolated Environment on AWS](/en/chapters/63-agent-sandbox.md)

Assumptions:

- One NAT gateway and its Elastic IP address for 730 hours
- Data processing is not included. Nothing narrows the destination beyond port 443

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `nat.gateway.hour` | 730 | Hrs | 1 NAT gateway x 730 hours | 45.26 | - | 45.26 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 Elastic IP address x 730 hours | 3.65 | - | 3.65 |

- List subtotal: **USD 48.91** / month
- Subtotal after monthly free allowance: **USD 48.91** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`

## Agent Sandbox egress: Network Firewall with a NAT gateway

ID: `agent-sandbox-egress-firewall` / chapter: [63 Agent Sandbox: Running Coding Agents in an Isolated Environment on AWS](/en/chapters/63-agent-sandbox.md)

Assumptions:

- One firewall endpoint (one Availability Zone) for 730 hours
- The hourly and data processing charges of the NAT gateway in the same path are left out, as the pricing page says they are waived. Its Elastic IP address is included
- The firewall's data processing (USD 0.065 per GB) is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `network-firewall.endpoint.hour` | 730 | Hourly | 1 firewall endpoint x 730 hours | 288.35 | - | 288.35 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 Elastic IP address x 730 hours | 3.65 | - | 3.65 |

- List subtotal: **USD 292.00** / month
- Subtotal after monthly free allowance: **USD 292.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`

## Agent Sandbox egress: a proxy you run

ID: `agent-sandbox-egress-proxy` / chapter: [63 Agent Sandbox: Running Coding Agents in an Isolated Environment on AWS](/en/chapters/63-agent-sandbox.md)

Assumptions:

- One t4g.micro instance and one public IPv4 address for 730 hours
- The volume, data transfer, and the work of operating a proxy are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-micro.linux.hour` | 730 | Hrs | 1 instance x 730 hours | 7.88 | - | 7.88 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 public IPv4 address x 730 hours | 3.65 | - | 3.65 |

- List subtotal: **USD 11.53** / month
- Subtotal after monthly free allowance: **USD 11.53** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `ec2.t4g-micro.linux.hour`

## Isolates: a month without one request

ID: `isolates-idle` / chapter: [64 Isolates: Self-Hosting a V8 Isolate Runtime on AWS](/en/chapters/64-isolates.md)

Assumptions:

- The default layout deployed with `-c imageTag=...`: one task (0.25 vCPU, 0.5 GB, arm64) in a public subnet for 730 hours
- One load balancer for 730 hours. LCUs are not included
- Three public IPv4 addresses: two load balancer nodes and one task
- Repository storage, logs, and data transfer are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 182.5 | hours | 1 tasks x 0.25 vCPU x 730 hours | 7.38 | - | 7.38 |
| `fargate.arm.memory.gb-hour` | 365 | hours | 1 tasks x 0.5 GB x 730 hours | 1.61 | - | 1.61 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,190 | Hrs | (2 load balancer nodes + 1 tasks) x 730 hours | 10.95 | - | 10.95 |

- List subtotal: **USD 37.68** / month
- Subtotal after monthly free allowance: **USD 37.68** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`

## Isolates: left for one day

ID: `isolates-one-day` / chapter: [64 Isolates: Self-Hosting a V8 Isolate Runtime on AWS](/en/chapters/64-isolates.md)

Assumptions:

- The layout of `isolates-idle` for 24 hours
- Repository storage, logs, data transfer, and LCUs are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 6 | hours | 1 tasks x 0.25 vCPU x 24 hours | 0.24 | - | 0.24 |
| `fargate.arm.memory.gb-hour` | 12 | hours | 1 tasks x 0.5 GB x 24 hours | 0.05 | - | 0.05 |
| `alb.hour` | 24 | Hrs | 1 load balancer x 24 hours | 0.58 | - | 0.58 |
| `vpc.public-ipv4.in-use.hour` | 72 | Hrs | (2 load balancer nodes + 1 tasks) x 24 hours | 0.36 | - | 0.36 |

- List subtotal: **USD 1.24** / month
- Subtotal after monthly free allowance: **USD 1.24** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`

## Isolates: the repository alone

ID: `isolates-repository-only` / chapter: [64 Isolates: Self-Hosting a V8 Isolate Runtime on AWS](/en/chapters/64-isolates.md)

Assumptions:

- Deployed without `-c imageTag`: no load balancer, no task
- 0.1 GB assumed for one image (the image was never built, so its real size is not measured; the workerd binary alone is 139 MB unpacked and 40 MB as the compressed archive)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ecr.storage` | 0.1 | GB-Mo | 0.1 GB stored (assumption) | 0.01 | - | 0.01 |

- List subtotal: **USD 0.01** / month
- Subtotal after monthly free allowance: **USD 0.01** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ecr.storage`

## Isolates: 15 million requests a month on workerd and Fargate

ID: `isolates-load-fargate` / chapter: [64 Isolates: Self-Hosting a V8 Isolate Runtime on AWS](/en/chapters/64-isolates.md)

Assumptions:

- The layout of `isolates-idle`, still one task
- 7 ms of CPU time per request: 16% of 0.25 vCPU averaged over the month. Bursts are not considered
- LCUs counted on the new-connection dimension: one connection per request is 5.7 a second or 0.228 LCU, which is 166.7 LCU-hours over 730 hours
- Logs, data transfer, and repository storage are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 182.5 | hours | 1 tasks x 0.25 vCPU x 730 hours | 7.38 | - | 7.38 |
| `fargate.arm.memory.gb-hour` | 365 | hours | 1 tasks x 0.5 GB x 730 hours | 1.61 | - | 1.61 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,190 | Hrs | (2 load balancer nodes + 1 tasks) x 730 hours | 10.95 | - | 10.95 |
| `alb.lcu.hour` | 166.7 | LCU-Hrs | 0.228 LCU x 730 hours (assumption: one new connection per request) | 1.33 | - | 1.33 |

- List subtotal: **USD 39.02** / month
- Subtotal after monthly free allowance: **USD 39.02** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `alb.lcu.hour`

## Isolates: the same 15 million requests on chapter 04's stack

ID: `isolates-load-lambda` / chapter: [64 Isolates: Self-Hosting a V8 Isolate Runtime on AWS](/en/chapters/64-isolates.md)

Assumptions:

- An API Gateway HTTP API in front of a 256 MB arm64 Lambda function
- Lambda bills duration, not CPU time. 50 ms per request is assumed, as in chapter 04's scenario
- Logs and data transfer are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `apigw.http.request` | 15,000,000 | Requests | one HTTP API request each | 19.35 | - | 19.35 |
| `lambda.request.arm` | 15,000,000 | Requests | one invocation per request | 3.00 | 1,000,000 | 2.80 |
| `lambda.duration.arm` | 187,500 | Lambda-GB-Second | 15000000 x 0.05 s x 0.25 GB, in GB-seconds | 2.50 | 400,000 | 0 |

- List subtotal: **USD 24.85** / month
- Subtotal after monthly free allowance: **USD 22.15** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `apigw.http.request`

## Nitro: the enclave-enabled instance and its key, left running for a month

ID: `nitro-idle-running` / chapter: [68 Nitro: What EC2 Stands On, Nitro Enclaves, and Graviton](/en/chapters/68-nitro.md)

Assumptions:

- One c6g.large left running for 730 hours. The same whether an enclave runs or not
- An 8 GiB gp3 root volume (chapter 23's assumption; the AMI decides it, and it was not checked)
- One customer managed key, and no requests
- In a public subnet, with one auto-assigned public IPv4 address
- Not included: the chapter 11 network, data transfer, KMS requests

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.c6g-large.linux.hour` | 730 | Hrs | 1 c6g.large x 730 hours | 62.49 | - | 62.49 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 public IPv4 address x 730 hours | 3.65 | - | 3.65 |
| `ebs.gp3.storage` | 8 | GB-Mo | 8 GiB root (assumed), 730 of 730 hours | 0.77 | - | 0.77 |
| `kms.key` | 1 | Keys | 1 customer managed key, 730 of 730 hours | 1.00 | - | 1.00 |

- List subtotal: **USD 67.91** / month
- Subtotal after monthly free allowance: **USD 67.91** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `ec2.c6g-large.linux.hour`, `kms.key`, `ebs.gp3.storage`

## Nitro: the instance stopped for a month

ID: `nitro-idle-stopped` / chapter: [68 Nitro: What EC2 Stands On, Nitro Enclaves, and Graviton](/en/chapters/68-nitro.md)

Assumptions:

- One c6g.large left stopped for 730 hours. The same whether an enclave runs or not
- An 8 GiB gp3 root volume (chapter 23's assumption; the AMI decides it, and it was not checked)
- One customer managed key, and no requests
- The auto-assigned public IPv4 address is released when the instance stops
- Not included: the chapter 11 network, data transfer, KMS requests

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ebs.gp3.storage` | 8 | GB-Mo | 8 GiB root (assumed), 730 of 730 hours | 0.77 | - | 0.77 |
| `kms.key` | 1 | Keys | 1 customer managed key, 730 of 730 hours | 1.00 | - | 1.00 |

- List subtotal: **USD 1.77** / month
- Subtotal after monthly free allowance: **USD 1.77** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `kms.key`, `ebs.gp3.storage`

## What the production settings add to the notes API: 1,000,000 requests a month

ID: `ready-added-small` / chapter: [33 Production Readiness: The Review Before You Ship](/en/chapters/33-production-readiness.md)

Assumptions:

- The same traffic as chapter 19's obs-small: 1 KB of logs per request, 0.953674 GB ingested a month
- Log retention goes from 7 days to 90; the average stored volume is assumed to be the difference between 90/30 and 7/30 of the monthly ingest
- The table holds 1 GB, and PITR storage is assumed to equal the table's 1 GB (the size of the change history was not confirmed and is not included)
- Deletion protection, DeletionPolicy and UpdateReplacePolicy have no item in the price list
- Alarms, metrics and traces are priced in chapter 19 and are not included here, nor is the delivery of notification mail

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.pitr.storage` | 1 | GB-Mo | 1 GB table, PITR storage assumed equal to it | 0.23 | - | 0.23 |
| `logs.storage` | 2.638 | GB-Mo | 0.953674 GB x (90 - 7)/30, in GB-month | 0.09 | 5 | 0 |

- List subtotal: **USD 0.32** / month
- Subtotal after monthly free allowance: **USD 0.23** / month

## EKS: the stack alone for a month, with no manifest applied

ID: `eks-control-plane-only` / chapter: [34 Kubernetes: EKS, Auto Mode, Pod Identity, and ALB](/en/chapters/34-eks.md)

Assumptions:

- One cluster on a version in standard support for 730 hours
- The built-in node pools are disabled, so there is no node and no load balancer

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `eks.cluster.hour` | 730 | Hours | 1 cluster x 730 hours | 73.00 | - | 73.00 |

- List subtotal: **USD 73.00** / month
- Subtotal after monthly free allowance: **USD 73.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `eks.cluster.hour`

## EKS: the default layout with the app running for a month

ID: `eks-idle` / chapter: [34 Kubernetes: EKS, Auto Mode, Pod Identity, and ALB](/en/chapters/34-eks.md)

Assumptions:

- One cluster on a version in standard support for 730 hours
- Two t4g.medium nodes (arm64, on demand), one per zone, with the Auto Mode management fee
- 20 GB of ephemeral storage per node, assumed to be gp3. The size of the root volume was not confirmed and is not included
- One load balancer for 730 hours. LCUs are not included
- Four public IPv4 addresses: two load balancer nodes and two cluster nodes
- Logs, data transfer, surplus T4g CPU credits, the storage in chapter 12's repository, and nodes the node pool adds are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `eks.cluster.hour` | 730 | Hours | 1 cluster x 730 hours | 73.00 | - | 73.00 |
| `ec2.t4g-medium.linux.hour` | 1,460 | Hrs | 2 t4g.medium nodes x 730 hours | 63.07 | - | 63.07 |
| `eks.auto.t4g-medium.hour` | 1,460 | hours | 2 nodes managed by Auto Mode x 730 hours | 7.56 | - | 7.56 |
| `ebs.gp3.storage` | 40 | GB-Mo | 2 nodes x 20 GB of ephemeral storage (gp3 assumed) | 3.84 | - | 3.84 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,920 | Hrs | (2 load balancer nodes + 2 nodes) x 730 hours | 14.60 | - | 14.60 |

- List subtotal: **USD 179.81** / month
- Subtotal after monthly free allowance: **USD 179.81** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `eks.cluster.hour`, `eks.auto.t4g-medium.hour`, `ec2.t4g-medium.linux.hour`, `alb.hour`, `ebs.gp3.storage`

## EKS: the default layout with the app running for one day

ID: `eks-one-day` / chapter: [34 Kubernetes: EKS, Auto Mode, Pod Identity, and ALB](/en/chapters/34-eks.md)

Assumptions:

- The layout of eks-idle for 24 hours

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `eks.cluster.hour` | 24 | Hours | 1 cluster x 24 hours | 2.40 | - | 2.40 |
| `ec2.t4g-medium.linux.hour` | 48 | Hrs | 2 t4g.medium nodes x 24 hours | 2.07 | - | 2.07 |
| `eks.auto.t4g-medium.hour` | 48 | hours | 2 nodes managed by Auto Mode x 24 hours | 0.25 | - | 0.25 |
| `ebs.gp3.storage` | 1.315 | GB-Mo | 2 nodes x 20 GB of ephemeral storage (gp3 assumed) | 0.13 | - | 0.13 |
| `alb.hour` | 24 | Hrs | 1 load balancer x 24 hours | 0.58 | - | 0.58 |
| `vpc.public-ipv4.in-use.hour` | 96 | Hrs | (2 load balancer nodes + 2 nodes) x 24 hours | 0.48 | - | 0.48 |

- List subtotal: **USD 5.91** / month
- Subtotal after monthly free allowance: **USD 5.91** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `eks.cluster.hour`, `eks.auto.t4g-medium.hour`, `ec2.t4g-medium.linux.hour`, `alb.hour`, `ebs.gp3.storage`

## EKS: nodes in private subnets, out through one NAT gateway

ID: `eks-private-nodes` / chapter: [34 Kubernetes: EKS, Auto Mode, Pod Identity, and ALB](/en/chapters/34-eks.md)

Assumptions:

- `--node-subnets private`, with chapter 11 deployed with `-c egress=nat`
- Two t4g.medium nodes (arm64, on demand), one per zone, with the Auto Mode management fee
- 20 GB of ephemeral storage per node, assumed to be gp3. The size of the root volume was not confirmed and is not included
- One load balancer for 730 hours. LCUs are not included
- The nodes hold no public IPv4 address. Three addresses: two load balancer nodes and the NAT gateway's Elastic IP address
- 2 GB a month assumed through the NAT gateway
- Logs, data transfer, surplus T4g CPU credits, the storage in chapter 12's repository, and nodes the node pool adds are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `eks.cluster.hour` | 730 | Hours | 1 cluster x 730 hours | 73.00 | - | 73.00 |
| `ec2.t4g-medium.linux.hour` | 1,460 | Hrs | 2 t4g.medium nodes x 730 hours | 63.07 | - | 63.07 |
| `eks.auto.t4g-medium.hour` | 1,460 | hours | 2 nodes managed by Auto Mode x 730 hours | 7.56 | - | 7.56 |
| `ebs.gp3.storage` | 40 | GB-Mo | 2 nodes x 20 GB of ephemeral storage (gp3 assumed) | 3.84 | - | 3.84 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,190 | Hrs | (2 load balancer nodes + 1 NAT gateway) x 730 hours | 10.95 | - | 10.95 |
| `nat.gateway.hour` | 730 | Hrs | 1 NAT gateway x 730 hours | 45.26 | - | 45.26 |
| `nat.gateway.data` | 2 | GB | 2 GB processed (assumption) | 0.12 | - | 0.12 |

- List subtotal: **USD 221.55** / month
- Subtotal after monthly free allowance: **USD 221.55** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `eks.cluster.hour`, `eks.auto.t4g-medium.hour`, `ec2.t4g-medium.linux.hour`, `alb.hour`, `ebs.gp3.storage`

## EKS: a month on a version that has entered extended support

ID: `eks-extended-support` / chapter: [34 Kubernetes: EKS, Auto Mode, Pod Identity, and ALB](/en/chapters/34-eks.md)

Assumptions:

- The layout of eks-idle
- The upgrade policy is EXTENDED and the version has left standard support: USD 0.50 an hour is added

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `eks.cluster.hour` | 730 | Hours | 1 cluster x 730 hours | 73.00 | - | 73.00 |
| `eks.cluster.extended-support.hour` | 730 | Hours | 1 cluster in extended support x 730 hours | 365.00 | - | 365.00 |
| `ec2.t4g-medium.linux.hour` | 1,460 | Hrs | 2 t4g.medium nodes x 730 hours | 63.07 | - | 63.07 |
| `eks.auto.t4g-medium.hour` | 1,460 | hours | 2 nodes managed by Auto Mode x 730 hours | 7.56 | - | 7.56 |
| `ebs.gp3.storage` | 40 | GB-Mo | 2 nodes x 20 GB of ephemeral storage (gp3 assumed) | 3.84 | - | 3.84 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,920 | Hrs | (2 load balancer nodes + 2 nodes) x 730 hours | 14.60 | - | 14.60 |

- List subtotal: **USD 544.81** / month
- Subtotal after monthly free allowance: **USD 544.81** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `eks.cluster.hour`, `eks.cluster.extended-support.hour`, `eks.auto.t4g-medium.hour`, `ec2.t4g-medium.linux.hour`, `alb.hour`, `ebs.gp3.storage`

## Distributed SQL: the default stack (no nodes) for a month

ID: `distsql-foundation` / chapter: [66 Distributed SQL: Self-Hosting a Distributed Database on EC2](/en/chapters/66-distributed-sql.md)

Assumptions:

- Deployed without `-c nodes=3`: a bucket, a role, and two security groups
- The 0.48 GB archive for the nodes left in the bucket

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3.standard.storage` | 0.48 | GB-Mo | the release archive for the nodes | 0.01 | - | 0.01 |

- List subtotal: **USD 0.01** / month
- Subtotal after monthly free allowance: **USD 0.01** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`

## Distributed SQL: three nodes running for a month with no queries

ID: `distsql-cluster-idle` / chapter: [66 Distributed SQL: Self-Hosting a Distributed Database on EC2](/en/chapters/66-distributed-sql.md)

Assumptions:

- `-c nodes=3`: three t4g.medium running for 730 hours
- The root volume is assumed to be 8 GiB (the AMI decides; the real size was not checked). Each data volume is 20 GiB. Both are gp3 within the IOPS and throughput that carry no extra charge
- The chapter 11 network deployed with three zones, with three Systems Manager interface endpoints (ssm, ssmmessages, ec2messages) left in all three
- CPU credits are in standard mode, so nothing is billed above the baseline
- The bucket holds only the 0.48 GB archive for the nodes

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-medium.linux.hour` | 2,190 | Hrs | 3 t4g.medium x 730 hours | 94.61 | - | 94.61 |
| `ebs.gp3.storage` | 84 | GB-Mo | 3 x (8 GiB root, assumed + 20 GiB data) | 8.06 | - | 8.06 |
| `vpc.endpoint.interface.hour` | 6,570 | Hrs | 3 interface endpoints x 3 zones x 730 hours | 91.98 | - | 91.98 |
| `s3.standard.storage` | 0.48 | GB-Mo | the release archive for the nodes | 0.01 | - | 0.01 |

- List subtotal: **USD 194.66** / month
- Subtotal after monthly free allowance: **USD 194.66** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `ec2.t4g-medium.linux.hour`, `ebs.gp3.storage`

## Distributed SQL: three nodes taking 10 writes a second for a month

ID: `distsql-cluster-load` / chapter: [66 Distributed SQL: Self-Hosting a Distributed Database on EC2](/en/chapters/66-distributed-sql.md)

Assumptions:

- `-c nodes=3`: three t4g.medium running for 730 hours
- The root volume is assumed to be 8 GiB (the AMI decides; the real size was not checked). Each data volume is 20 GiB. Both are gp3 within the IOPS and throughput that carry no extra charge
- The chapter 11 network deployed with three zones, with three Systems Manager interface endpoints (ssm, ssmmessages, ec2messages) left in all three
- CPU credits are in standard mode, so nothing is billed above the baseline
- The bucket holds only the 0.48 GB archive for the nodes
- 10 writes a second for 730 hours. Each is assumed to carry 2,000 bytes through replication (not measured)
- A tablet leader sends each write to its two followers in the other zones. A transfer between zones is metered at the sending and the receiving end, so each byte is counted four times
- Heartbeats, transaction status records, reads forwarded to a leader in another zone, and traffic between clients and nodes are not included. The real figure is higher

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-medium.linux.hour` | 2,190 | Hrs | 3 t4g.medium x 730 hours | 94.61 | - | 94.61 |
| `ebs.gp3.storage` | 84 | GB-Mo | 3 x (8 GiB root, assumed + 20 GiB data) | 8.06 | - | 8.06 |
| `vpc.endpoint.interface.hour` | 6,570 | Hrs | 3 interface endpoints x 3 zones x 730 hours | 91.98 | - | 91.98 |
| `s3.standard.storage` | 0.48 | GB-Mo | the release archive for the nodes | 0.01 | - | 0.01 |
| `datatransfer.regional` | 210.24 | GB | 10 writes/s x 2000 bytes x 730 hours, to 2 followers, metered out and in | 2.10 | - | 2.10 |

- List subtotal: **USD 196.77** / month
- Subtotal after monthly free allowance: **USD 196.77** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `ec2.t4g-medium.linux.hour`, `datatransfer.regional`, `ebs.gp3.storage`

## Distributed SQL: the data volumes left after destroying the stack

ID: `distsql-retained-after-destroy` / chapter: [66 Distributed SQL: Self-Hosting a Distributed Database on EC2](/en/chapters/66-distributed-sql.md)

Assumptions:

- 730 hours after destroying a `-c nodes=3` stack created with the default `stateOnDestroy=retain`
- What remains: three 20 GiB data volumes. Root volumes go with their instances
- Storage in the retained bucket and endpoints left in the chapter 11 stack are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ebs.gp3.storage` | 60 | GB-Mo | 3 retained data volumes x 20 GiB | 5.76 | - | 5.76 |

- List subtotal: **USD 5.76** / month
- Subtotal after monthly free allowance: **USD 5.76** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ebs.gp3.storage`

## Aurora DSQL: 10 writes and 90 reads a second for a month

ID: `distsql-dsql-same-load` / chapter: [66 Distributed SQL: Self-Hosting a Distributed Database on EC2](/en/chapters/66-distributed-sql.md)

Assumptions:

- 10 writes and 90 reads a second for 730 hours
- DPUs per statement are chapter 13's assumptions (0.00675 for a read, 0.18525 for a write). Not measured on this load
- 10 GB of data
- Backups, Lambda, and networking are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dsql.dpu` | 6,464,880 | DPU | 10 writes/s x 0.18525 DPU + 90 reads/s x 0.00675 DPU, for 730 hours | 64.65 | 100,000 | 63.65 |
| `dsql.storage` | 10 | GB-Month | 10 GB stored | 4.00 | 1 | 3.60 |

- List subtotal: **USD 68.65** / month
- Subtotal after monthly free allowance: **USD 67.25** / month

## Aurora Serverless v2: the smallest always-on configuration for a month, 10 GB of data

ID: `distsql-aurora-floor` / chapter: [66 Distributed SQL: Self-Hosting a Distributed Database on EC2](/en/chapters/66-distributed-sql.md)

Assumptions:

- Aurora PostgreSQL, one writer staying at the 0.5 ACU minimum for 730 hours
- Whether 0.5 ACU carries this chapter's load was not checked. If it does not, capacity rises and so does the bill
- Aurora Standard. I/O charges are not included (there is no basis to estimate the count)
- 10 GB of data

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu` | 365 | ACU-Hr | 0.5 ACU x 730 hours | 54.75 | - | 54.75 |
| `aurora.postgres.storage` | 10 | GB-Mo | 10 GB stored | 1.20 | - | 1.20 |

- List subtotal: **USD 55.95** / month
- Subtotal after monthly free allowance: **USD 55.95** / month

## A host to try Firecracker: destroyed after two hours

ID: `firecracker-host-two-hours` / chapter: [67 Firecracker: The MicroVM under Lambda and Fargate](/en/chapters/67-firecracker.md)

Assumptions:

- Deployed with -c run=true and destroyed two hours later
- One c7i.large, one public IPv4 address, a 16 GiB gp3 root volume
- Data transfer of the downloads, the kit in S3 (tens of kilobytes) and Session Manager are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.c7i-large.linux.hour` | 2 | Hrs | 1 c7i.large x 2 hours | 0.22 | - | 0.22 |
| `vpc.public-ipv4.in-use.hour` | 2 | Hrs | 1 public IPv4 address x 2 hours | 0.01 | - | 0.01 |
| `ebs.gp3.storage` | 0.044 | GB-Mo | 16 GiB x 2 / 730 of a month | 0.004205 | - | 0.004205 |

- List subtotal: **USD 0.24** / month
- Subtotal after monthly free allowance: **USD 0.24** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `ec2.c7i-large.linux.hour`, `ebs.gp3.storage`

## A host to try Firecracker: forgotten for a month

ID: `firecracker-host-month` / chapter: [67 Firecracker: The MicroVM under Lambda and Fargate](/en/chapters/67-firecracker.md)

Assumptions:

- Deployed with -c run=true and left for 730 hours
- One c7i.large, one public IPv4 address, a 16 GiB gp3 root volume
- With no NAT gateway or endpoints in the chapter 11 network. Data transfer is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.c7i-large.linux.hour` | 730 | Hrs | 1 c7i.large x 730 hours | 82.02 | - | 82.02 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 public IPv4 address x 730 hours | 3.65 | - | 3.65 |
| `ebs.gp3.storage` | 16 | GB-Mo | 16 GiB for the month | 1.54 | - | 1.54 |

- List subtotal: **USD 87.20** / month
- Subtotal after monthly free allowance: **USD 87.20** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `ec2.c7i-large.linux.hour`, `ebs.gp3.storage`

## For comparison: two hours of c5.metal

ID: `firecracker-metal-two-hours` / chapter: [67 Firecracker: The MicroVM under Lambda and Fargate](/en/chapters/67-firecracker.md)

Assumptions:

- Two hours of c5.metal, the type Firecracker's guide suggests. This stack does not create one
- The instance-hour price only

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.c5-metal.linux.hour` | 2 | Hrs | 1 c5.metal x 2 hours | 10.27 | - | 10.27 |

- List subtotal: **USD 10.27** / month
- Subtotal after monthly free allowance: **USD 10.27** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ec2.c5-metal.linux.hour`

## Asynchronous inspection and housekeeping: deployed, with no images, for a month

ID: `async-idle` / chapter: [08 Queue: SQS, DLQs, Idempotency, and Scheduler](/en/chapters/08-async.md)

Assumptions:

- Counts only what is added on top of the app of chapter 07. No uploads; the bucket is empty
- The schedule starts the housekeeping function once an hour, 730 times a month. One run is assumed to take 0.5 s at 256 MB on arm64
- Each run lists the bucket twice. It is empty, so one page each
- 1 KB of logs per run (the function's line and Lambda's START, END, and REPORT lines)
- Not included: the SQS requests Lambda makes while long-polling the empty queue. The documentation gives no rate, so there is no quantity to enter. This is not a statement that they cost 0

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `scheduler.invocation` | 730 | Invocations | one invocation an hour | 0 | - | 0 |
| `lambda.request.arm` | 730 | Requests | one housekeeping run an hour | 0.000146 | 1,000,000 | 0 |
| `lambda.duration.arm` | 91.25 | Lambda-GB-Second | 730 x 0.5 s x 0.25 GB, in GB-seconds | 0.001217 | 400,000 | 0 |
| `s3.request.tier1` | 1,460 | Requests | 730 runs x 2 LIST requests | 0.01 | - | 0.01 |
| `logs.ingest.standard` | 0.001 | GB | 730 x 1 KB, in GB | 0.000532 | 5 | 0 |
| `logs.storage` | 0 | GB-Mo | 0.0007 GB x 7/30, in GB-month | 0.000007 | 5 | 0 |

- List subtotal: **USD 0.01** / month
- Subtotal after monthly free allowance: **USD 0.01** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.request.tier1`

## Asynchronous inspection: 10,000 uploads and 1,000 deletes a month

ID: `async-pipeline-small` / chapter: [08 Queue: SQS, DLQs, Idempotency, and Scheduler](/en/chapters/08-async.md)

Assumptions:

- Counts only the per-event part added to chapter 07's example of 10,000 uploads a month. Housekeeping is a separate example
- 11,000 S3 events (10,000 creates, 1,000 deletes). No duplicates and no retries
- Three SQS requests per message: S3's SendMessage, and Lambda's ReceiveMessage and DeleteMessage. Empty receives are not included (their rate is unknown)
- The worker is taken to run once per message (fewer invocations if messages arrive in batches). 200 ms on average at 256 MB on arm64
- The worker makes one GetObject per create event. The request that removes a tag is taken as not billed, as in chapter 07
- DynamoDB: one write unit and one strongly consistent read unit per create event, one write unit per delete event
- 0.8 KB of logs per event
- Not included: data transfer from S3 to Lambda in the same Region (its price was not checked)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `sqs.request.standard` | 33,000 | Requests | 11,000 messages x 3 requests | 0.01 | 1,000,000 | 0 |
| `lambda.request.arm` | 11,000 | Requests | one invocation per message | 0.002200 | 1,000,000 | 0 |
| `lambda.duration.arm` | 550 | Lambda-GB-Second | 11,000 x 0.2 s x 0.25 GB, in GB-seconds | 0.01 | 400,000 | 0 |
| `s3.request.tier2` | 10,000 | Requests | one GetObject per create event | 0.003700 | - | 0.003700 |
| `dynamodb.write.on-demand` | 11,000 | WriteRequestUnits | one conditional write per event | 0.01 | - | 0.01 |
| `dynamodb.read.on-demand` | 10,000 | ReadRequestUnits | one attachment lookup per create event | 0.001425 | - | 0.001425 |
| `logs.ingest.standard` | 0.008 | GB | 11,000 x 0.8 KB, in GB | 0.01 | 5 | 0 |
| `logs.storage` | 0.002 | GB-Mo | 0.0084 GB x 7/30, in GB-month | 0.000066 | 5 | 0 |

- List subtotal: **USD 0.04** / month
- Subtotal after monthly free allowance: **USD 0.01** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.request.tier2`

## Scheduled housekeeping: reconciling a bucket of 10,000 images every hour

ID: `async-housekeeping-10k` / chapter: [08 Queue: SQS, DLQs, Idempotency, and Scheduler](/en/chapters/08-async.md)

Assumptions:

- The bucket holds 10,000 images all month, each with an attachment record
- 730 runs a month. Each lists the bucket twice (10 pages of 1,000) and reads DynamoDB four times per image: chapter 07's sweep reads the record and the note, and this chapter's pass reads the record and the inspection. All strongly consistent, one unit each
- One run is assumed to take 200 s (40,000 reads in sequence at 5 ms each) at 256 MB on arm64. This was not measured
- The request that removes a tag is taken as not billed. Nothing is deleted
- 1 KB of logs per run

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `scheduler.invocation` | 730 | Invocations | one invocation an hour | 0 | - | 0 |
| `lambda.request.arm` | 730 | Requests | one housekeeping run an hour | 0.000146 | 1,000,000 | 0 |
| `lambda.duration.arm` | 36,500 | Lambda-GB-Second | 730 x 200 s x 0.25 GB, in GB-seconds | 0.49 | 400,000 | 0 |
| `s3.request.tier1` | 14,600 | Requests | 730 runs x 2 passes x 10 LIST pages | 0.07 | - | 0.07 |
| `dynamodb.read.on-demand` | 29,200,000 | ReadRequestUnits | 730 runs x 10,000 images x 4 reads | 4.16 | - | 4.16 |
| `logs.ingest.standard` | 0.001 | GB | 730 x 1 KB, in GB | 0.000532 | 5 | 0 |
| `logs.storage` | 0 | GB-Mo | 0.0007 GB x 7/30, in GB-month | 0.000007 | 5 | 0 |

- List subtotal: **USD 4.72** / month
- Subtotal after monthly free allowance: **USD 4.23** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.request.tier1`

## SSR: deployed, but nobody visits for a month

ID: `ssr-idle` / chapter: [09 SSR: A BFF, and Nuxt on Regional Lambda](/en/chapters/09-ssr.md)

Assumptions:

- No requests and no publishes
- 5 MB of static assets in the bucket
- Logs expire after a week; nothing is stored

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3.standard.storage` | 0.005 | GB-Mo | 5 MB stored for the month, in GB-month | 0.000125 | - | 0.000125 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`

## SSR: 100,000 page views a month

ID: `ssr-small` / chapter: [09 SSR: A BFF, and Nuxt on Regional Lambda](/en/chapters/09-ssr.md)

Assumptions:

- Each page view is assumed to be 4 requests to CloudFront on average (1 for HTML or API JSON, 3 for assets) and 100 KB in total
- Served entirely from Japan edge locations over HTTPS
- Of the 100,000 HTML and API requests, half are assumed answered from CloudFront's cache and 50,000 reach Lambda
- Lambda averages 200 ms at 512 MB, arm64, buffered. The 200 ms is an assumption, not a measurement
- 0.3 KB of logs per invocation (only Lambda's START/END/REPORT lines). 7-day retention; average stored volume assumed to be 7/30 of the monthly ingest
- One tenth of the 300,000 asset requests are assumed to reach S3
- 10 publishes a month, 20 object PUTs each. 5 MB in the bucket
- Data transfer from Lambda to CloudFront, standard logging, WAF, and a custom domain are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
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

- List subtotal: **USD 1.67** / month
- Subtotal after monthly free allowance: **USD 0.01** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `s3.request.tier1`, `s3.request.tier2`

## Containers: the repository alone (deployed without an image tag)

ID: `containers-repository-only` / chapter: [12 Containers: ECR, ECS/Fargate, and ALB](/en/chapters/12-containers.md)

Assumptions:

- Deployed without `-c imageTag`: no load balancer, no tasks
- 0.1 GB stored, assumed for one image (the image was never built, so its real size is not measured)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ecr.storage` | 0.1 | GB-Mo | 0.1 GB stored (assumption) | 0.01 | - | 0.01 |

- List subtotal: **USD 0.01** / month
- Subtotal after monthly free allowance: **USD 0.01** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ecr.storage`

## Containers: the default layout left running for a month

ID: `containers-idle` / chapter: [12 Containers: ECR, ECS/Fargate, and ALB](/en/chapters/12-containers.md)

Assumptions:

- Two tasks (0.25 vCPU, 0.5 GB, arm64) in public subnets for 730 hours
- One load balancer for 730 hours. LCUs are not included (what health checks alone consume was not confirmed)
- Four public IPv4 addresses: two load balancer nodes and two tasks. More if the load balancer adds nodes
- 0.1 GB in the repository (assumption)
- Logs, data transfer, and tasks added by auto scaling are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 365 | hours | 2 tasks x 0.25 vCPU x 730 hours | 14.76 | - | 14.76 |
| `fargate.arm.memory.gb-hour` | 730 | hours | 2 tasks x 0.5 GB x 730 hours | 3.23 | - | 3.23 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,920 | Hrs | (2 load balancer nodes + 2 tasks) x 730 hours | 14.60 | - | 14.60 |
| `ecr.storage` | 0.1 | GB-Mo | 0.1 GB stored (assumption) | 0.01 | - | 0.01 |

- List subtotal: **USD 50.34** / month
- Subtotal after monthly free allowance: **USD 50.34** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `ecr.storage`

## Containers: the default layout for one day

ID: `containers-one-day` / chapter: [12 Containers: ECR, ECS/Fargate, and ALB](/en/chapters/12-containers.md)

Assumptions:

- The layout of `containers-idle` for 24 hours
- Repository storage, logs, data transfer, and LCUs are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 12 | hours | 2 tasks x 0.25 vCPU x 24 hours | 0.49 | - | 0.49 |
| `fargate.arm.memory.gb-hour` | 24 | hours | 2 tasks x 0.5 GB x 24 hours | 0.11 | - | 0.11 |
| `alb.hour` | 24 | Hrs | 1 load balancer x 24 hours | 0.58 | - | 0.58 |
| `vpc.public-ipv4.in-use.hour` | 96 | Hrs | (2 load balancer nodes + 2 tasks) x 24 hours | 0.48 | - | 0.48 |

- List subtotal: **USD 1.65** / month
- Subtotal after monthly free allowance: **USD 1.65** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`

## Containers: 1,000,000 requests a month

ID: `containers-small` / chapter: [12 Containers: ECR, ECS/Fargate, and ALB](/en/chapters/12-containers.md)

Assumptions:

- The layout of `containers-idle`, assuming the service stays at two tasks
- LCUs counted on the new-connection dimension: one connection per request, 1,000,000 a month is 0.38 a second or 0.0152 LCU, which is 11.1 LCU-hours over 730 hours
- One 0.2 KB log line per request (successful health checks are not logged); 7-day retention, average stored volume assumed to be 7/30 of the monthly ingest
- 0.5 KB per response assumed, so 0.477 GB of data transfer out to the internet

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
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

- List subtotal: **USD 50.63** / month
- Subtotal after monthly free allowance: **USD 50.48** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `datatransfer.out.internet`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `alb.lcu.hour`, `ecr.storage`

## Containers: tasks in private subnets, out through one NAT gateway

ID: `containers-private-nat` / chapter: [12 Containers: ECR, ECS/Fargate, and ALB](/en/chapters/12-containers.md)

Assumptions:

- `-c taskSubnets=private`, with chapter 11 deployed with `-c egress=nat`
- Tasks hold no public IPv4 address. Three addresses: two load balancer nodes and the NAT gateway's Elastic IP address
- 2 GB a month assumed through the NAT gateway (image pulls and logs)
- LCUs, logs, and data transfer out to the internet are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 365 | hours | 2 tasks x 0.25 vCPU x 730 hours | 14.76 | - | 14.76 |
| `fargate.arm.memory.gb-hour` | 730 | hours | 2 tasks x 0.5 GB x 730 hours | 3.23 | - | 3.23 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 2,190 | Hrs | (2 load balancer nodes + 1 NAT gateway) x 730 hours | 10.95 | - | 10.95 |
| `ecr.storage` | 0.1 | GB-Mo | 0.1 GB stored (assumption) | 0.01 | - | 0.01 |
| `nat.gateway.hour` | 730 | Hrs | 1 NAT gateway x 730 hours | 45.26 | - | 45.26 |
| `nat.gateway.data` | 2 | GB | 2 GB processed (assumption) | 0.12 | - | 0.12 |

- List subtotal: **USD 92.07** / month
- Subtotal after monthly free allowance: **USD 92.07** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `ecr.storage`

## Containers: tasks in private subnets, reaching AWS through three interface endpoints

ID: `containers-private-endpoints` / chapter: [12 Containers: ECR, ECS/Fargate, and ALB](/en/chapters/12-containers.md)

Assumptions:

- `-c taskSubnets=private`, with chapter 11 deployed with `-c interfaceEndpoints=ecr.api,ecr.dkr,logs`
- Three interface endpoints in two zones each. Image layers go through the S3 gateway endpoint, which is free
- 1 GB a month assumed through the interface endpoints
- Two public IPv4 addresses, for the load balancer nodes only
- LCUs, logs, and data transfer out to the internet are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 365 | hours | 2 tasks x 0.25 vCPU x 730 hours | 14.76 | - | 14.76 |
| `fargate.arm.memory.gb-hour` | 730 | hours | 2 tasks x 0.5 GB x 730 hours | 3.23 | - | 3.23 |
| `alb.hour` | 730 | Hrs | 1 load balancer x 730 hours | 17.74 | - | 17.74 |
| `vpc.public-ipv4.in-use.hour` | 1,460 | Hrs | 2 load balancer nodes x 730 hours | 7.30 | - | 7.30 |
| `ecr.storage` | 0.1 | GB-Mo | 0.1 GB stored (assumption) | 0.01 | - | 0.01 |
| `vpc.endpoint.interface.hour` | 4,380 | Hrs | 3 interface endpoints x 2 zones x 730 hours | 61.32 | - | 61.32 |
| `vpc.endpoint.interface.data` | 1 | GB | 1 GB processed (assumption) | 0.01 | - | 0.01 |

- List subtotal: **USD 104.37** / month
- Subtotal after monthly free allowance: **USD 104.37** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`, `alb.hour`, `ecr.storage`

## Aurora DSQL: 1 GB of data and no queries for a month

ID: `sql-dsql-idle` / chapter: [13 SQL: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2](/en/chapters/13-sql.md)

Assumptions:

- No queries, so no DPUs
- 1 GB of data
- No backups

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dsql.dpu` | 0 | DPU | no database activity | 0 | 100,000 | 0 |
| `dsql.storage` | 1 | GB-Month | 1 GB stored for the month | 0.40 | 1 | 0 |

- List subtotal: **USD 0.40** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Aurora DSQL: a notes API at 1 million requests a month (database only)

ID: `sql-dsql-small` / chapter: [13 SQL: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2](/en/chapters/13-sql.md)

Assumptions:

- 900,000 reads and 100,000 writes
- A read is assumed to cost 0.00675 DPU (the figure in the documentation's point-lookup example)
- A write is assumed to cost 0.18525 DPU (three times the 0.06175 DPU of the documentation's single-row insert example; a create in this chapter writes three rows)
- Not measured on this chapter's queries
- 1 GB of data
- Lambda, API Gateway, logs, and backups are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dsql.dpu` | 24,600 | DPU | 900,000 x 0.00675 DPU + 100,000 x 0.18525 DPU | 0.25 | 100,000 | 0 |
| `dsql.storage` | 1 | GB-Month | 1 GB stored for the month | 0.40 | 1 | 0 |

- List subtotal: **USD 0.65** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## RDS for PostgreSQL: the smallest configuration running for 730 hours

ID: `sql-rds-min` / chapter: [13 SQL: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2](/en/chapters/13-sql.md)

Assumptions:

- db.t4g.micro, Single-AZ, never stopped, 730 hours
- 20 GB of gp3 (the minimum for PostgreSQL)
- Independent of how many queries run
- Backup storage beyond the free allocation, data transfer, and VPC charges (chapter 11) are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `rds.postgres.t4g-micro.single-az` | 730 | Hrs | one instance for 730 hours | 18.25 | - | 18.25 |
| `rds.postgres.gp3.storage` | 20 | GB-Mo | 20 GB provisioned for the month | 2.76 | - | 2.76 |

- List subtotal: **USD 21.01** / month
- Subtotal after monthly free allowance: **USD 21.01** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `rds.postgres.t4g-micro.single-az`, `rds.postgres.gp3.storage`

## Aurora Serverless v2: no auto-pause, 0.5 ACU minimum for 730 hours

ID: `sql-aurora-min` / chapter: [13 SQL: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2](/en/chapters/13-sql.md)

Assumptions:

- Aurora PostgreSQL, one writer, staying at the 0.5 ACU minimum for 730 hours
- Aurora Standard (I/O is billed separately; zero I/O here)
- 1 GB of data
- Backup storage beyond the free allocation, data transfer, and VPC charges (chapter 11) are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu` | 365 | ACU-Hr | 0.5 ACU x 730 hours | 54.75 | - | 54.75 |
| `aurora.postgres.storage` | 1 | GB-Mo | 1 GB stored for the month | 0.12 | - | 0.12 |

- List subtotal: **USD 54.87** / month
- Subtotal after monthly free allowance: **USD 54.87** / month

## Aurora Serverless v2: auto-paused for the whole month

ID: `sql-aurora-paused` / chapter: [13 SQL: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2](/en/chapters/13-sql.md)

Assumptions:

- 0 ACU minimum, assuming no connection and no resume for the whole month
- In practice Aurora resumes the instance for maintenance at times, and that time is billed
- 1 GB of data

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `aurora.postgres.serverless-v2.acu` | 0 | ACU-Hr | paused for all 730 hours | 0 | - | 0 |
| `aurora.postgres.storage` | 1 | GB-Mo | 1 GB stored for the month | 0.12 | - | 0.12 |

- List subtotal: **USD 0.12** / month
- Subtotal after monthly free allowance: **USD 0.12** / month

## Long jobs: deployed, with no notes at all, for a month

ID: `export-idle` / chapter: [16 Workflow: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch](/en/chapters/16-long-jobs.md)

Assumptions:

- The schedule starts the workflow once a day, 30 times a month. The table is empty
- One execution passes ExportPages, MorePages, Finish, and Exported once each. With start and end that is counted as 6 state transitions (the pricing page's way of counting; not measured)
- Two function invocations per execution, each assumed to take 0.5 s with 256 MB on arm64
- An empty Scan is counted as one read unit, generously. S3 sees one LIST and one manifest PUT
- 1 KB of logs per function invocation

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `scheduler.invocation` | 30 | Invocations | one start a day | 0 | - | 0 |
| `sfn.standard.transition` | 180 | StateTransitions | 30 executions x 6 transitions | 0.004500 | 4,000 | 0 |
| `lambda.request.arm` | 60 | Requests | 30 executions x 2 invocations | 0.000012 | 1,000,000 | 0 |
| `lambda.duration.arm` | 7.5 | Lambda-GB-Second | 60 x 0.5 s x 0.25 GB, in GB-seconds | 0.000100 | 400,000 | 0 |
| `dynamodb.read.on-demand` | 30 | ReadRequestUnits | one empty Scan per run, counted as 1 unit | 0.000004 | - | 0.000004 |
| `s3.request.tier1` | 60 | Requests | 30 runs x (1 LIST + 1 manifest PUT) | 0.000282 | - | 0.000282 |
| `logs.ingest.standard` | 0 | GB | 60 x 1 KB, in GB | 0.000043 | 5 | 0 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.request.tier1`

## Long jobs: 10,000 notes exported daily, every page in one invocation (this chapter's default)

ID: `export-daily-10k-coarse` / chapter: [16 Workflow: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch](/en/chapters/16-long-jobs.md)

Assumptions:

- 10,000 notes of 1 KB in the table (10 MB), exported once a day, 30 times a month
- 100 notes a page, so 100 parts per export; 120 KB a part and 12 MB an export, assumed
- The Scan is eventually consistent, 0.5 units per 4 KB: 1,280 units for 10 MB
- Exports expire after 7 days, so the bucket holds 7 of them at any time (84 MB)
- Functions on arm64 with 256 MB. 200 ms a page and 1 s for Finish, assumed, not measured
- State transitions are estimated the way the pricing page's example counts them (start and end count as one each), not measured
- Not included: retries, redrives, data transfer out of S3 and DynamoDB
- ExportPages writes all 100 pages in one invocation (20 s). 6 state transitions per execution

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `scheduler.invocation` | 30 | Invocations | one start a day | 0 | - | 0 |
| `sfn.standard.transition` | 180 | StateTransitions | 30 executions x 6 transitions | 0.004500 | 4,000 | 0 |
| `lambda.request.arm` | 60 | Requests | 30 executions x 2 invocations | 0.000012 | 1,000,000 | 0 |
| `lambda.duration.arm` | 157.5 | Lambda-GB-Second | 30 x (20 s + 1 s) x 0.25 GB, in GB-seconds | 0.002100 | 400,000 | 0 |
| `dynamodb.read.on-demand` | 38,400 | ReadRequestUnits | 30 runs x 10,240 KB scanned / 4 KB x 0.5 (eventually consistent) | 0.01 | - | 0.01 |
| `s3.request.tier1` | 3,060 | Requests | 30 runs x (100 part PUTs + 1 manifest PUT + 1 LIST) | 0.01 | - | 0.01 |
| `s3.standard.storage` | 0.082 | GB-Mo | 7 exports of 12 MB kept at any time, in GB-month | 0.002050 | - | 0.002050 |
| `logs.ingest.standard` | 0 | GB | 60 x 1 KB, in GB | 0.000043 | 5 | 0 |

- List subtotal: **USD 0.03** / month
- Subtotal after monthly free allowance: **USD 0.02** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `s3.request.tier1`

## Long jobs: 10,000 notes exported daily, returning to the workflow after every page

ID: `export-daily-10k-fine` / chapter: [16 Workflow: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch](/en/chapters/16-long-jobs.md)

Assumptions:

- 10,000 notes of 1 KB in the table (10 MB), exported once a day, 30 times a month
- 100 notes a page, so 100 parts per export; 120 KB a part and 12 MB an export, assumed
- The Scan is eventually consistent, 0.5 units per 4 KB: 1,280 units for 10 MB
- Exports expire after 7 days, so the bucket holds 7 of them at any time (84 MB)
- Functions on arm64 with 256 MB. 200 ms a page and 1 s for Finish, assumed, not measured
- State transitions are estimated the way the pricing page's example counts them (start and end count as one each), not measured
- Not included: retries, redrives, data transfer out of S3 and DynamoDB
- ExportPages returns after every page: 100 passes through ExportPages and MorePages each, 204 state transitions per execution

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `scheduler.invocation` | 30 | Invocations | one start a day | 0 | - | 0 |
| `sfn.standard.transition` | 6,120 | StateTransitions | 30 executions x (100 x 2 + 4) transitions | 0.15 | 4,000 | 0.05 |
| `lambda.request.arm` | 3,030 | Requests | 30 executions x (100 pages + 1 finish) | 0.000606 | 1,000,000 | 0 |
| `lambda.duration.arm` | 157.5 | Lambda-GB-Second | 30 x (100 x 0.2 s + 1 s) x 0.25 GB, in GB-seconds | 0.002100 | 400,000 | 0 |
| `dynamodb.read.on-demand` | 38,400 | ReadRequestUnits | 30 runs x 10,240 KB scanned / 4 KB x 0.5 (eventually consistent) | 0.01 | - | 0.01 |
| `s3.request.tier1` | 3,060 | Requests | 30 runs x (100 part PUTs + 1 manifest PUT + 1 LIST) | 0.01 | - | 0.01 |
| `s3.standard.storage` | 0.082 | GB-Mo | 7 exports of 12 MB kept at any time, in GB-month | 0.002050 | - | 0.002050 |
| `logs.ingest.standard` | 0.003 | GB | 3,030 x 1 KB, in GB | 0.002196 | 5 | 0 |

- List subtotal: **USD 0.18** / month
- Subtotal after monthly free allowance: **USD 0.07** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `s3.request.tier1`

## Long jobs: 10,000 notes exported daily with the durable-function variant (`-c durable=true`)

ID: `export-daily-10k-durable` / chapter: [16 Workflow: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch](/en/chapters/16-long-jobs.md)

Assumptions:

- 10,000 notes of 1 KB in the table (10 MB), exported once a day, 30 times a month
- 100 notes a page, so 100 parts per export; 120 KB a part and 12 MB an export, assumed
- The Scan is eventually consistent, 0.5 units per 4 KB: 1,280 units for 10 MB
- Exports expire after 7 days, so the bucket holds 7 of them at any time (84 MB)
- Functions on arm64 with 256 MB. 200 ms a page and 1 s for Finish, assumed, not measured
- Not included: retries, redrives, data transfer out of S3 and DynamoDB
- Started once a day by hand or by a schedule of your own; Step Functions is not involved
- One step per 20 pages makes 5 steps, plus finish. With the start of the execution that is 7 durable operations per execution
- No waits, so one function invocation per execution (21 s), assumed
- Only the progress is checkpointed: 1 KB per operation, retained for one day, assumed

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
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

- List subtotal: **USD 0.03** / month
- Subtotal after monthly free allowance: **USD 0.02** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `s3.request.tier1`, `lambda.durable.operation`, `lambda.durable.written`, `lambda.durable.retained`

## For comparison: a step that takes an hour, run once a day as a Fargate task for a month

ID: `export-step-fargate-1h` / chapter: [16 Workflow: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch](/en/chapters/16-long-jobs.md)

Assumptions:

- Not something this chapter's stack creates; computed only to compare prices
- A task of 0.25 vCPU and 0.5 GB on arm64, once a day for an hour: 30 hours a month
- Run in a public subnet with a public IPv4 address (chapter 12's layout), billed only while the task runs
- Not included: image storage in ECR, logs, data transfer, Step Functions state transitions

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `fargate.arm.vcpu.hour` | 7.5 | hours | 30 hours x 0.25 vCPU | 0.30 | - | 0.30 |
| `fargate.arm.memory.gb-hour` | 15 | hours | 30 hours x 0.5 GB | 0.07 | - | 0.07 |
| `vpc.public-ipv4.in-use.hour` | 30 | Hrs | one public IPv4 address for 30 hours | 0.15 | - | 0.15 |

- List subtotal: **USD 0.52** / month
- Subtotal after monthly free allowance: **USD 0.52** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `fargate.arm.vcpu.hour`, `fargate.arm.memory.gb-hour`

## Summary API: deployed, but never called for a month

ID: `ai-idle` / chapter: [17 AI Development for Workers AI Users: Bedrock](/en/chapters/17-ai.md)

Assumptions:

- No requests
- Logs expire after a week; nothing is stored

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Summary API: 1,000 summaries a month (Nova 2 Lite, jp. profile)

ID: `ai-summaries-nova-2-lite` / chapter: [17 AI Development for Workers AI Users: Bedrock](/en/chapters/17-ai.md)

Assumptions:

- 1,000 summaries a month
- Assumed 2,000 input tokens each (system prompt plus note; the real number is in the response's usage)
- Assumed 150 output tokens each (the limit is 400)
- Lambda at 256 MB on arm64, assumed 4 seconds each on average (waiting for the model is billed too)
- Assumed 1 KB of logs each
- Data transfer is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.input` | 2,000 | 1K tokens | 1,000 summaries x 2,000 input tokens, in 1K tokens | 0.79 | - | 0.79 |
| `bedrock.nova-2-lite.output` | 150 | 1K tokens | 1,000 summaries x 150 output tokens, in 1K tokens | 0.50 | - | 0.50 |
| `lambda.request.arm` | 1,000 | Requests | one invocation per summary | 0.000200 | 1,000,000 | 0 |
| `lambda.duration.arm` | 1,000 | Lambda-GB-Second | 1,000 x 4 s x 0.25 GB | 0.01 | 400,000 | 0 |
| `logs.ingest.standard` | 0.001 | GB | 1,000 x 1 KB, in GB | 0.000725 | 5 | 0 |

- List subtotal: **USD 1.30** / month
- Subtotal after monthly free allowance: **USD 1.29** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.nova-2-lite.input`, `bedrock.nova-2-lite.output`

## Summary API: output cost if all 1,000 summaries hit the output limit

ID: `ai-output-ceiling-nova-2-lite` / chapter: [17 AI Development for Workers AI Users: Bedrock](/en/chapters/17-ai.md)

Assumptions:

- All 1,000 summaries write up to the maxTokens of 400
- Output tokens only; input and Lambda are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.nova-2-lite.output` | 400 | 1K tokens | 1,000 summaries x 400 output tokens, in 1K tokens | 1.32 | - | 1.32 |

- List subtotal: **USD 1.32** / month
- Subtotal after monthly free allowance: **USD 1.32** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.nova-2-lite.output`

## Summary API: the same token counts on Claude Haiku 4.5 (inference only)

ID: `ai-summaries-claude-haiku-4-5` / chapter: [17 AI Development for Workers AI Users: Bedrock](/en/chapters/17-ai.md)

Assumptions:

- 1,000 summaries a month
- Assumed 2,000 input tokens each (system prompt plus note; the real number is in the response's usage)
- Assumed 150 output tokens each (the limit is 400)
- Tokenizers differ by model, so the same text does not give the same token count; this is for comparing unit prices
- Inference only; Lambda is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `bedrock.claude-haiku-4-5.input` | 2 | 1M tokens | 1,000 summaries x 2,000 input tokens, in 1M tokens | 2.20 | - | 2.20 |
| `bedrock.claude-haiku-4-5.output` | 0.15 | 1M tokens | 1,000 summaries x 150 output tokens, in 1M tokens | 0.82 | - | 0.82 |

- List subtotal: **USD 3.03** / month
- Subtotal after monthly free allowance: **USD 3.03** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `bedrock.claude-haiku-4-5.input`, `bedrock.claude-haiku-4-5.output`

## Observed notes API: deployed, but never called for a month

ID: `obs-idle` / chapter: [19 Observability: CloudWatch, OpenTelemetry, RUM, and Synthetics](/en/chapters/19-observability.md)

Assumptions:

- No requests: no log lines, no traces, and no data points for the custom metric
- The two alarms refer to three metrics in total (Count and 5xx for the error rate, Latency for slowness)
- The one dashboard is assumed to be within the free tier (3 dashboards of up to 50 metrics); the price beyond that could not be confirmed and is not included
- The API, Lambda and DynamoDB themselves are priced in chapters 04 and 05 and are not included here

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.alarm.standard` | 3 | Alarms | 2 alarms listing 3 metrics | 0.30 | 10 | 0 |

- List subtotal: **USD 0.30** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Observed notes API: what observing 1,000,000 requests a month costs

ID: `obs-small` / chapter: [19 Observability: CloudWatch, OpenTelemetry, RUM, and Synthetics](/en/chapters/19-observability.md)

Assumptions:

- 1 KB of logs per request. The application's line measures 255 bytes with trace fields; the rest is what Lambda writes, whose size in the JSON format is an unmeasured assumption
- 7-day log retention; average stored volume assumed to be 7/30 of the monthly ingest
- Requests assumed to arrive at a steady rate: 0.38 per second, so Lambda's default sampling (the first each second plus 5% of the rest) traces every one. This is the upper bound; uneven arrival lowers it
- The number of spans in a trace is assumed not to change the price (charged per trace)
- 10,000 traces opened a month, and 1 GB of logs scanned by Logs Insights
- One custom metric (NoteConflicts) and three metrics referred to by alarms
- The dashboard is assumed to be within the free tier. SNS notifications and the API, Lambda and DynamoDB themselves are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `logs.ingest.standard` | 0.954 | GB | 1,000,000 x 1,024 bytes, in GB | 0.72 | 5 | 0 |
| `logs.storage` | 0.223 | GB-Mo | 0.953674 GB x 7/30, in GB-month | 0.01 | 5 | 0 |
| `logs.insights.scanned` | 1 | GB | 1 GB scanned by queries | 0.01 | 5 | 0 |
| `cloudwatch.metric.custom` | 1 | Metrics | NoteConflicts | 0.30 | 10 | 0 |
| `cloudwatch.alarm.standard` | 3 | Alarms | 2 alarms listing 3 metrics | 0.30 | 10 | 0 |
| `xray.trace.recorded` | 1,000,000 | traces | every request traced at 0.38 requests per second | 5.00 | 100,000 | 4.50 |
| `xray.trace.retrieved` | 10,000 | traces | 10,000 traces opened | 0.01 | 1,000,000 | 0 |

- List subtotal: **USD 6.34** / month
- Subtotal after monthly free allowance: **USD 4.50** / month

## One more log line per request: 1,000,000 requests a month

ID: `obs-one-more-line` / chapter: [19 Observability: CloudWatch, OpenTelemetry, RUM, and Synthetics](/en/chapters/19-observability.md)

Assumptions:

- The added line is 167 bytes, the measured size of the request line without trace fields
- 7-day retention; average stored volume assumed to be 7/30 of the monthly ingest

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `logs.ingest.standard` | 0.156 | GB | 1,000,000 x 167 bytes, in GB | 0.12 | 5 | 0 |
| `logs.storage` | 0.036 | GB-Mo | 0.15553 GB x 7/30, in GB-month | 0.001198 | 5 | 0 |

- List subtotal: **USD 0.12** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## One more custom metric

ID: `obs-one-more-metric` / chapter: [19 Observability: CloudWatch, OpenTelemetry, RUM, and Synthetics](/en/chapters/19-observability.md)

Assumptions:

- One custom metric without dimensions, receiving data points every hour for a month
- With dimensions, every distinct combination of values counts as one metric

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.metric.custom` | 1 | Metrics | 1 metric for a full month | 0.30 | 10 | 0 |

- List subtotal: **USD 0.30** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Synthetics: one canary every 5 minutes

ID: `obs-canary-5min` / chapter: [19 Observability: CloudWatch, OpenTelemetry, RUM, and Synthetics](/en/chapters/19-observability.md)

Assumptions:

- 730 hours x 12 runs an hour = 8,760 runs
- The Lambda, S3, log and metric charges a canary incurs are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.synthetics.run` | 8,760 | Runs | 730 h x 12 runs | 16.64 | 100 | 16.45 |

- List subtotal: **USD 16.64** / month
- Subtotal after monthly free allowance: **USD 16.45** / month

## RUM: 10,000 visits a month, all collected

ID: `obs-rum-small` / chapter: [19 Observability: CloudWatch, OpenTelemetry, RUM, and Synthetics](/en/chapters/19-observability.md)

Assumptions:

- 20 events per visit (the number in the pricing page's example), 100% of sessions collected
- The one-time free trial of 1 million events is not deducted

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.rum.event` | 200,000 | Events | 10,000 visits x 20 events | 2.00 | - | 2.00 |

- List subtotal: **USD 2.00** / month
- Subtotal after monthly free allowance: **USD 2.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `cloudwatch.rum.event`

## Shipping: the stack and the CI roles in place, nobody calling for a month

ID: `ship-idle` / chapter: [20 CI/CD: OIDC, Environments, Previews, Rollback, and Drift](/en/chapters/20-shipping.md)

Assumptions:

- No requests to the API; logs have expired and nothing is stored
- CloudFormation adds no charge for AWS:: resource types; IAM roles and the OIDC provider are part of IAM, at no additional charge
- No deploys and no drift detection
- GitHub Actions charges are not an AWS bill and are not included

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Shipping: one deploy a day for a year, assets never cleaned up

ID: `ship-assets-year` / chapter: [20 CI/CD: OIDC, Environments, Previews, Rollback, and Drift](/en/chapters/20-shipping.md)

Assumptions:

- Every deploy changes the code and adds one new zip to the CDK asset bucket
- Each zip is 137 KB (this chapter's 837 KB bundle deflated locally; not a measurement of the zip the CDK CLI makes)
- Storage for a month in which all 365 remain; PUT request charges are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3.standard.storage` | 0.048 | GB-Mo | 365 x 137 KB, in GB | 0.001192 | - | 0.001192 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`

## Security: the default stack, deployed but never called for a month

ID: `sec-idle-default` / chapter: [21 Protect and Govern: WAF, Inspector, GuardDuty, Secrets, KMS, CloudTrail, Config, and Organizations](/en/chapters/21-security.md)

Assumptions:

- Neither `-c cmk=on` nor `-c webAclArn=...`; the web ACL stack (AihSecurityWaf) does not exist
- No requests. The function never runs, so no Secrets Manager API call is made
- One secret for 730 hours, encrypted with aws/secretsmanager (no monthly fee)
- The CloudFront distribution, Lambda, and the IAM role cost nothing uncalled; logs have expired and nothing is stored

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `secretsmanager.secret` | 1 | Secrets | 1 secret for the whole month | 0.40 | - | 0.40 |

- List subtotal: **USD 0.40** / month
- Subtotal after monthly free allowance: **USD 0.40** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `secretsmanager.secret`

## Security: with `-c cmk=on`, deployed but never called for a month

ID: `sec-idle-cmk` / chapter: [21 Protect and Govern: WAF, Inspector, GuardDuty, Secrets, KMS, CloudTrail, Config, and Organizations](/en/chapters/21-security.md)

Assumptions:

- The default stack plus one customer managed key
- The key is less than a year old and has not rotated yet. Each of the first two rotations adds USD 1 a month
- No requests

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `secretsmanager.secret` | 1 | Secrets | 1 secret for the whole month | 0.40 | - | 0.40 |
| `kms.key` | 1 | Keys | 1 customer managed key, one key version | 1.00 | - | 1.00 |

- List subtotal: **USD 1.40** / month
- Subtotal after monthly free allowance: **USD 1.40** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `secretsmanager.secret`, `kms.key`

## Security: the web ACL (AihSecurityWaf) for a month, inspecting one million requests

ID: `sec-waf-month` / chapter: [21 Protect and Govern: WAF, Inspector, GuardDuty, Secrets, KMS, CloudTrail, Config, and Organizations](/en/chapters/21-security.md)

Assumptions:

- One web ACL and three rules (one rate-based rule, two AWS managed rule groups; a managed rule group counts as one rule)
- 727 WCUs in total, inside the 1,500 WCUs the base price includes
- One million requests inspected in the month. With none, USD 8.00 a month
- That a web ACL for CloudFront is metered under the Global-* usage types was not confirmed on a bill. The ap-northeast-1 and us-east-1 prices are the same numbers
- This subtotal excludes the default stack. No WAF logging, no Bot Control or other add-ons

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `waf.global.webacl` | 1 | Month | 1 web ACL for the whole month | 5.00 | - | 5.00 |
| `waf.global.rule` | 3 | Month | 3 rules for the whole month | 3.00 | - | 3.00 |
| `waf.global.request` | 1,000,000 | Request | 1,000,000 requests inspected | 0.60 | - | 0.60 |

- List subtotal: **USD 8.60** / month
- Subtotal after monthly free allowance: **USD 8.60** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `waf.global.webacl`, `waf.global.rule`, `waf.global.request`

## Security: the default stack, 100,000 tokens issued and 100,000 verified a month

ID: `sec-small` / chapter: [21 Protect and Govern: WAF, Inspector, GuardDuty, Secrets, KMS, CloudTrail, Config, and Organizations](/en/chapters/21-security.md)

Assumptions:

- 200,000 requests to CloudFront (HTTPS, Japan edge locations). Nothing is cached, so all of them reach Lambda
- 0.5 KB per response, assumed
- Lambda averages 50 ms at 256 MB, arm64. The 50 ms is an assumption, not a measurement
- One execution environment running all month and reloading its keys every five minutes (730 hours x 12 x 2 GetSecretValue calls). More environments mean proportionally more
- 0.3 KB of logs per invocation (only the lines Lambda writes). 7-day retention; average stored volume assumed to be 7/30 of the monthly ingest
- No customer managed key and no web ACL. Data transfer from Lambda to CloudFront is not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `secretsmanager.secret` | 1 | Secrets | 1 secret for the whole month | 0.40 | - | 0.40 |
| `secretsmanager.api` | 17,520 | API Requests | 730 hours x 12 reloads x 2 GetSecretValue calls | 0.09 | - | 0.09 |
| `cloudfront.jp.request.https` | 200,000 | Requests | 100,000 /token + 100,000 /verify | 0.24 | 10,000,000 | 0 |
| `cloudfront.jp.transfer` | 0.095 | GB | 200,000 x 0.5 KB, in GB | 0.01 | 1,024 | 0 |
| `lambda.request.arm` | 200,000 | Requests | every request reaches the function | 0.04 | 1,000,000 | 0 |
| `lambda.duration.arm` | 2,500 | Lambda-GB-Second | 200,000 x 0.05 s x 0.25 GB, in GB-seconds | 0.03 | 400,000 | 0 |
| `logs.ingest.standard` | 0.057 | GB | 200,000 x 0.3 KB, in GB | 0.04 | 5 | 0 |
| `logs.storage` | 0.013 | GB-Mo | 0.057220 GB x 7/30, in GB-month | 0.000441 | 5 | 0 |

- List subtotal: **USD 0.86** / month
- Subtotal after monthly free allowance: **USD 0.49** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `secretsmanager.secret`, `secretsmanager.api`

## Security: GuardDuty, Inspector, and AWS Config on a small account for a month (an order-of-magnitude example)

ID: `sec-detect-example` / chapter: [21 Protect and Govern: WAF, Inspector, GuardDuty, Secrets, KMS, CloudTrail, Config, and Organizations](/en/chapters/21-security.md)

Assumptions:

- A month after the free trials have ended
- 100,000 CloudTrail management events analyzed by GuardDuty, assumed. The real count depends on what the account does; this is not a measurement
- GuardDuty's other charges (VPC flow log and DNS log volume, and protection plans such as S3, Lambda, and Malware Protection) are not included. Enabling GuardDuty for the first time turns every protection plan on by default
- Inspector with Lambda standard scanning only, one function for 730 hours. ECR image and EC2 instance scanning are not included
- AWS Config with continuous recording and 500 configuration items in the month, assumed. Rule evaluations and the S3 storage for the records are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `guardduty.cloudtrail.event` | 100,000 | Events | 100,000 management events analyzed (assumed) | 0.47 | - | 0.47 |
| `inspector.lambda.standard` | 730 | Hourly | 1 function x 730 hours | 0.36 | - | 0.36 |
| `config.item.continuous` | 500 | APN1-ConfigurationItemRecorded | 500 configuration items (assumed) | 1.50 | - | 1.50 |

- List subtotal: **USD 2.34** / month
- Subtotal after monthly free allowance: **USD 2.34** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `guardduty.cloudtrail.event`, `inspector.lambda.standard`, `config.item.continuous`

## Recovery: what staying restorable adds for a month (1 GB table, 10 GB of images)

ID: `recovery-keep` / chapter: [22 Backup: PITR, Snapshots, S3 Versioning, and AWS Backup](/en/chapters/22-recovery.md)

Assumptions:

- The default stack: a 1 GB table with point-in-time recovery enabled
- 10 GB of images, of which 1 GB a month is overwritten or deleted, each old version kept 30 days (computed as 1 GB for one month)
- Storage of the table and of the current images, requests, and Lambda are left out: this is only what is added

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.pitr.storage` | 1 | GB-Mo | 1 GB table under PITR, in GB-month | 0.23 | - | 0.23 |
| `s3.standard.storage` | 1 | GB-Mo | 1 GB of noncurrent versions, in GB-month | 0.03 | - | 0.03 |

- List subtotal: **USD 0.25** / month
- Subtotal after monthly free allowance: **USD 0.25** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`

## Recovery: one drill that restores and checks a 1 GB table

ID: `recovery-drill` / chapter: [22 Backup: PITR, Snapshots, S3 Versioning, and AWS Backup](/en/chapters/22-recovery.md)

Assumptions:

- One RestoreTableToPointInTime, restoring 1 GB of data
- Four checks (a strongly consistent Scan of the whole table), 262,144 read request units each, counting 1 GB as 4 KB items
- Includes storage for the restored table (1 GB) if it is left in place for a month
- S3 listing and restore requests, Lambda, and logs are left out

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.restore` | 1 | GB | 1 GB restored | 0.17 | - | 0.17 |
| `dynamodb.read.on-demand` | 1,048,576 | ReadRequestUnits | 4 full scans x 262,144 read request units | 0.15 | - | 0.15 |
| `dynamodb.storage` | 1 | GB-Mo | the restored table, 1 GB for a month | 0 | - | 0 |

- List subtotal: **USD 0.32** / month
- Subtotal after monthly free allowance: **USD 0.32** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `dynamodb.restore`

## Recovery: what `-c backup=on` adds (AWS Backup, 1 GB table)

ID: `recovery-backup-optin` / chapter: [22 Backup: PITR, Snapshots, S3 Versioning, and AWS Backup](/en/chapters/22-recovery.md)

Assumptions:

- One snapshot a day, kept 7 days: seven are in warm storage at any time
- Each snapshot is assumed to be billed as the whole table (1 GB); whether they are incremental was not confirmed
- No restore

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `backup.dynamodb.warm` | 7 | GB-month | 7 snapshots x 1 GB, in GB-month | 0.80 | - | 0.80 |

- List subtotal: **USD 0.80** / month
- Subtotal after monthly free allowance: **USD 0.80** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `backup.dynamodb.warm`

## Recovery: what `-c replica=on` adds (S3 Replication, 10 GB of images)

ID: `recovery-replica-optin` / chapter: [22 Backup: PITR, Snapshots, S3 Versioning, and AWS Backup](/en/chapters/22-recovery.md)

Assumptions:

- The destination holds 10 GB of images placed after replication was enabled, and 1 GB of old versions
- 10,000 objects are replicated in the month; a replication PUT is computed at the ordinary PUT price (Tier 1)
- Replication within one Region; no data transfer is included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `s3.standard.storage` | 11 | GB-Mo | the second copy: 10 GB current + 1 GB noncurrent, in GB-month | 0.28 | - | 0.28 |
| `s3.request.tier1` | 10,000 | Requests | 10,000 replication PUT requests | 0.05 | - | 0.05 |

- List subtotal: **USD 0.32** / month
- Subtotal after monthly free allowance: **USD 0.32** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `s3.request.tier1`

## EC2: a month running in a private subnet

ID: `ec2-private-running` / chapter: [23 VM: EC2, SSM, EBS, and Process Management](/en/chapters/23-ec2.md)

Assumptions:

- The default layout: one t4g.micro running for 730 hours
- Three interface endpoints (ssm, ssmmessages, ec2messages) in two zones, left in the chapter 11 stack
- The root volume is assumed to be 8 GiB (the AMI decides; the real size was not checked). The data volume is 8 GiB. Both are gp3 within the IOPS and throughput that carry no extra charge
- CPU credits are in standard mode, so nothing is billed for use above the baseline
- Session Manager and Run Command have no additional charge on EC2 instances
- Data transfer, snapshots, and the S3 bucket for releases (a few files under 1 MB) are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-micro.linux.hour` | 730 | Hrs | 1 t4g.micro x 730 hours | 7.88 | - | 7.88 |
| `ebs.gp3.storage` | 16 | GB-Mo | 8 GiB root (assumed) + 8 GiB data, 730 of 730 hours | 1.54 | - | 1.54 |
| `vpc.endpoint.interface.hour` | 4,380 | Hrs | 3 interface endpoints x 2 zones x 730 hours | 61.32 | - | 61.32 |

- List subtotal: **USD 70.74** / month
- Subtotal after monthly free allowance: **USD 70.74** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ec2.t4g-micro.linux.hour`, `ebs.gp3.storage`

## EC2: a month stopped in a private subnet

ID: `ec2-private-stopped` / chapter: [23 VM: EC2, SSM, EBS, and Process Management](/en/chapters/23-ec2.md)

Assumptions:

- The instance stopped for 730 hours. The volumes and the interface endpoints in the chapter 11 stack remain
- The root volume is assumed to be 8 GiB (the AMI decides; the real size was not checked). The data volume is 8 GiB. Both are gp3 within the IOPS and throughput that carry no extra charge
- CPU credits are in standard mode, so nothing is billed for use above the baseline
- Session Manager and Run Command have no additional charge on EC2 instances
- Data transfer, snapshots, and the S3 bucket for releases (a few files under 1 MB) are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ebs.gp3.storage` | 16 | GB-Mo | 8 GiB root (assumed) + 8 GiB data, 730 of 730 hours | 1.54 | - | 1.54 |
| `vpc.endpoint.interface.hour` | 4,380 | Hrs | 3 interface endpoints x 2 zones x 730 hours | 61.32 | - | 61.32 |

- List subtotal: **USD 62.86** / month
- Subtotal after monthly free allowance: **USD 62.86** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ebs.gp3.storage`

## EC2: a month running in a public subnet

ID: `ec2-public-running` / chapter: [23 VM: EC2, SSM, EBS, and Process Management](/en/chapters/23-ec2.md)

Assumptions:

- `-c placement=public`: one t4g.micro running for 730 hours with one auto-assigned public IPv4 address
- No interface endpoints
- The root volume is assumed to be 8 GiB (the AMI decides; the real size was not checked). The data volume is 8 GiB. Both are gp3 within the IOPS and throughput that carry no extra charge
- CPU credits are in standard mode, so nothing is billed for use above the baseline
- Session Manager and Run Command have no additional charge on EC2 instances
- Data transfer, snapshots, and the S3 bucket for releases (a few files under 1 MB) are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ec2.t4g-micro.linux.hour` | 730 | Hrs | 1 t4g.micro x 730 hours | 7.88 | - | 7.88 |
| `ebs.gp3.storage` | 16 | GB-Mo | 8 GiB root (assumed) + 8 GiB data, 730 of 730 hours | 1.54 | - | 1.54 |
| `vpc.public-ipv4.in-use.hour` | 730 | Hrs | 1 public IPv4 address x 730 hours | 3.65 | - | 3.65 |

- List subtotal: **USD 13.07** / month
- Subtotal after monthly free allowance: **USD 13.07** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `vpc.public-ipv4.in-use.hour`, `ec2.t4g-micro.linux.hour`, `ebs.gp3.storage`

## EC2: a month stopped in a public subnet

ID: `ec2-public-stopped` / chapter: [23 VM: EC2, SSM, EBS, and Process Management](/en/chapters/23-ec2.md)

Assumptions:

- The `-c placement=public` instance stopped for 730 hours. Its auto-assigned public IPv4 address is released on stop. No Elastic IP address is used
- The root volume is assumed to be 8 GiB (the AMI decides; the real size was not checked). The data volume is 8 GiB. Both are gp3 within the IOPS and throughput that carry no extra charge
- CPU credits are in standard mode, so nothing is billed for use above the baseline
- Session Manager and Run Command have no additional charge on EC2 instances
- Data transfer, snapshots, and the S3 bucket for releases (a few files under 1 MB) are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ebs.gp3.storage` | 16 | GB-Mo | 8 GiB root (assumed) + 8 GiB data, 730 of 730 hours | 1.54 | - | 1.54 |

- List subtotal: **USD 1.54** / month
- Subtotal after monthly free allowance: **USD 1.54** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ebs.gp3.storage`

## Ledger: deployed, with nothing appended for a month

ID: `ledger-idle` / chapter: [58 Ledger: QLDB Today, and an Append-Only Ledger You Can Verify](/en/chapters/58-ledger.md)

Assumptions:

- The default stack. 1,000 entries in the ledger, under 1 MB in the table. One digest exists and nothing new is appended
- The digest function runs once an hour, 730 times a month. Each run lists the versions once, fetches the newest digest once, and sends one strongly consistent Query to the table (4 KB or less). With nothing appended it sends no PutObject
- The function is assumed to take 0.5 s at 256 MB (not measured). 300 bytes of log per run
- The hourly rule's own invocations are left out: which line of the price list they fall under was not confirmed

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.storage` | 0.001 | GB-Mo | 1 MB in the table, in GB-month | 0 | - | 0 |
| `dynamodb.read.on-demand` | 730 | ReadRequestUnits | 730 runs, one strongly consistent Query of 4 KB or less each: 1 unit | 0.000104 | - | 0.000104 |
| `s3.request.tier1` | 730 | Requests | 730 ListObjectVersions requests | 0.003431 | - | 0.003431 |
| `s3.request.tier2` | 730 | Requests | 730 GetObject requests for the newest digest | 0.000270 | - | 0.000270 |
| `s3.standard.storage` | 0 | GB-Mo | One digest of about 150 bytes, rounded up to 1 KB | 0.000000 | - | 0.000000 |
| `lambda.request.arm` | 730 | Requests | 730 scheduled invocations | 0.000146 | 1,000,000 | 0 |
| `lambda.duration.arm` | 91.25 | Lambda-GB-Second | 730 x 0.5 s x 0.25 GB | 0.001217 | 400,000 | 0 |
| `logs.ingest.standard` | 0 | GB | 730 x 300 bytes | 0.000167 | 5 | 0 |

- List subtotal: **USD 0.01** / month
- Subtotal after monthly free allowance: **USD 0.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `s3.request.tier1`, `s3.request.tier2`

## Ledger: 100,000 entries appended in a month

ID: `ledger-month` / chapter: [58 Ledger: QLDB Today, and an Append-Only Ledger You Can Verify](/en/chapters/58-ledger.md)

Assumptions:

- 100,000 appends a month. An entry is about 300 bytes, under 1 KB. One append is one strongly consistent Query for the tail (1 unit) and one write (1 unit). Whether a PartiQL INSERT is billed in the same units as PutItem was not confirmed. No retries from two writers taking the same number
- 730 hourly digests. Each reads the 137 new entries (about 41 KB) with strong consistency: 11 units. On S3: one version listing, one fetch of the newest digest, one PutObject. The listing fits in one page for the month
- One full audit a month: 7,500 units to read 100,000 entries (30 MB), 730 digest fetches and one listing
- The function is assumed to take 0.5 s at 256 MB (not measured). 300 bytes of log per run. 30 MB in the table, under 1 MB of digests

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
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

- List subtotal: **USD 0.10** / month
- Subtotal after monthly free allowance: **USD 0.10** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `s3.request.tier1`, `s3.request.tier2`

## ECR: the stack deployed, and not one image, for a month

ID: `ecr-idle` / chapter: [52 ECR: Tags and Digests, Lifecycle, Scanning, Replication, and Pull-Through Cache](/en/chapters/52-ecr.md)

Assumptions:

- AihEcr deployed with its defaults: the repository alone
- No image was pushed: nothing is stored

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ecr.storage` | 0 | GB-Mo | 0 GB stored | 0 | - | 0 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ecr.storage`

## ECR: as full as the lifecycle policy lets it get

ID: `ecr-kept` / chapter: [52 ECR: Tags and Digests, Lifecycle, Scanning, Replication, and Pull-Through Cache](/en/chapters/52-ecr.md)

Assumptions:

- The policy keeps 20 releases and the 30 newest images: 50 if none overlap
- 0.15 GB assumed per image (no image was built, so this is not measured). How layers shared between images count toward storage was not confirmed, so every image is counted in full
- Pulls come from Fargate in the same Region, so data transfer is USD 0

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ecr.storage` | 7.5 | GB-Mo | 50 images x 0.15 GB | 0.75 | - | 0.75 |

- List subtotal: **USD 0.75** / month
- Subtotal after monthly free allowance: **USD 0.75** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ecr.storage`

## ECR: the monthly charge after a year without a lifecycle policy

ID: `ecr-unpruned` / chapter: [52 ECR: Tags and Digests, Lifecycle, Scanning, Replication, and Pull-Through Cache](/en/chapters/52-ecr.md)

Assumptions:

- Five pushes each working day and nothing deleted: 20 days a month for 12 months, 1,200 images
- 0.15 GB assumed per image (no image was built, so this is not measured). How layers shared between images count toward storage was not confirmed, so every image is counted in full
- One month at the end of that year, not the sum of the months before

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `ecr.storage` | 180 | GB-Mo | 1,200 images x 0.15 GB | 18.00 | - | 18.00 |

- List subtotal: **USD 18.00** / month
- Subtotal after monthly free allowance: **USD 18.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `ecr.storage`

## ECR: a month with enhanced scanning on

ID: `ecr-enhanced-scan` / chapter: [52 ECR: Tags and Digests, Lifecycle, Scanning, Replication, and Pull-Through Cache](/en/chapters/52-ecr.md)

Assumptions:

- 100 pushes a month, each scanned once initially
- The 50 images kept are assumed to be re-scanned four times a month each. How often a re-scan happens depends on new vulnerabilities being published; this number has no basis
- Inspector's free trial is not deducted

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `inspector.image.initial-scan` | 100 | Resource-assessment | 100 pushes | 11.00 | - | 11.00 |
| `inspector.image.rescan` | 200 | Resource-assessment | 50 images x 4 re-scans (assumption) | 2.00 | - | 2.00 |

- List subtotal: **USD 13.00** / month
- Subtotal after monthly free allowance: **USD 13.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `inspector.image.initial-scan`, `inspector.image.rescan`

## ECR: a month's data transfer when replicating to Osaka

ID: `ecr-replicate-osaka` / chapter: [52 ECR: Tags and Digests, Lifecycle, Scanning, Replication, and Pull-Through Cache](/en/chapters/52-ecr.md)

Assumptions:

- 100 pushes a month, all replicated to Osaka
- 0.15 GB assumed per image (no image was built, so this is not measured). How layers shared between images count toward storage was not confirmed, so every image is counted in full
- Storage in Osaka is not included (its unit price was not checked)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `datatransfer.tokyo-osaka` | 15 | GB | 100 images x 0.15 GB | 1.35 | - | 1.35 |

- List subtotal: **USD 1.35** / month
- Subtotal after monthly free allowance: **USD 1.35** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `datatransfer.tokyo-osaka`

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

Allowances that could not be confirmed (treated as unknown, not as zero; nothing is deducted):

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
