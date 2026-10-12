---
title: "07 File Upload: Presigned URLs and S3"
sourceRevision: 4
---

# 07 File Upload: Presigned URLs and S3

Chapter 06 let a signed-in user read and write their own notes and nobody else's. This chapter lets them attach images to a note.

The browser sends each image straight to S3, and the API never receives it. All the API does is issue a permit that says this person may put one image of this type, up to this size, at this place.

The prerequisite is [chapter 06](/en/chapters/06-auth.md). The code is in `examples/07-uploads/`. Note storage is imported unchanged from chapter 05 and sign-in and authorization from chapter 06, so what you write here is only what attachments add.

## The big picture

<!-- section: 07.architecture -->

```figure
caption: The browser gets permission from the API, sends the image straight to S3, and reads it straight from S3.
type: sequence
actor browser: Browser | SPA
actor api: API Gateway + Lambda | Authorization: Bearer <access token>
actor s3: S3 bucket | Block Public Access on
note browser: body: { contentType }
step browser -> api: 1. POST /notes/{id}/attachments
step api -> api: looks up the note under caller's sub
step api -> api: key = u/<sub>/<note id>/<attachment id>
step api -> api: signs a POST policy, role credentials
step api --> browser: 201 attachmentId, upload: url, fields
step browser -> s3: 2. POST fields, file (no token)
step s3 --> browser: 204, or 4xx if the policy is not met
note s3: tag: upload-state=pending
step browser -> api: 3. PUT .../attachments/{attachmentId}
step api -> s3: HeadObject
step api -> s3: DeleteObjectTagging
step api -> api: DynamoDB PutItem (ATTACHMENT#...)
step browser -> api: 4. GET /notes/{id}/attachments
step api --> browser: id, size, url (presigned GET, 5 min)
step browser -> s3: 5. img src = presigned GET (no token)
mark s3
```

This chapter creates one bucket for uploads and adds attachment records to chapter 06's table.

### Why the image doesn't go through the API

You could send the image to the API and have Lambda write it to S3, but this chapter doesn't. Through Lambda, the function runs and uses memory in proportion to the size of the image, and one Lambda invocation accepts at most 6 MB. Moving bytes is what S3 is good at, so the image goes to S3 directly.

That leaves one problem to solve. S3 knows nothing about chapter 06's access token. When the browser sends a request straight to S3, S3 needs some way to learn who this is and what they may do. That way is the presigned URL.

### Three separate requests

As steps 1, 2, and 3 in the big-picture figure show, an attachment is made of three separate requests: one that gets a permit, one that sends the image to S3, and one that reports that it was sent.

Because what looks like one operation is really three, it can stop partway. Step 2 may finish and step 3 never arrive, or the function may crash in the middle of step 3. [Design and Build](/en/chapters/07-uploads/build.md) deals with those cases in detail.

## Issue the permit

<!-- section: 07.permit -->

The limits on attachments and the shape of the request come first.

<<< @/examples/07-uploads/api/src/contract.ts{limits}

<<< @/examples/07-uploads/api/src/contract.ts{upload}

The caller chooses the image type and nothing else. The request can't state where the image goes or how large it may be, and anything like that in it is ignored.

### What a presigned URL hands over

A presigned URL is a URL that contains a signature and has an expiry. A request to S3 is normally signed with AWS credentials. A presigned URL has that signing done ahead of time and embedded in the URL, so whoever receives it can perform that one operation without holding any AWS credentials.

The official documentation says three things you need to know.

- A presigned URL uses the permissions of the principal that created it. What that principal can't do, the URL can't do
- A presigned URL is a bearer token. It works for anyone who holds it
- It can be used any number of times until it expires

In this chapter the Lambda function creates the URLs. Whatever the function's execution role allows is therefore the outer limit of every permit the API issues, which is one more reason to keep that role narrow.

### Where size and type can be enforced

Checking the size in browser code enforces nothing, because anyone can skip the check and send to S3 directly. The API never sees the image, so it can't enforce anything either. Only S3, which receives the image, can.

There are two ways to make S3 do it.

| | Presigned PUT | Presigned POST (this chapter) |
| --- | --- | --- |
| Shape | `PUT` to a signed URL | `POST` a form that carries a signed policy |
| Type | With `Content-Type` in the signature, only that value is accepted | A policy condition can require a match |
| Size | No way to state a range | `content-length-range` sets a minimum and a maximum |
| Refusing overwrites | `PutObject` is among the operations that accept `If-None-Match` | POST Object is not on that list |

This chapter uses POST, because POST is the one for which the official documentation states plainly how to have S3 itself refuse anything over 5 MB. A POST policy is a document listing the conditions an upload must meet, and `content-length-range` is described as "the minimum and maximum allowable size for the uploaded content".

With PUT, the API could ask for the size first and put `Content-Length` into the signature, and then only that size should be accepted. The documentation goes no further than a general recommendation to sign every header you plan to send, though, and no statement about `Content-Length` in particular could be found. A method that couldn't be confirmed isn't made the center of the defense.

