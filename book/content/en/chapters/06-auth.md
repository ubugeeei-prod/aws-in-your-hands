---
title: "06 Add Login: Cognito and Authorization"
sourceRevision: 1
---

# 06 Add Login: Cognito and Authorization

## What you will have at the end

- Sign-in from the SPA, with a password that never passes through this app's code
- An API that rejects a request before the function is invoked when it cannot establish who the request comes from
- Signed-in users who can read and write only their own notes. Knowing the ID of someone else's note does not get them to it
- The chapter 03 SPA and the chapter 05 API connected as one app
- A local setup in which you can use the app as two users, without Cognito

This chapter builds on [chapter 03](/en/chapters/03-spa.md) and [chapter 05](/en/chapters/05-dynamodb.md). The example is in `examples/06-auth/`. Note storage and optimistic locking use the chapter 05 code as it is, and this chapter writes only the parts that change for authentication and authorization.

## Architecture

<!-- section: 06.architecture -->

```text
Browser (SPA from CloudFront + S3)
  |  1. redirect to sign in                      2. password typed here, not in the SPA
  +-------------------------------------------> Cognito managed login (user pool domain)
  |  3. redirect back with ?code=...&state=...
  |  4. POST /oauth2/token  (code + PKCE code_verifier)  ->  access token
  |
  |  5. GET /notes   Authorization: Bearer <access token>
  v
API Gateway HTTP API
  |  JWT authorizer: signature, issuer, expiry, client, scope
  |  fails -> 401/403 here; Lambda is not invoked
  v
Lambda function
  |  reads the verified claims from the event; owner = claims.sub
  v
DynamoDB table   pk = OWNER#<sub>   sk = NOTE#<note id>
```

Here is what appears in the diagram.

- A **user pool** is Amazon Cognito's directory of users. It verifies passwords and issues tokens.
- **Managed login** is the sign-in page that Cognito serves. It runs on a different domain from your app.
- The **JWT authorizer** is a feature of API Gateway HTTP API. It verifies the token attached to a request and does not call the function if the token fails.

### Separate the two questions

This chapter treats the following two as different things.

| | Question | Where this chapter answers it |
| --- | --- | --- |
| Authentication | Who does this call come from? | Cognito, and the API Gateway JWT authorizer |
| Authorization | May that person touch this note? | The app code inside Lambda, and the table's key |

Being signed in does not mean being allowed to touch any note. If you add authentication and forget authorization, you get an API where "anyone who has signed in can read someone else's note if they know its ID".

### Why this architecture

You could store passwords yourself, check them, and build the reset procedure. This book does not. The damage when they leak is large, and there are many details to get right. With Cognito doing that work, the only thing this app handles is "a verified token".

The chapter does not use Amplify. A Cognito user pool can be used through the standard procedures of OAuth 2.0 and OpenID Connect (OIDC). The SPA in this chapter calls the standard endpoints with a general-purpose OAuth library (oauth4webapi). If you replace Cognito with another service that supports OIDC, most of the SPA code does not change.

The SPA and the API stay on separate origins, and the token is sent in the `Authorization` header. No cookies are used. The other approach is for the server side (a BFF) to hold the token and give the browser only a cookie. Its advantage is that the token is no longer visible to JavaScript in the browser. Chapter 09 (planned) covers that.

## The minimum vocabulary

<!-- section: 06.terms -->

| Term | Meaning in this chapter |
| --- | --- |
| access token | The token used to call an API. This is the one this chapter sends to the API |
| ID token | The token that tells the app itself that sign-in happened and what the user's attributes are. It is not sent to the API |
| refresh token | The token used to get a new access token. The SPA in this chapter does not keep it |
| authorization code | A short-lived voucher that the SPA receives after sign-in. It is exchanged for tokens at the token endpoint |
| PKCE | A mechanism that keeps the voucher from being exchanged even if it is intercepted |
| scope | A string attached to a token that expresses the range of what is permitted |
| `sub` | An identifier that the user pool issues for each user and that does not change |

An access token and an ID token are both in a format called JWT, and both are signed by the same user pool. They cannot be told apart by how they look. This matters later, in the API's configuration.

