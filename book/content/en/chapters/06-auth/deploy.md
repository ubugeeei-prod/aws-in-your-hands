---
title: "06 Auth: Deploy"
---

# 06 Auth: Deploy

This page puts the app you [ran locally](/en/chapters/06-auth/local.md) on AWS. You define the user pool and the JWT authorizer with CDK, look at what happens when a user is disabled, and then deploy.

## Getting ready for AWS

<!-- section: 06.infra -->

The infrastructure is defined with CDK. This chapter's stack (`AihNotesApp`) holds the whole app in one place. It takes the SPA delivery from chapter 03 (the bucket, the distribution, and the fallback function) and the table and API from chapter 05, and adds a user pool and an authorizer.

### The user pool

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{user-pool}

`selfSignUpEnabled` is `false`. If you publish a practice app that anyone can register with, strangers can become users, and the confirmation emails for those registrations go out from your account. You create users with a task that "Deploy" on this page uses.

`removalPolicy` is `DESTROY`. Deleting the stack deletes the user pool and every user in it.

### The app client

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{client}

The app client is configured as follows.

- `generateSecret: false` makes it a public client
- The only allowed flow is authorization code, and implicit is disabled
- `authFlows` sets the four flows it names (`userSrp`, `userPassword`, `adminUserPassword`, `custom`) to `false`. That closes the paths that sign in by sending a password straight to an API and leaves the redirect to managed login as the only entry
- There are only two callback URLs, `/callback` on the deployed SPA and `/callback` on the local development server. Cognito doesn't return an authorization code to a URL that isn't registered
- An access token lives for one hour

`enableTokenRevocation` makes it possible to revoke a user's tokens. Revocation only reaches so far, though, and "Disabled, and still getting through for a while" explains how far.

### The JWT authorizer

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{authorizer}

According to the official documentation, a JWT authorizer checks these five things.

1. The token's signature, verified with the issuer's public key. Only RSA-family algorithms are supported
2. That `iss` matches the configured issuer
3. That `aud`, or `client_id` when there is no `aud`, matches one of the configured audiences
4. That `exp`, `nbf`, and `iat` are consistent with the current time
5. If the route has scopes configured, that the token has one of them

If any check fails, API Gateway rejects the request and the function isn't invoked.

`authorizationScopes: ["openid"]` is there to turn ID tokens away at the entry point. The same documentation says there is no standard way to tell an access token from an ID token, and recommends requiring a scope on the route unless you use ID tokens for API authorization. An ID token has no scope claim, so it is rejected here. The app's checks on `token_use` and `client_id` are a second layer of defense behind items 5 and 3.

The tests check the following against the template.

- Every route other than `/health` has the JWT authorizer
- Every protected route requires a scope
- The client has no secret, and its only flow is authorization code
- CORS allows exactly two origins and doesn't include `*`

If you add a route and forget the authorizer, the first check fails.

### Limit what it accepts

The authorizer turns away requests that have no token. It only turns them away, though, and does nothing to slow down the sender. `/health` also reaches the function without a token. So the stage gets the same throttling as in chapter 04.

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{throttle}

The stage accepts up to 10 requests a second, with bursts up to 20. API Gateway returns a 429 for the rest, and the function doesn't run.

This throttling is not per user. If one person uses it up, everyone else's requests get a 429 as well. It protects your bill, but it can't protect other users from one user's overuse, because the setting applies to a stage and a route, not to a caller.

The table has the same caps as in chapter 05 (150 read units and 40 write units a second). DynamoDB turns away what goes over and doesn't charge for it. The tests check that both of these limits are in the template.

## Disabled, and still getting through for a while

<!-- section: 06.revocation -->

Once an access token has been issued, it can be verified without asking anyone. That is the advantage of a JWT and also its limit.

The next figure shows what happens when an administrator disables a user who has signed in.

```figure
caption: After a user is disabled, an access token that was already issued still passes API Gateway until it expires.
type: sequence
actor cognito: Cognito
actor alice: Alice's browser
actor api: API Gateway | JWT authorizer
step alice -> cognito: t0 sign in
step cognito --> alice: access token (exp = t0 + 1h)
note cognito: t0+10m admin disables Alice /
note cognito: revokes her tokens
note cognito: Cognito's own APIs now refuse it
step alice -> api: t0+11m GET /notes
step api --> alice: 200 (signature ok, not expired)
note alice: t0+1h token expires
step alice -> api: GET /notes
step api --x alice: 401
```

At t0+11m, one minute after Alice was disabled, the request still goes through.

According to the official documentation, a revoked token can no longer be used with the Cognito APIs that require a token. A JWT library that only verifies the signature and the expiry still judges it valid. What the API Gateway JWT authorizer checks is the five items listed under "The JWT authorizer", and none of them asks Cognito whether the token was revoked.

So **after you disable a user, an access token that was already issued keeps passing this API until it expires.** At the longest that is the lifetime of an access token, which is one hour in this chapter.

This is a typical gap in a distributed system, the kind that appears when several places each hold their own copy of the state. The fact that the account is disabled lives in Cognito, and API Gateway decides that the token is valid from the information it has locally.

There are three ways to deal with it, and each one costs something.

| Approach | What you gain | What you pay |
| --- | --- | --- |
| Shorten the access token's lifetime (5 minutes at the shortest) | Less time until revocation takes effect | More token renewals. With managed login, the official documentation recommends against going below one hour |
| The app looks up a revocation list on every request | Takes effect immediately | One more read on every request. You give up the JWT's advantage of being verifiable without asking anyone |
| Accept it | Nothing to add | A disabled user gets through for up to one hour |

This chapter takes the third. For a notes app, cases where it matters that notes are read within an hour of disabling a user were judged to be few. With different data, the decision would be different.

API Gateway also caches the issuer's public keys for up to two hours. Take that time into account when the user pool's keys change.

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

`app:user:create` creates one user. Cognito emails a temporary password to that address, and the user sets their own password at the first sign-in. The task never sees or prints a password.

`app:publish` builds the SPA, writes `config.json` from the stack outputs, and puts the files in the bucket. The publishing order and the caching policy are the same implementation as in chapter 03.

Opening the URL shown as `DistributionDomainName` shows a "Sign in" button. Pressing it moves you to Cognito's sign-in page, and signing in brings you back to the SPA.

`app:smoke:api` checks what can be checked without a person signing in, which is that a request with no token and a request with a garbage token are both rejected. It runs the signed-in path only when the environment variable `AIH_ACCESS_TOKEN` holds an access token. Without one, the task prints that the signed-in path was not checked.

You can also point the local SPA at the deployed API and user pool. `http://localhost:5173/callback` is already registered as a callback URL, and `http://localhost:5173` as an origin CORS allows. Rewrite `web/public/config.json` with the deployed values and start `vp run dev:app:web`. In a production app, don't leave the local origin allowed.

The drift check is the same as in earlier chapters.

```bash
vp run app:infra:drift
```

This stack has three resource types for which the pinned cdkd has no dedicated implementation: `AWS::CloudFront::Function`, `AWS::Cognito::UserPoolClient`, and `AWS::Cognito::UserPoolDomain`. These three are handled through Cloud Control API. Whether they can actually be created and read back has not been checked.
