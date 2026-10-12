---
title: "21 Security: Deploy"
---

# 21 Security: Deploy

This page deploys the default stack built so far to AWS and checks it. It also adds the bounds that hold when a flood of requests reaches the public URL.

## Deploying and checking

<!-- section: 21.deploy -->

For the default stack alone, the steps are the same as in earlier chapters.

```bash
vp run sec:infra:diff
vp run sec:infra:deploy
vp run sec:smoke
```

`sec:smoke` runs against the CloudFront URL and checks, in order, `/health`, issuing a token, verifying it, rejection of a token with an altered signature, and rejection of POST. Issuing a token reads Secrets Manager once, which is one billed API call.

You should know one thing before you deploy. **The default deploy has nothing that limits the number of requests.** CloudFront is set not to cache, so every request that arrives goes all the way to Lambda. `/token?sub=...` has no authentication and signs a token for anyone, for any `sub`. Nothing in this chapter trusts that token. A real service would authenticate the caller before issuing one. If someone learns the URL and hammers it, you are billed for every request they send. The amounts are worked out under ["When it gets hammered" in the cost section](/en/chapters/21-security/wrap.md).

Two bounds are available.

One is the web ACL, which limits each IP address to 300 requests in five minutes. It is the most effective bound in this chapter, but it costs USD 8.00 a month, so it is not attached by default. How to attach it is under ["Entry points that can carry WAF, and ones that can't" in Build, Continued](/en/chapters/21-security/more.md).

The other bound costs nothing.

```bash
vp run sec:infra:deploy -c reservedConcurrency=5
```

This option lets at most 5 instances of the function run at once. Lambda rejects requests beyond that, which puts a ceiling on Lambda duration and on the secret reloads that happen in each execution environment. It does not look at IP addresses, though, so while a flood is arriving, real users are rejected along with everyone else. CloudFront's request fee also applies to the rejected requests.

If a new account refuses this deploy with a concurrency error, check the account's limit in Service Quotas. The value at which the refusal starts has not been checked. Turn on at least one of the two bounds before you give the URL to anyone.

Check as well that the function URL can't be called directly. Find the function's URL in the Lambda console and call it with `curl`. It should return 403.

```bash
vp run sec:infra:drift
```

Every resource type in this stack has a dedicated implementation in the pinned cdkd. What drift detection can compare, and how far, is unknown because it has not been run. Note that a rotation does not show up as drift. The secret's value is not in the template, so there is nothing to compare it with.
