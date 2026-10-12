---
title: "06 Auth: Cognito and Authorization"
sourceRevision: 6
---

# 06 Auth: Cognito and Authorization

The SPA is online and notes now stay in a table, but nothing yet says whose notes they are. This chapter adds sign-in to the SPA so that a signed-in user can read and write their own notes and nobody else's. It is also where the chapter 03 SPA and the chapter 05 API first become one app.

In this chapter's app, the password never passes through the app's code. A request whose caller can't be established is rejected before the function is invoked. Someone else's note stays out of reach even if you know its ID. On your machine, you can use the app as two different users without Cognito.

The prerequisites are [chapter 03](/en/chapters/03-spa.md) and [chapter 05](/en/chapters/05-dynamodb.md). The code is in `examples/06-auth/`. Note storage and optimistic locking use the chapter 05 code unchanged, so what you write here is only the part that changes for authentication and authorization.

## The big picture

<!-- section: 06.architecture -->

```figure
caption: The SPA signs in at Cognito managed login and exchanges the authorization code for an access token.
type: sequence
actor browser: Browser | SPA from CloudFront + S3
actor cognito: Cognito managed login | user pool domain
step browser -> cognito: 1. redirect to the sign-in page
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

Three things are new in this chapter. A user pool is Amazon Cognito's directory of users, and it verifies passwords and issues tokens. Managed login is the sign-in page Cognito serves, on a different domain from your app. The JWT authorizer is a feature of API Gateway HTTP API that verifies the token attached to a request and doesn't invoke the function when the token fails.

### Authentication and authorization are separate questions

This chapter keeps two questions apart.

The first is **authentication**, which asks who a call comes from. Cognito and the API Gateway JWT authorizer answer it.

The second is **authorization**, which asks whether that person may touch this note. The app code inside Lambda and the table's key answer it.

Being signed in doesn't mean you may touch any note. If you add authentication and forget authorization, you get an API where anyone who has signed in can read someone else's note as long as they know its ID.

### Passwords are left to Cognito

You could store passwords yourself, check them, and build the reset procedure, but this book doesn't. The damage when passwords leak is large, and getting them right takes care over many details. With Cognito doing that work, the only thing this app handles is a verified token.

The book doesn't use Amplify. A Cognito user pool works through the standard procedures of OAuth 2.0 and OpenID Connect (OIDC), and this chapter's SPA only calls those standard endpoints with a general-purpose OAuth library (oauth4webapi). If you replace Cognito with another service that supports OIDC, most of the SPA code stays the same.

The SPA and the API stay on separate origins, and the token travels in the `Authorization` header. Cookies aren't used. The alternative is to let the server side (a BFF) hold the token and give the browser only a cookie, which has the advantage that JavaScript in the browser can no longer see the token. [Chapter 09](/en/chapters/09-ssr.md) covers that approach.

## Terms used in this chapter

<!-- section: 06.terms -->

These are the terms this chapter uses.

- An access token is the token used to call an API. It is the one this chapter sends to the API
- An ID token tells the app itself that sign-in happened and what the user's attributes are. It is not sent to the API
- A refresh token is used to get a new access token. It arrives in the token endpoint's response, but this chapter's SPA discards it without storing it
- An authorization code is a short-lived voucher the SPA receives after sign-in. The SPA exchanges it for tokens at the token endpoint
- PKCE is a mechanism that keeps an intercepted authorization code from being exchanged
- A scope is a string attached to a token that states the range of what is permitted
- `sub` is an identifier the user pool issues for each user, and it does not change

An access token and an ID token are both JWTs, and the same user pool signs both. You can't tell them apart by looking, so the API has to confirm, in its configuration and in its code, that what it was sent is an access token.

## Add the caller to the contract

<!-- section: 06.contract -->

The shape of a note is the same as in chapter 05. The list is the same too: a page of at most 20 summaries, with the body fetched through `GET /notes/:id`. The SPA's list screen shows the title and the update time and fetches the body when you open a note. The contract gains two things.

<<< @/examples/06-auth/api/src/contract.ts{me}

<<< @/examples/06-auth/api/src/contract.ts{error}

`unauthenticated` (401) means the API doesn't know who the call comes from.

`quota_exceeded` (409) means the request hit the cap that chapter 05's repository counts. One person holds at most 100 notes. In chapter 05 there was a single owner (`anonymous`), so that meant 100 in total. From this chapter on the owner is the token's `sub`, so the cap is 100 per user. This chapter adds only one line that passes the cap to the repository (`api/src/compose.ts`) and a few lines that turn the error into a 409 (`api/src/app.ts`). The counting is unchanged from chapter 05.

There is deliberately no error for "not permitted" (403) on a note. Asking for someone else's note returns `not_found`, the same as asking for a note that doesn't exist, because a 403 would reveal that a note with that ID exists.

## Establish the caller

<!-- section: 06.identity -->

The app receives the logic that works out who made the call as a single function.

<<< @/examples/06-auth/api/src/identity.ts{identity}

It has two implementations. On AWS it reads the result API Gateway verified, and locally it verifies a development token. The body of the app doesn't know which one is in use.

### On AWS, read what API Gateway verified

<<< @/examples/06-auth/api/src/identity.ts{api-gateway}

By the time the function runs, API Gateway has finished checking the token's signature, issuer, expiry, and the client it was issued to. The token's contents, its claims, are in the event under `requestContext.authorizer.jwt.claims`. The function doesn't verify a signature. It reads the verified result.

The app still checks two things again. API Gateway already checks both at the entry point, so this is a second layer of defense.

- `token_use` is `access`. An ID token is signed by the same user pool, so it passes the signature and issuer checks, but only an access token may be sent to the API. At the entry point, the scope requirement set on [the deploy page](/en/chapters/06-auth/deploy.md) is what turns ID tokens away
- `client_id` is this app's client. If you add a client for another app to the same user pool, a token issued to that client must not be able to call this API. At the entry point, the authorizer checks the same thing as the audience

When the event has no authorizer information at all, the caller is treated as nobody. That way, a route where someone forgot the authorizer doesn't end up letting everyone through.

<<< @/examples/06-auth/api/src/lambda.ts{handler}

The Lambda entry point doesn't read the `Authorization` header. The claims API Gateway verified are its only source for who the caller is. Chapter 04's `handleApiGateway` passes the event along with the `Request`, and the app hands that event to `authenticate` as it is.

### A guard that makes authentication mandatory

<<< @/examples/06-auth/api/src/app.ts{guard}

There are two routers, one inside the other. The outer one has a single route, `GET /health`, and every request that doesn't match it comes to this function. When the caller isn't known, it returns 401 here. Only a known caller is passed on to the inner router (`signedIn`, shown in the next section). The `context` an inner route receives always has an `identity`. A new route added to the inner router requires authentication without any extra code.

A path that doesn't exist also returns 401, not 404, when there is no token. Only `GET` matches `/health`, so the same goes for `HEAD /health`.

CORS is handled outside this guard. A browser sends its preflight (`OPTIONS`) without a token, so the preflight has to be answered before the guard. A 401 carries the CORS headers too, so the SPA can read it and ask the user to sign in again.

Checking in both API Gateway and Lambda looks like duplication, but the two have different jobs. API Gateway does most of the work. It stops an invalid request at the entry point, so the function isn't invoked and there is no function charge. The app's check is one more layer for the case where the configuration at the entry point has gone wrong.

## Only your own notes are reachable

<!-- section: 06.authorization -->

<<< @/examples/06-auth/api/src/app.ts{routes}

There is almost no code for authorization. No if statement anywhere checks whether this user may touch this note. Two rules do the work instead.

1. The owner passed to the service is always the token's `sub`. It is never taken from the path, the query, or the body
2. Notes are stored under their owner (`pk = OWNER#<owner>` from chapter 05)

