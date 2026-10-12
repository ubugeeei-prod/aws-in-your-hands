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