## Add "who" to the contract

<!-- section: 06.contract -->

The shape of a note is the same as in chapter 05. Two things are added.

<<< @/examples/06-auth/api/src/contract.ts{me}

<<< @/examples/06-auth/api/src/contract.ts{error}

`unauthenticated` (401) means "it is not known who this call comes from".

There is deliberately no error that expresses "not permitted" (403) for a note. The answer when someone else's note is specified is `not_found`, the same as when a note that does not exist is specified. Returning 403 would reveal that "a note with that ID exists".

## Receive who is calling

<!-- section: 06.identity -->

The app receives "who made the call" as a single function.

<<< @/examples/06-auth/api/src/identity.ts{identity}

There are two implementations. In AWS, the function reads the result that API Gateway verified, and locally it verifies a development token. The body of the app does not know which one is in use.

### In AWS: read the claims that API Gateway verified

<<< @/examples/06-auth/api/src/identity.ts{api-gateway}

By the time the function runs, API Gateway has finished checking the token's signature, issuer, expiry, and the client it was issued to. The contents of the token (the claims) are in the event, under `requestContext.authorizer.jwt.claims`. The function does not verify a signature. It only reads the verified result.

Even so, the app checks two things itself.

- **That `token_use` is `access`.** An ID token is signed by the same user pool, so it passes the signature and issuer checks. Only an access token may be sent to the API.
- **That `client_id` is this app's client.** If you add a client for another app to the same user pool, a token issued to that client must not be able to call this API.

When the event has no authorizer information at all, the caller is treated as "nobody". This is so that a route where the authorizer was forgotten does not turn into "let anyone through".

<<< @/examples/06-auth/api/src/lambda.ts{handler}

The Lambda entry point does not read the `Authorization` header. The only source of identity is the claims that API Gateway verified.

### Make authentication required

<<< @/examples/06-auth/api/src/app.ts{guard}

Only `/health` comes before this middleware. Every route after it returns 401 when there is no identity. If you add a new route below it, authentication is required and there is no way to forget to write it.

Checking in both API Gateway and Lambda looks like duplication, but the two have different roles. API Gateway looks at "is this a valid token?" and prevents an invalid request from invoking the function. That request incurs no function charge. The app looks at "is this token meant for this use?".

## Make only your own notes reachable

<!-- section: 06.authorization -->

<<< @/examples/06-auth/api/src/app.ts{routes}

There is almost no code for authorization. Nowhere is there an if statement that checks "may this user touch this note?". Instead, there are two rules.

1. The owner passed to the service is **always** the token's `sub`. It is never taken from the path, the query, or the body
2. Notes are stored under their owner (`pk = OWNER#<owner>` from chapter 05)

From these two, someone else's note is "not found". When Bob calls `GET /notes/<id>` with the ID of Alice's note, the app looks for that ID under `OWNER#bob`. It is not there, so the answer is 404.

The approach of writing a check in each place ("read the note, then compare whether the owner matches") gives you a chance to forget it every time you add a new route. With this approach there is nothing to forget. This is why chapter 05 put the owner in the key while there was still only one user.

The invariant being kept is this one sentence.

**A request can read and write only the notes whose owner is that token's `sub`.**

The tests try to break it.

- Alice's notes do not appear in Bob's list
- When Bob specifies the ID of Alice's note, he gets the same 404 as for an ID that does not exist
- Bob can neither update nor delete Alice's note, even if he knows its ID and version
- Even if Bob writes `owner: alice` in the query, a header, and the body, the note is created under Bob

`sub` is not an email address. An email address can be changed and can be reused by a different person. `sub` is an identifier that the user pool issues and that does not change. The official documentation also recommends using `sub` to identify a user.

### What goes in the logs

Who performed which operation is recorded in the request log as `sub`. The token itself is never written to the logs. If an access token can be read from the logs, anyone who can see them can impersonate that user until the token expires. A test checks that the logs do not contain the token.

## Run it locally as two users

<!-- section: 06.local -->

Copy `examples/06-auth/.env.example` to `.env` in the same directory.

