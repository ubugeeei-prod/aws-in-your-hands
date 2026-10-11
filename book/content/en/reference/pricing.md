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
- Prices whose free allowance could not be confirmed (nothing deducted): `s3.standard.storage`, `s3.request.tier1`, `s3.request.tier2`

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

## Network: add one NAT gateway

ID: `network-nat-single` / chapter: [11 The Network You Actually Need: VPC, Subnets, NAT, and Endpoints](/en/chapters/11-network.md)

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

ID: `network-nat-per-az` / chapter: [11 The Network You Actually Need: VPC, Subnets, NAT, and Endpoints](/en/chapters/11-network.md)

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

ID: `network-interface-endpoints` / chapter: [11 The Network You Actually Need: VPC, Subnets, NAT, and Endpoints](/en/chapters/11-network.md)

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

## Notification mail: deployed, but nothing sent for a month

ID: `email-idle` / chapter: [15 Send Email: SES](/en/chapters/15-email.md)

Assumptions:

- No mail sent, no events
- 10 MB of records in the table (suppressions and unexpired notification records)

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `dynamodb.storage` | 0.01 | GB-Mo | 10 MB stored, in GB-month | 0 | - | 0 |

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Notification mail: 10,000 messages a month

ID: `email-small` / chapter: [15 Send Email: SES](/en/chapters/15-email.md)

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

ID: `edge-small` / chapter: [10 Understand the Edge: CloudFront Functions, KeyValueStore, and Lambda@Edge](/en/chapters/10-edge.md)

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

## Aurora DSQL: 1 GB of data and no queries for a month

ID: `sql-dsql-idle` / chapter: [13 SQL Development for D1 Users: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2](/en/chapters/13-sql.md)

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

ID: `sql-dsql-small` / chapter: [13 SQL Development for D1 Users: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2](/en/chapters/13-sql.md)

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

ID: `sql-rds-min` / chapter: [13 SQL Development for D1 Users: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2](/en/chapters/13-sql.md)

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

ID: `sql-aurora-min` / chapter: [13 SQL Development for D1 Users: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2](/en/chapters/13-sql.md)

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

ID: `sql-aurora-paused` / chapter: [13 SQL Development for D1 Users: Aurora DSQL, RDS PostgreSQL, and Aurora Serverless v2](/en/chapters/13-sql.md)

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

## Image attachments: 10,000 uploads and 100,000 views a month

ID: `uploads-small` / chapter: [07 Upload Images: Presigned URLs and S3](/en/chapters/07-uploads.md)

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

## SSR: deployed, but nobody visits for a month

ID: `ssr-idle` / chapter: [09 SSR and a BFF: Nuxt on Regional Lambda](/en/chapters/09-ssr.md)

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

ID: `ssr-small` / chapter: [09 SSR and a BFF: Nuxt on Regional Lambda](/en/chapters/09-ssr.md)

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

## Observed notes API: deployed, but never called for a month

ID: `obs-idle` / chapter: [19 See Production Behavior: CloudWatch, OpenTelemetry, RUM, and Synthetics](/en/chapters/19-observability.md)

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

ID: `obs-small` / chapter: [19 See Production Behavior: CloudWatch, OpenTelemetry, RUM, and Synthetics](/en/chapters/19-observability.md)

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

ID: `obs-one-more-line` / chapter: [19 See Production Behavior: CloudWatch, OpenTelemetry, RUM, and Synthetics](/en/chapters/19-observability.md)

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

ID: `obs-one-more-metric` / chapter: [19 See Production Behavior: CloudWatch, OpenTelemetry, RUM, and Synthetics](/en/chapters/19-observability.md)

Assumptions:

- One custom metric without dimensions, receiving data points every hour for a month
- With dimensions, every distinct combination of values counts as one metric

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.metric.custom` | 1 | Metrics | 1 metric for a full month | 0.30 | 10 | 0 |

- List subtotal: **USD 0.30** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Synthetics: one canary every 5 minutes

ID: `obs-canary-5min` / chapter: [19 See Production Behavior: CloudWatch, OpenTelemetry, RUM, and Synthetics](/en/chapters/19-observability.md)

Assumptions:

- 730 hours x 12 runs an hour = 8,760 runs
- The Lambda, S3, log and metric charges a canary incurs are not included

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.synthetics.run` | 8,760 | Runs | 730 h x 12 runs | 16.64 | 100 | 16.45 |

- List subtotal: **USD 16.64** / month
- Subtotal after monthly free allowance: **USD 16.45** / month

## RUM: 10,000 visits a month, all collected

ID: `obs-rum-small` / chapter: [19 See Production Behavior: CloudWatch, OpenTelemetry, RUM, and Synthetics](/en/chapters/19-observability.md)

Assumptions:

