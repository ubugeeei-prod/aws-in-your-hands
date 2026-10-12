---
title: "07 File Upload: Presigned URLs and S3"
sourceRevision: 1
---

# 07 File Upload: Presigned URLs and S3

You can sign in, and you can read and write your own notes and nobody else's. Next, let's attach images to a note.

In this chapter the browser sends the image straight to S3. The API never receives it. All the API does is hand out a permit: "this person may put one image of this type, up to this size, at this place."

You'll need [chapter 06](/en/chapters/06-auth.md). The code is in `examples/07-uploads/`. Note storage comes from chapter 05 and sign-in and authorization from chapter 06, imported as they are, so what you write here is only what attachments add.

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

Two things are new: one bucket for uploads, and an "attachment record" that joins the notes in chapter 06's table.

### Why not go through the API?

Send the image to the API and let Lambda write it to S3. That's the obvious design, isn't it? We won't do it.

Through Lambda, the function runs and holds memory for as long and as much as the image takes. And one Lambda invocation accepts at most 6 MB. Moving bytes is what S3 is good at, so S3 gets to do it directly.

That leaves one problem. S3 knows nothing about chapter 06's access token. When the browser talks to S3 itself, how does S3 learn who this is and what they may do? The answer is the presigned URL.

### Three requests, not one

Look at steps 1, 2, and 3 in the diagram. An attachment is made of three separate requests: get a permit, send to S3, say that you sent it.

When one operation is really three, it can stop partway. Step 2 finishes and step 3 never arrives. The function dies in the middle of step 3. Most of the second half of this chapter is about that.

## Writing the permit

<!-- section: 07.permit -->

First, the rules.

<<< @/examples/07-uploads/api/src/contract.ts{limits}

<<< @/examples/07-uploads/api/src/contract.ts{upload}

The caller gets to choose the image type and nothing else. Not where it goes, not how big it may be. Anything like that in the request is ignored.

### What a presigned URL hands over

A presigned URL is a URL with a signature and an expiry built in. A request to S3 is normally signed with AWS credentials. A presigned URL is that signature made ahead of time and put into the URL. Whoever receives it can perform that one operation without holding any AWS credentials.

The official documentation says three things that matter here.

- A presigned URL uses the permissions of the principal who created it. What that principal cannot do, the URL cannot do
- A presigned URL is a bearer token. It works for anyone who holds it
- It can be used any number of times until it expires

In this chapter the Lambda function creates the URLs. So whatever the function's execution role allows is the outer limit of every permit the API hands out. One more reason to keep that role narrow.

### Where can size and type actually be enforced?

Checking the size in browser code enforces nothing: skip the check and send to S3 directly. The API never sees the image, so it can't enforce anything either. Only S3, which receives the image, can.

There are two ways to make S3 do it.

| | Presigned PUT | Presigned POST (this chapter) |
| --- | --- | --- |
| Shape | `PUT` to a signed URL | `POST` a form that carries a signed policy |
| Type | With `Content-Type` in the signature, only that value is accepted | A policy condition can require a match |
| Size | No way to state a range | `content-length-range` sets a minimum and a maximum |
| Refusing overwrites | `PutObject` is among the operations that accept `If-None-Match` | POST Object is not on that list |

We chose POST. It is the one where the official documentation states plainly how to have S3 itself refuse "more than 5 MB". A POST policy is a document listing conditions an upload must meet, and `content-length-range` is described as "the minimum and maximum allowable size for the uploaded content".

With PUT, the API could ask for the size first and put `Content-Length` into the signature, and then only that size should be accepted. But the documentation goes no further than a general recommendation to sign every header you plan to send. We found no statement about `Content-Length` in particular. Something we couldn't confirm doesn't get to be the pillar of a defence.

Choosing POST costs something too: the last row of the table. It comes back in "Cleaning up what is left".

<<< @/examples/07-uploads/api/src/s3-object-store.ts{presign-upload}