<<< @/examples/06-auth/.env.example

Use two terminals.

```bash
vp run dev:app:api
vp run dev:app:web
```

Open <http://localhost:5173>, enter a user name (the default is `alice`), and sign in. Create a note, then sign in as `bob` in another browser or a private window, and Bob's list is empty. If you open the same note in two tabs and save in both, the tab that saved later shows both the saved content and your own input.

This needs neither Docker, nor AWS credentials, nor a user pool.

### Development sign-in

There is no Cognito locally, so a substitute is provided.

<<< @/examples/06-auth/api/src/local-auth.ts

<<< @/examples/06-auth/api/src/dev.ts{dev}

`POST /local/token` takes a user name and returns a token for that user unconditionally. There is no password. It is a tool for using the app locally as two users.

That this does not get mixed into a deployment is guaranteed by how things are built.

- This endpoint and the development verification exist only in `dev.ts` and `local-auth.ts`. The Lambda entry point (`lambda.ts`) imports neither. They are not in the bundle
- The development token is signed with a shared secret (HS256). The API Gateway JWT authorizer accepts only RSA-based signatures, so even if this token were sent to the deployed API, it would not pass

**This is not an emulation of Cognito.** Here is what it does not reproduce.

| Not reproduced | What it means in the real environment |
| --- | --- |
| Managed login and passwords | The real sign-in page, the password rules, the password change at first sign-in |
| The authorization code and PKCE round trip | The SPA's code for Cognito (`web/src/auth/cognito.ts`) is never executed locally |
| The API Gateway JWT authorizer | That an invalid token is rejected before it reaches the function. The shape of the response when that happens |
| Token expiry, refresh, and revocation | What happens after 1 hour |

The second one matters most. What runs locally is "the app after sign-in", not "sign-in with Cognito".

### The SPA reads its configuration at runtime

<<< @/examples/06-auth/web/src/config.ts{config}

At startup, the SPA reads `/config.json` to learn where the API is and how to sign in. `web/public/config.json` is for local use. When you deploy, it is replaced with a `config.json` built from the stack's outputs. Once the SPA is built, it can be pointed at any deployment.

There is no secret in this configuration. Anyone who loads the page can see both the client ID and the sign-in domain. An app that runs in a browser cannot hold a secret, and such an app is called a public client.

## Sign in from the SPA

<!-- section: 06.pkce -->

What the SPA uses to sign in is the authorization code grant combined with PKCE. The steps are 1 to 4 in the architecture diagram.

<<< @/examples/06-auth/web/src/auth/provider.ts{provider}

<<< @/examples/06-auth/web/src/auth/cognito.ts{cognito}

`signIn` creates two random values.

- **state** is for checking that the redirect coming back is the answer to the request this tab sent. If an attacker gets someone to follow a link containing a code obtained through the attacker's own sign-in, the state does not match, so it is not accepted.
- The **code verifier** is the PKCE secret. Only its hash (the code challenge) is sent to the sign-in page. When exchanging the code for tokens, the SPA presents the original value. Someone who saw the code along the way does not know the original value and cannot make the exchange.

A public client cannot hold a client secret. PKCE takes its place. The only challenge method Cognito supports is `S256`.

Navigating to the sign-in page discards the SPA's page. Until the user comes back, the two values are kept in sessionStorage, which is per tab.

<<< @/examples/06-auth/web/src/auth/pending.ts{pending}

They can be taken out only once. When the state does not match, or when the request is too old, nothing is returned. Tests check that a forged state, reuse of the same callback URL, and a request older than 10 minutes are each rejected.

Cognito also has the implicit grant, which returns tokens directly in the URL without using a code. The official documentation explains that it is less secure because it exposes tokens on the user's side. The client in this chapter has the implicit grant disabled.

### Where to keep the token

The SPA holds the access token only in a variable in memory. It does not put it in localStorage or in a cookie.

| Location | After a reload | From a script that got into the page |
| --- | --- | --- |
| Memory (this chapter) | Gone. You sign in again | Readable while the page is open |
| localStorage | Remains | Readable at any time. Remains after the tab is closed |
| A server-side session and a cookie (planned for chapter 09) | Remains | Not readable (when `HttpOnly`) |

