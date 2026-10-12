---
title: "58 Ledger: QLDB Today, and an Append-Only Ledger You Can Verify"
sourceRevision: 1
---

# 58 Ledger: QLDB Today, and an Append-Only Ledger You Can Verify

Sometimes a record of who did what, and when, has to be kept so that nobody can change it afterwards. AWS had a service for that, Amazon QLDB. Its support ended on July 31, 2025, and it can no longer be used. This chapter does not teach QLDB. It builds the properties QLDB promised from parts this book has already used.

There is one idea. Permissions alone cannot make a record that nobody can rewrite. So you write the record in a form where any rewrite shows, and you put the evidence somewhere that even you cannot delete it. The records are appended to a DynamoDB table, each carrying the hash of the one before it. The evidence is a small object holding the last hash, stored in an S3 bucket with Object Lock.

The chapter builds on conditional writes from [chapter 05](/en/chapters/05-dynamodb.md), S3 from [chapter 07](/en/chapters/07-uploads.md), IAM and CloudTrail from [chapter 21](/en/chapters/21-security.md), and backups from [chapter 22](/en/chapters/22-recovery.md). It reads and writes the table through the interface from [chapter 30](/en/chapters/30-data-modeling.md) and uses that chapter's in-memory model. The code is in `examples/58-ledger/`.

Nothing in the stack is billed by the hour. But **the bucket that holds the digests stays behind when you destroy the stack**, because a locked object cannot be deleted until its retention period is over. With the default settings that is one day, after which you delete it yourself. The steps are in [Costs, Pitfalls, and Cleanup](/en/chapters/58-ledger/wrap.md).

## QLDB today

<!-- section: 58.qldb -->

The AWS General Reference lists the services AWS has stopped offering. When I read it on 2026-10-13, Amazon Quantum Ledger Database (Amazon QLDB) was under "Services in Full Shutdown" with an end of support date of July 31, 2025. A service at that stage has been removed from the AWS portfolio and is not available or supported in any form. On the same day the QLDB product page redirected to the Aurora page, and the developer guide answered 404.

So what QLDB was comes from the blog posts AWS wrote for people migrating away. According to them, the heart of QLDB was the journal: an append-only data structure holding committed transactions in order, as records that could not be changed. Blocks of records were chained to the previous block with cryptographic hashes, and the chain let you verify that the history had not been rewritten. The post calls these two properties, immutability and cryptographic verifiability, unique to QLDB.

The migration target AWS pointed to is Aurora PostgreSQL. The posts describe how to move a ledger's data into Aurora PostgreSQL, and what replaces each QLDB feature in an audit use case: pgAudit with CloudWatch Logs, audit tables filled by triggers, AWS DMS, and Database Activity Streams. The same post says that Aurora PostgreSQL keeps no immutable record of changes. You produce the history yourself as audit data and store it outside the database. Nothing among the replacements stands in for the cryptographic verification.

If you meet the name QLDB in an existing account, it will be in an old IAM policy or a design document. Nothing new can be created. The same reference lists Amazon Managed Blockchain under "Services in Sunset", with support ending on September 29, 2027. Neither of the AWS services with "ledger" in its description is one to choose today.

## The whole picture

<!-- section: 58.overview -->

```figure
caption: The app only appends to the ledger. An hourly function writes the last hash to a locked bucket, and an auditor reads both and compares them.
node app: Notes app | AppendAccess policy
node table: DynamoDB table | numbered entries, chained by hash
node fn: Lambda function | every hour
node bucket: S3 bucket | Object Lock, versioning
node auditor: Auditor | AuditorRole
edge app -> table: PartiQL INSERT, Query
edge fn -> table: Query
edge fn -> bucket: PutObject (If-None-Match)
edge auditor -> table: Query
edge auditor -> bucket: ListObjectVersions, GetObject
mark bucket
```

A ledger is a sequence of numbered entries. Each entry carries a hash computed from its own content and the hash of the entry before it. That sequence is called a hash chain. Change one entry in the middle and every hash after it stops matching.

Someone who can rewrite the table freely can recompute all the later hashes too, though. After that, the table alone shows no sign of the change. So at some moment you note the last sequence number and its hash somewhere outside the table. That note is called a digest. The last hash is determined by every entry before it, so one digest stands for the whole history up to that moment.

