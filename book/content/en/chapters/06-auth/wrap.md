---
title: "06 Auth: Costs, Pitfalls, and Cleanup"
---

# 06 Auth: Costs, Pitfalls, and Cleanup

## If you're coming from Workers

To do the same thing on Cloudflare, you would often either put Cloudflare Access in front or use a library that verifies the JWT inside the Worker. The difference is where the verification happens.

In this chapter, verification is finished in front of the function (in API Gateway), and the function only reads the result. With verification inside the Worker, the verification code, and fetching and caching the public keys, are your code's responsibility.

Both have their good sides. Verifying in front means less code, and an invalid request doesn't run the function. In exchange, the verification rules are limited to what API Gateway provides.

This comparison describes common architectures, and the primary sources on the Cloudflare side have not been checked.

## Let's talk money

Amounts are in USD, for the Tokyo Region, before tax. The inputs and unit prices behind the calculations are in [Pricing Worksheets](/en/reference/pricing.md).

Cognito first. A user pool is charged by the number of monthly active users (MAU). A user who performed some operation in that month, such as a sign-in or a token refresh, is counted as one. The default plan for a new user pool is Essentials, which in the Tokyo Region is USD 0.015 per MAU. According to the pricing page, Essentials and Lite have a free allowance of 10,000 MAU per month per account (or organization), and it does not expire after 12 months.

With 100 users, that is USD 1.50 per month at the list price. Within the free allowance, it is 0.

Email and SMS are charged separately. In this chapter's setup, the temporary password email sent when a user is created goes through Cognito's default sending feature. Its limits and charges have not been checked. An app with many users uses Amazon SES ([chapter 15](/en/chapters/15-email.md)).

What about the JWT authorizer? The API Gateway price list for the Tokyo Region has no item for authorizers. A rejected request doesn't invoke the function, so there is no Lambda charge. Whether that request is counted toward the API Gateway request charge has not been checked.

For the whole app, it looks like this. The calculation adds 100 MAU to the chapter 05 example of 1 million requests per month.

| Item | List price | After the monthly free allowance |
| --- | --- | --- |
| Chapter 05 total (API Gateway, Lambda, logs, DynamoDB) | 2.41 | 1.64 |
| Cognito (Essentials, 100 MAU) | 1.50 | 0 |
| Subtotal | **3.91** | **1.64** |

For SPA delivery (CloudFront and S3), see the calculation in chapter 03.

**In a month when nobody signs in, the Cognito charge is 0.** What remains is only the storage for the table and the bucket.

Delete the stack, and the user pool and the users in it go with it. As "Clean up" says, all that's left is the storage locations created by the cdkd bootstrap and the deployment files placed in them.

## Where people get stuck

| If you see this | Look here |
| --- | --- |
| `dev:app:api` stops with a message that mentions `LOCAL_AUTH_SECRET` | Is `examples/06-auth/.env` there? Is the value 32 characters or longer? |
| The local SPA shows "The app could not start." | Is `dev:app:api` running? Check `apiUrl` in `web/public/config.json` too |
| The sign-in page shows an error that indicates a redirect mismatch | Do the SPA's origin and `/callback` match the client's callback URL exactly? A trailing `/` or its absence counts as a difference |
| After sign-in, it shows "does not belong to a sign-in started in this tab" | The tab where you started the sign-in and the tab you came back to are different. Or it took 10 minutes or more. Sign in again |
| The deployed API returns 401 even though you are signed in | Is the SPA sending an access token? Does `clientId` in `config.json` match the stack's `UserPoolClientId`? |
| A 403 comes back | The token doesn't have the `openid` scope. Does the sign-in request send `scope=openid`? |
| The browser console shows a CORS error | When API Gateway returns a 401 or 403, the response can lack CORS headers, and the browser can display it as a CORS error. Check the status code with `curl` first |
| You disabled a user and they can still call the API | That's what "Disabled, and still getting through for a while" describes. The token passes until the access token expires |

The body of a 401 or 403 returned by API Gateway is not in this book's error shape (`error.code`). The typed client treats it as `unauthenticated`.

## If you take this to production