Signing in again on every reload is inconvenient. However, managed login itself holds a session cookie that is valid for 1 hour, so during that time you can come back without retyping the password. Letting the SPA hold a refresh token would keep the session longer, but it would mean keeping a long-lived token in the browser. This chapter leans to the short side.

With any of these approaches, if a malicious script gets into the page (XSS), it can call the API as the user while that page is open. Where the token is kept changes the extent of the damage, but it is not a substitute for defending against XSS itself.

The typed client fetches the token on every request.

<<< @/examples/06-auth/api/src/client.ts{client}

When the API returns 401, the SPA discards the token it holds and prompts the user to sign in again.

### Show the conflict to the user

In chapter 05, an update from an old version was rejected with a 409, and the stored note was returned as `current`. The screen in this chapter shows that to the user. It leaves the user's input in the fields, displays the saved content next to it, and lets the user choose between "Keep my text and save over it" and "Discard my text and use the saved note". The app does not decide on its own which one to keep.

## Define the infrastructure

<!-- section: 06.infra -->

This chapter's stack (`AihNotesApp`) brings the whole app together into one. To the chapter 03 SPA delivery (the bucket, the distribution, the fallback function) and the chapter 05 table and API, it adds a user pool and an authorizer.

### user pool

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{user-pool}

`selfSignUpEnabled` is `false`. If you publish a practice app with a setting that lets anyone register, strangers can become users. The confirmation emails for registration are also sent from your account. Users are created with a task that comes up later.

`removalPolicy` is `DESTROY`. Deleting the stack deletes the user pool and all the users in it.

### app client

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{client}

- `generateSecret: false`. It is a public client
- The only flow allowed is authorization code. Implicit is disabled
- `authFlows` are all `false`. This closes the paths that sign in by sending a password directly to an API, and leaves the redirect to managed login as the only way in
- There are only two callback URLs: `/callback` on the deployed SPA and `/callback` on the local dev server. Cognito does not return a code to a URL that is not registered
- The access token lifetime is 1 hour

`enableTokenRevocation` makes it possible to revoke a user's tokens. However, there is a limit to what this setting does. The next section explains it.

### JWT authorizer

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{authorizer}

According to the official documentation, the JWT authorizer checks the following.

1. The token's signature. It is verified with the issuer's public key. Only RSA-based algorithms are supported
2. That `iss` matches the configured issuer
3. That `aud`, or `client_id` if there is no `aud`, matches one of the configured audiences
4. That `exp`, `nbf`, and `iat` are consistent with the current time
5. If scopes are configured on the route, that the token has one of them

If any of these fails, API Gateway rejects the request. The function is not invoked.

`authorizationScopes: ["openid"]` is there to turn ID tokens away at the entrance. The same documentation says that there is no standard way to tell an access token from an ID token, and recommends requiring scopes on routes unless you use ID tokens for API authorization. An ID token has no scope claim, so it is rejected here. The app's `token_use` check is the second layer of that protection.

Tests check the following against the template.

- Every route other than `/health` has the JWT authorizer attached
- Every protected route requires a scope
- The client has no secret, and its only flow is authorization code
- CORS allows only two origins, and they do not include `*`

The first check fails if you add a route and forget to attach the authorizer.

## Token expiry and revocation

<!-- section: 06.revocation -->

After an access token has been issued, it can be verified without asking anyone. That is the advantage of a JWT, and at the same time its limit.

```text
time   event                                            access token (exp = t0 + 1h)
t0     Alice signs in                                   issued
t0+10m admin disables Alice / revokes her tokens        Cognito's own APIs now refuse it
t0+11m Alice's browser calls GET /notes                 API Gateway: signature ok, not expired -> 200
t0+1h  token expires                                    API Gateway -> 401
```

The official documentation says this: a revoked token can no longer be used with the Cognito APIs that require a token. But a JWT library that only verifies the signature and the expiry continues to judge it valid. What the API Gateway JWT authorizer checks is the five items in the previous section. An item that asks Cognito whether the token has been revoked is not among them.

