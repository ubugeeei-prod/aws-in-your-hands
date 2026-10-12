---
title: "27 Search: Full-Text, Vectors, and RAG"
sourceRevision: 1
---

# 27 Search: Full-Text, Vectors, and RAG

A note from chapter 05 can be read if you know its ID, but it cannot be found. In this chapter you make notes findable by their words, and then by their meaning when no word matches. After that you have a model answer a question using only the notes the search found.

AWS has several services you can search with. Some configurations cost hundreds of dollars a month just for existing, without a single search. What you build and what you pay both depend on which one you choose, so this chapter spends its pages on the choice.

The other subject is that search data is a copy of the table it came from. A copy lags and drifts. Even so, one person's search must never show another person's note. The invariant of this chapter is "a search never returns another owner's note", and the code is built so that it holds even when the index is wrong.

This chapter builds on [chapter 05](/en/chapters/05-dynamodb.md) and [chapter 17](/en/chapters/17-ai.md). The code is in `examples/27-search/`. The tests and the default development server call nothing in AWS, and each task that is billed is marked as billed where it appears.

## The whole picture

<!-- section: 27.architecture -->

Writing and searching take different paths.

```figure
caption: A change to a note reaches the vector index through the stream
node table: DynamoDB table | notes, stream: NEW_AND_OLD_IMAGES
node indexer: Lambda function | indexer
node titan: Amazon Bedrock | Titan Text Embeddings V2
node index: S3 Vectors | vector index, 1024 dimensions, cosine
node dlq: SQS queue | dead letters
edge table --> indexer: stream records, at least once
edge indexer -> titan: InvokeModel
edge indexer -> index: PutVectors, DeleteVectors
edge indexer --x dlq: after 3 retries
mark index
```

Notes are written to the same table as in chapter 05. What is new is a stream on the table. DynamoDB Streams records each change to an item, and Lambda reads those records and hands them to a function. The function cuts a note into short pieces (passages), turns each one into a vector with a Bedrock model, and writes the vectors to an S3 Vectors index. A text turned into a vector is called an embedding.

```figure
caption: A search reads the owner's notes from the table, then checks what the index says against them
type: sequence
actor caller: Caller
actor fn: Lambda | search
actor table: DynamoDB
actor bedrock: Bedrock
actor index: S3 Vectors
step caller -> fn: POST /search
step fn -> table: Query
note fn: BM25
step fn -> bedrock: InvokeModel
step fn -> index: QueryVectors
note fn: verify, merge
step fn --> caller: hits
```

The search function starts by reading the owner's notes from the table. The word search is computed inside the function over the notes it just read. The meaning search turns the query into a vector and asks S3 Vectors. Then the function checks the hits the index returned against the notes it read, and drops the ones the table does not have. Every piece of text returned to the caller was read from the table. The index holds none of the notes' text.

`POST /answers` hands the result of the same search to chapter 17's `ConverseStream` and returns the answer piece by piece. The way in is a function URL as in chapter 17, with `AWS_IAM` authentication.

## What to search with

<!-- section: 27.choice -->

There are three candidates: OpenSearch Serverless, S3 Vectors, and Bedrock Knowledge Bases. What follows, prices included, was checked on 2026-10-13 against the official documentation and the AWS Price List. All three changed a great deal in the past year, so check again when you read this.

### OpenSearch Serverless

OpenSearch is a search engine. OpenSearch Serverless is the form in which you use it without owning a cluster, and it groups indexes into collections. A collection is of the full-text kind (search) or the vector kind (vector search), and the S3 documentation points to OpenSearch for workloads that need hybrid search, aggregations, or advanced filtering.

The price is a unit of compute called an OCU (OpenSearch Compute Unit) multiplied by time. In the Tokyo Region one OCU-hour costs USD 0.334, for indexing and for search alike.

According to the pricing page, the original form (a Classic collection) is billed at least 2 OCUs for the first collection in an account. **That is USD 487.64 a month without a single search** (0.334 × 2 × 730 hours). Without standby replicas it is 1 OCU, which is still USD 243.82. If you create one to practice and forget to delete it, that is the bill.

On 2026-05-28 a new generation called NextGen became generally available. The documentation and the pricing page say that a NextGen collection group can have a minimum of 0 OCUs, and that indexing and search both shrink to zero after 10 minutes without requests. Storage is billed separately. So the drawback of Classic, paying for OCUs that sit idle, does not apply to NextGen.