- 20 events per visit (the number in the pricing page's example), 100% of sessions collected
- The one-time free trial of 1 million events is not deducted

| Price ID | Quantity | Unit | Basis | List | Free allowance | After allowance |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| `cloudwatch.rum.event` | 200,000 | Events | 10,000 visits x 20 events | 2.00 | - | 2.00 |

- List subtotal: **USD 2.00** / month
- Subtotal after monthly free allowance: **USD 2.00** / month
- Prices whose free allowance could not be confirmed (nothing deducted): `cloudwatch.rum.event`

## KV and cache: the default stack (DynamoDB), deployed but never called for a month

ID: `kv-idle-dynamodb` / chapter: [14 Choose a Key-Value Store or Cache: DynamoDB, ElastiCache/Valkey, and Edge Configuration](/en/chapters/14-kv-cache.md)

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

ID: `kv-idle-valkey-serverless` / chapter: [14 Choose a Key-Value Store or Cache: DynamoDB, ElastiCache/Valkey, and Edge Configuration](/en/chapters/14-kv-cache.md)

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

ID: `kv-idle-valkey-node` / chapter: [14 Choose a Key-Value Store or Cache: DynamoDB, ElastiCache/Valkey, and Edge Configuration](/en/chapters/14-kv-cache.md)

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

ID: `kv-used-dynamodb` / chapter: [14 Choose a Key-Value Store or Cache: DynamoDB, ElastiCache/Valkey, and Edge Configuration](/en/chapters/14-kv-cache.md)

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

ID: `kv-used-valkey` / chapter: [14 Choose a Key-Value Store or Cache: DynamoDB, ElastiCache/Valkey, and Edge Configuration](/en/chapters/14-kv-cache.md)

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

## Shipping: the stack and the CI roles in place, nobody calling for a month

ID: `ship-idle` / chapter: [20 Ship Changes: CI/CD, OIDC, Environments, Previews, Rollback, and Drift](/en/chapters/20-shipping.md)

Assumptions:

- No requests to the API; logs have expired and nothing is stored
- CloudFormation adds no charge for AWS:: resource types; IAM roles and the OIDC provider are part of IAM, at no additional charge
- No deploys and no drift detection
- GitHub Actions charges are not an AWS bill and are not included

- List subtotal: **USD 0.00** / month
- Subtotal after monthly free allowance: **USD 0.00** / month

## Shipping: one deploy a day for a year, assets never cleaned up

ID: `ship-assets-year` / chapter: [20 Ship Changes: CI/CD, OIDC, Environments, Previews, Rollback, and Drift](/en/chapters/20-shipping.md)

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

## Containers: the repository alone (deployed without an image tag)

ID: `containers-repository-only` / chapter: [12 Run Containers: ECR, ECS/Fargate, and ALB](/en/chapters/12-containers.md)

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

ID: `containers-idle` / chapter: [12 Run Containers: ECR, ECS/Fargate, and ALB](/en/chapters/12-containers.md)

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

ID: `containers-one-day` / chapter: [12 Run Containers: ECR, ECS/Fargate, and ALB](/en/chapters/12-containers.md)

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

ID: `containers-small` / chapter: [12 Run Containers: ECR, ECS/Fargate, and ALB](/en/chapters/12-containers.md)

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

ID: `containers-private-nat` / chapter: [12 Run Containers: ECR, ECS/Fargate, and ALB](/en/chapters/12-containers.md)

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

ID: `containers-private-endpoints` / chapter: [12 Run Containers: ECR, ECS/Fargate, and ALB](/en/chapters/12-containers.md)

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

## Asynchronous inspection and housekeeping: deployed, with no images, for a month

ID: `async-idle` / chapter: [08 Move Work off the Request: SQS, DLQs, Idempotency, and Scheduler](/en/chapters/08-async.md)

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

ID: `async-pipeline-small` / chapter: [08 Move Work off the Request: SQS, DLQs, Idempotency, and Scheduler](/en/chapters/08-async.md)

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

ID: `async-housekeeping-10k` / chapter: [08 Move Work off the Request: SQS, DLQs, Idempotency, and Scheduler](/en/chapters/08-async.md)

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

## EC2: a month running in a private subnet

ID: `ec2-private-running` / chapter: [23 EC2 When You Want Control: SSM, EBS, and Process Management](/en/chapters/23-ec2.md)

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

ID: `ec2-private-stopped` / chapter: [23 EC2 When You Want Control: SSM, EBS, and Process Management](/en/chapters/23-ec2.md)

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

ID: `ec2-public-running` / chapter: [23 EC2 When You Want Control: SSM, EBS, and Process Management](/en/chapters/23-ec2.md)

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

ID: `ec2-public-stopped` / chapter: [23 EC2 When You Want Control: SSM, EBS, and Process Management](/en/chapters/23-ec2.md)

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

## Long jobs: deployed, with no notes at all, for a month

ID: `export-idle` / chapter: [16 Run Longer Jobs: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch](/en/chapters/16-long-jobs.md)

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

ID: `export-daily-10k-coarse` / chapter: [16 Run Longer Jobs: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch](/en/chapters/16-long-jobs.md)

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

ID: `export-daily-10k-fine` / chapter: [16 Run Longer Jobs: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch](/en/chapters/16-long-jobs.md)

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

ID: `export-daily-10k-durable` / chapter: [16 Run Longer Jobs: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch](/en/chapters/16-long-jobs.md)

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

ID: `export-step-fargate-1h` / chapter: [16 Run Longer Jobs: ECS Tasks, Step Functions, Lambda Durable Functions, and AWS Batch](/en/chapters/16-long-jobs.md)

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

Allowances that could not be confirmed (treated as unknown, not as zero; nothing is deducted):

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