- **Enable MFA.** This chapter's user pool uses a password only
- **Remove the local origin.** Delete `http://localhost:5173` from the callback URLs and from CORS. Use a separate stack for development
- **Use a custom domain.** While the sign-in page's domain is still `...amazoncognito.com`, it is harder for users to tell whether it is genuine
- **Send email from SES.** Cognito's default sending is for small volumes ([chapter 15](/en/chapters/15-email.md))
- **Decide the token lifetime and the revocation policy.** Choose from the table in "Disabled, and still getting through for a while"
- **Set a Content-Security-Policy.** It reduces the damage from XSS. As we said in chapter 03, it is not included in the managed policy
- **Connect deleting a user to deleting their data.** When you delete a user, the notes under that `sub` remain in the table. You need a process that deletes them
- **Protect the user pool.** Set `removalPolicy` to `RETAIN` and enable deletion protection. If you delete the user pool, every user has to start over from registration

## Clean up

<!-- section: 06.cleanup -->

```bash
vp run app:unpublish --yes
vp run app:infra:destroy
```

Empty the bucket first. `app:infra:destroy` deletes the user pool, the table, the function, the API, the distribution, and the bucket. All the users and notes go with them, and they can't be restored.

To delete only a user, run `vp run app:user:delete you@example.com`. That user's notes remain in the table.

All that's left is the storage locations created by the cdkd bootstrap (chapter 02) and the deployment files placed in them.

::: details Verification notes for this chapter

**Checked locally.** The API tests (authentication, authorization, the audit log), the tests for reading the identity, the development sign-in tests, the tests for the temporary PKCE storage, the infrastructure assertions, type checking, the SPA build, and synth. Also, with `dev:app:api` and `dev:app:web` started, the following was checked by driving a browser automatically: sign-in, creating a note, that fetching it as another user is a 404, that a request without a token is a 401, the conflict display and "Keep my text and save over it", and that sign-in is required after a reload.

**Not checked yet.** Sign-in with Cognito has never been run. `web/src/auth/cognito.ts` (the authorization code and PKCE round trip, and the token exchange) has only passed type checking and has not been run against a real user pool. This is the most important unverified part of this chapter. `app:infra:deploy`, `app:user:create`, `app:publish`, `app:smoke:web`, `app:smoke:api`, `app:infra:drift`, `app:unpublish`, and `app:infra:destroy` have not been run either. So the following have not been checked in a real environment: that the JWT authorizer rejects an ID token and an invalid token; that the Cognito token endpoint can be called directly from a browser (CORS); that the shapes of `Issuer` and `AuthDomain` written to `config.json` satisfy oauth4webapi's validation.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Add "who" to the contract | `examples/06-auth/api/src/contract.ts` | `test:unit` |
| Who is calling? | `examples/06-auth/api/src/identity.ts`, `api/src/lambda.ts`, `api/src/app.ts`, `api/test/identity.test.ts` | `test:unit` |
| Only your own notes are reachable | `examples/06-auth/api/src/app.ts`, `api/test/app.test.ts`, `examples/05-dynamodb/src/notes.ts` | `test:unit` |
| Be two people on your machine | `examples/06-auth/api/src/dev.ts`, `api/src/local-auth.ts`, `api/test/local-auth.test.ts`, `api/src/compose.ts`, `web/src/auth/local.ts`, `web/src/config.ts`, `web/public/config.json`, `.env.example` | `dev:app:api`, `dev:app:web` |
| Sign in from the SPA | `examples/06-auth/web/src/auth/`, `web/src/App.vue`, `web/src/router/route.ts`, `api/src/client.ts` | `test:unit`, `typecheck:app:web`, `lint:app:web`, `build:app:web` |
| Getting ready for AWS | `examples/06-auth/infra/lib/notes-app-stack.ts`, `infra/bin/app.ts`, `infra/functions/spa-fallback.js`, `infra/test/notes-app-stack.test.ts`, `cdk.json` | `app:infra:synth`, `test:unit` |
| Deploy | `examples/06-auth/scripts/write-config.ts`, `scripts/user.ts`, `scripts/smoke.ts`, `tools/src/site/`, `tools/src/infra/` | `app:infra:diff`, `app:infra:deploy`, `app:user:create`, `app:publish`, `app:smoke:web`, `app:smoke:api`, `app:infra:drift` |
| Clean up | `tools/src/site/unpublish.ts`, `examples/06-auth/scripts/user.ts` | `app:unpublish`, `app:infra:destroy`, `app:user:delete` |
| Let's talk money | `data/pricing/` | `test:unit` |

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