Choosing POST means giving up the last row of the table, refusing overwrites. [The gap this design leaves](/en/chapters/07-uploads/build.md) in Design and Build explains what that costs.

<<< @/examples/07-uploads/api/src/s3-object-store.ts{presign-upload}

`createPresignedPost` sends nothing to S3. It computes and signs inside the function. S3 checks the policy later, when the browser's POST arrives.

Each value in `Fields` becomes a condition that requires an exact match. The values are the key, the `Content-Type`, and the tag, and the size range and the expiry (5 minutes) are added to them. Nothing is left for the browser to choose. A test confirms that no open-ended condition such as `starts-with` is used.

This part has not been confirmed against real S3. Sending the tag in the form is the least certain piece. The POST Object documentation lists a `tagging` field, but the table of POST policy conditions doesn't list `tagging` by name. Because the rule is that every form field must appear among the conditions, the reading taken here is that the `{"tagging": "..."}` condition the SDK writes should pass. The steps to check it are in the [verification notes for this chapter](/en/chapters/07-uploads/wrap.md).

### What S3 doesn't look at

S3 checks that the `Content-Type` written in the form matches the policy. It doesn't check that the file really is a PNG, so HTML that calls itself `image/png` can be stored.

This chapter takes two measures. One is to narrow the allowed types to four image formats (SVG is left out because it can contain scripts). The other is to serve images from a different origin from the app (the S3 domain). Inspecting the contents takes processing that runs after the upload ([chapter 08](/en/chapters/08-async.md) adds it).

## The API decides the key

<!-- section: 07.keys -->

An object key is the name that identifies an object within a bucket. It can contain `/`, but there are no folders.

<<< @/examples/07-uploads/api/src/keys.ts{keys}

The key is `u/<owner>/<note ID>/<attachment ID>`, and the server decides all three parts. The owner is the `sub` of the verified token. The note ID is one whose existence under that owner has been confirmed. The attachment ID is built from the time and random numbers.

The file name doesn't go into the key. If a string the user typed went into the key, you would have to check every time whether `../` or `/` could point at someone else's location. With nothing from the user in the key, there is nothing to check.

<<< @/examples/07-uploads/api/src/attachments.ts{request-upload}

The approach is the same as in chapter 06. No if statement checks whether this note belongs to this person. The code only looks for the note under the caller's `sub`. Someone else's note isn't found, so the answer is 404. It isn't 403 for the same reason as in chapter 06, which is to avoid revealing whether a note ID is in use.

<<< @/examples/07-uploads/api/src/app.ts{routes}

The body of a permit request is read up to 1 KiB and no further. The image itself doesn't pass through here. Only a small JSON that names the type of the image does.

<<< @/examples/07-uploads/api/src/app.ts{compose}

The four routes are passed to chapter 06's `createApp` as its second argument. The chapter 06 app adds the routes it is given to its inner router. So the added routes also sit behind the sign-in guard and return 401 without a token. The error shape, the CORS headers, and the request ID are chapter 06's, unchanged.

The tests try to break this in the following ways.

- When Bob asks for a permit on Alice's note, he gets the same 404 as for a note that doesn't exist
- Even if Bob writes Alice's name and Alice's key in the query, a header, and the body, the key that comes back starts with `u/bob/`
- Bob can't complete, list, or delete Alice's attachment, even if he knows its ID
- When a part of the key contains `/`, `..`, or an empty string, the function that builds the key throws

### 100 permits per person per day

The last check `requestUpload` makes is the cap on the number of permits.

Issuing a permit puts nothing in the bucket until the permit is used, so looking at the bucket doesn't tell you how many permits are out. If nobody counted, a signed-in user could take as many permits as they liked and put up to 5 MB with each one. S3 deletes what was never completed after a day, but until then it costs storage.

So the API counts the permits it issues.

<<< @/examples/07-uploads/api/src/permit-ledger.ts{ledger}

The count is kept in the same table as the notes. No new data store is added.

<<< @/examples/07-uploads/api/src/permit-ledger.ts{dynamodb}

The owner's partition holds one item per date (UTC), and the count in it goes up by one each time. Adding to the count and checking that it is below the cap happen in a single update, so two requests that arrive together can't both take the last permit. It is the same pattern chapter 05 uses to count notes.

At the cap, the API returns 429 `upload_quota_exceeded`. The cap on notes was a 409, but the cap on permits is a 429, because waiting, which here means the date changing, lets requests through again.

What is counted is permits issued, not permits used. A permit that is never used still counts as one. Requests turned away with a 404, or by the cap of 10 attachments per note, are not counted.

With this cap, one person can put at most 100 uncompleted objects, 500 MB, in a day. This chapter doesn't delete the per-date items, so one small item remains for each day on which someone uploaded.

One thing this cap doesn't prevent. As noted above, a permit can be used any number of times until it expires (5 minutes). Each use overwrites the same key, so the amount stored doesn't grow, but this cap can't limit the number of requests to S3.
