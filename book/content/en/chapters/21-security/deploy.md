---
title: "21 Security: Deploy"
---

# 21 Security: Deploy

## Deploy and check

<!-- section: 21.deploy -->

For the default stack alone, the flow is the usual one.

```bash
vp run sec:infra:diff
vp run sec:infra:deploy
vp run sec:smoke
```

`sec:smoke` checks, against the CloudFront URL and in order, `/health`, issuing a token, verifying it, refusal of a token with an edited signature, and refusal of POST. Issuing a token reads Secrets Manager once (a billed API call).

One thing a chapter about defense should say up front. **The default deploy has nothing that limits the number of requests.** CloudFront is set to cache nothing, so every request that arrives goes all the way to Lambda. `/token?sub=...` has no authentication and signs for anyone, for any `sub` (nothing in this chapter trusts that token; a real service authenticates the caller before issuing one). If the URL gets out and gets hammered, you are billed for every hit. The amounts are worked out under "When it's hammered" in the money section.

Two bounds are ready for you.

One is the web ACL: 300 requests in five minutes per IP address. It is the most effective bound in this chapter, but it costs USD 8.00 a month, so it isn't attached by default. How to attach it is in the section "Entry points that can carry WAF, and ones that can't."

The other costs nothing.

```bash
vp run sec:infra:deploy -c reservedConcurrency=5
```

It lets at most 5 copies of the function run at once. Lambda turns away the rest, which puts a ceiling on Lambda duration and on the secret reloads that happen in each execution environment. It doesn't look at IP addresses, so while you're being hammered, real users are turned away with everyone else. And CloudFront's request fee is charged for the requests that get turned away, too.

If a new account refuses this deploy with a concurrency error, check the account's limit in Service Quotas. To be honest, where exactly the refusal starts hasn't been checked here. Before you hand the URL to anyone, turning on one of the two is a good idea.

Have a look, too, that the function URL can't be called directly. Find the function's URL in the Lambda console and call it with `curl`; you should get 403.

```bash
vp run sec:infra:drift
```

Every resource type in this stack is one the pinned cdkd has a dedicated implementation for. What drift can compare, and how far, is unknown because it hasn't been run. One thing in advance: a rotation is not drift. The secret's value is not in the template, so there is nothing to compare it to.