`createPresignedPost` sends nothing to S3. It computes and signs inside the function. S3 checks the policy later, when the browser's POST arrives.

Each value in `Fields` becomes an "exactly this" condition: the key, the `Content-Type`, the tag. Then the size range and the expiry (5 minutes). Nothing is left for the browser to choose. A test confirms that no open-ended condition such as `starts-with` is used.

Here's the honest part: this has not been run against real S3. The tag in the form is the least certain piece. The POST Object documentation lists a `tagging` field. But the table of POST policy conditions does not list `tagging` by name. Since the rule is that every form field must appear among the conditions, we read it as: the `{"tagging": "..."}` condition the SDK writes should pass. The steps to check that are in the notes at the end of the chapter.

### What S3 does not look at

S3 checks that the `Content-Type` written in the form matches the policy. It does not check that the file really is a PNG. HTML calling itself `image/png` can be stored.

This chapter does two things about that. It narrows the allowed types to four image formats (SVG is left out because it can contain script). And it serves images from an origin other than the app's (the S3 domain). Inspecting the content needs a process that runs after the upload ([chapter 08](/en/chapters/08-async.md) adds one).

## The API decides the key

<!-- section: 07.keys -->

An object key is the name that identifies an object in a bucket. It may contain `/`, but there are no folders.

<<< @/examples/07-uploads/api/src/keys.ts{keys}

A key is `u/<owner>/<note ID>/<attachment ID>`. The server decides all three parts. The owner is the `sub` of the verified token. The note ID is one that was found under that owner. The attachment ID is made from the clock and a random suffix.

The file name is not part of the key. Put a string the user typed into a key, and every time you have to wonder whether `../` or `/` can point it at someone else's place. Leave it out, and there is nothing to wonder about.

<<< @/examples/07-uploads/api/src/attachments.ts{request-upload}

This continues chapter 06's idea. There is no `if` that asks "does this note belong to this person?" The note is simply looked up under the caller's `sub`. Someone else's note isn't found there, so the answer is 404. Not 403, for the same reason as in chapter 06: the answer should not reveal which note IDs are in use.

<<< @/examples/07-uploads/api/src/app.ts{routes}

The routes are added to chapter 06's app as it is. Its sign-in middleware is registered first, so the four new routes answer 401 without a token as well.

The tests try to break it like this.

- Bob asks for a permit on Alice's note and gets the same 404 as for a note that does not exist
- Bob writes Alice's name and a key of Alice's into the query, the headers, and the body, and the key that comes back still starts with `u/bob/`
- Bob knows the ID of Alice's attachment and still cannot finish, list, or delete it
- A `/`, a `..`, or an empty string in any part of a key makes the key builder throw

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

There is no row for "upload in progress". Handing out a permit writes nothing anywhere. A permit that is never used leaves no trace.

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

## Running it locally

<!-- section: 07.local -->

Copy `examples/07-uploads/.env.example` to `.env` in the same place.

<<< @/examples/07-uploads/.env.example

Use two terminals.

```bash
vp run dev:uploads:api
vp run dev:uploads:web
```

Open <http://localhost:5173>, sign in, create a note, and open it. Choose a file under "Images" and the image is attached. Sign in as `bob` in another browser and neither Alice's note nor her image is visible.

No Docker, no AWS credentials, no bucket.

### Standing in for S3

<<< @/examples/07-uploads/api/src/object-store.ts{port}

The app receives "a place that holds bytes" as this interface. In AWS it is S3. On your laptop it is an in-memory implementation.

<<< @/examples/07-uploads/api/src/local-store-http.ts{local-store}

<<< @/examples/07-uploads/api/src/dev.ts{dev}

The local implementation has an endpoint for the form inside the development server. Its permits carry a small policy signed with the development secret, and it refuses a different key, a different type, a file that is too large, and an expired permit.

