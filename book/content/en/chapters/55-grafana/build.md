---
title: "55 Grafana: Design and Build"
---

# 55 Grafana: Design and Build

The [previous page](/en/chapters/55-grafana.md) covered the condition for signing in, the price, and the reasons to add Grafana. This page builds everything from the single definition of the dashboard to its delivery into a workspace.

## One Definition

<!-- section: 55.definition -->

There is one thing to protect. **The two dashboards read the same metrics, with the same statistic and the same period.** That is this chapter's invariant.

Chapter 19's dashboard is assembled by chapter 19's `Monitoring` construct through the CDK API, and this chapter does not change it. Instead, what the dashboard shows is written again in a form that leans on neither the CDK nor Grafana.

<<< @/examples/55-grafana/src/signals.ts{types}

A `Resource` is one of three things: the API, the function, or the table. Their names are not known until a deploy, so the definition says which resource it means in place of a name. A `Signal` classifies what a line tells you about users, and there are four: traffic, errors, latency, and saturation. Saturation is how close something is to a limit, as throttling and concurrency show. Read with these four, chapter 19's dashboard has only what a user feels in its top row (traffic, errors, latency), and saturation in the rows below.

<<< @/examples/55-grafana/src/signals.ts{rows}

DynamoDB reports `ThrottledRequests` and `SystemErrors` per operation only. Chapter 19 draws each as one line, the sum over five operations, so the definition has a `sum` form for it.

Whether this definition really equals chapter 19's dashboard is settled by a test, not by the care of whoever wrote it. First comes a function that builds the body of a CloudWatch dashboard from the definition.

<<< @/examples/55-grafana/src/cloudwatch.ts{body}

The test synthesizes chapter 19's stack on the spot, takes the dashboard body out of the template, and compares it whole with this function's output. A difference in the number of widgets, a position, a title, a metric, a statistic, a period or a label fails it. Whoever adds a line to chapter 19's dashboard sees this chapter's test fail, and so updates the definition too.

The same check is used after a deploy.

<<< @/examples/55-grafana/src/cloudwatch.ts{read}

`readCloudWatchBody` reads the Region and the three resource names out of a deployed body. Chapter 19's stack does not output the names of its function or its table, so the names are taken from where they are actually used. `agreeingDashboard` puts the names it read into the definition, rebuilds the body, and returns the names only when the result equals the original. A dashboard to which someone added a line in the console is refused here.

## Generating the Grafana Dashboard

<!-- section: 55.dashboard -->

A Grafana dashboard is one JSON object. It lists panels, and each panel holds the queries it sends to a data source, which Grafana calls targets. A CloudWatch query has this shape.

<<< @/examples/55-grafana/src/grafana.ts{target}

The field names and their meanings come from the type definitions of the CloudWatch data source in Grafana's repository, at the v13.0.9 tag. Managed Grafana does not publish which 13.x release a version 13 workspace runs, so one tag of the 13.0 line was chosen and read.

`matchExact` restricts a query to the metric that has exactly the given dimensions. Without it Grafana builds a search expression and draws up to 100 matching metrics. It is always `true` here, so that another API's line cannot slip in.

<<< @/examples/55-grafana/src/grafana.ts{dashboard}

A sum uses CloudWatch metric math as it is. The part queries get an `id` and are hidden (`hide`), and an expression query adds them by ID: `getitem + putitem + ...`. It is the same expression the CloudWatch dashboard uses.

Three things were decided.

The `uid` is fixed. Grafana identifies a dashboard by its `uid`, so every push replaces the same dashboard.

`editable` is `false`. The source is the definition in the repository, so the workspace's screens are not for editing it. A change someone wants to make on screen is made in the definition and pushed.

`schemaVersion` is 41. That is what Grafana 12.0 writes, and 13.0.9 writes 42. The documentation says that a dashboard in the older form, put in through the API, is migrated to the newer form automatically when it is loaded.

One thing is not matched with chapter 19's dashboard. Chapter 19 draws Lambda's concurrency on the right axis, and the Grafana side does not split the axes. The metrics read are the same. Only the look differs.

Before the generated JSON is sent, a schema checks it.

<<< @/examples/55-grafana/src/schema.ts{panel}

This schema looks at the fields this chapter writes, as strictly as is known, and refuses any field it does not know. It is not Grafana's own validation, so passing it does not mean Grafana will accept the JSON. Its purpose is to stop, before anything is sent, the mistakes that can be caught locally: panels that overlap, two panels with one ID, an expression that names a query the panel does not have.

