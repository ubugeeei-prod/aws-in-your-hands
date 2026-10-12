---
title: "27 Search: Costs, Pitfalls, and Cleanup"
---

# 27 Search: Costs, Pitfalls, and Cleanup

With the [deploy](/en/chapters/27-search/deploy.md) done, this page compares the same job on Cloudflare and Vercel, works out the cost, and cleans up what you built.

## On Cloudflare and Vercel

<!-- section: 27.compare -->

Cloudflare has products for both layers of this chapter. What follows was checked against the official documentation on 2026-10-13.

Vectorize is a vector database, the counterpart of S3 Vectors. You call it from Workers or over an HTTP API. Billing is by the number of vector dimensions stored and the number queried, and Workers Paid includes 10 million stored and 50 million queried dimensions each month. The documentation states that there is no charge for active hours or for the number of indexes. Having no charge for merely existing is something it shares with S3 Vectors.

There are differences too. A Vectorize vector has at most 1,536 dimensions, and one query returns at most 100 results (50 if it returns metadata). To filter on metadata you have to create a metadata index for the property you filter on before you insert vectors. Creating it later does nothing for vectors already in the index. In S3 Vectors, metadata is filterable without any setup. Vectorize also has namespaces, which separate vectors inside one index.

AI Search takes over ingestion, cutting, embedding, and searching, and corresponds to the managed kind of Bedrock knowledge base. Hybrid search, which combines meaning and words, is on by default. The merging of rankings that this chapter wrote by hand is part of the product. Billing is said to begin on 2026-11-01, with unit prices applying beyond a monthly allowance (5 million ingestion tokens, 10 GB of storage, 1,000 semantic queries, 1,000 full-text queries). Custom metadata is limited to 5 fields per instance. What it can ingest from was not checked.

Vercel has no vector database and no search product of its own. Its storage guide points to Marketplace providers (Neon, Upstash, Supabase, and others) for vector databases. You write the model calls with the AI SDK, and the storage is whatever provider you chose.

This chapter's configuration cannot be called better than Cloudflare's or Vercel's. Getting from "here are my documents" to "they can be searched" takes far fewer steps with AI Search, and the merging of words and meaning comes ready-made. If your application is on Cloudflare and the documents you want to search can go into AI Search, using it is the short way.

What this chapter gives you is parts you can see. Which text is copied where, and what comes back to whose search, are decided by your own code and tests. If your notes are in DynamoDB and you want to prove the separation of owners yourself, this shape makes sense. The price is that the stream, the indexer, the queue, and the rebuild procedure are yours to own.

## Cost

<!-- section: 27.cost -->

Amounts are in USD, for the Tokyo Region, pay-as-you-go, before tax. Unit prices are from the AWS Price List (checked 2026-10-13), and the details of the calculation are in [Pricing calculations](/en/reference/pricing.md).

**A month in which the stack is deployed and nothing is written or searched costs USD 0.00.** Assuming 1,000 indexed notes and 2,000 vectors, S3 Vectors stores about 8 MB, which costs USD 0.0005 (0.008011 GB × 0.066). To two decimal places that is 0. Lambda, the function URL, the stream, and an empty queue cost nothing for existing. The DynamoDB storage is inside its 25 GB free tier.

Here is the same month with a search engine kept around.

| Configuration | Cost of a month of doing nothing | Basis |
| --- | --- | --- |
| This chapter (S3 Vectors and Lambda) | 0.00 | Storage only |
| OpenSearch Serverless, Classic, default redundancy | 487.64 | 2 OCUs × 730 hours × 0.334 |
| OpenSearch Serverless, Classic, no standby replicas | 243.82 | 1 OCU × 730 hours × 0.334 |
| OpenSearch Serverless, NextGen | unknown | OCUs are said to shrink to 0. Availability and price in Tokyo not confirmed |
| Bedrock managed knowledge base | 0.01 | 2 MB × 5.00 per GB a month. The pricing page's figure, with no Region named |

The two Classic rows do not include storage.

The cost of use is worked out for a month with 1,000 writes and 10,000 searches, of which 1,000 go on to an answer.