In other words, **even if you disable a user, an access token that has already been issued passes this API until it expires.** At the longest, that is the lifetime of the access token (1 hour in this chapter). This is a typical gap in a distributed system, one that arises when several places each hold state separately. The fact "the account is disabled" is in Cognito, and the judgment "this token is valid" is made by API Gateway from only the information it has at hand.

There are three ways to deal with it, each in exchange for a cost.

| Approach | What you get | What you pay |
| --- | --- | --- |
| Shorten the access token lifetime (the minimum is 5 minutes) | The time until revocation takes effect gets shorter | More token refreshes. When you use managed login, the official documentation does not recommend less than 1 hour |
| The app looks up a list of revocations on every request | It takes effect immediately | One more read on every request. You give up the JWT advantage of "not asking" |
| Accept it | Nothing is added | For up to 1 hour, a disabled user gets through |

This chapter takes the third. For a notes app, we judged that there are not many situations where it is a problem for notes to be read within 1 hour of disabling a user. If what you handle changes, the judgment changes too.

API Gateway also caches the issuer's public keys for up to 2 hours. Keep this in mind as the grace period when the user pool's keys are replaced.

## Deploy

<!-- section: 06.deploy -->

```bash
vp run app:infra:diff
vp run app:infra:deploy
vp run app:user:create you@example.com
vp run app:publish
vp run app:smoke:web
vp run app:smoke:api
```

`app:infra:deploy` creates the distribution, the bucket, the table, the function, the API, and the user pool together.

`app:user:create` creates one user. Cognito emails a temporary password to that address. At first sign-in, the user chooses their own password. This task never sees or displays a password.

`app:publish` builds the SPA, writes `config.json` from the stack's outputs, and places the result in the bucket. The publishing order and the cache policy are the same implementation as in chapter 03.

Open the URL of the `DistributionDomainName` output, and a "Sign in" button appears. Pressing it takes you to the Cognito sign-in page, and signing in brings you back to the SPA.

`app:smoke:api` checks what can be checked without a person signing in: that a request without a token and a request with a made-up token are rejected. It runs the signed-in path only when the environment variable `AIH_ACCESS_TOKEN` contains an access token. When it does not, the task prints that the signed-in path was not checked.

You can also point the local SPA at the deployed API and user pool. `http://localhost:5173/callback` is already registered as a callback URL, and `http://localhost:5173` as an origin that CORS allows. Rewrite `web/public/config.json` with the values of the deployment and start `vp run dev:app:web`. In a production app, do not leave the local origin allowed.

The drift check is the same as in the earlier chapters.

```bash
vp run app:infra:drift
```

This stack has three types for which the pinned version of cdkd has no dedicated implementation: `AWS::CloudFront::Function`, `AWS::Cognito::UserPoolClient`, and `AWS::Cognito::UserPoolDomain`. They are handled through the Cloud Control API. Whether they can in fact be created and read back has not been checked.

## If you are used to Workers

To do the same thing on Cloudflare, you would often either put Cloudflare Access in front or use a library that verifies the JWT inside the Worker. The difference is where the verification happens. In this chapter, verification is finished in front of the function (in API Gateway), and the function only reads the result. With verification inside the Worker, the verification code, and fetching and caching the public keys, are the responsibility of your code. Both have advantages. Verifying in front means less code, and an invalid request does not run the function. In exchange, the verification rules are limited to what API Gateway provides.

This comparison describes common architectures, and the primary sources on the Cloudflare side have not been checked.

## Cost

Amounts are in USD, for the Tokyo Region, before tax. The inputs and unit prices behind the calculations are in [Pricing Worksheets](/en/reference/pricing.md).

**Cognito.** A user pool is charged by the number of monthly active users (MAU). A user who performed some operation in that month, such as a sign-in or a token refresh, is counted as one. The default plan for a new user pool is Essentials, which in the Tokyo Region is USD 0.015 per MAU. According to the pricing page, Essentials and Lite have a free allowance of 10,000 MAU per month per account (or organization), and it does not expire after 12 months.

