---
title: "55 Grafana: Deploy"
---

# 55 Grafana: Deploy

## Create the Workspace and Deliver the Dashboard

<!-- section: 55.deploy -->

None of the steps from here on was run against a real AWS account. Creating a workspace costs at least 9 from that month on, outside the free trial. When you have tried it, delete it with the steps on the [last page](/en/chapters/55-grafana/wrap.md).

There are two prerequisites: chapter 19's stack is deployed, and a way to sign in is ready. For IAM Identity Center, enable it in the account first and create your own user.

```bash
vp run obs:infra:deploy
vp run grafana:infra:diff -c authentication=AWS_SSO
vp run grafana:infra:deploy -c authentication=AWS_SSO
```

For a SAML IdP, pass `SAML` in place of `AWS_SSO`. The IdP's metadata is then registered in the console after the workspace exists.

**Give `-c authentication=...` to every command from here on.** If you forget it and run `grafana:infra:deploy`, the workspace is gone from the template, and the deploy sets out to delete the workspace with the dashboards inside it. The habit of reading `grafana:infra:diff` first pays off here more than usual.

When the workspace's status is `ACTIVE`, assign a user. Assignments are not a CloudFormation resource, so the stack has none. Open the workspace in the Managed Grafana console, assign yourself in the Authentication tab, and make yourself an administrator. The documentation asks for at least one administrator per workspace. Then open the URL in the stack output `WorkspaceEndpoint` and check that you can sign in.

Next, deliver the dashboard.

```bash
vp run obs:smoke
vp run grafana:push
```

`obs:smoke` is chapter 19's task and sends a handful of requests to the API. A dashboard without a single line cannot tell you whether it was drawn correctly.

`grafana:push` works in this order.

1. It takes the dashboard's name from the outputs of chapter 19's stack and reads its body with `aws cloudwatch get-dashboard`
2. It checks that the body agrees with the definition in `src/signals.ts`, and takes the names of the API, the function and the table from it. If they disagree, it stops here
3. It looks for a service account named `aih-dashboards` and creates it with the administrator role if there is none
4. It mints a token that expires in 15 minutes
5. It looks for the CloudWatch data source and creates it if there is none
6. It sends the dashboard
7. It deletes the token

The service account of step 3 is billed as one user in any month in which it calls the API.

In the workspace you signed in to, open the `Notes API` dashboard and compare it with chapter 19's dashboard in the CloudWatch console. Seven panels with the same lines mean the chapter has done what it set out to do.

The drift check is the same as in earlier chapters.

```bash
vp run grafana:infra:drift -c authentication=AWS_SSO
```

It compares what is in the stack, which is the workspace's settings and the role. The dashboard is not a resource of the stack, so a change someone makes to it in the workspace does not show up here. Drift on the Grafana side is repaired by the next `grafana:push`, which overwrites it. Drift on the CloudWatch side is found by the second step of `grafana:push`.

As for cdkd, the package of the pinned version (0.296.28) was inspected. `AWS::IAM::Role` and `AWS::IAM::Policy` have dedicated implementations. `AWS::Grafana::Workspace` has none and goes through Cloud Control API. The type is in Cloud Control API's list of supported resources, but whether cdkd can actually create it, and read its `Endpoint` and `Id` attributes into outputs, is not confirmed.

### When Something Goes Wrong

| Symptom | Where to look |
| --- | --- |
| Creating the workspace fails | `AWS_SSO` may have been passed in an account where IAM Identity Center is not enabled. How this failure shows itself was not checked |
| The sign-in screen does not let you through | Whether you are assigned in the Authentication tab. Assignments are per workspace |
| The workspace URL answers 403 | If you passed `prefixListIds`, whether your address is in the prefix list |
| `grafana:push` stops with "does not show what src/signals.ts describes" | Chapter 19's dashboard differs from the definition. Compare the output of `vp run grafana:render --cloudwatch` with the body from `aws cloudwatch get-dashboard` |
| `could not create the data source: HTTP 403` | The service account is not an administrator. An `aih-dashboards` created earlier with another role may be left over |
| A panel shows a permission error | The workspace role lacks an action. Add it to `WORKSPACE_ACTIONS` in `infra/lib/grafana-stack.ts` and adjust the test |
