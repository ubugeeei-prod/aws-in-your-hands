---
title: "55 Grafana: Dashboards and Alerts with Amazon Managed Grafana"
sourceRevision: 1
---

# 55 Grafana: Dashboards and Alerts with Amazon Managed Grafana

The dashboard of [chapter 19](/en/chapters/19-observability.md) lives inside the CloudWatch console, so looking at it takes permission to enter the AWS account. Amazon Managed Grafana is a Grafana server that AWS runs. People enter it through their organization's sign-in instead of IAM, and data from outside CloudWatch can sit on the same screen.

This chapter builds a Grafana dashboard that shows the same numbers as chapter 19. A dashboard that exists in two places gets fixed in one of them, and then two people looking at the same incident see different numbers. So the definition of what to look at is written once, in code. The CloudWatch dashboard is checked against that definition, and the Grafana dashboard is generated from it.

No workspace was actually created for this chapter. Signing in has a condition and the service has a monthly price, so read the next section before you create one. The chapter builds on [chapter 19](/en/chapters/19-observability.md) and [chapter 01](/en/chapters/01-account.md). The code is in `examples/55-grafana/`.

## The Whole Picture

<!-- section: 55.overview -->

```figure
caption: One definition: the CloudWatch dashboard is checked against it, and the Grafana dashboard is generated from it
node def: signals.ts | the seven panels, defined
node cw: CloudWatch dashboard | chapter 19's stack
node json: Grafana JSON | generated
node ws: Grafana workspace
node metrics: CloudWatch Metrics
node people: People | IAM Identity Center or SAML
edge def -> cw: checked for equality
edge def -> json: generates
edge json -> ws: HTTP API, 15-minute token
edge ws -> metrics: GetMetricData with a role
edge people -> ws: sign in
mark def
```

Amazon Managed Grafana calls a logically isolated Grafana server a workspace. Providing, scaling and updating the server is AWS's work. What you own is the workspace's configuration and its contents. The service is available in the Tokyo Region.

A workspace holds no numbers of its own. Each time a panel opens, it asks CloudWatch or another service through a data source. Requests to CloudWatch run with the permissions of the IAM role you hand to the workspace.

### What Signing In Requires

Nobody can sign in to a workspace as an IAM user or an IAM role. A workspace accepts IAM Identity Center, an identity provider (IdP) that speaks SAML 2.0, or both.

IAM Identity Center requires AWS Organizations to be activated for the account. According to the documentation, an account that belongs to no organization can still use it: when you create the first workspace that uses Identity Center, Managed Grafana activates Organizations. You do not need an IdP of your own, because Identity Center has a built-in directory in which you can create users.

If you chose `aws login` in [chapter 01](/en/chapters/01-account.md), you work as an IAM user. That IAM user cannot enter a workspace, so using Grafana means either activating Organizations and Identity Center or connecting an external IdP through SAML. The first changes the shape of your account. For an account outside any organization, the documentation asks that the role managing workspaces and users carry managed policies including `AWSOrganizationsFullAccess`, and warns that this policy amounts to administrator access to the account.

Without a reason to go that far, chapter 19's dashboard and alarms are enough. The next section says how to tell.

### Price

The price is per workspace, by the number of users active in the month. In the Tokyo Region an editor or administrator costs 9 a month and a viewer 5 (USD, before tax). Only users who signed in or called the API at least once that month are counted.

**A workspace costs 9 a month even when nobody signs in.** The pricing page says each workspace needs a minimum of one Editor license. By default this chapter's stack creates no workspace.

An account new to the service gets a 90-day free trial covering up to five users per account. The monthly breakdown, and what Grafana's calls to CloudWatch cost, are worked out on the [last page](/en/chapters/55-grafana/wrap.md).

## When the CloudWatch Dashboard Is Enough

<!-- section: 55.enough -->

Chapter 19's dashboard is enough when everyone who looks at it can enter the AWS account and the numbers they want are in CloudWatch. A team of a few developers usually fits. The CloudWatch dashboard is part of chapter 19's stack, so it deploys with the application and adds neither a sign-in system nor a monthly minimum.

These are reasons to add Grafana.

- You want to show the dashboard to people you would rather not let into the AWS account. Support or business staff can sign in through the organization's IdP and be assigned as viewers
- You want numbers that are not in CloudWatch on the same screen
- You already have Grafana dashboards and alerts, and want AWS to host them

The second point depends on what kinds of data a workspace can show. A workspace comes with data sources for AWS services. CloudWatch reads metrics and logs, and is the only one this chapter uses. The X-Ray data source opens chapter 19's traces from a dashboard or from the Explore screen. The Athena data source turns the result of a SQL query into a panel, so an aggregate over logs in S3, as in [chapter 49](/en/chapters/49-athena.md), can sit next to the metrics. Amazon Managed Service for Prometheus handles container metrics with the same data model and query language as Prometheus, and is what you would use to watch a Kubernetes cluster like the one in [chapter 34](/en/chapters/34-eks.md). Its dedicated data source exists from version 12 of Managed Grafana. In workspaces of version 9 or newer, a data source outside the core set may need its plugin installed.

Some things do not change when you add Grafana. The alarms still watch CloudWatch metrics, and whether a problem is on AWS's side is still what Health in [chapter 44](/en/chapters/44-health.md) tells you. Grafana changes how numbers you already have are shown. It does not add numbers.

[Design and Build](/en/chapters/55-grafana/build.md) goes through the code in order: the definition, the generator, the workspace, and the push.