This is not an emulation of S3. It is a stand-in that lets the app's ordering and authorization run. What it does not reproduce:

- The real evaluation of a POST policy: what S3 refuses, and with what response
- The bucket's CORS. Locally the development server returns its own CORS headers
- IAM: whether the execution role has enough permissions
- Lifecycle rules. Locally, a pending object stays forever
- URLs expiring early when credentials expire

An S3-compatible server in a container would get you a little closer to the real thing. That needs Docker, and the Docker daemon is not part of the Nix shell. This chapter provides no task for it. The daemon was not running where this was written, so it was not tried either.

### The screen

The SPA is built on chapter 06's `web/`. Sign-in, loading the configuration, and parsing routes are imported from chapter 06's files as they are. The only addition is the images panel under the note form.

<<< @/examples/07-uploads/web/src/check-file.ts{check-file}

When you choose a file, the browser checks the type and size as well. That is a courtesy, not a control. Send a file that would fail the check directly, and S3 refuses it (locally, the in-memory implementation does).

## Getting ready for AWS

<!-- section: 07.infra -->

The stack (`AihUploads`) is chapter 06's stack with one more bucket, two more permission statements, and four more routes.

### The bucket

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{uploads-bucket}

All four Block Public Access settings are on. Neither an ACL nor a bucket policy can make an object in this bucket public. A presigned URL is not "public": it is a request signed by the role, so it works under these settings.

CORS allows two origins (the deployed SPA and the local development server) and the method `POST` only. The browser's JavaScript needs it to read the result of a POST to another origin. Showing an image with `<img>` needs no CORS rule, so `GET` is not listed.

There are two lifecycle rules. One is the cleanup of pending objects from before. The other aborts incomplete multipart uploads. A multipart upload sends a large object in parts, and the parts of an upload that was neither completed nor aborted stay stored, and billed. This chapter's app never starts a multipart upload. The rule is there anyway because the official documentation recommends it, and so that it isn't forgotten on the day you add support for large files.

`removalPolicy` is `DESTROY`. Destroying the stack deletes the bucket, once it has been emptied.

### What the function may do

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{uploads-role}

The function is allowed five operations on keys that start with `u/`. The function itself never calls `s3:PutObject` or `s3:PutObjectTagging`. The browser's upload performs them, using the function's signature. If the role that signed lacks the permission, the permit doesn't work.

`s3:ListBucket` is not there for listing. According to the official documentation, `HeadObject` on a key that does not exist returns 404 if the caller has this permission and 403 if not. A 403 cannot tell "not uploaded yet" from "not allowed".

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{routes}

The tests check the template for the following.

- Both buckets have all four Block Public Access settings on
- The uploads bucket's policy contains no `Allow` at all
- There is one CORS rule, its only method is `POST`, and it contains no `*`
- The lifecycle rules are the two above: the pending tag and multipart uploads
- The function's S3 permissions are the six operations above, with no `*` action and no `*` resource
- Every route except `/health`, the four new ones included, has the JWT authorizer and a scope

The resource types are the same 19 as in chapter 06. The uploads bucket adds no new type. The pinned cdkd has a dedicated implementation for `AWS::S3::Bucket`, and its package contains code that handles the lifecycle and CORS settings; we looked. The three types without a dedicated implementation (`AWS::CloudFront::Function`, `AWS::Cognito::UserPoolClient`, `AWS::Cognito::UserPoolDomain`) are the same as in chapter 06.

## Deploying

<!-- section: 07.deploy -->

From here on, nothing has been run. The steps and tasks are prepared, and that's where it stops.

```bash
vp run uploads:infra:diff
vp run uploads:infra:deploy
vp run uploads:user:create you@example.com
vp run uploads:publish
vp run uploads:smoke:web
vp run uploads:smoke:api
```

The flow is chapter 06's. The difference is `uploads:smoke:api`. Run it with an access token in the environment variable `AIH_ACCESS_TOKEN` and it tries the following against the real bucket.

