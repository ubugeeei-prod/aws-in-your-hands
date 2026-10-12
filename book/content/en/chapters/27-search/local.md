---
title: "27 Search: Run It Locally"
---

# 27 Search: Run It Locally

Here you start the search from [Design and Build](/en/chapters/27-search/build.md) on your own machine. Nothing in AWS is called. The page separates what you can check locally from what you cannot, and then goes through the tests.

## Running it locally

<!-- section: 27.local -->

Copy `examples/27-search/.env.example` to a file named `.env` in the same directory.

<<< @/examples/27-search/.env.example

```bash
vp run dev:search
```

The development server starts at <http://localhost:8827>. With `SEARCH_BACKEND=local`, notes and vectors both live in a `Map` inside the process, filled at the start with the notes in `fixtures/notes.json`. There are two owners, `alice` and `bob`, and both wrote about payments (決済).

<<< @/examples/27-search/src/local.ts{local}

There is no stream on a laptop. The indexer is called directly, right after each note is written. In AWS a stream and Lambda sit between the two, and with them come lag and redelivery.

Search from another terminal.

```bash
curl -s http://localhost:8827/search -H 'x-notes-owner: alice' -d '{"query":"決済のタイムアウト"}'
curl -s http://localhost:8827/search -H 'x-notes-owner: bob' -d '{"query":"決済のタイムアウト"}'
curl -s -i http://localhost:8827/search -d '{"query":"決済"}'
```

The same query returns different notes for different owners. The third request has no owner header and gets a 401. This is the output of the three commands (the first two with line breaks added for reading, the third cut to its first line).

```text
{"hits":[
  {"noteId":"0000000a2","title":"障害の振り返り","snippet":"火曜の夜、決済のタイムアウトが増えた。原因は接続プールの上限で、再試行が重なって悪化した。上限を上げ、再試行に待ち時間を入れる。","score":0.03278688524590164,"matched":["meaning","words"]},
  {"noteId":"0000000a1","title":"リリース前の確認","snippet":"金曜のリリースまでに、決済の結合テストと負荷試験を終える。担当は佐藤さんと鈴木さん。水曜の朝会で進み具合を確認する。","score":0.016129032258064516,"matched":["words"]}
],"meaning":"used"}

{"hits":[
  {"noteId":"0000000b1","title":"決済の見積もり","snippet":"決済の手数料を見直す。来期の予算は未確定で、社外には出さない。","score":0.01639344262295082,"matched":["words"]}
],"meaning":"used"}

HTTP/1.1 401 Unauthorized
```

`score` is the value from merging the rankings. For an entry that is first in both lists it is twice 1 ÷ 61, about 0.0328. Its size means nothing by itself. It is a number to sort by.

This is the moment to be clear about what the local "meaning search" does.

<<< @/examples/27-search/src/embedder.ts{hashing}

The local embedding is not a model. It adds 1 or -1 at a position fixed by each word, so texts that share words end up close. It knows nothing about meaning. The first result is marked `meaning` because the query and the note contain the same words. Try a query that shares no word and nothing comes back.

```bash
curl -s http://localhost:8827/search -H 'x-notes-owner: alice' -d '{"query":"支払いのトラブル"}'
```

```text
{"hits":[],"meaning":"used"}
```

To a person, 「支払いのトラブル」 (trouble with payments) is close to the note about payment timeouts. A real embedding model is expected to judge them close. Checking that takes a call to Bedrock. What the local search lets you check is the wiring, the separation of owners, the merging of rankings, and the handling of failures. It cannot tell you about search quality.

The local index differs from the real one as well.

<<< @/examples/27-search/src/memory-vector-index.ts{memory}

The local index compares the query with every vector, so it always returns the nearest. S3 Vectors is approximate and can miss a near one. The distance is computed like this.

<<< @/examples/27-search/src/memory-vector-index.ts{cosine}

You can try an answer too.

```bash
curl -sN http://localhost:8827/answers -H 'x-notes-owner: alice' -d '{"question":"リリースまでに何を終える?"}'
```

```text
event: sources
data: {"type":"sources","sources":[{"n":1,"noteId":"0000000a1","title":"リリース前の確認"}]}

event: delta
data: {"type":"delta","text":"金曜のリリースまでに、"}

event: delta
data: {"type":"delta","text":"決済の結合テストと負荷試験を終える予定です [1]。"}

event: delta
data: {"type":"delta","text":"進み具合は水曜の朝会で確認します [1][7]。"}

event: done
data: {"type":"done","stopReason":"end_turn","complete":true,"usage":{"inputTokens":640,"outputTokens":62},"citations":[1],"unknownCitations":[7]}
```

`sources` is the result of a real search. The text after it is a fixed fixture (`fixtures/answer.json`) replayed by the same mechanism as in chapter 17, and the same text flows whatever the question is. The fixture cites a source `[7]` that does not exist, on purpose, and 7 appears in `unknownCitations` of `done`. Nothing about the quality of a model's answers can be learned locally.

A question that finds nothing ends without calling the model (here, the fixture).

```bash
curl -sN http://localhost:8827/answers -H 'x-notes-owner: alice' -d '{"question":"zzz qqq"}'
```

```text
event: sources
data: {"type":"sources","sources":[]}

event: done
data: {"type":"done","stopReason":"no_sources","complete":false,"usage":null,"citations":[],"unknownCitations":[]}
```

With `SEARCH_BACKEND=aws` the same server calls the deployed table and index, and Bedrock, with your own credentials. Every search is billed for an embedding. The development server listens on `127.0.0.1` only because it believes the owner header as it is.

## Tests

<!-- section: 27.tests -->

```bash
vp run test:unit
```

The tests reproduce, in a fixed order, the things that would do real harm.

Four tests try to break the invariant "a search never returns another owner's note" (`test/search.test.ts`). Two people write about the same thing. The index ignores the owner filter and returns someone else's hits. The index holds an entry that passes off another person's note as yours. The last one runs 200 rounds, with a seeded random generator, against an index that returns hits with owner, note, version, and passage combined at random. In every case only the caller's notes come back.

The tests also reproduce the table and the index out of step. When a note is deleted and its vector remains, the note is not returned. When a note is rewritten and its old vector remains, it is found by its new words and not by its old meaning. When the embedding model fails, the search answers from words alone.

For the indexer (`test/indexer.test.ts`), the tests check that delivering the same change twice changes nothing, that the surplus passages of a shortened note disappear, and that nothing remains when a delete arrives twice. For the stream handler, they check that a failure in the middle of a batch returns the failed number without touching the records after it, and that the retry converges to the same result even when the first record arrives again.

For the rebuild (`test/reconcile.test.ts`), a test reproduces the stream indexing a newer version right after the rebuild has read the old one, and checks that the newer version is what remains.

For answers (`test/answer.test.ts`), the prompt that goes to the model is recorded, and a test checks that it holds no text from another owner's note. The tests also pin that the model is not called when nothing was found, and that a citation of a number that was not sent ends up in `unknownCitations`.

Some things the tests do not check. The shape of the stream records was written by hand from the documentation and the types in `@types/aws-lambda`, not taken from a real stream. S3 Vectors and Titan were never called. The test for the S3 Vectors adapter (`test/s3-vectors-index.test.ts`) only checks, with a stand-in client, the shape of the requests handed to the SDK and how returned values are read. Whether the real service accepts those requests was not checked. The Titan adapter (`src/bedrock-embedder.ts`) has no test and has only passed the type check. The full list of what was not checked is in the [verification notes for this chapter](/en/chapters/27-search/wrap.md).
