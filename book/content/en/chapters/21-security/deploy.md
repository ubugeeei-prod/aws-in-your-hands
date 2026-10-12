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

Have a look, too, that the function URL can't be called directly. Find the function's URL in the Lambda console and call it with `curl`; you should get 403.

```bash
vp run sec:infra:drift
```

Every resource type in this stack is one the pinned cdkd has a dedicated implementation for. What drift can compare, and how far, is unknown because it hasn't been run. One thing in advance: a rotation is not drift. The secret's value is not in the template, so there is nothing to compare it to.