- That S3 refuses three uploads: a file that is too large, a different `Content-Type`, and a different key
- That a small PNG can be sent, finished, and found in the list
- That the returned URL returns the image without a token
- That after a delete, the same URL no longer returns the image

Most of this chapter's "not yet" can be settled by this task. Without a token, it only checks that requests without one are turned away, and prints that the upload path was not checked.

This is a different stack from chapter 06's (`AihNotesApp`). The user pool and the table are different too, so with both deployed, users and notes are separate.

Checking for drift is the same as before.

```bash
vp run uploads:infra:drift
```

## If you're coming from R2

Cloudflare R2 has presigned URLs too. According to R2's official documentation, the supported operations are `GET`, `HEAD`, `PUT`, and `DELETE`, and POST uploads through an HTML form are not currently supported. So this chapter's `content-length-range` approach does not carry over to R2 as it is. The same documentation says that presigned URLs work only on the S3 API domain and cannot be used with custom domains, and that they should be treated as bearer tokens.

If you use R2 from Workers, you may well skip presigned URLs and read and write from inside the Worker through a binding. In that design the image passes through the Worker. That is the "through the function" approach this chapter avoided, though the limits and the price of passing through differ between a Worker and Lambda. We did not check those limits and prices.

## What it costs

Amounts are in USD, for the Tokyo Region, before tax. The inputs and unit prices are in [Pricing calculations](/en/reference/pricing.md).

S3 charges for three things. The amount stored (USD 0.025 per GB a month for the first 50 TB). The number of requests (USD 0.0047 per 1,000 PUT, POST, or LIST requests, and USD 0.0037 per 10,000 GET and other requests). And the data leaving S3 for the internet (USD 0.114 per GB for the first 10 TB). Data coming from the internet into S3 costs USD 0.

One example: 10,000 images of 1 MB uploaded in a month, and images displayed 100,000 times. It counts only what is added on top of chapter 06's app.

| Item | List price |
| --- | --- |
| S3 storage (10 GB) | 0.25 |
| S3 requests (10,000 POST, 10,000 HEAD, 100,000 GET) | 0.09 |
| Data transfer out of S3 (about 97.7 GB) | 11.13 |
| The API side (API Gateway, Lambda, logs, and DynamoDB for 120,000 requests) | 0.29 |
| Subtotal | **11.76** |

As you can see, almost all of it is data transfer. Images cost more to hand out than to keep. This calculation assumes the browser cache does not help at all. A presigned URL is different every time, so when the URL changes the browser loads the same image again. For an app with many views, consider putting CloudFront in front.

The subtotal after the monthly free allowances is 11.67. But what is deducted are the Lambda and logs allowances, which are shared with chapter 06's usage. At 1,000,000 requests a month, as in chapter 06's example, no Lambda allowance is left. The data transfer price is described as applying "beyond the free tier", but the size of that free tier was not confirmed, so nothing is deducted for it. The same goes for an S3 free tier.

Storing tags is charged too, but a tag is on an object only until the upload is finished, so it is not in the calculation. The request that removes the tag is not billed, according to the official documentation.

**In a month when nobody uses the app, the stored images are still charged for.** 10 GB is USD 0.25 a month. Orphaned objects are counted at the same price. That is why cleanup matters.

Destroying the stack deletes the bucket and the images in it. What remains is listed under "Cleaning up".

## Where it goes wrong