| Item | Quantity | List price | After the monthly free allowance |
| --- | --- | --- | --- |
| S3 Vectors storage | 0.008 GB | 0.00 | 0.00 |
| Writes to S3 Vectors | 0.122 GB | 0.03 | 0.03 |
| Queries to S3 Vectors | 10,000 | 0.03 | 0.03 |
| Data processed by queries | 80.1 GB | 0.00 | 0.00 |
| Titan embeddings | 1.1 million tokens | 0.03 | 0.03 |
| Nova 2 Lite input | 2.5 million tokens | 0.99 | 0.99 |
| Nova 2 Lite output | 150,000 tokens | 0.50 | 0.50 |
| DynamoDB writes | 2,000 units | 0.00 | 0.00 |
| DynamoDB reads | 30,000 units | 0.00 | 0.00 |
| Lambda requests | 11,000 | 0.00 | 0 |
| Lambda duration | 2,375 GB-seconds | 0.03 | 0 |
| CloudWatch Logs ingestion | 0.01 GB | 0.01 | 0 |
| Subtotal | | **1.62** | **1.58** |

No free allowance could be confirmed for the S3 Vectors and Bedrock rows, so nothing is deducted from them.

Most of the cost is the model that writes answers (USD 1.49). Searching and indexing alone come to USD 0.13 a month. The money goes less into searching than into having a model read what the search found. The 2,500 input tokens assumed per answer come from handing over up to four passages, and more passages raise that row in proportion.

Keep in mind that many of the assumptions were not checked. How many tokens a Japanese note takes was not measured. 400 tokens per passage and 30 per query are values that were picked. The real numbers are in the `embedded` log lines and in the `usage` of an answer.

S3 Vectors pricing has two properties that are hard to read off the table.

A write is billed for at least 128 KB per `PutVectors` call. This chapter makes one call per changed note, so every write of a few kilobytes of vectors pays for 128 KB. The write row in the table above is calculated at that minimum. When you put in a large amount at once, batching up to 500 vectors per call lowers the cost a great deal.

The data a query processes is determined by the size of the whole index. Filtering by owner does not keep everyone else's vectors out of the calculation. At 2,000 vectors the amount is negligible, but as the index grows, the cost of each query grows with it. With an index per owner, the data processed would be that owner's alone.

Data transfer and the bytes that queries return are not in the table. That means not included, not zero. The data a query returns is said to be free up to 512 KB per query, and this chapter's queries return only 30 keys with short metadata, which should fit within that.

Deleting the stack stops what this chapter costs.

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| `dev:search` stops with `Invalid environment` | Check that `examples/27-search/.env` exists. `SEARCH_BACKEND` has no default |
| A search gets a 401 | The `x-notes-owner` header is missing or contains characters that are not allowed |
| The function URL answers 403 | The request is not signed, or the caller lacks `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` |
| A note is found by words but not by meaning | Indexing has not caught up, or the distance is farther than the threshold. See whether `vp run search:logs -- --indexer` has an `indexed` line and whether `vp run search:reindex` reports no difference |
| `meaning` in the response is `unavailable` | The embedding or the query failed. The search log does not give the cause. Check that the execution role can call Titan and the index, and that Bedrock is not throttling |
| `dropped` in the search log is not 0 | The index and the table are out of step. The results returned are still right. Bring them together with `vp run search:reindex -- --apply` |
| The dead-letter queue has messages | There are changes the indexer could not apply even after retrying. Find the cause in `indexing failed` in the indexer's log, fix it, then run `search:reindex -- --apply` |
| The deploy fails while creating the index | The route by which cdkd creates `AWS::S3Vectors::Index` through the Cloud Control API was not confirmed. Read the error |
| `unknownCitations` in an answer is not empty | The model cited a number it was not given. That is a reason to doubt the answer |

## For production

- Decide the owner from a verified token, not from a header. Verify the access token from chapter 06 and return its `sub` from `ownerOf`. Of everything in this chapter, change this first
- Set the threshold and the passage length again on real notes. Neither 0.7 nor 800 characters was tuned. Prepare pairs of "the note that should be found" from your own data and compare different values
- Put an alarm on the dead-letter queue. A single message means a change that does not show up in search. Watch the queue's length the way chapter 19 shows
- Measure indexing lag. The time from writing a note to finding it by meaning was never measured in this chapter
- Check your Bedrock quotas. The documentation says embedding models are limited by requests per minute. This chapter's indexer makes one call per passage, so a large rebuild hits that limit first. The value in the Tokyo Region was not checked
- When a note is deleted, make sure its vectors are gone too. If you are obliged to delete personal data, the index, being a copy, is in scope. This chapter's index holds no text, but the vectors were made from the original text
- Add a limit per user. As in chapter 17, one person asking ten thousand questions costs ten thousand questions
- If you lift the limit on the number of notes, rebuild the word search. The word search in this chapter works because an owner has at most 100 notes
- Deploy through the AWS CDK CLI and CloudFormation, as chapter 02 explains

## As a distributed system

The table owns the state. The index is a copy that can be computed from the table, and it lags, has gaps, and has leftovers. The design of this chapter was to make a wrong copy harmless.

