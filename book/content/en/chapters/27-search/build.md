---
title: "27 Search: Design and Build"
---

# 27 Search: Design and Build

On the [first page](/en/chapters/27-search.md) you decided to use S3 Vectors for the meaning search and to compute the word search inside the function. This page implements, in order, the word search, the cutting of notes, embeddings, the index, the sync with the table, the search itself, rebuilding, and answers.

## Finding by words

<!-- section: 27.words -->

A word search starts by splitting text into words. English splits at spaces, but Japanese has nothing that marks where a word ends. This chapter uses no dictionary. It cuts the Japanese parts into pairs of characters, moving one character at a time.

<<< @/examples/27-search/src/tokenize.ts{tokenize}

「負荷試験」 becomes 「負荷」, 「荷試」, and 「試験」. The query is cut by the same rule, so searching for 「試験」 hits a note that contains 「負荷試験」. With no dictionary, 「走る」 and 「走った」 stay different words, and meaningless pairs such as 「荷試」 are indexed too. Nothing reduces words to their stems, and nothing removes words like "the" or 「の」.

Ranking uses a formula called BM25. A text ranks higher the more of the query's words it contains, a long text is discounted, and a rare word counts for more.

<<< @/examples/27-search/src/bm25.ts{bm25}

How rare a word is gets counted within the texts passed in. Only one owner's notes are passed, so no one else's notes enter the statistics. If the same computation ran over everyone's notes together, rarity would come from the whole, and what other people write would affect the ranking of your search. That does not happen here.

## Cutting a note into passages

<!-- section: 27.passages -->

A note is handled in short pieces, not whole, both when it is searched and when it is shown as the basis of an answer. Turn 10,000 characters into one vector and hardly anything of any single sentence remains. This chapter calls such a piece a passage.

<<< @/examples/27-search/src/chunk.ts{chunk}

The note is cut every 800 characters, with the last 100 characters of one passage repeated at the start of the next. The overlap is there so that a sentence cut by a boundary is whole in one of the two passages. The title goes at the head of every passage, because many notes name their subject only in the title.

800 and 100 are values this chapter picked. They were not chosen by looking at real search quality. Titan Text Embeddings V2 accepts up to 8,192 tokens or 50,000 characters, and 800 characters should be well within that, but how many tokens a Japanese character takes was not measured.

The same note always gives the same passages. Both indexing and searching depend on that. Each passage has one vector, and its key is formed like this.

<<< @/examples/27-search/src/chunk.ts{keys}

A key can be computed from the owner, the note's ID, and the passage number. Which keys to delete can be decided without asking the index.

## Embeddings

<!-- section: 27.embeddings -->

The part that turns text into a vector is an interface with one function.

<<< @/examples/27-search/src/embedder.ts{interface}

In AWS it calls Titan Text Embeddings V2 on Bedrock.

<<< @/examples/27-search/src/bedrock-embedder.ts{titan}

Unlike `Converse` in chapter 17, an embedding model is called with `InvokeModel`, and the shape of the request and the response is set by each model. The Titan V2 request has three fields: `inputText`, `dimensions`, and `normalize`. With `normalize` set to `true`, the vector that comes back has length 1.

The dimensions can be 1,024, 512, or 256. This chapter uses the default, 1,024. An index's dimension cannot be changed after it is created, so changing the dimension, or switching to another model, means creating a new index and putting everything in again. Vectors made by different models cannot be meaningfully compared.

The documentation says Titan V2 is optimized for English. Japanese is on the list of supported languages, but how good it is on Japanese notes was not checked in this chapter. In the Tokyo Region this model runs inside the Region only (the model card marks In-Region and nothing else). It needs no inference profile like chapter 17's `jp.` or `global.`.

`inputTextTokenCount` in the response is the number of tokens billed, so it goes to the log.

## The index

<!-- section: 27.index -->

The place vectors are stored is an interface too.

<<< @/examples/27-search/src/vector-index.ts{interface}

The index holds a vector and four values that say which passage of which note it is. It holds no text. The S3 Vectors documentation describes storing the text of each passage alongside the vector, as metadata that is not used for filtering. That lets a search answer with text straight from its result, but it adds one more copy of the notes, and copies you forget to delete stay behind. This chapter always reads the text from the table.

Here is the adapter for S3 Vectors.

<<< @/examples/27-search/src/s3-vectors-index.ts{s3vectors}

The access management page describes `PutVectors` as adding or updating vectors. The code assumes that a vector with the same key is replaced, and that was not confirmed in practice. The `filter` of `QueryVectors` carries the condition that the owner must match. For an index in a vector bucket created on or after 2026-09-30, the documentation says the vectors that satisfy the filter are selected first and the nearest are then searched among them. In buckets created before that date the condition is checked during the search, so when few vectors satisfy it, fewer results than requested can come back.

