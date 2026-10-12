---
title: "06 Auth: Cognito and Authorization"
sourceRevision: 4
---

# 06 Auth: Cognito and Authorization

The SPA is live, and notes now stay in a table. What's missing is whose notes they are.

In this chapter you'll add sign-in to the SPA, so that a signed-in user can read and write their own notes and nobody else's. This is also where the chapter 03 SPA and the chapter 05 API finally become one app.

The password never passes through this app's code. A request whose caller can't be established is rejected before the function is invoked. Someone else's note stays out of reach even if you know its ID. And on your machine, you can use the app as two different users without Cognito.

This chapter builds on [chapter 03](/en/chapters/03-spa.md) and [chapter 05](/en/chapters/05-dynamodb.md). The code is in `examples/06-auth/`. Note storage and optimistic locking use the chapter 05 code as it is, so all you write here is the part that changes for authentication and authorization.

## The big picture

<!-- section: 06.architecture -->

```figure
caption: The SPA signs in at Cognito managed login and exchanges the code for an access token.
type: sequence
actor browser: Browser | SPA from CloudFront + S3
actor cognito: Cognito managed login | user pool domain
step browser -> cognito: 1. redirect to sign in
note cognito: 2. password typed here, not in the SPA
step cognito --> browser: 3. redirect back with ?code=...&state=...
step browser -> cognito: 4. POST /oauth2/token (code + PKCE code_verifier)
step cognito --> browser: access token
```

```figure
caption: The JWT authorizer in API Gateway verifies the access token, and only requests that pass reach Lambda and the table.
node browser: Browser | SPA from CloudFront + S3
node api: API Gateway HTTP API | JWT authorizer: signature, issuer, expiry, client, scope
node fn: Lambda function | owner = claims.sub
node table: DynamoDB table | pk = OWNER#<sub>, sk = NOTE#<note id>
edge browser -> api: 5. GET /notes + access token
edge api -> fn: verified claims in the event
edge fn -> table
edge api -x browser: fails: 401/403, Lambda is not invoked
mark api
```

There are three new players.

A user pool is Amazon Cognito's directory of users. It verifies passwords and issues tokens. Managed login is the sign-in page that Cognito serves, on a different domain from your app. And the JWT authorizer is a feature of API Gateway HTTP API. It verifies the token attached to a request, and if the token fails, the function is never called.

### "Who is it?" and "May they?" are two questions

This chapter keeps two questions apart.

The first is **authentication**: who does this call come from? Cognito and the API Gateway JWT authorizer answer that one.

The second is **authorization**: may that person touch this note? The app code inside Lambda and the table's key answer that one.

Being signed in doesn't mean you may touch any note you like. Add authentication and forget authorization, and you end up with an API where anyone who has signed in can read someone else's note, as long as they know its ID.

### We don't keep passwords

You could store passwords yourself, check them, and build the reset procedure. This book doesn't. The damage when they leak is large, and there are too many details to get right. Leave that to Cognito, and the only thing this app ever handles is a verified token.

We don't use Amplify. A Cognito user pool works through the standard procedures of OAuth 2.0 and OpenID Connect (OIDC), and the SPA in this chapter calls those standard endpoints with a general-purpose OAuth library (oauth4webapi). Swap Cognito for another service that supports OIDC, and most of the SPA code stays the same.

The SPA and the API stay on separate origins, and the token travels in the `Authorization` header. No cookies. The other way to do it is to let the server side (a BFF) hold the token and give the browser only a cookie. Its advantage is that JavaScript in the browser can no longer see the token. [Chapter 09](/en/chapters/09-ssr.md) covers that.

## A few words first

<!-- section: 06.terms -->

Here are the words this chapter uses.

- access token: the token used to call an API. This is the one this chapter sends to the API
- ID token: the token that tells the app itself that sign-in happened and what the user's attributes are. It is not sent to the API
- refresh token: the token used to get a new access token. It arrives in the token endpoint's response, but the SPA in this chapter discards it without storing it
- authorization code: a short-lived voucher that the SPA receives after sign-in. It is exchanged for tokens at the token endpoint
- PKCE: a mechanism that keeps the voucher from being exchanged even if it is intercepted
- scope: a string attached to a token that expresses the range of what is permitted
- `sub`: an identifier that the user pool issues for each user and that does not change

An access token and an ID token are both in a format called JWT, and both are signed by the same user pool. You can't tell them apart by looking. That comes back later, in the API's configuration.

## Add "who" to the contract

<!-- section: 06.contract -->

The shape of a note is the same as in chapter 05. So is the list: a page of at most 20 summaries, with the body fetched through `GET /notes/:id`. The SPA's list screen shows the title and the update time, and fetches the body when you open a note. Two things are new.

