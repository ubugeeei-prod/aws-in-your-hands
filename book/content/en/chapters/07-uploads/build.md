---
title: "07 File Upload: Design and Build"
---

# 07 File Upload: Design and Build

[The previous page](/en/chapters/07-uploads.md) went as far as the API issuing a permit and the browser sending the image straight to S3. This page covers recording the uploaded image as an attachment, cleaning up what is left when the process stops partway, and showing the image.

## Two stores, one order

<!-- section: 07.finish -->

The image is in S3, and which image is attached to which note is in DynamoDB. There is no way to put the writes to both into one transaction.

Optimistic locking in chapter 05 happened inside one table, where a conditional write made the check and the update a single step. This chapter deals with two services. If the function crashes right after writing to one of them, a state with only one side written is left behind.

You can't prevent that state. What you can do is choose which side is allowed to be missing.

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

The invariant to keep is this one sentence.

**If an attachment record exists, its object exists and is exempt from automatic deletion.**

The opposite state, an object without a record, is allowed. Nobody can see such an object, and it breaks nothing on the user's screen. It costs only storage, and it can be cleaned up later.

A record without an object, on the other hand, is visible to the user. Opening the note shows a broken image. So the design rules that state out.

That decision fixes the order of the writes. To add, write the object first and the record second. To delete, delete the record first and the object second. Wherever the process stops, the object a record points to always exists.

### The record

<<< @/examples/07-uploads/api/src/attachment-repository.ts{interface}

<<< @/examples/07-uploads/api/src/dynamodb-attachment-repository.ts{keys}

The record goes in the same table as in chapter 06, in the same owner's partition. Its sort key has a different prefix, so it doesn't get mixed into the list of notes, which fetches the keys that start with `NOTE#`.

No row is created to mean "upload in progress". The only thing written when a permit is issued is the number issued that day, described on [the previous page](/en/chapters/07-uploads.md). Which permits were used is not written anywhere.

### Finishing

<<< @/examples/07-uploads/api/src/attachments.ts{finish}

When the browser reports that it sent the image, the API doesn't take its word for it. It uses `HeadObject` to confirm that the object really is in S3, and it records the size and type that S3 returns.

<<< @/examples/07-uploads/api/src/s3-object-store.ts{head}

<<< @/examples/07-uploads/api/src/s3-object-store.ts{mark-attached}

An uploaded object carries the tag `upload-state=pending`. The bucket has a rule that deletes objects that have kept this tag for one day, and finishing removes the tag. The record is written after the tag is removed.

Finishing gives the same result when it is called twice. If the record already exists, it returns that record. The record is written conditionally, so two finishes running at the same time still produce one record. That is why the route is a `PUT`.

<<< @/examples/07-uploads/api/src/attachments.ts{timing}

Finishing is accepted within 15 minutes of the object arriving in the bucket. The deadline exists so that the sweep described in "Cleaning up what is left" and the finishing step never touch the same object at the same time.

### On the browser's side

<<< @/examples/07-uploads/api/src/client.ts{send}

<<< @/examples/07-uploads/api/src/client.ts{client}

The POST to S3 carries no access token. S3 wouldn't read it, and there is no reason to send the app's token to another service. The signature inside the form is the whole of the permission.

### Tests that stop it partway

The tests stop the process at a fixed place and check both stores. The in-memory implementations have a hook that makes the next call fail once, which fixes where the process stops.

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

Deleting a note is added by wrapping chapter 06's service, and chapter 06's code is unchanged. The note is deleted first because once it is gone, no route of the API can reach its attachments. What is left only needs cleaning up later.

## Cleaning up what is left

<!-- section: 07.orphans -->

Objects left without a record come in two kinds.

The first kind was sent and never finished. It happens when a tab is closed or a connection drops, so it is probably the most common kind. S3 itself deletes these.

<<< @/examples/07-uploads/api/src/object-store.ts{tags}

A lifecycle rule is a setting that has S3 delete matching objects by itself a set number of days after they were created. This chapter's rule deletes objects tagged `upload-state=pending` after one day. No code of yours has to run.

According to the official documentation, a rule with a tag condition is evaluated once a day, and the deletion runs asynchronously. If the tag is no longer there when it runs, nothing is deleted. There can be a delay between the deadline and the actual deletion. The object doesn't disappear exactly 24 hours later. It disappears some time after a day has passed.