`QueryVectors` is an approximate search. Nothing guarantees that it returns the nearest vector.

Values that come back from the index are outside data, the same as items from a table.

<<< @/examples/27-search/src/s3-vectors-index.ts{metadata}

A hit whose owner or version cannot be read is treated as nobody's and dropped.

Besides narrowing by owner through metadata, you can give each owner an index of their own. The AWS best practices recommend an index per tenant, with IAM allowing each tenant only its own index. A query is billed by the size of the whole index, so separate indexes also lower the price of each query. This chapter uses a single index because it did not want code that creates an index whenever an owner appears. If your service's unit is a company or an organization, choose separate indexes.

## Keeping in step with the table

<!-- section: 27.sync -->

The index is a copy of the table. Every time a note is created, rewritten, or deleted, the index has to catch up.

The first way that comes to mind is to write to the index inside the API that saves the note. But if the embedding or the write to the index fails after the write to the table has succeeded, the two stay out of step. You can return an error to the caller, and the note has been saved anyway.

So DynamoDB Streams records the table's changes, and a separate function reads them and applies them to the index. The stream keeps changes for 24 hours. If applying one to the index fails, the change is not lost and can be tried again.

The documentation guarantees two things about the stream. A record appears in the stream exactly once. Changes to the same item appear in the order they were made. The order is guaranteed per item, and nothing is guaranteed about the order of changes to different notes.

The side where Lambda reads the stream and hands records to the function is at least once. The same record can arrive twice. The function is therefore written so that applying the same change twice gives the same result.

One change has this shape.

<<< @/examples/27-search/src/indexer.ts{change}

Deciding what to do to the index for a change is a function that uses no network.

<<< @/examples/27-search/src/indexer.ts{plan}

It embeds every passage of the new version and deletes the keys of passages the old version had and the new one does not. If a note shrank from three passages to one, numbers 1 and 2 are deleted. For a delete, all of them are. The length of the old version comes from the item as it was before the change, which the stream record carries. That is why the stream is set to record both the item before and the item after.

<<< @/examples/27-search/src/indexer.ts{apply}

Applying the same change twice leaves the index as applying it once does, because writes replace by key and deletes name their keys.

The order is to write the new passages and then delete the old ones. If the function stops after the write and before the delete, passages of the old version remain. They carry a version other than the note's current one, so the search ignores them (next section). The other order would make the note vanish from the meaning search when the function stops.

This is the part that takes a change out of a stream record.

<<< @/examples/27-search/src/stream.ts{record}

A record carries items in DynamoDB's notation (`{ "S": "..." }`, `{ "N": "12" }`). Here too, what arrives is checked against a schema. The table also holds items that are not notes (chapter 05's counter), so the keys are read first and anything that is not a note is left alone. A record that is a note and cannot be read is failed, not indexed on a guess.

<<< @/examples/27-search/src/stream.ts{handler}

Records are applied in the order they arrive, and the function stops at the first failure. When it returns the number of the record that failed, Lambda starts again from there. Skipping the failed record and going on would apply a later change to the same note first, and the retry would then put the older content back.

A record that fails every time blocks the stream. By default an event source mapping retries until the record expires, which is up to 24 hours. This chapter's stack limits retries to 3 and sends information about a batch that still fails to an SQS queue. The settings are on the [deploy page](/en/chapters/27-search/deploy.md).

The API reference does not say what `DeleteVectors` does with a key that is no longer there. The code assumes it is not an error, and the real behaviour was not confirmed. If it is an error, a delete that arrives twice ends up in the queue.

## The search and its invariant

<!-- section: 27.search -->

A search begins by reading all of the owner's notes.

<<< @/examples/27-search/src/search.ts{load}

It calls `list` on chapter 05's repository until the pages run out. A DynamoDB `Query` reads with the owner's partition key, so there is no way for it to read another owner's items. This chapter's invariant stands on that one point.

<<< @/examples/27-search/src/search.ts{search}

Only the passages of the notes read at the start (`mine`) can be returned. The word ranking is computed over `mine`. The meaning search embeds the query and asks the index, but it does not use the hits as they come. It checks three things.

- The hit's owner is the caller. If the index's filter works, no hit fails here
- The distance is within the threshold (0.7). A nearest-neighbour search returns something however far away it is, so what is too far counts as unrelated
- The note the hit points to is in `mine` at the same version. Deleted notes, notes rewritten since they were indexed, and notes that were never this owner's all fail here

The index is a hint, and the table is what is right. If the index's filter were broken, or its metadata had been rewritten, the text returned would still have been read from the table with the owner's key, so nobody else's note comes back. The number of hits dropped goes to the log as `dropped`. If it is not 0, the index and the table are out of step.