The invariant is "a search never returns another owner's note". It is upheld by always reading the text that is returned from the table, with the calling owner's key. The filter in the index is only the first of two checks.

The lag of the copy cannot be removed. A note that was just rewritten cannot be found by meaning until indexing catches up. Between finding it by its old content and not finding it, this chapter chose not finding it. The word search reads the table, so a way to find it by its new content remains.

Delivery is at least once, and changes to the same note keep their order. The indexing operations give the same result when applied twice, so duplicates do no harm. The order breaks only in a rebuild, which writes from outside the stream, and there the note is read again after the write.

## Cleanup

<!-- section: 27.cleanup -->

```bash
vp run search:infra:destroy
```

This deletes the table and its notes, the index and its vectors, the vector bucket, both functions, the function URL, the queue, the roles, and the log groups.

The CloudFormation reference says a vector bucket that is not empty cannot be deleted. This stack deletes the index first, so the bucket should be empty by then, but that cdkd can delete an index that holds vectors was not confirmed. If the delete stops partway, look for `aih-search-notes` under "Vector buckets" in the S3 console.

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it. This chapter created no resource on the Bedrock side.

::: details Verification notes for this chapter

**Checked locally.** On 2026-10-13 the unit tests (9 files, 80 tests), the type check, and synth (including the esbuild bundles, 14 resources) were run. `dev:search` was started with `SEARCH_BACKEND=local`, and the `curl` commands on [Run It Locally](/en/chapters/27-search/local.md) were run against it. The output shown there is from that run. That the invariant tests really catch a failure was checked by removing the version check from the search, which fails one test, and by removing the delete from the indexer, which fails two. In the installed packages the following was checked. `aws-cdk-lib` 2.273.0 has `CfnVectorBucket` and `CfnIndex`. The commands and the input and output types of `@aws-sdk/client-s3vectors` 3.1149.0. The pinned cdkd (0.296.28) has its own implementation for `AWS::DynamoDB::Table`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::EventSourceMapping`, `AWS::Lambda::Function`, `AWS::Lambda::Url`, `AWS::Logs::LogGroup`, `AWS::S3Vectors::VectorBucket`, and `AWS::SQS::Queue`. It has none for `AWS::S3Vectors::Index`, which goes through the Cloud Control API. What was read is the bundled files in the npm package, not `src/provisioning/register-providers.ts` itself.

**Not checked yet.** This chapter was never deployed to AWS. Titan embeddings, S3 Vectors, and the answering model were never called for real. `search:infra:deploy`, `search:seed`, `search:smoke`, `search:reindex`, `search:logs`, `search:infra:drift`, `search:infra:destroy`, and `dev:search` with `SEARCH_BACKEND=aws` were not run. These points in particular wait for a check in a real environment.

- That cdkd 0.296.28 can create and delete `AWS::S3Vectors::Index` through the Cloud Control API
- That Titan Text Embeddings V2 can be called from Tokyo and returns vectors of 1,024 dimensions. Only the model card and the request specification were read
- That real S3 Vectors responses fit the adapter's schema. That a query with the owner condition is accepted. That `PutVectors` replaces the same key. What `DeleteVectors` does with a key that does not exist
- That real DynamoDB Streams records fit the handler's schema. The records in the tests were written by hand from the documentation and the type definitions
- That the event source mapping's filter, partial failure reporting, retry limit, and delivery to the queue work as configured. What a message in the queue contains
- Whether the distance threshold (0.7) and the passage length (800 characters) suit Japanese notes. The number of tokens per Japanese character
- Indexing lag, and the response times of search and answers. Nothing was measured
- Whether OpenSearch Serverless NextGen is available in the Tokyo Region, whether its price equals Classic's, and how long it takes to come back from zero
- Whether the Bedrock managed knowledge base costs what the pricing page says in the Tokyo Region too
- Whether `dynamodb:ListStreams` can be narrowed to a single stream

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The whole picture, What to search with | `examples/27-search/infra/lib/search-stack.ts` | `search:infra:synth` |
| Finding by words | `examples/27-search/src/tokenize.ts`, `src/bm25.ts`, `test/ranking.test.ts` | `test:unit` |
| Cutting a note into passages | `examples/27-search/src/chunk.ts`, `test/chunk.test.ts` | `test:unit` |
| Embeddings | `examples/27-search/src/embedder.ts`, `src/bedrock-embedder.ts` | `test:unit` |
| The index | `examples/27-search/src/vector-index.ts`, `src/memory-vector-index.ts`, `src/s3-vectors-index.ts`, `test/s3-vectors-index.test.ts` | `test:unit` |
| Keeping in step with the table | `examples/27-search/src/indexer.ts`, `src/stream.ts`, `src/indexer-lambda.ts`, `test/indexer.test.ts` | `test:unit` |
| The search and its invariant | `examples/27-search/src/search.ts`, `src/fusion.ts`, `test/search.test.ts` | `test:unit` |
| Rebuilding from scratch | `examples/27-search/src/reconcile.ts`, `scripts/reindex.ts`, `test/reconcile.test.ts` | `test:unit`, `search:reindex` |
| Answering with citations | `examples/27-search/src/prompt.ts`, `src/answer.ts`, `src/app.ts`, `src/contract.ts`, `src/owner.ts`, `test/answer.test.ts`, `test/app.test.ts` | `test:unit` |
| Running it locally | `examples/27-search/src/dev.ts`, `src/local.ts`, `src/compose.ts`, `src/env.ts`, `fixtures/`, `.env.example` | `dev:search` |
| The stack | `examples/27-search/infra/lib/search-stack.ts`, `infra/bin/app.ts`, `infra/test/search-stack.test.ts`, `src/lambda.ts`, `src/aws-parts.ts` | `search:infra:synth`, `test:unit` |
| Deploying and checking | `examples/27-search/scripts/seed.ts`, `scripts/smoke.ts`, `scripts/sign.ts`, `scripts/logs.ts` | `search:infra:diff`, `search:infra:deploy`, `search:seed`, `search:smoke`, `search:logs`, `search:infra:drift` |
| Cost | `data/pricing/`, `tools/src/pricing/calc.ts` | `test:unit` |
| Cleanup | `tools/src/infra/` | `search:infra:destroy` |

**Primary sources** (all checked 2026-10-13)

- S3 Vectors: [Working with S3 Vectors and vector buckets](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors.html), [Limitations and restrictions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html), [Regions, endpoints, and quotas](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-regions-quotas.html), [Metadata filtering](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-metadata-filtering.html), [Best practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-best-practices.html), [Creating a vector index](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-create-index.html), [Identity and Access management](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-access-management.html)
- S3 Vectors API: [QueryVectors](https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_QueryVectors.html), [PutVectors](https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_PutVectors.html), [DeleteVectors](https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_DeleteVectors.html)
- CloudFormation: [AWS::S3Vectors::Index](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3vectors-index.html), [AWS::S3Vectors::VectorBucket](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3vectors-vectorbucket.html)
- OpenSearch Serverless: [What is Amazon OpenSearch Serverless?](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-overview.html), [Managing capacity limits](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-scaling.html), [Collection group capacity limits](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/collection-groups-capacity-limits.html), [Working with vector search collections](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-vector-search.html), [Endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/opensearch-service.html), [Amazon OpenSearch Service pricing](https://aws.amazon.com/opensearch-service/pricing/), [AWS News Blog (2026-05-28)](https://aws.amazon.com/blogs/aws/introducing-the-next-generation-of-amazon-opensearch-serverless-for-building-your-agentic-ai-applications/)
- Bedrock Knowledge Bases: [Overview](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html), [Build a managed knowledge base](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-build-managed.html), [Supported Regions](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-regions.html), [Vector stores](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-setup.html), [Data source connectors](https://docs.aws.amazon.com/bedrock/latest/userguide/data-source-connectors.html), [Custom data source](https://docs.aws.amazon.com/bedrock/latest/userguide/custom-data-source-connector.html), [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
- Embeddings: [Amazon Titan Text Embeddings models](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html), [Request and response](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-titan-embed-text.html), [Model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-titan-text-embeddings-v2.html)
- Streams: [Change data capture for DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html), [Using AWS Lambda with Amazon DynamoDB](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html), [Parameters](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-params.html), [Partial batch response](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-batchfailurereporting.html), [Event filtering](https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventfiltering.html)
- Pricing: [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/), [DynamoDB on-demand pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/), and the AWS Price List bulk API for [S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json), [OpenSearch Service](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonES/current/ap-northeast-1/index.json), and [Bedrock](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-northeast-1/index.json). The worked examples on the S3 pricing page use N. Virginia prices. This chapter's unit prices are the Tokyo rows of the Price List
- Cloudflare: [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/), [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/), [Vectorize metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/), [AI Search](https://developers.cloudflare.com/ai-search/), [AI Search limits and pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)
- Vercel: [Vercel Storage overview](https://vercel.com/docs/storage)
- Installed packages: [@aws-sdk/client-s3vectors 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-s3vectors/v/3.1149.0), [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
