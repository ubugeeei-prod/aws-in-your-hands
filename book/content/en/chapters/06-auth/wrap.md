---
title: "06 Auth: Costs, Pitfalls, and Cleanup"
---

# 06 Auth: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It covers how this setup differs from the usual approach on Cloudflare, what it costs, where people get stuck, and what to change for production, and then it removes what you built.

## If you're coming from Workers

To do the same thing on Cloudflare, you would usually either put Cloudflare Access in front or use a library that verifies the JWT inside the Worker. The difference from this chapter is where verification happens.

In this chapter, API Gateway finishes the verification in front of the function, and the function only reads the result. When you verify inside the Worker, the verification code and the fetching and caching of public keys are your code's responsibility.

Verifying in front means less code, and an invalid request doesn't run the function. In exchange, the verification rules are limited to what API Gateway provides. Each approach has its advantages.

This comparison describes common architectures, and the primary sources on the Cloudflare side have not been checked.

## Costs

Amounts are in USD, for the Tokyo Region, before tax. The inputs and unit prices behind the calculations are in [Pricing Worksheets](/en/reference/pricing.md).

A Cognito user pool is charged by the number of monthly active users (MAU). A user who performed some operation in the month, such as a sign-in or a token refresh, counts as one. The default plan for a new user pool is Essentials, which costs USD 0.015 per MAU in the Tokyo Region. According to the pricing page, Essentials and Lite have a free allowance of 10,000 MAU a month per account (or organization), and it does not expire after 12 months.

With 100 users, that is USD 1.50 a month at the list price, and 0 within the free allowance.

Email and SMS are charged separately. In this chapter's setup, the temporary password email sent when a user is created goes through Cognito's default sending feature. Its limits and charges have not been checked. An app with many users uses Amazon SES ([chapter 15](/en/chapters/15-email.md)).

The API Gateway price list for the Tokyo Region has no item for JWT authorizers. A rejected request doesn't invoke the function, so there is no Lambda charge. Whether that request counts toward the API Gateway request charge has not been checked.

The table below shows the cost of the whole app. It adds 100 MAU to the chapter 05 example of 1 million requests a month.

| Item | List price | After the monthly free allowance |
| --- | --- | --- |
| Chapter 05 total (API Gateway, Lambda, logs, DynamoDB) | 2.41 | 1.64 |
| Cognito (Essentials, 100 MAU) | 1.50 | 0 |
| Subtotal | **3.91** | **1.64** |

For the cost of SPA delivery (CloudFront and S3), see the calculation in chapter 03.

**In a month when nobody signs in, the Cognito charge is 0.** What remains is the charge for what the table and the bucket store.

Deleting the stack deletes the user pool and the users in it. As "Clean up" says, what remains is the storage created by the cdkd bootstrap and the deployment files placed in it.

### When it gets hammered

This API's URL is public, so a bot may send it requests in bulk. This section works out what happens then and what it costs.

Someone who isn't signed in can do only two things. One is to call `/health`, and that request reaches the function. The other is to call any other route and be turned away by the authorizer, in which case the function doesn't run. As noted above, whether a rejected request counts toward the API Gateway charge has not been checked.

A signed-in user can call every route. Nobody can register with this user pool themselves, though, so the only users are the ones you created with `app:user:create`.

Both kinds of caller face a ceiling. The stage's throttling is 10 requests a second, which is at most 25.92 million requests in a month (30 days). If every one of them got through and every one ran the function, the cost would be as in the table below. Lambda and logs use the same assumptions as the example above (60 milliseconds on average, 256 MB, 0.5 KB per call).