| When this happens | Look here |
| --- | --- |
| `dev:uploads:api` stops and names `UPLOADS_STORE` | Is there an `examples/07-uploads/.env`? Copy `.env.example` |
| The screen says "The upload was refused (HTTP 403)" | Did more than 5 minutes pass since the permit was issued? Choose the file again |
| The POST to S3 answers 403 | A form field whose value differs from the policy does not meet its condition. Are you sending the `fields` the SDK returned as they are, with the `file` field last? What S3 actually puts in the response has not been checked yet |
| The POST to S3 shows up as a CORS error in the browser console | Does the SPA's origin match the bucket's CORS `AllowedOrigins` exactly? Look at the status code with `curl` first |
| The finish call answers 409 `upload_missing` | Did the POST to S3 answer 204? If not, there is no object |
| The finish call answers 500 and the log shows a 403 | Without `s3:ListBucket` on the execution role, `HeadObject` on a missing key answers 403 |
| The finish call answers 409 `upload_rejected` | More than 15 minutes passed since the upload. Send it again |
| An image stops showing after a while | The URL's lifetime (5 minutes). The screen fetches the list again. If that doesn't help, the object is gone |
| S3 answers `ExpiredToken` | The credentials that signed the URL have expired. Fetch the list again to get URLs signed with fresh ones |

## Before production

- **Close the replay of a form.** See "A gap this design leaves open"
- **Run the sweep on a schedule.** As a task run by hand, it will be forgotten one day ([chapter 08](/en/chapters/08-async.md))
- **Inspect the content.** S3 does not look at whether a file really is an image. Add a check that runs after the upload
- **Rethink delivery.** With many views, put CloudFront in front. Both the data transfer charges and the caching change
- **Protect the bucket.** Set `removalPolicy` to `RETAIN` and consider versioning. With versioning on, lifecycle rules behave differently
- **Set a limit per user.** This chapter's only limit is 10 images per note. Nothing limits how many notes one user creates
- **Remove the local origin.** Take `http://localhost:5173` out of the bucket's CORS and the API's CORS
- **Record access.** Who used a presigned URL does not appear in the API's logs. You need records on the S3 side (this book does not cover them)

## Cleaning up

<!-- section: 07.cleanup -->

```bash
vp run uploads:empty --yes
vp run uploads:unpublish --yes
vp run uploads:infra:destroy
```

The pinned cdkd will not delete a bucket that is not empty, so the two buckets are emptied first. `uploads:empty` deletes the uploaded images and `uploads:unpublish` deletes the SPA's files. Without `--yes`, both only count.

`uploads:infra:destroy` deletes the buckets, the table, the user pool, the function, the API, and the distribution. Images, notes, and users cannot be brought back.

What remains is the storage that cdkd's bootstrap created (chapter 02) and the deployment files in it.

::: details Verification notes for this chapter

**Checked locally.** The API tests (authorization, what a permit contains, finishing, the deadline, the limit), the tests that stop partway (the six rows of the table above, the sweep, and the replay of a form), key building, the contents of the POST policy and the presigned GET that the SDK produces (signed with made-up credentials and never sent to S3), the shape of the DynamoDB requests, the infrastructure assertions, type checking, the SPA build, and synth. In addition, with `dev:uploads:api` and `dev:uploads:web` running, a browser was driven automatically to check the following: signing in, creating a note, choosing a file and seeing the image displayed, a 404 for another user's permit, list, and finish, refusal of a file that is too large, a different type, and a different key, the same result from calling finish twice, and the image URL no longer loading after a delete and after deleting the note.

