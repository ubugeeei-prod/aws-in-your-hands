---
title: "06 Auth: Deploy"
---

# 06 Auth: Deploy

## Getting ready for AWS

<!-- section: 06.infra -->

From here on it's CDK. This chapter's stack (`AihNotesApp`) brings the whole app together into one. To the chapter 03 SPA delivery (the bucket, the distribution, the fallback function) and the chapter 05 table and API, it adds a user pool and an authorizer.

### user pool

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{user-pool}

`selfSignUpEnabled` is `false`. Publish a practice app that lets anyone register, and strangers can become users. The confirmation emails for registration are also sent from your account. You'll create users with a task that comes up later.

`removalPolicy` is `DESTROY`. Deleting the stack deletes the user pool and all the users in it.

### app client

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{client}

- `generateSecret: false`. It is a public client
- The only flow allowed is authorization code. Implicit is disabled
- `authFlows` sets the four flows it names (`userSrp`, `userPassword`, `adminUserPassword`, `custom`) to `false`. This closes the paths that sign in by sending a password directly to an API, and leaves the redirect to managed login as the only way in
- There are only two callback URLs: `/callback` on the deployed SPA and `/callback` on the local dev server. Cognito does not return a code to a URL that is not registered
- The access token lifetime is 1 hour

`enableTokenRevocation` makes it possible to revoke a user's tokens. There's a limit to what this setting does, though. That's what the next section is about.

### JWT authorizer

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{authorizer}

According to the official documentation, the JWT authorizer checks these five things.

1. The token's signature. It is verified with the issuer's public key. Only RSA-based algorithms are supported
2. That `iss` matches the configured issuer
3. That `aud`, or `client_id` if there is no `aud`, matches one of the configured audiences
4. That `exp`, `nbf`, and `iat` are consistent with the current time
5. If scopes are configured on the route, that the token has one of them

If any of these fails, API Gateway rejects the request. The function is not invoked.

`authorizationScopes: ["openid"]` is there to turn ID tokens away at the gate. The same documentation says that there is no standard way to tell an access token from an ID token, and recommends requiring scopes on routes unless you use ID tokens for API authorization. An ID token has no scope claim, so it is rejected here. The app's `token_use` and `client_id` checks are the second layer behind items 5 and 3.

Tests check the following against the template.

- Every route other than `/health` has the JWT authorizer attached
- Every protected route requires a scope
- The client has no secret, and its only flow is authorization code
- CORS allows only two origins, and they do not include `*`

Add a route and forget to attach the authorizer, and the first check fails.

### Limit the rate at the entrance

The authorizer turns away a request without a token. But all it does is turn it away. It doesn't slow anyone down. And `/health` reaches the function with no token at all. So the stage gets the same limit as in chapter 04.

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{throttle}

10 requests a second, 20 for a moment. Anything past that gets a 429 from API Gateway, and the function doesn't run.

One thing to know: this limit is not per user. If one person uses it up, everyone else's requests get 429 too. It protects the bill, but it can't protect the other users from one heavy user. The setting works per stage and per route, not per caller.

The table has chapter 05's limit as well (150 read units and 40 write units a second). DynamoDB refuses whatever goes past it, and doesn't bill for it. The tests check that both limits are in the template.

## Disabled, and still getting through for a while

<!-- section: 06.revocation -->

After an access token has been issued, it can be verified without asking anyone. That's the good part of a JWT, and at the same time its limit.

So what happens when you disable a user?

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

Look at t0+11m. The call goes through.

Here is what the official documentation says. A revoked token can no longer be used with the Cognito APIs that require a token. But a JWT library that only verifies the signature and the expiry continues to judge it valid. What the API Gateway JWT authorizer checks is the five items from the previous section. Asking Cognito whether the token has been revoked is not among them.

In other words, **even if you disable a user, an access token that has already been issued passes this API until it expires.** At the longest, that is the lifetime of the access token (1 hour in this chapter).

This is a typical gap in a distributed system, the kind that appears when several places each hold state separately. The fact "the account is disabled" lives in Cognito, and the judgment "this token is valid" is made by API Gateway from only the information it has at hand.

There are three ways to deal with it. Each one costs something.

| Approach | What you get | What you pay |
| --- | --- | --- |
| Shorten the access token lifetime (the minimum is 5 minutes) | The time until revocation takes effect gets shorter | More token refreshes. When you use managed login, the official documentation does not recommend less than 1 hour |
| The app looks up a list of revocations on every request | It takes effect immediately | One more read on every request. You give up the JWT advantage of "not asking" |
| Accept it | Nothing is added | For up to 1 hour, a disabled user gets through |

This chapter takes the third. For a notes app, we judged that there aren't many situations where it's a problem for notes to be read within 1 hour of disabling a user. If what you handle changes, the judgment changes too.

One more thing. API Gateway also caches the issuer's public keys for up to 2 hours. Keep that in mind as the grace period when the user pool's keys are replaced.

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

Let's go through them in order.

`app:infra:deploy` creates the distribution, the bucket, the table, the function, the API, and the user pool together.

`app:user:create` creates one user. Cognito emails a temporary password to that address. At first sign-in, the user chooses their own password. This task never sees or displays a password.

`app:publish` builds the SPA, writes `config.json` from the stack's outputs, and places the result in the bucket. The publishing order and the cache policy are the same implementation as in chapter 03.

Open the URL of the `DistributionDomainName` output, and a "Sign in" button appears. Press it and you go to the Cognito sign-in page. Sign in and you come back to the SPA.

`app:smoke:api` checks what can be checked without a person signing in: that a request without a token and a request with a made-up token are rejected. It runs the signed-in path only when the environment variable `AIH_ACCESS_TOKEN` contains an access token. When it doesn't, the task prints that the signed-in path was not checked.

You can also point the local SPA at the deployed API and user pool. `http://localhost:5173/callback` is already registered as a callback URL, and `http://localhost:5173` as an origin that CORS allows. Rewrite `web/public/config.json` with the values of the deployment and start `vp run dev:app:web`. In a production app, though, please don't leave the local origin allowed.

The drift check is the same as in the earlier chapters.

```bash
vp run app:infra:drift
```

This stack has three types for which the pinned version of cdkd has no dedicated implementation: `AWS::CloudFront::Function`, `AWS::Cognito::UserPoolClient`, and `AWS::Cognito::UserPoolDomain`. They are handled through the Cloud Control API. Whether they can in fact be created and read back has not been checked.
