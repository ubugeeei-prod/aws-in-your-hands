---
title: "58 Ledger: Run It Locally"
---

# 58 Ledger: Run It Locally

This page runs the ledger from [Design and Build](/en/chapters/58-ledger/build.md) on your machine. It needs no AWS credentials and costs nothing.

## Reproduce a rewrite

<!-- section: 58.local -->

```bash
vp run ledger:demo
```

`scripts/demo.ts` appends, takes a digest, rewrites, and audits, on chapter 30's in-memory table and the bucket model from the previous page. This is its output.

```text
append 1 to 4
  1  prev 000000000000  hash 7b6cf94ab47f  {"type":"note.updated","noteId":"n1","actor":"user-1","version":1}
  2  prev 7b6cf94ab47f  hash 3c5d6ea932a0  {"type":"note.updated","noteId":"n1","actor":"user-1","version":2}
  3  prev 3c5d6ea932a0  hash 43b831f1e561  {"type":"note.updated","noteId":"n1","actor":"user-1","version":3}
  4  prev 43b831f1e561  hash 55f68d58c945  {"type":"note.updated","noteId":"n1","actor":"user-1","version":4}

digest: {"kind":"written","digest":{"ledger":"notes","seq":4,"hash":"55f68d58c9450501bbae7cdcd1d5715afe1ec65d427dbe28ca2db26ed5725595","at":"2026-10-13T09:05:00.000Z"}}

append 5 and 6
  5  prev 55f68d58c945  hash de63561ff98f  {"type":"note.updated","noteId":"n1","actor":"user-1","version":5}
  6  prev de63561ff98f  hash 44570f14cb62  {"type":"note.updated","noteId":"n1","actor":"user-1","version":6}

audit, untouched
  entries 6, digests 1, not yet covered 2
  no findings

audit, after entries 2 to 6 were rewritten consistently
  entries 6, digests 1, not yet covered 2
  findings:
    {"kind":"digest_mismatch","seq":4,"versionId":"v1"}

delete the digest version, without the bypass permission: locked
```

On each line, `prev` is the `hash` of the line above. A digest was taken after the fourth entry, and two more entries were added. The first audit finds nothing, and `not yet covered 2` says that the fifth and sixth entries are in no digest yet.

Then the `actor` of the second entry was changed to someone else, and every hash up to the sixth was recomputed. Nothing in the table contradicts anything else. The audit finds that the hash of the fourth entry differs from the locked digest. The last line is an attempt to delete the digest's version without the permission, refused by the model.

The times are fixed, so the same hashes come out on every run.

### Check against DynamoDB Local

Sending the PartiQL `INSERT` and the `Query` to a real DynamoDB API can be checked with DynamoDB Local.

```bash
cp examples/58-ledger/.env.example examples/58-ledger/.env
vp run db:local:start
vp run ledger:db:migrate:local
vp run ledger:test:local
```

`db:local:start` is chapter 05's task. It needs a Docker daemon, which the Nix shell does not include. `ledger:db:migrate:local` creates this chapter's table in the same DynamoDB Local. If the endpoint is not an address on this machine, the tasks stop without doing anything.

Without Docker, starting the jar that AWS distributes directly with Java works the same. That is how this chapter was checked, with the environment variable `DYNAMODB_ENDPOINT` pointing at the port it was started on.

There is no local stand-in for S3 Object Lock here. The digest side has the in-memory model only.

## Tests

<!-- section: 58.tests -->

```bash
vp run test:unit
vp run ledger:test:local
```

| Layer | Files | What it sees | What it cannot see |
| --- | --- | --- | --- |
| Entries and hashes | `test/entry.test.ts`, `test/events.test.ts` | The pinned hash, boundaries between values, key order, refusal of misshapen rows, the event schema | The strength of SHA-256 itself |
| Journal rules | `test/journal-contract.ts` | Writing only to a free number, the tail, range reads, ledgers kept apart. Run on both the in-memory model and DynamoDB Local | IAM, the distributed behavior of the real service |
| Append | `test/ledger.test.ts` | A race for the number, a lost answer, losing every time, an unreadable tail | How often races happen for real |
| Digests | `test/digest.test.ts`, `test/digest-lambda.test.ts` | Reading only from the last digest on, refusing a ledger that does not match, the function failing | How Lambda and the schedule really behave |
| Verification | `test/verify.test.ts` | Detection of changed, removed, swapped, and cut-off entries. The range that goes undetected. Attacks on the digest | That S3 really keeps its locks |
| Bucket model | `test/memory-digests.test.ts` | Conditional writes, delete markers, versions piling up | That the model agrees with S3 |
| Request checks | `test/adapters.test.ts` | The PartiQL statement and its parameters, that no `PutItem` is sent, `If-None-Match`, paging through the version listing | That AWS acts on those requests as expected |
| Cleanup | `test/purge.test.ts` | The plan that leaves locked versions alone | Actual deletion |
| Infrastructure | `infra/test/ledger-stack.test.ts` | Permissions, the lock settings, removal policies, the schedule | That AWS acts on that template as expected |

The journal rules are written once and run against both the in-memory model and DynamoDB Local. On DynamoDB Local they run through both the implementation that uses PartiQL's `INSERT` and the one that uses a conditional `PutItem`.

`ledger:test:local` fails when `DYNAMODB_ENDPOINT` is missing. The test file itself skips when it has no endpoint, so the output of `vp run test:unit` shows `1 skipped`.

Against DynamoDB Local (3.3.1), 11 tests passed. That confirms that the PartiQL statement is accepted, that a second `INSERT` of the same key is refused, and that a strongly consistent `Query` returns entries in order of their numbers.

What has not been confirmed matters more in this chapter. That the writer's policy stops an overwrite, that S3 refuses to delete a locked version, and what `If-None-Match` and `ListObjectVersions` really answer can only be confirmed on AWS. What passed locally is that the verification code behaves as intended on models that follow the rules in the official documentation.