| Item | Quantity | List price |
| --- | --- | --- |
| API Gateway | 25.92 million requests | 33.44 |
| Lambda (requests and duration) | 25.92 million invocations, 388,800 GB-seconds | 10.37 |
| Log ingestion and storage | 12.36 GB | 9.49 |
| DynamoDB writes (at the table's cap) | 40 units a second, 103.68 million a month | 74.13 |
| DynamoDB reads (at the table's cap) | 150 units a second, 388.8 million a month | 55.40 |
| Subtotal | | **182.83** |

Someone who isn't signed in reaches the first three rows and no further. The two DynamoDB rows are what a signed-in user would cost by updating the largest possible note and listing for a month without a break. It will hardly ever get that far, and the rows are there as the figure the cost can't go above.

This calculation treats the 10-a-second throttling as one limit for the whole API. If each route is counted separately, the first three rows, as far as a signed-in user can reach them, multiply by the number of routes (seven in this chapter). Which it is has not been checked on a real API. The two DynamoDB rows don't change, because they are the table's own cap. Whether a request answered with a 429 is charged for has not been checked either.

The table leaves out data transfer for the responses. Response size is capped: a list is one page of 20 summaries and at most 20 KiB, and one note is at most 64 KiB. Ten requests a second for a month comes to about 494 GB if every response is a list, which is about USD 56 at the price for transfer out to the internet (USD 0.114 per GB). If every response were one 64 KiB note, it would still stop at about 1,582 GB, or about USD 180. As in chapter 04, whether that unit price applies unchanged to API Gateway responses has not been checked. Only a signed-in user can call the routes that return notes.

The amount of stored data is capped too. One person holds at most 100 notes and a note is about 31 KB at its largest, so that is about 3 MB a person.

Throttling doesn't tell callers apart. On a route a bot keeps sending requests to, real users get a 429 as well. Your bill is protected, but the API's availability is not. Protecting that takes something that limits each caller separately. An AWS WAF rate-based rule does this, but as [chapter 21](/en/chapters/21-security.md) explains, it can't be attached to an HTTP API directly. You put CloudFront in front and attach it there (USD 5 a month for the web ACL, USD 1 a month per rule, USD 0.60 per million requests inspected). This book doesn't build that setup.

## Where people get stuck

| If you see this | Look here |
| --- | --- |
| `dev:app:api` stops with a message that mentions `LOCAL_AUTH_SECRET` | Check that `examples/06-auth/.env` exists and that the value is 32 characters or longer |
| The local SPA shows "The app could not start." | Check that `dev:app:api` is running, and check `apiUrl` in `web/public/config.json` |
| The sign-in page shows an error about a redirect mismatch | Check that the SPA's origin and `/callback` match the client's callback URL exactly. A trailing `/` counts as a difference |
| After sign-in, it shows "does not belong to a sign-in started in this tab" | The tab where you started the sign-in and the tab you came back to are different, or it took 10 minutes or more. Sign in again |
| The deployed API returns 401 even though you are signed in | Check that the SPA is sending an access token and that `clientId` in `config.json` matches the stack's `UserPoolClientId` |
| A 403 comes back | The token doesn't have the `openid` scope. Check that the sign-in request sends `scope=openid` |
| The browser console shows a CORS error | When API Gateway returns a 401 or 403, the response can lack CORS headers, and the browser can show it as a CORS error. Check the status code with `curl` first |
| A 429 comes back | This is the stage's throttling (10 requests a second). It isn't per user, so it also comes back when someone else has used it up. Wait a moment and call again |
| Creating a note returns 409 `quota_exceeded` | That user has 100 notes. Waiting changes nothing, so delete one |
| You disabled a user and they can still call the API | This is the behavior [Disabled, and still getting through for a while](/en/chapters/06-auth/deploy.md) describes. Requests pass until the access token expires |

The body of a 401 or 403 returned by API Gateway is not in this book's error shape (`error.code`). The typed client treats it as `unauthenticated`.

## If you take this to production

- Limit requests per caller. This chapter's throttling doesn't tell callers apart. As "When it gets hammered" says, either put CloudFront and AWS WAF in front or count a per-user limit in the app
- Enable MFA. This chapter's user pool uses a password only. If you add MFA, also provide the step where a user registers an authenticator app. This chapter's SPA has no screen for that
- Remove the local origin. Delete `http://localhost:5173` from the callback URLs and from CORS, and use a separate stack for development
- Use a custom domain. While the sign-in page's domain is still `...amazoncognito.com`, users have a harder time telling whether it is genuine
- Send email from SES. Cognito's default sending is for small volumes ([chapter 15](/en/chapters/15-email.md))
- Decide the token lifetime and the revocation policy. Choose from the table in [Disabled, and still getting through for a while](/en/chapters/06-auth/deploy.md)
- Set a Content-Security-Policy to reduce the damage from XSS. As chapter 03 explained, the managed policy doesn't include one
- Connect deleting a user to deleting their data. When you delete a user, the notes under that `sub` remain in the table, so you need a process that deletes them
- Protect the user pool. Set `removalPolicy` to `RETAIN` and enable deletion protection. If you delete the user pool, every user has to register again

## Clean up

<!-- section: 06.cleanup -->

```bash
vp run app:unpublish --yes
vp run app:infra:destroy
```

`app:unpublish` empties the bucket first. `app:infra:destroy` then deletes the user pool, the table, the function, the API, the distribution, and the bucket. All the users and notes go with them, and they can't be restored.

To delete only a user, run `vp run app:user:delete you@example.com`. That user's notes remain in the table.

What remains is the storage created by the cdkd bootstrap (chapter 02) and the deployment files placed in it.

::: details Verification notes for this chapter

**Checked locally.** These were run: the API tests (authentication, authorization, the audit log), the tests for reading the caller, the development sign-in tests, the tests for the temporary PKCE storage, the infrastructure assertions, type checking, the SPA build, and synth. With `dev:app:api` and `dev:app:web` started, the following was also checked by driving a browser automatically: sign-in, creating a note, that fetching it as another user is a 404, that a request without a token is a 401, the conflict display and "Keep my text and save over it", and that sign-in is required after a reload. API tests also pin the list: it returns no body, a page stops at 20 notes, and it stays under 20 KiB with the largest titles. The browser check was not repeated after that change, and the SPA was only type-checked and built. The caps added here were checked with tests. A user's 101st note is a 409, other users are unaffected, and deleting one gives the place back (through `composeApp` as well). The template has the throttling on the stage and the request unit caps on the table.

**Not checked yet.** Sign-in with Cognito has never been run. `web/src/auth/cognito.ts` (the authorization code and PKCE round trip, and the token exchange) has only passed type checking and has not been run against a real user pool. This is the most important unverified part of this chapter. `app:infra:deploy`, `app:user:create`, `app:publish`, `app:smoke:web`, `app:smoke:api`, `app:infra:drift`, `app:unpublish`, and `app:infra:destroy` have not been run either. So the following have not been checked in a real environment: that the JWT authorizer rejects an ID token and an invalid token, that the Cognito token endpoint can be called directly from a browser (CORS), and that the shapes of `Issuer` and `AuthDomain` written to `config.json` satisfy oauth4webapi's validation. The same goes for the limits. These have not been checked: whether cdkd 0.296.28 applies the stage's `DefaultRouteSettings` and the table's `OnDemandThroughput`, whether throttling is counted for the whole API or per route, whether a 429 or a request the authorizer rejected is charged for, and that the conditional update that counts notes succeeds on a real DynamoDB. The amounts in "When it gets hammered" are computed from unit prices and assumptions.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Add the caller to the contract | `examples/06-auth/api/src/contract.ts` | `test:unit` |
| Establish the caller | `examples/06-auth/api/src/identity.ts`, `api/src/lambda.ts`, `api/src/app.ts`, `api/test/identity.test.ts` | `test:unit` |
| Only your own notes are reachable | `examples/06-auth/api/src/app.ts`, `api/test/app.test.ts`, `examples/05-dynamodb/src/notes.ts` | `test:unit` |
| Run it as two users on your machine | `examples/06-auth/api/src/dev.ts`, `api/src/local-auth.ts`, `api/test/local-auth.test.ts`, `api/src/compose.ts`, `web/src/auth/local.ts`, `web/src/config.ts`, `web/public/config.json`, `.env.example` | `dev:app:api`, `dev:app:web` |
| Sign in from the SPA | `examples/06-auth/web/src/auth/`, `web/src/App.vue`, `web/src/router/route.ts`, `api/src/client.ts` | `test:unit`, `typecheck:app:web`, `lint:app:web`, `build:app:web` |
| Getting ready for AWS | `examples/06-auth/infra/lib/notes-app-stack.ts`, `infra/bin/app.ts`, `infra/functions/spa-fallback.js`, `infra/test/notes-app-stack.test.ts`, `cdk.json` | `app:infra:synth`, `test:unit` |
| Deploy | `examples/06-auth/scripts/write-config.ts`, `scripts/user.ts`, `scripts/smoke.ts`, `tools/src/site/`, `tools/src/infra/` | `app:infra:diff`, `app:infra:deploy`, `app:user:create`, `app:publish`, `app:smoke:web`, `app:smoke:api`, `app:infra:drift` |
| Clean up | `tools/src/site/unpublish.ts`, `examples/06-auth/scripts/user.ts` | `app:unpublish`, `app:infra:destroy`, `app:user:delete` |
| Costs | `data/pricing/` | `test:unit` |

**Primary sources** (all checked 2026-10-11)

- [Control access to HTTP APIs with JWT authorizers in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [The redirect and authorization endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
- [Understanding the access token](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)
- [Ending user sessions with token revocation](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html)
- [The managed login sign-out endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html)
- [Amazon Cognito pricing](https://aws.amazon.com/cognito/pricing/)
- AWS Price List bulk API: [Cognito](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCognito/current/ap-northeast-1/index.json)
- [oauth4webapi 3.8.8](https://www.npmjs.com/package/oauth4webapi/v/3.8.8), [jose 6.2.12](https://www.npmjs.com/package/jose/v/6.2.12) (type definitions)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