The test of "reads the same metrics" uses the next function.

<<< @/examples/55-grafana/src/schema.ts{queried}

The test takes the list of metrics the generated dashboard reads and compares it with the list taken from the body in chapter 19's template. The second list is read straight from the template, without passing through this chapter's definition. Namespace, metric name, dimensions, statistic and period must all match for the test to pass.

## The Workspace and Its Role

<!-- section: 55.workspace -->

CloudFormation has one resource type for Managed Grafana: the workspace. User assignments, service accounts, data sources, dashboards and alert rules are not CloudFormation resources. The stack creates the workspace and the role, and the contents go in through the HTTP API of the next section.

<<< @/examples/55-grafana/infra/bin/app.ts{context}

`authentication` has no default. Without it no workspace is created and the stack holds the role only. Choosing how people sign in is, by design, the same act as starting the bill.

<<< @/examples/55-grafana/infra/lib/grafana-stack.ts{role}

This is the role handed to the workspace. Its trust policy lets the Grafana service assume it only for a workspace of this account in this Region. Without the conditions, the policy would let the Grafana service assume the role on behalf of anyone's workspace.

<<< @/examples/55-grafana/infra/lib/grafana-stack.ts{actions}

The permissions are two actions. A workspace gets its permissions in one of two ways: the service manages them (service managed), or you hand it a role (customer managed). Left to the service, CloudWatch access means the AWS managed policy `AmazonGrafanaCloudWatchAccess`, which also covers reading logs, describing alarms and reading EC2 tags. The panels of this chapter only fetch metric data, so the role is handed over instead. Neither action can be limited to a metric's ARN, so the resource is `*`. When you add a panel that shows logs, add permission to read that log group here.

Whether these two actions are enough was not checked against a real workspace.

<<< @/examples/55-grafana/infra/lib/grafana-stack.ts{workspace}

The remaining settings, in order.

Network. By default a workspace is reachable from any address. Signing in is required, but anyone can reach the sign-in screen. Passing managed prefix lists with `-c prefixListIds=pl-...` makes the workspace reachable only from the addresses in them, and everyone else gets a 403. Private address ranges in a prefix list are ignored, so opening the workspace from inside a VPC takes an interface endpoint for workspaces, allowed by its ID. This chapter creates none.

Plugins. With `pluginAdminEnabled` set to `true`, administrators of the workspace can install plugins from the catalog. A plugin is code that runs right next to the data, and the documentation says the decision and the responsibility for community plugins lie with the customer. This chapter's dashboard needs only what is installed from the start, so the setting is `false`.

Version. The choices are 9, 10, 12 and 13. Without `grafanaVersion`, the service picks its latest version at creation. A workspace can move up and never down. An update cannot be undone, and the workspace is read-only for up to about 10 minutes while it runs. Plugins are not updated with it. The exact form of the string to pass as `-c grafanaVersion=...` was not confirmed for this chapter.

## Delivering the Dashboard

<!-- section: 55.provision -->

Calling Grafana's HTTP API takes a token of a service account. A service account is a user for programs instead of people, with the role of administrator, editor or viewer. It is billed as one user as well.

A token expires, at most 30 days after it is made. The documentation recommends a few hours or less. This chapter goes shorter.

<<< @/examples/55-grafana/src/provision.ts{token}

Each push mints a token that lives 15 minutes and deletes it when done. **It is stored nowhere.** The token is minted by `aws grafana create-workspace-service-account-token`, an AWS API called with IAM permissions. So whether you can write to Grafana is decided, in the end, by AWS credentials. To push from CI, allow that API to the OIDC role of [chapter 20](/en/chapters/20-shipping.md), then mint and delete the token inside the pipeline. No long-lived secret comes to exist anywhere.

If a token really must be kept, the place for it is Secrets Manager from [chapter 21](/en/chapters/21-security.md). It still expires in 30 days, so something has to replace it. An expired token counts toward the limit of 100 per workspace until it is deleted.

<<< @/examples/55-grafana/src/provision.ts{call}

The token travels to the workspace endpoint and nowhere else. The endpoint comes from a stack output, and anything that is not a bare host name (a path, a port, user info) is refused. Redirects are not followed, because following one would hand the `Authorization` header to wherever it points. An error message carries Grafana's own words and never the request that was sent.