With both rules in place, someone else's note is simply not found. When Bob calls `GET /notes/<id>` with the ID of Alice's note, the app looks for that ID under `OWNER#bob`. It isn't there, so the answer is 404. What actually stands where this text says `bob` is the `sub`, which is `local-bob` with the local development sign-in and the ID the user pool issues in a real environment.

If you read the note and then compare its owner, you have to write that check in every route, and every new route is a chance to forget it. With the owner in the key, there is nothing to forget. That is why chapter 05 put the owner in the key while there was still only one user.

The invariant being kept is this one sentence.

**A request can read and write only the notes whose owner is that token's `sub`.**

The tests try to break it.

- Alice's notes do not appear in Bob's list
- When Bob specifies the ID of Alice's note, he gets the same 404 as for an ID that does not exist
- Bob can neither update nor delete Alice's note, even if he knows its ID and version
- Even if Bob writes `owner: alice` in the query, a header, and the body, the note is created under Bob

`sub` is not an email address. An email address can be changed, and can be reused by a different person. `sub` is an identifier the user pool issues that does not change, and the official documentation also recommends using `sub` to identify a user.

### What goes in the logs

The request log records who did what as `sub`. The token itself is never written to the logs, because anyone who could read an access token there could impersonate that user until the token expires. A test checks that the logs don't contain the token.