The threshold of 0.7 was not tuned against real Titan embeddings. Once you deploy, look at the distances that come back and set it again.

Because a hit at another version is dropped, a note you just rewrote cannot be found by meaning until indexing catches up. The word search reads the table, so it finds the new content at once. When the embedding model or the index fails, the search answers from words alone and sets `meaning` in the response to `unavailable`.

The two rankings are merged this way.

<<< @/examples/27-search/src/fusion.ts{rrf}

A BM25 score and a vector distance differ in unit and in range, so they cannot simply be added. Only the positions are used. Each list gives its nth entry 1 ÷ (60 + n), and the values are summed. The method is called reciprocal rank fusion. An entry found by both lists ranks above one that leads a single list. 60 is a value this chapter picked and did not tune.

## Rebuilding from scratch

<!-- section: 27.reindex -->

Sooner or later the index is rebuilt. The stream keeps changes for only 24 hours, so if the indexer is down longer than that, changes are lost. A batch that fell into the queue is not applied until someone deals with it. Changing how passages are cut also means putting everything in again.

Rebuilding is possible because the index can be computed from the table. Read all of the table and all of the index, and work out the difference.

<<< @/examples/27-search/src/reconcile.ts{plan}

Notes missing from the index, or indexed at another version, are indexed again, and vectors for which the table has no passage are deleted. Every disagreement is settled in the table's favour.

A rebuild runs while the stream is running, and that is a race. Suppose the rebuild reads version 1, the note is then rewritten, and the stream indexes version 2. When the rebuild now writes version 1, the newer vector is overwritten by the older one. S3 Vectors has no conditional write of the kind "only if newer than what is there", so this cannot be prevented before the write.

<<< @/examples/27-search/src/reconcile.ts{reindex}

After writing, the note is read once more. If it is at the version that was written, that is the end. If not, the newer one is indexed again. Once writes stop, this always converges. If they do not stop, it gives up after a set number of rounds and says so. What is left out of step is hidden by the search's version check and is fixed by the next stream record or the next rebuild.

A rebuild that changes the model or the dimension takes more than this. You create a new index under another name, put everything in, point the search function at it, and then delete the old index. This chapter's stack does not go as far as that switch.

## Answering with citations

<!-- section: 27.rag -->

Searching for text related to a question first, and then handing that text to a model to write the answer, is called RAG (retrieval-augmented generation). The search already exists, so what is added is a prompt and chapter 17's streaming.

The limits on the input and the shape of the events come first.

<<< @/examples/27-search/src/contract.ts{request}

A query is at most 200 characters. The query is embedded on every search, so this length decides what one search can cost.

<<< @/examples/27-search/src/contract.ts{events}

Two things were added to chapter 17's events: `sources`, sent first, and the citations inside `done`.

The owner is not taken from the request body.

<<< @/examples/27-search/src/owner.ts{owner}

This chapter takes the owner from a header. That is acceptable only because the function URL checks an IAM signature, so the only callers that reach the function are ones you allowed. In a setup where users' browsers call it directly, this header must not be believed. Verify the access token from [chapter 06](/en/chapters/06-auth.md) and use its `sub` as the owner. The app only takes a function called `ownerOf`, so there is one place to swap.

Here is the prompt.

<<< @/examples/27-search/src/prompt.ts{prompt}

The passages are numbered, and the model is told to cite its sources by number. What is inside a passage was written by a user, so, as in chapter 17, the model is told to treat it as data and not as instructions. That one line is no guarantee that the model will not follow an order written in a note. The limits therefore lie elsewhere: only the caller's own notes reach the model, and the length of the output is capped.

<<< @/examples/27-search/src/answer.ts{answer}

The search runs first, with the caller's owner. The model sees only the passages that search returned. However the model behaves, it cannot quote a note the caller could not have found by searching.

When nothing was found, the model is not called. Called without anything to go on, a model answers with a guess, and the guess is billed too.

<<< @/examples/27-search/src/answer.ts{relay}

The differences from chapter 17's relay are at the start and at the end. It starts by sending `sources`, which tells the caller which notes the answer will rest on before any text arrives. It ends by counting the numbers such as `[1]` in the answer.

<<< @/examples/27-search/src/prompt.ts{citations}

Numbers of sources that were sent and numbers that were not are returned separately. A number that was not sent means the model invented a source, which a screen can turn into a warning.

That is as far as the check on citations goes. Whether a sentence marked `[1]` really rests on what source 1 says is not checked. A model can write something its sources do not say and attach a plausible number. That is the reason to list the sources on the screen, where users can read them for themselves.

The route for searching is below, and the one for answers has the same shape as `/summaries` in chapter 17.

<<< @/examples/27-search/src/app.ts{search-route}

On the next page you run all of this locally.