With 100 users, that is USD 1.50 per month at the list price, and 0 if it is within the free allowance.

Email and SMS are charged separately. In this chapter's architecture, the temporary password email sent when a user is created goes through Cognito's default sending feature. Its limits and charges have not been checked. An app with many users uses Amazon SES (planned for chapter 15).

**JWT authorizer.** The API Gateway price list for the Tokyo Region has no item for authorizers. A rejected request does not invoke the function, so there is no Lambda charge. Whether that request is counted toward the API Gateway request charge has not been checked.

**The whole app.** This calculation adds 100 MAU to the chapter 05 example of 1 million requests per month.

| Item | List price | After the monthly free allowance |
| --- | --- | --- |
| Chapter 05 total (API Gateway, Lambda, logs, DynamoDB) | 2.41 | 1.64 |
| Cognito (Essentials, 100 MAU) | 1.50 | 0 |
| Subtotal | **3.91** | **1.64** |

For SPA delivery (CloudFront and S3), see the calculation in chapter 03.

**When it is not being used.** In a month when no user signs in, the Cognito charge is 0. What remains is only the storage for the table and the bucket.

**After you delete it.** Nothing remains. The user pool and the users in it are deleted together with the stack.

## When it does not work

| Symptom | What to check |
| --- | --- |
| `dev:app:api` stops with a message that mentions `LOCAL_AUTH_SECRET` | Does `examples/06-auth/.env` exist? Is the value 32 characters or longer? |
| The local SPA shows "The app could not start" | Is `dev:app:api` running? Check `apiUrl` in `web/public/config.json` |
| The sign-in page shows an error that indicates a redirect mismatch | Do the SPA's origin and `/callback` match the client's callback URL exactly? A trailing `/` or its absence also counts as a difference |
| After sign-in, it shows "does not belong to a sign-in started in this tab" | The tab where you started the sign-in and the tab you came back to are different. Or it took 10 minutes or more. Sign in again |
| The deployed API returns 401 even though you are signed in | Is what the SPA sends an access token? Does `clientId` in `config.json` match the stack's `UserPoolClientId`? |
| A 403 comes back | The token does not have the `openid` scope. Does the sign-in request send `scope=openid`? |
| The browser console shows a CORS error | When API Gateway returns a 401 or 403, the response can lack CORS headers, and the browser can display it as a CORS error. Check the status code with `curl` first |
| You disabled a user and they can still call the API | As the section "Token expiry and revocation" explains. The token passes until the access token expires |

The body of a 401 or 403 returned by API Gateway is not in this book's error shape (`error.code`). The typed client treats it as `unauthenticated`.

## If you take this to production

- **Enable MFA.** This chapter's user pool uses a password only.
- **Remove the local origin.** Delete `http://localhost:5173` from the callback URLs and from CORS. Use a separate stack for development.
- **Use a custom domain.** While the sign-in page's domain is still `...amazoncognito.com`, it is harder for users to tell whether it is genuine.
- **Send email from SES.** Cognito's default sending is for small volumes (planned for chapter 15).
- **Decide the token lifetime and the revocation policy.** Choose from the table in the earlier section.
- **Set a Content-Security-Policy.** It reduces the damage from XSS. As chapter 03 said, it is not included in the managed policy.
- **Connect deleting a user to deleting their data.** When you delete a user, the notes under that `sub` remain in the table. You need a process that deletes them.
- **Protect the user pool.** Set `removalPolicy` to `RETAIN` and enable deletion protection. If you delete the user pool, every user has to start over from registration.

## Clean up

<!-- section: 06.cleanup -->

```bash
vp run app:unpublish --yes
vp run app:infra:destroy
```

Empty the bucket first. `app:infra:destroy` deletes the user pool, the table, the function, the API, the distribution, and the bucket. **All the users and notes are deleted, and they cannot be restored.**

To delete only a user, run `vp run app:user:delete you@example.com`. That user's notes remain in the table.

All that remains is the storage locations created by the cdkd bootstrap (chapter 02) and the deployment files placed in them.

## Verification status of this chapter