The second kind lost its record after its tag was removed. These are rows 2, 5, and 6 of the table in "Tests that stop it partway". They have no tag, so the lifecycle rule doesn't apply to them. S3 doesn't know what is in the table, so S3 alone can't find them either. It takes a process that compares the bucket with the table.

<<< @/examples/07-uploads/api/src/sweep.ts{sweep}

The sweep goes through the objects in the bucket and deletes any that lack either a record or a note. It deletes in the same order as a user's delete, the record first and the object second.

It leaves objects newer than one hour alone. The deadline for finishing is 15 minutes, so an object that is an hour old can't be in the middle of finishing. That leaves a margin even if the function's clock and S3's clock differ a little. Dividing by time this way is a common technique when you can't put a lock between two processes.

A key in a shape the sweep doesn't know is reported and not deleted, because this app didn't write it.

The sweep is not a function. It is a task that runs with your credentials, so you can see what it would delete before it deletes anything.

```bash
vp run uploads:sweep
vp run uploads:sweep --delete
```

Running it automatically on a schedule takes a scheduler ([chapter 08](/en/chapters/08-async.md) adds one).

### The gap this design leaves

This design has one gap that is not closed.

A presigned form can be used any number of times until it expires. If a user sends an image, finishes it, and then sends the same form again within 5 minutes, S3 replaces the object and applies the tag written in the form again. The record exists, but the object is back to pending. A day later the lifecycle rule deletes the object and only the record remains, which breaks the invariant.

A user can break only their own attachments this way and can't reach anyone else's. The invariant is broken all the same. One test reproduces this behavior on purpose.

There are two possible ways to close the gap. One is to switch to a presigned PUT and have S3 refuse a second write to the same key with `If-None-Match`. The official documentation lists `PutObject` among the operations that accept this header and doesn't list POST Object. Taking this route gives up the dependable way of having S3 enforce the size range. The other is to add a process that removes the tag again after the permit expires. This chapter implements neither.

There is also something the sweep can't find, which is a record without an object. It appears when someone deletes an object from the bucket by hand. Finding it means searching from the table's side, and this chapter's sweep doesn't do that.

## Showing the image

<!-- section: 07.view -->

The bucket isn't public, so the API provides a separate URL that an `<img>` can read the image from.

<<< @/examples/07-uploads/api/src/attachments.ts{list}

<<< @/examples/07-uploads/api/src/s3-object-store.ts{presign-view}

When the API returns the list of attachments, it creates a presigned GET URL valid for 5 minutes for each one and includes it. This URL is also only computed inside the function, and no request goes to S3.

The list route checks that the note belongs to the caller. The URL it returns, though, works for anyone who uses it, and no access token is needed. If you paste the URL into a chat, the person you sent it to can see the image for 5 minutes. The URL also stays in the browser history and in proxy logs.

The official documentation calls a presigned URL a bearer token and recommends protecting it accordingly. The only protection this chapter chooses is a short expiry. After 5 minutes the image can no longer be read, so the screen fetches the list again when an image fails to load.

If you want the app's authorization to apply on every request, the architecture is different. You put CloudFront in front and use signed cookies or signed URLs. The chapter outline planned to go through CloudFront and OAC. With OAC alone, though, anyone who knows the URL can read the image. Separating users takes a signing mechanism in addition, so this chapter uses a presigned GET.

### It can expire before its expiry

A presigned URL expires at the time you specify, but in some cases it expires sooner.

According to the official documentation, a presigned URL created with temporary credentials becomes invalid when those credentials expire, even if the expiry you specified is later.

<<< @/examples/07-uploads/api/src/lambda.ts{handler}

Lambda passes the function an access key obtained from the execution role, together with a session token, in environment variables. A session token means the credentials are temporary. So every URL and form in this chapter is subject to this rule. How often those credentials are replaced could not be confirmed in the official documentation. The presigned URL page gives rough figures for EC2 and ECS, but none for Lambda.

This chapter's expiry is 5 minutes, so the effect should be small. Even so, a URL created just before the credentials expire stops working in under 5 minutes. Something like a share link valid for 7 days, created from Lambda, won't last 7 days. If you need a long expiry, consider a different mechanism.

This is the reverse of [Disabled, and still getting through for a while](/en/chapters/06-auth/deploy.md) in chapter 06. There, something you wanted to stop kept passing until it expired. Here, something you want to pass stops before it expires. Both come from the verifying side deciding on the information it has locally.
