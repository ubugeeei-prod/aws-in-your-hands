---
title: "27 Search: Deploy"
---

# 27 Search: Deploy

Here the search you [ran locally](/en/chapters/27-search/local.md) goes onto AWS. The page looks at the definitions in order (the table, the index, the indexer, the search function) and then at the steps to deploy. This chapter was never deployed to AWS, so the steps are prepared, not a record of a run.

## The stack

<!-- section: 27.stack -->

Nothing in this stack is billed by the hour. There is no NAT gateway, no load balancer, no container or database that is always running. Everything is billed by use.

### The table

<<< @/examples/27-search/infra/lib/search-stack.ts{table}

It is chapter 05's table with `stream` added. `NEW_AND_OLD_IMAGES` puts the item both before and after the change into each record. The indexer embeds the item after the change, and works out which passages to delete from the item before it.

The read limit is raised from chapter 05's 150 to 400. One search reads all of an owner's notes, and reading the maximum, 100 notes or about 3 MB, takes 375 units.

The table in chapter 05's stack is not used. Adding a stream to it would mean changing chapter 05's stack, and that would break this book's promise that each chapter can be created and deleted by itself. In a real application there is one notes table, and the stream goes on that one.

### The vector bucket and the index

<<< @/examples/27-search/infra/lib/search-stack.ts{vectors}

S3 Vectors resources come in two levels: an index is created inside a vector bucket. A vector bucket is a different kind of resource from an ordinary S3 bucket. Its name has to be unique within the account and Region, not worldwide. Public access is always blocked and cannot be opened.

The index's `dimension` must equal the dimension the embedding model returns. The adapter and the stack both use the same constant (`EMBEDDING_DIMENSIONS`). The data type, the dimension, and the distance metric cannot be changed after creation. In the CloudFormation reference, changing any of them replaces the index, which means its contents are gone.

`aws-cdk-lib` 2.273.0 has no L2 construct for S3 Vectors, so the stack uses the L1 `CfnVectorBucket` and `CfnIndex`. The pinned cdkd (0.296.28) has its own implementation for the vector bucket and requires the bucket's name, which is why the name is written out. It has none for the index, which is created through the Cloud Control API. That an index can be created by that route was not confirmed. The index ARN is put together from the names, not read from the resource's attribute, for the same reason: to rely on the unconfirmed route in fewer places.

Deleting the stack deletes the index, the vectors in it, and the bucket. The vectors can be rebuilt from the table, so `DESTROY` is fine for practice. In production too there is little reason to keep the index. The table is what needs protecting.

### The indexer

<<< @/examples/27-search/infra/lib/search-stack.ts{indexer}

The execution role allows reading the stream, calling Titan, and writing and deleting vectors in the index. It has no permission to read the table. The content of a note arrives inside the stream record.

Permission to read the stream is granted with `table.grantStreamRead`. Within it, `dynamodb:ListStreams` alone has `*` as its resource. That is how `Table` in `aws-cdk-lib` writes it, and a test checks that this is the only statement with a `*`. Whether this action can be narrowed to a single stream was not confirmed.

The event source mapping is the setting that connects the stream to the function. Five of its settings matter to this chapter.

- `startingPosition` set to `TRIM_HORIZON` starts reading from the oldest record still in the stream, so that a note written during the deploy is not missed
- `reportBatchItemFailures` makes Lambda use the number the function returns to say "it failed here". Without it, whatever the function returns, only the success or failure of the whole batch gets through
- `retryAttempts` is 3. The default is to retry until the record expires, so a single record that keeps failing holds up the records behind it in the same shard for up to 24 hours
- `onFailure` sends information about a batch that still fails after the retries to an SQS queue. What exactly arrives in the queue, the records themselves or only their position, was not confirmed in this chapter. Either way, a message in the queue means there are changes the index does not reflect. To fix it, run the [rebuild](/en/chapters/27-search/build.md)
- `filters` hands the function only records whose sort key starts with `NOTE#`. The table also holds chapter 05's counter item, which is rewritten each time a note is created. Without the filter you would pay for invocations in which the function does nothing

No function reads the queue. What has to be done differs with the cause: throttling by the model, a wrong permission, or a record that cannot be read. An alarm that tells you the queue has messages can be added the way chapter 19 shows.

Here is the handler.

<<< @/examples/27-search/src/indexer-lambda.ts{handler}

### The search function

<<< @/examples/27-search/infra/lib/search-stack.ts{search}

The execution role allows a `Query` on the table, calling Titan, querying the index, and calling the model that writes answers. It allows no write at all.

`s3vectors:GetVectors` is needed on top of `s3vectors:QueryVectors` because the query carries a metadata condition and asks for metadata back. According to the documentation, doing either requires both permissions, and with only one the request gets a 403.

The permission for the answering model uses chapter 17's `modelArns` as it is: the inference profile and the model in each destination Region.

The function URL is set up as in chapter 17. Its `AWS_IAM` authentication was the reason the owner header could be believed. Change it to `NONE` and anyone who knows the URL can claim to be any owner and search that owner's notes.

<<< @/examples/27-search/src/lambda.ts{handler}

The parts that call AWS are put together by one function.

<<< @/examples/27-search/src/aws-parts.ts{aws}

The parts this function returns are the only difference from the local setup. The app, the search, and the answering code are the same.

To test the stack, run these locally.

```bash
vp run search:infra:synth
vp run test:unit
```

`search:infra:synth` bundles the two functions with esbuild and writes a template with 14 resources to `cdk.out`. It asks AWS nothing.

## Deploying and checking

<!-- section: 27.deploy -->

```bash
vp run search:infra:diff
vp run search:infra:deploy
```

Deploying by itself costs next to nothing. Billing starts when you write notes and the indexer runs.

```bash
vp run search:seed
```

`search:seed` writes the same five notes as the local setup to the table, with your own credentials. The writes flow into the stream, and the indexer embeds them with Titan. That embedding is billed. They are five short notes, so the amount is small.

The search URL needs a signature. The owner header was added to chapter 17's signing code, and it is covered by the signature.

<<< @/examples/27-search/scripts/sign.ts{sign}

```bash
vp run search:smoke
```

`search:smoke` is billed as well: three embeddings and one short answer. It checks these things in order.

- An unsigned request is refused with a 403
- A search as `alice` for 「支払いのトラブル」 has hits. The query shares no word with any note, so a hit means the meaning search works. It waits for indexing to catch up, every 5 seconds for up to a minute
- Neither `alice`'s nor `bob`'s results contain the other's notes
- The answer to `alice`'s question arrives as sources, then text, then citations

If the second check fails, there are two possible causes. Indexing has not finished, or the distance Titan produced is farther than the threshold of 0.7. The threshold was not tuned, so the second is quite possible. The logs tell which.

```bash
vp run search:logs
vp run search:logs -- --indexer
```

The search log has `search` lines, in which `dropped` is the number of hits that were dropped. The indexer's log has an `indexed` line per note and an `embedded` line per embedding, with its token count.

Whether the table and the index agree is checked with the next task.

```bash
vp run search:reindex
vp run search:reindex -- --apply
```

Without `--apply` it prints how many things differ and changes nothing. With `--apply` it embeds the missing notes again and deletes the surplus vectors. This task reads the whole table with a `Scan`. A `Scan` is billed for every item it reads, so it is not used inside a user's request, only in maintenance work like this.

Drift detection is the same as in chapter 02.

```bash
vp run search:infra:drift
```
