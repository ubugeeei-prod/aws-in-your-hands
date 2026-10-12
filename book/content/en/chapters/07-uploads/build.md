---
title: "07 File Upload: Design and Build"
---

# 07 File Upload: Design and Build

## Two stores, one order

<!-- section: 07.finish -->

The image is in S3. "Which image is attached to which note" is in DynamoDB. And there is no way to put those two writes into one transaction.

Chapter 05's optimistic lock lived inside one table. A conditional write made check-and-update a single step. This time there are two services. If the function dies right after writing to one of them, a state with only one side written is left behind.

You cannot prevent that. What you can do is choose which "only one side" you allow.

```text
finish (step 3)                        if the function stops right after this step
  a. HeadObject: is it there?          nothing changed
  b. DeleteObjectTagging (S3)          object without a record   <- allowed; cleaned up later
  c. PutItem ATTACHMENT#... (DynamoDB) done

remove
  a. DeleteItem ATTACHMENT#... (DynamoDB)   object without a record   <- allowed; cleaned up later
  b. DeleteObject (S3)                      done

never, at any step:                    a record whose object is missing or about to expire
```

The invariant, in one sentence:

**If an attachment record exists, its object exists and is out of reach of automatic deletion.**

The reverse is allowed: an object with no record. Nobody sees it, and no screen breaks. The only harm is the storage charge, and it can be cleaned up afterwards.

A record with no object, on the other hand, is visible. Open the note and there's a broken image. So that one must not happen.

Once that's decided, the order follows by itself. Adding: object first, record second. Removing: record first, object second. Wherever it stops, a record always points at something.

### The record

<<< @/examples/07-uploads/api/src/attachment-repository.ts{interface}

<<< @/examples/07-uploads/api/src/dynamodb-attachment-repository.ts{keys}

Records go into the same table as chapter 06, in the same owner's partition. The sort key has a different prefix, so they never show up in the note list (which asks for keys starting with `NOTE#`).

There is no row for "upload in progress". All that handing out a permit writes is the count of permits handed out today, from the previous page. Which permits were used is not written anywhere.

### Finishing

<<< @/examples/07-uploads/api/src/attachments.ts{finish}

When the browser says "I sent it", the API doesn't take its word. It asks S3 with `HeadObject` whether the object is really there. The size and type it records are the ones S3 answered with.

<<< @/examples/07-uploads/api/src/s3-object-store.ts{head}

<<< @/examples/07-uploads/api/src/s3-object-store.ts{mark-attached}

An uploaded object carries the tag `upload-state=pending`. The bucket has a rule that deletes objects still carrying this tag after one day, and finishing takes the tag off. Only after that is the record written.

Calling this twice gives the same result. If the record is already there, it is returned. The record is written with a condition, so two finishes running side by side still leave one record. That is why the route is a `PUT`.

<<< @/examples/07-uploads/api/src/attachments.ts{timing}

A finish is accepted within 15 minutes of the object arriving in the bucket. That deadline is there so that the cleanup you'll meet shortly and a finish never touch the same object at the same time.

### On the browser's side

<<< @/examples/07-uploads/api/src/client.ts{send}

<<< @/examples/07-uploads/api/src/client.ts{client}

The POST to S3 carries no access token. S3 wouldn't read it, and there is no reason to send the app's token to another service. The signature inside the form is the whole permission.

### Stopping it partway

The tests stop the sequence at a fixed place and look at both stores. The in-memory implementations are rigged to "fail the next call, once", which fixes the order.

| Stopped at | S3 | DynamoDB | Afterwards |
| --- | --- | --- | --- |
| Sent. Finish never called | object (pending) | nothing | The lifecycle rule deletes it a day later |
| Tag removed. Writing the record fails | object (no tag) | nothing | Calling finish again creates one record. If nobody calls, the sweep deletes it |
| Removing the tag fails | object (pending) | nothing | Calling finish again succeeds |
| Finished. The response is lost | object (no tag) | record | Calling again returns the same record |
| Delete removed the record. Deleting the object fails | object (no tag) | nothing | The user is told it succeeded. The sweep deletes it |
| Note deleted. Cleaning up its attachments fails | object (no tag) | record | No note, so the API cannot reach them. The sweep deletes both |

In no row is there a record without its object.

<<< @/examples/07-uploads/api/src/attachments.ts{remove}

<<< @/examples/07-uploads/api/src/attachments.ts{cascade}

Deleting a note is chapter 06's service with a wrapper around it. Chapter 06's code is unchanged. The note goes first because once it is gone, no route of the API can reach its attachments. What remains is a cleanup problem.

## Cleaning up what is left

<!-- section: 07.orphans -->

Orphaned objects come in two kinds.

The first kind was sent and never finished. This is probably the most common: a closed tab, a dropped connection. S3 deletes these by itself.