The digest goes into the S3 bucket marked in the figure. The bucket has Object Lock, and an object version written there cannot be deleted until its retention period is over. Verification recomputes the hashes from the entries in the table and compares them with the locked digests.

Two things own state here. The DynamoDB table owns the entries, and the S3 bucket owns the evidence. The design consists of making sure the same permissions cannot rewrite both.

## What this proves, and what it does not

<!-- section: 58.trust -->

The invariant of this chapter is one sentence. Any change, reordering, or removal of an entry older than a locked digest is found by verification.

When verification finds nothing, what you can say is that the entries up to the newest digest are as they were when that digest was written. Their content, their order, and their number are unchanged. That conclusion rests on nobody being able to produce different content with the same SHA-256 hash, and on S3 keeping its locks.

What you cannot say deserves the same weight.

- The ledger does not know whether what was appended is true. If the app writes a lie, the lie is preserved faithfully. An event that was never written does not show up in verification either
- Entries after the newest digest are protected by nothing yet. Rewrite them, or cut off the end, and verification passes. By default that gap is at most one hour. `test/verify.test.ts` has tests that confirm these cases go undetected
- An entry's time is the writer's clock. The time S3 received an object is more trustworthy, but verification in this chapter does not look at it
- Rewriting the table itself is not prevented. An operator with enough permissions can replace an item, or delete the whole table. This design promises that you will know afterwards, not that it cannot happen

Who you have to trust is settled as well. You trust AWS for S3 keeping Object Lock. In governance mode an administrator holding `s3:BypassGovernanceRetention` can lift a lock, so you trust that administrator too. In compliance mode nobody can delete, the root user included. The code and role of the function that writes digests, and the code that verifies, are trusted as well. Someone who takes over the function can lock a digest of a ledger that has already been rewritten. The digests locked before the takeover still cannot be deleted, so a rewrite of the history up to that point is still found.

To really separate the operator from the auditor, put the digest bucket in another account. An administrator of the app's account then has no permission on that bucket at all. [Chapter 33](/en/chapters/33-production-readiness.md) covers separate accounts. This chapter's stack keeps both in one account.

## When to choose something else

<!-- section: 58.fit -->

As a way to keep a history of changes, this ledger is on the heavy side. First ask whether something lighter is enough.

If you only need to know who called which API, CloudTrail does that (chapter 21). Creating and deleting a DynamoDB table is logged by default, and reads and writes of items are logged once you enable data events on a trail. If you only need the history of what the app decided, an audit table you have agreed never to delete from, with the backups from chapter 22, is enough. You need a hash chain when you have to show someone else that you, who run the records, did not rewrite them.

And sometimes this chapter's mechanism is not enough.

- A regulation requires the records themselves on WORM (write once, read many) storage. The S3 user guide says Object Lock has been assessed by a third party against regulations such as SEC 17a-4. The design then puts the records themselves, not digests of them, in a compliance-mode bucket. Which regulation applies to your business is not something this book can decide
- You want to show that one entry is in the ledger without reading the whole ledger. Verification here reads every entry up to the digest
- You have to convince someone who trusts neither you nor AWS. That takes several organizations each holding a copy. The AWS service for that, Amazon Managed Blockchain, is being retired, as noted above
- You want to query the history with SQL on a relational database. The path AWS showed QLDB users is Aurora PostgreSQL with audit tables. Chapter 60 covers Aurora

I checked the official documentation of Cloudflare and Vercel on 2026-10-13 as well. Cloudflare R2 has bucket locks, which forbid deleting and overwriting objects for a number of days, until a date, or indefinitely. A rule can be removed from the dashboard or with Wrangler. I found no mode in the documentation that the bucket's owner cannot remove. In kind it is close to governance mode, and it is not a place for evidence that you yourself cannot delete. The Vercel Blob overview page describes no feature that protects an object for a retention period. The hash chain can be written the same way on any database, D1 or Postgres included. Where the platforms differ is in where the evidence can go.

The following pages go through the implementation. [Design and Build](/en/chapters/58-ledger/build.md) writes the ledger, the digests, and verification, [Run It Locally](/en/chapters/58-ledger/local.md) reproduces a rewrite, and [Deploy](/en/chapters/58-ledger/deploy.md) looks at the stack and its permissions.