**Not checked yet.** Nothing has been run against AWS. None of `uploads:infra:deploy`, `uploads:user:create`, `uploads:publish`, `uploads:smoke:web`, `uploads:smoke:api`, `uploads:sweep`, `uploads:infra:drift`, `uploads:empty`, `uploads:unpublish`, or `uploads:infra:destroy`. So the following are unconfirmed on real S3: that S3 accepts a presigned POST with a `tagging` field. That S3 refuses on the `content-length-range` and `Content-Type` conditions, and with what response. That a POST from the browser passes the bucket's CORS rule. That `HeadObject` right after the POST finds the object (the statement on strong consistency names PUT and DELETE, and does not name POST Object). That the lifecycle rule deletes pending objects. That it leaves objects alone after `DeleteObjectTagging`. The DynamoDB implementation (`dynamodb-attachment-repository.ts`) has the shape of its requests pinned by tests and has been sent to neither DynamoDB Local nor the real service. The lifetime of the execution role's credentials could not be confirmed from the official documentation. No S3-compatible local implementation was used (the Docker daemon was not running).

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Writing the permit | `examples/07-uploads/api/src/contract.ts`, `api/src/object-store.ts`, `api/src/s3-object-store.ts`, `api/test/s3-object-store.test.ts` | `test:unit` |
| The API decides the key | `examples/07-uploads/api/src/keys.ts`, `api/src/attachments.ts`, `api/src/app.ts`, `api/test/keys.test.ts`, `api/test/app.test.ts` | `test:unit` |
| Two stores, one order | `examples/07-uploads/api/src/attachments.ts`, `api/src/attachment-repository.ts`, `api/src/dynamodb-attachment-repository.ts`, `api/src/client.ts`, `api/test/partial-failure.test.ts`, `api/test/harness.ts` | `test:unit` |
| Cleaning up what is left | `examples/07-uploads/api/src/sweep.ts`, `scripts/sweep.ts`, `infra/lib/uploads-stack.ts` | `test:unit`, `uploads:sweep` |
| Showing the image | `examples/07-uploads/api/src/s3-object-store.ts`, `api/src/attachments.ts`, `api/src/lambda.ts` | `test:unit` |
| Running it locally | `examples/07-uploads/api/src/dev.ts`, `api/src/memory-object-store.ts`, `api/src/local-store-http.ts`, `api/src/compose.ts`, `api/src/env.ts`, `.env.example`, `web/` | `dev:uploads:api`, `dev:uploads:web`, `typecheck:uploads:web`, `lint:uploads:web`, `build:uploads:web` |
| Getting ready for AWS | `examples/07-uploads/infra/lib/uploads-stack.ts`, `infra/bin/app.ts`, `infra/test/uploads-stack.test.ts`, `cdk.json` | `uploads:infra:synth`, `test:unit` |
| Deploying | `examples/07-uploads/scripts/write-config.ts`, `scripts/user.ts`, `scripts/smoke.ts`, `tools/src/site/`, `tools/src/infra/` | `uploads:infra:diff`, `uploads:infra:deploy`, `uploads:user:create`, `uploads:publish`, `uploads:smoke:web`, `uploads:smoke:api`, `uploads:infra:drift` |
| Cleaning up | `examples/07-uploads/scripts/empty-uploads.ts`, `scripts/user.ts`, `tools/src/site/unpublish.ts` | `uploads:empty`, `uploads:unpublish`, `uploads:infra:destroy`, `uploads:user:delete` |
| What it costs | `data/pricing/` | `test:unit` |

**Primary sources** (all checked on 2026-10-11)

- [Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), [Uploading objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [POST Policy](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-HTTPPOSTConstructPolicy.html), [POST Object](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/RESTObjectPOST.html), [Authenticating Requests: Using Query Parameters](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-query-string-auth.html). On the day they were checked, the earlier URLs of these three under `/AmazonS3/latest/API/` redirected to the table of contents, so they were read under `/developerguide/`
- [How to prevent object overwrites with conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)
- [Working with Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html), [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [Expiring objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html), [Configuring a bucket lifecycle configuration to delete incomplete multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html), [Tagging your objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-tagging.html)
- [Using cross-origin resource sharing (CORS)](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html), [Elements of a CORS configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html), [Blocking public access to your Amazon S3 storage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html) (strong consistency)
- AWS Price List bulk API: [S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json), [Data Transfer](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json)
- [@aws-sdk/s3-presigned-post 3.1149.0](https://www.npmjs.com/package/@aws-sdk/s3-presigned-post/v/3.1149.0) (type definitions and source)
- [Cloudflare R2: Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