<<< @/examples/07-uploads/api/src/object-store.ts{tags}

A lifecycle rule is a bucket setting under which S3 itself deletes matching objects a number of days after they were created. This chapter's rule is "delete objects tagged `upload-state=pending` after one day". Not one line of your code has to run.

According to the official documentation, tag-based rules are evaluated once a day and the deletion runs asynchronously. If the tag is no longer on the object when the action executes, the deletion does not happen. There can be a delay between the expiry and the actual removal. So it is not "exactly 24 hours later". It is "some time after a day has passed".

The second kind became orphaned after the tag was removed: rows 2, 5, and 6 of the table. With no tag, the lifecycle rule doesn't pick them up. S3 doesn't know what is in the table, so it couldn't. Something has to compare the bucket with the table.

<<< @/examples/07-uploads/api/src/sweep.ts{sweep}

The sweep walks the objects in the bucket and deletes those that lack a record or a note. The order is the same as a user's delete: record first, object second.

It leaves objects younger than one hour alone. The deadline for finishing was 15 minutes. An object that is an hour old cannot still be in the middle of a finish. That holds even if the function's clock and S3's clock disagree somewhat. Separating two processes by time like this is a common move when you cannot put a lock between them.

Keys of an unknown shape are reported and never deleted. This app did not write them.

The sweep is a task that runs with your credentials. It is not a function. You can look at what it would delete first.

```bash
vp run uploads:sweep
vp run uploads:sweep --delete
```

Running it on a schedule needs a scheduler ([chapter 08](/en/chapters/08-async.md) adds one).

### A gap this design leaves open

One gap is not closed. Here it is, in the open.

A presigned form can be used any number of times until it expires. Suppose a user sends an image, finishes it, and then sends the same form again within the 5 minutes. S3 replaces the object and applies the tag written in the form once more. There is a record, and its object is back to pending. A day later the lifecycle rule deletes it and only the record is left. The invariant is broken.

Users can break only their own attachments this way, never someone else's. A break is still a break. One test is there on purpose to reproduce it.

There are two ways to close it. One is to switch to a presigned PUT and have S3 refuse a second write to the same key with `If-None-Match`. The official documentation lists `PutObject` among the operations that accept this header, and does not list POST Object. In exchange you give up the one documented way to have S3 enforce a size range. The other is to add a step that removes the tag again after the permit has expired. Neither is implemented in this chapter.

And there is something the sweep cannot find: a record with no object. It appears if someone deletes an object from the bucket by hand. Finding it means starting from the table, which this chapter's sweep does not do.

## Showing the image

<!-- section: 07.view -->

The bucket is not public. So how does an `<img>` load the image?

<<< @/examples/07-uploads/api/src/attachments.ts{list}

<<< @/examples/07-uploads/api/src/s3-object-store.ts{presign-view}

When the API returns the list of attachments, it creates a presigned GET URL for each one, valid for 5 minutes. This, too, is arithmetic inside the function. No request goes to S3.

The list route checks that the note belongs to the caller. But the URL it returns works for whoever uses it. No access token needed. Paste it into a chat and the reader can see the image for 5 minutes. It ends up in the browser history and in proxy logs.

The official documentation calls presigned URLs bearer tokens and recommends protecting them accordingly. The only protection this chapter chose is a short lifetime. The image stops loading after 5 minutes, so the screen fetches the list again when an image fails to load.

If you want the app's authorization applied on every request, that is a different architecture: CloudFront in front, with signed cookies or signed URLs. The chapter outline planned to read through CloudFront with OAC. But with OAC alone, anyone who knows the URL can read the image. Separating users needs a signing mechanism on top of it, so this chapter uses presigned GET.

### It can expire before its expiry

A presigned URL expires at the time you asked for. Except when it expires earlier.

The official documentation says: a presigned URL created with temporary credentials becomes invalid when those credentials expire, even if the URL was created with a later expiration time.

<<< @/examples/07-uploads/api/src/lambda.ts{handler}

Lambda passes the access keys obtained from the execution role to the function in environment variables, together with a session token. Credentials that come with a session token are temporary ones. So every URL and form in this chapter falls under that rule. How often those credentials are replaced could not be confirmed from the official documentation. The presigned URL page gives typical figures for EC2 and ECS, and none for Lambda.

This chapter's lifetime is 5 minutes, so the effect should be small. Even so, a URL created just before the credentials expire will not last its 5 minutes. A "share link valid for 7 days" made from Lambda will not last 7 days. If you need long lifetimes, look for a different mechanism.

This is chapter 06's "disabled, and still getting through for a while", turned around. There, you want to stop something and it keeps working until it expires. Here, you want something to work and it stops before it expires. Both come from a verifier deciding on the information it has at hand.