<<< @/examples/55-grafana/src/provision.ts{datasource}

The data source is created when it is missing. `authType: "default"` is the AWS SDK's default authentication, which according to the Managed Grafana documentation uses the permissions of the role handed to the workspace. No access key is given to Grafana. Only an administrator can add a data source, so this service account has the administrator role. Because that is a lot of reach, the token's life is short.

<<< @/examples/55-grafana/src/provision.ts{save}

The dashboard is sent with `overwrite: true`. Whatever the workspace holds under the same `uid` is replaced, whoever edited it. With one source of truth, that is the intended behaviour.

`vp run grafana:push` calls these parts in order. It reads the body of chapter 19's dashboard from CloudWatch and stops there if the body does not agree with the definition. If it agrees, it mints the token, makes sure of the data source, sends the dashboard, and deletes the token whether the push succeeded or failed.

Version 13 also has Git Sync, which keeps dashboards in step with a Git repository in both directions and can turn an edit made in the workspace into a pull request. It was not tried for this chapter.

## Which Side Owns the Alerts

<!-- section: 55.alerts -->

Grafana has alerts too. A rule sends queries to a data source and notifies when its condition has held for long enough, and in workspaces of version 12 or later alerting is always on. Rules, contact points and notification policies can be put in from code as dashboards can: through the HTTP API (`POST /api/v1/provisioning/alert-rules` and its siblings) or Terraform. A rule put in through the API cannot be edited in the workspace's screens by default.

This chapter creates no rule. The two alarms of chapter 19 stay the ones that page a person, for three reasons.

The first is that the same condition cannot be written in both places. A chapter 19 alarm fires when 3 of the last 5 minutes are over the threshold. A Grafana rule has a pending period, which counts how long the condition has held without a break. Writing 3 minutes there does not make "3 of 5". Missing data works differently as well: CloudWatch has `notBreaching`, and Grafana has a `NoData` state. Put similar rules in both and a night comes when only one of them fires.

The second is the expression for the 5xx rate. Chapter 19 computes `errors / requests` with metric math. The Managed Grafana documentation says an alert rule cannot be built on an expression query that refers to another query. The expression would have to be rebuilt on the Grafana side, which is a second definition again.

The third is where evaluation happens. A CloudWatch alarm is evaluated whether or not a workspace exists. A Grafana rule is evaluated by the workspace. Delete the workspace and the rule is gone, and when the workspace can no longer read CloudWatch, the rule turns to `NoData` or `Error`.

Grafana's alerts fit when the condition cannot be written with CloudWatch metrics alone: a condition on Prometheus metrics or on an Athena aggregate, or one rule across several data sources. Even then, keep the rule that pages for one symptom in one place. A workspace allows 100 rule instances.

To notify through SNS, the workspace role needs `sns:Publish`. The policy the service creates when it manages permissions allows publishing only to topics whose name starts with `grafana`. To publish to chapter 19's topic, add that topic's ARN to this chapter's role.

## Checking It Locally

<!-- section: 55.local -->

Neither an AWS account nor a Grafana is needed.

```bash
vp test run examples/55-grafana
vp run grafana:render
vp run grafana:render --cloudwatch
vp run grafana:infra:synth
```

`grafana:render` prints the generated dashboard JSON, with placeholders such as `API_ID` for the resource names. With `--cloudwatch` it prints the CloudWatch body built from the same definition. `grafana:infra:synth` writes a template with the role only into `cdk.out`, and with `-c authentication=AWS_SSO` a template that includes the workspace. Synth asks AWS nothing.

The tests check the following.

- The definition equals the dashboard in chapter 19's template, exactly
- `agreeingDashboard` refuses a dashboard whose statistic changed, that gained a line, or that mixes in another table
- The generated dashboard reads chapter 19's metrics and no others
- The schema refuses an unknown field, overlapping panels, and an expression that names a missing query
- The token appears in the `Authorization` header only, and nothing is sent to an endpoint that is not a host name
- The default stack has no workspace, and the role has exactly two actions

What is not reproduced locally is Grafana itself. Whether a real Grafana accepts the generated JSON and draws its lines, and whether the HTTP API answers in the shape of the fake, can only be learned by creating a workspace. The tests of the API calls run against a fake `fetch` written for this chapter after the examples in the documentation.

Next is [Deploy](/en/chapters/55-grafana/deploy.md).