Three things about NextGen could not be confirmed, though: whether it is available in the Tokyo Region, whether its price there is the one above, and how long the first search takes after the collection has shrunk to zero. OpenSearch Serverless has endpoints in Tokyo, and the AWS blog says NextGen is available in every commercial Region where the service is offered, but it names no Region. The Tokyo rows of the Price List do not tell the generations apart.

Price aside, there is more to handle. You need a collection group, three kinds of policy (encryption, network, data access), and an OpenSearch client that signs with SigV4. The documentation also says that what you write takes about 10 seconds to show up in a search.

### S3 Vectors

S3 Vectors stores vectors and returns the nearest ones, and that is all it does. It cannot search by words. In exchange, nothing in it is billed by the hour. You pay for what is stored, for the bytes you write, for each query, and for the data a query processes.

| Item | Unit price in the Tokyo Region |
| --- | --- |
| Storage | USD 0.066 per GB-month |
| Writes (PutVectors) | USD 0.219 per GB, with a minimum of 128 KB per call |
| Queries (QueryVectors) | USD 0.0027 per 1,000 |
| Data processed by queries | USD 0.000004278 per GB (the price up to 100,000 vectors) |

A vector of 1,024 dimensions is about 4 KB, so 2,000 of them come to roughly 8 MB, and storing them costs USD 0.0005 a month.

The documentation says that writes are strongly consistent and can be read right after they are written. Response times are described as under a second for infrequent queries and around 100 milliseconds for frequent ones. This chapter measured nothing. The service is meant for workloads where searches are occasional.

### Bedrock Knowledge Bases

Knowledge Bases takes over the whole job of ingesting documents, cutting them up, embedding them, and searching them. Today it comes in two kinds.

In the managed kind, Bedrock supplies the storage and the embedding model. It is available in the Tokyo Region. The pricing page says you pay only for what you store and what you retrieve, at USD 5.00 per GB of raw data a month and USD 1.00 per 1,000 Retrieve calls. Those two figures were not found as Tokyo rows in the Price List, however, and the pricing page does not name a Region.

In the customer-managed kind, you supply the vector store. OpenSearch Serverless and S3 Vectors are among the choices, so the price is that of the store you pick.

Neither kind can ingest from DynamoDB. What you can choose is S3, or a custom data source that takes documents through an API, among others. To put notes into Knowledge Bases, you would need code that follows changes in the table and sends them as documents. That is the same problem this chapter solves, solved in another place.

### What this chapter chooses

This chapter uses S3 Vectors for the meaning search and computes the word search inside the Lambda function.

No search engine is used for words because there is little to search. Chapter 05 limited one owner to 100 notes. A note is at most 10,000 characters, so all of an owner's notes come to about 3 MB. Reading them all and ranking them on every search costs at most about 375 DynamoDB read units, around USD 0.00005. At this size, reading the table every time is simpler than keeping a separate index, and it is always current.

The meaning search cannot be computed on the spot. Turning a note into a vector takes a call to a model, and you cannot embed every note again on every search, so the vectors are stored. S3 Vectors was chosen as the store because it costs next to nothing while unused.

Knowledge Bases is not used because the notes live in DynamoDB. You would write the sync code either way, and cutting and embedding take a few dozen lines. When you write them yourself, you can see which text is copied where, and your own code upholds the invariant.

In a month when nobody uses it, this configuration costs USD 0.00 (to two decimal places; the breakdown is in [Costs, Pitfalls, and Cleanup](/en/chapters/27-search/wrap.md)).

## When to build something else

<!-- section: 27.when-not -->

This configuration leans on one assumption: the number of notes per owner is bounded. When that no longer holds, choose again.

- If you search across owners, or one person has more than a few thousand notes, reading everything on every search stops working. The word search needs an index too, so choose OpenSearch Serverless. If NextGen is available in your Region, the cost of leaving it idle matters less as well
- If you want to absorb spelling variants, inflected forms, and typos, you need a search engine that analyzes language. The word search in this chapter only sees whether sequences of characters match. Which analyzers OpenSearch Serverless offers was not checked in this chapter
- If the source documents are PDF or Office files in S3, Knowledge Bases fits. It parses and cuts up the files for you
- If searches arrive constantly and response time matters, you are outside what S3 Vectors is meant for. Look at OpenSearch
- If you do not need a meaning search, half of this chapter is enough. With no stream, no index, and no embeddings, reading the table and ranking by words adds no cost and no copy that can drift

How the same job is done on Cloudflare and Vercel is compared in [Costs, Pitfalls, and Cleanup](/en/chapters/27-search/wrap.md).

The next page implements all of this, starting with the word search.