<<< @/examples/06-auth/api/src/contract.ts{me}

<<< @/examples/06-auth/api/src/contract.ts{error}

`unauthenticated` (401) means "we don't know who this call comes from".

`quota_exceeded` (409) is the limit chapter 05's repository counts. One person holds at most 100 notes. In chapter 05 there was a single owner (`anonymous`), so that meant 100 in total. From this chapter on the owner is the token's `sub`, so it's 100 per user. All this chapter wrote is one line that hands the limit to the repository (`api/src/compose.ts`) and a few lines that turn the error into a 409 (`api/src/app.ts`). The counting is chapter 05's, unchanged.

There's no error for "not permitted" (403) on a note, and that's on purpose. Ask for someone else's note and you get `not_found`, the same answer as for a note that doesn't exist. A 403 would tell you that a note with that ID exists.

## Who is calling?

<!-- section: 06.identity -->

The app receives "who made the call" as a single function.

<<< @/examples/06-auth/api/src/identity.ts{identity}

There are two implementations. In AWS it reads the result that API Gateway verified, and locally it verifies a development token. The body of the app doesn't know which one is in use.

### In AWS, read what API Gateway verified

<<< @/examples/06-auth/api/src/identity.ts{api-gateway}

By the time the function runs, API Gateway has finished checking the token's signature, issuer, expiry, and the client it was issued to. The contents of the token (the claims) are in the event, under `requestContext.authorizer.jwt.claims`. The function doesn't verify a signature. It only reads the verified result.

Even so, the app checks two things once more. API Gateway already looks at both on the way in, so this is a **second layer of defense**.

- That `token_use` is `access`. An ID token is signed by the same user pool, so it passes the signature and issuer checks. But only an access token may be sent to the API. On the way in, the scope requirement you'll see later is what turns ID tokens away
- That `client_id` is this app's client. If you add a client for another app to the same user pool, a token issued to that client must not be able to call this API. On the way in, the authorizer checks the same thing as the audience

When the event has no authorizer information at all, the caller is treated as "nobody". That way, a route where someone forgot the authorizer doesn't turn into "let anyone through".

<<< @/examples/06-auth/api/src/lambda.ts{handler}

The Lambda entry point doesn't read the `Authorization` header. Identity comes from the claims that API Gateway verified, and from nowhere else.

### Authentication you can't forget to write

<<< @/examples/06-auth/api/src/app.ts{guard}

Of the routes, `/health` is the only one registered before this middleware. Every route after it returns 401 when there is no identity. Add a new route below it, and authentication is required with no way to forget it.

Checking in both API Gateway and Lambda looks like duplication, doesn't it? API Gateway is the main gate. An invalid request stops there, so the function isn't invoked and there's no function charge. The app's check is one more layer, for the day the configuration at the gate is off.

## Only your own notes are reachable

<!-- section: 06.authorization -->

<<< @/examples/06-auth/api/src/app.ts{routes}

There's almost no code for authorization. You won't find an if statement anywhere that checks "may this user touch this note?". There are two rules instead.

1. The owner passed to the service is always the token's `sub`. It is never taken from the path, the query, or the body
2. Notes are stored under their owner (`pk = OWNER#<owner>` from chapter 05)

With these two in place, someone else's note is "not found". When Bob calls `GET /notes/<id>` with the ID of Alice's note, the app looks for that ID under `OWNER#bob`. It isn't there, so the answer is 404. (What really goes where we wrote `bob` is the `sub`. With the local development sign-in that is `local-bob`, and in a real environment it is the ID the user pool issues.)

If you write the check in each place instead ("read the note, then compare the owner"), every new route is another chance to forget it. Here there is nothing to forget. That's why chapter 05 put the owner in the key while there was still only one user.

The invariant being kept is this one sentence.

**A request can read and write only the notes whose owner is that token's `sub`.**

The tests try to break it.

- Alice's notes do not appear in Bob's list
- When Bob specifies the ID of Alice's note, he gets the same 404 as for an ID that does not exist
- Bob can neither update nor delete Alice's note, even if he knows its ID and version
- Even if Bob writes `owner: alice` in the query, a header, and the body, the note is created under Bob

By the way, `sub` is not an email address. An email address can be changed, and can be reused by a different person. `sub` is an identifier that the user pool issues and that does not change. The official documentation also recommends using `sub` to identify a user.

### What goes in the logs

Who did what goes into the request log as `sub`. The token itself is never written to the logs. If an access token could be read from the logs, anyone who can see them could impersonate that user until the token expires. A test checks that the logs don't contain the token.