- The API tests (authentication, authorization, the audit log), the tests for reading the identity, the development sign-in tests, the tests for the temporary PKCE storage, the infrastructure assertions, type checking, the SPA build, and synth are **verified locally**.
- With `dev:app:api` and `dev:app:web` started locally, the following was checked by driving a browser automatically: sign-in, creating a note, that fetching it as another user is a 404, that a request without a token is a 401, the conflict display and "Keep my text and save over it", and that sign-in is required after a reload. This is also **verified locally**.
- **Sign-in with Cognito has never been run.** `web/src/auth/cognito.ts` (the authorization code and PKCE round trip, and the token exchange) has only passed type checking and has not been run against a real user pool. This is the most important unverified part of this chapter.
- `app:infra:deploy`, `app:user:create`, `app:publish`, `app:smoke:web`, `app:smoke:api`, `app:infra:drift`, `app:unpublish`, and `app:infra:destroy` have not been run. They are **unverified**.
- So the following have not been checked in a real environment either: that the JWT authorizer rejects an ID token and an invalid token; that the Cognito token endpoint can be called directly from a browser (CORS); that the shapes of `Issuer` and `AuthDomain` written to `config.json` satisfy oauth4webapi's validation.

## Source map for this chapter

| Section | Files | Tasks |
| --- | --- | --- |
| Add "who" to the contract | `examples/06-auth/api/src/contract.ts` | `test:unit` |
| Receive who is calling | `examples/06-auth/api/src/identity.ts`, `api/src/lambda.ts`, `api/src/app.ts`, `api/test/identity.test.ts` | `test:unit` |
| Make only your own notes reachable | `examples/06-auth/api/src/app.ts`, `api/test/app.test.ts`, `examples/05-dynamodb/src/notes.ts` | `test:unit` |
| Run it locally as two users | `examples/06-auth/api/src/dev.ts`, `api/src/local-auth.ts`, `api/test/local-auth.test.ts`, `api/src/compose.ts`, `web/src/auth/local.ts`, `web/src/config.ts`, `web/public/config.json`, `.env.example` | `dev:app:api`, `dev:app:web` |
| Sign in from the SPA | `examples/06-auth/web/src/auth/`, `web/src/App.vue`, `web/src/router/route.ts`, `api/src/client.ts` | `test:unit`, `typecheck:app:web`, `lint:app:web`, `build:app:web` |
| Define the infrastructure | `examples/06-auth/infra/lib/notes-app-stack.ts`, `infra/bin/app.ts`, `infra/functions/spa-fallback.js`, `infra/test/notes-app-stack.test.ts`, `cdk.json` | `app:infra:synth`, `test:unit` |
| Deploy | `examples/06-auth/scripts/write-config.ts`, `scripts/user.ts`, `scripts/smoke.ts`, `tools/src/site/`, `tools/src/infra/` | `app:infra:diff`, `app:infra:deploy`, `app:user:create`, `app:publish`, `app:smoke:web`, `app:smoke:api`, `app:infra:drift` |
| Clean up | `tools/src/site/unpublish.ts`, `examples/06-auth/scripts/user.ts` | `app:unpublish`, `app:infra:destroy`, `app:user:delete` |
| Cost | `data/pricing/` | `test:unit` |

## Primary sources

- [Control access to HTTP APIs with JWT authorizers in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html) (checked 2026-10-11)
- [The redirect and authorization endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html) (checked 2026-10-11)
- [Understanding the access token](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html) (checked 2026-10-11)
- [Ending user sessions with token revocation](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html) (checked 2026-10-11)
- [The managed login sign-out endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html) (checked 2026-10-11)
- [Amazon Cognito pricing](https://aws.amazon.com/cognito/pricing/) (checked 2026-10-11)
- AWS Price List bulk API: [Cognito](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCognito/current/ap-northeast-1/index.json) (checked 2026-10-11)
- [oauth4webapi 3.8.8](https://www.npmjs.com/package/oauth4webapi/v/3.8.8), [jose 6.2.12](https://www.npmjs.com/package/jose/v/6.2.12) (type definitions. checked 2026-10-11)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (checked 2026-10-11)
