---
title: "55 Grafana: Costs, Pitfalls, and Cleanup"
---

# 55 Grafana: Costs, Pitfalls, and Cleanup

## Cost

<!-- section: 55.cost -->

Amounts are in USD, for the Tokyo Region, before tax. The arithmetic is in [Pricing worksheets](/en/reference/pricing.md). Chapter 19's stack was priced in chapter 19, so this page counts only what Grafana adds.

The default stack holds an IAM role and nothing else, and costs nothing.

Once a workspace exists, a month in which nobody signs in costs **9.00**, because each workspace needs a minimum of one Editor license.

As an example of a month of use, take one administrator and two viewers who sign in, and `grafana:push` run at least once.

| Item | Quantity | Amount |
| --- | ---: | ---: |
| Administrators and editors (9 each) | 2 | 18.00 |
| Viewers (5 each) | 2 | 10.00 |
| Metrics requested through GetMetricData (0.01 per 1,000) | 220,800 | 2.21 |
| Total | | **30.21** |

One of the two in the first row is the service account. In a month in which it calls the API, a service account counts as one user of its role. In a month without a single push it is not counted.

The third row is CloudWatch's price, not Grafana's. Each time a Grafana panel opens or reloads, it calls CloudWatch's GetMetricData, and that API is billed by the number of metrics requested.

<<< @/examples/55-grafana/src/cost-inputs.ts{inputs}

This chapter's dashboard reads 23 metrics per reload. A sum is one line, but each of its five parts is requested. The 220,800 in the table is one browser tab reloading every minute, 8 hours a day, 20 days a month. A wall monitor showing the dashboard around the clock multiplies that by about 4.5. To lower it, lengthen the reload interval or close the tabs nobody is watching. A test makes sure that adding a panel to the dashboard changes this quantity.

Four things could not be confirmed: whether a workspace created and deleted mid-month is prorated, how the one-license minimum is treated during the free trial, whether GetMetricData has a monthly free allowance, and how many metrics one reload actually requests. Nothing was subtracted from the amounts for any of them.

Beyond this, enabling Enterprise plugins adds 45 a month per user. This chapter does not use them. The price of IAM Identity Center or of an external IdP is not included either.

## For Production

This chapter's stack is the smallest form, for practice. For production, review these points.

- Narrow who can reach it. By default any address reaches the sign-in screen. Limit it to your company's addresses with `prefixListIds`, or to VPC endpoints only
- Decide roles by IdP group. Assigning people one by one means fixing the list at every transfer. With Identity Center assign groups, and with SAML let an assertion attribute decide the role
- Have at least two administrators. When the only administrator can no longer sign in, nobody is left who can fix the workspace's settings from its screens
- Make viewer the default. An editor costs 9 and a viewer 5, and with the dashboard's source in the repository, hardly anyone needs to edit on screen
- Move the push into CI. Run `grafana:push` from the pipeline of [chapter 20](/en/chapters/20-shipping.md), and give the permission to mint tokens to that role alone
- Decide on the encryption key. By default a workspace's contents are encrypted with a key AWS owns. You can use a key of your own ([chapter 21](/en/chapters/21-security.md)). This was not tried for the chapter

## Cleanup

<!-- section: 55.cleanup -->

```bash
vp run grafana:infra:destroy -c authentication=AWS_SSO
```

The workspace and the role are deleted. Deleting a workspace deletes its dashboards, data source configuration, alerts and snapshots with it. The dashboard can be rebuilt from the definition, so nothing is lost. Anything made on screen does not come back.

Some things are not deleted with the stack. IAM Identity Center and Organizations stay enabled, even if you enabled them for this chapter. Users created in Identity Center stay as well. Whether the month of deletion is prorated could not be confirmed.

Chapter 19's stack is separate from this one. Its dashboard and alarms keep working, unchanged, after the workspace is gone.

## As a Distributed System

- Who owns the state: what to look at is decided by `src/signals.ts` in the repository. The CloudWatch dashboard and the Grafana dashboard are both copies of it. The numbers themselves belong to CloudWatch, and Grafana holds none
- Invariant: the two dashboards read the same metrics, with the same statistic and the same period
- Tests that try to break it: the test that compares chapter 19's template with the definition, whole, catches a change on chapter 19's side. Bodies with a changed statistic, an added line and a second table are built, and the check before a push refuses each
- Partial failure: `grafana:push` can stop midway and be run again with the same result, because the data source is looked up by name before it is created and the dashboard replaces the one with the same `uid`. If deleting the token fails, the token stops working after 15 minutes but counts toward the limit of 100 until it is deleted
- Concurrent updates: when two people push at once, the one that arrives later stays. That is not necessarily the newer commit. Pushing from one place, CI, makes the order the order of main
- Delay: the lines Grafana shows are metrics that have reached CloudWatch. As chapter 19 showed, metrics arrive seconds to minutes late. Adding Grafana does not shorten the time to notice

::: details Verification notes for this chapter

**Checked locally.** Unit tests of the definition, of building and comparing the CloudWatch body, of generating the Grafana dashboard and its schema, of the HTTP API calls (against a fake `fetch`), of the pricing inputs, and of the stack. The type check. Synth, by default and with `-c authentication=AWS_SSO`. The output of `grafana:render`, with and without `--cloudwatch`. The option names of `aws grafana` and `aws cloudwatch get-dashboard` that `scripts/push.ts` uses, against the help of AWS CLI 2.35.11. Prices come from the AWS Price List bulk API.

**Not checked yet.** `grafana:infra:deploy`, `grafana:push`, `grafana:infra:drift` and `grafana:infra:destroy` were not run against a real AWS account. Not one Amazon Managed Grafana workspace was created, so the following are read from the documentation and from Grafana's source only.

- That cdkd 0.296.28 can create `AWS::Grafana::Workspace` through Cloud Control API and read `Endpoint` and `Id` into outputs. Whether `Endpoint` carries a scheme (the code accepts both forms)
- How the failure shows itself when `AWS_SSO` is passed in an account without IAM Identity Center. That a workspace created with `SAML`, leaving the SAML configuration for later, is accepted through the CloudFormation resource as well
- That a real Grafana accepts and draws the generated JSON: that a version 13 workspace reads JSON with `schemaVersion` 41, that a sum over hidden queries becomes one line, and that `authType: "default"` uses the workspace role
- That the workspace role's two actions are enough to draw the panels
- That the body `aws cloudwatch get-dashboard` returns equals, as JSON, the body the CDK wrote. The agreement check in `grafana:push` assumes it does
- The shape of the answers when listing and creating service accounts and minting and deleting tokens. They are read after the response syntax in the documentation
- The form of the version string to pass as `-c grafanaVersion=...`
- No Grafana alert rule was created. The section on alerts rests on the documentation alone
- Of the price: proration, the minimum license during the free trial, a free allowance for GetMetricData, and the number of metrics one reload requests

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The Whole Picture | `examples/55-grafana/infra/lib/grafana-stack.ts` | |
| One Definition | `examples/55-grafana/src/signals.ts`, `src/cloudwatch.ts`, `test/signals.test.ts`, `test/harness.ts` | `test:unit` |
| Generating the Grafana Dashboard | `examples/55-grafana/src/grafana.ts`, `src/schema.ts`, `test/grafana.test.ts` | `test:unit`, `grafana:render` |
| The Workspace and Its Role | `examples/55-grafana/infra/lib/grafana-stack.ts`, `infra/bin/app.ts`, `infra/test/grafana-stack.test.ts` | `test:unit`, `grafana:infra:synth` |
| Delivering the Dashboard | `examples/55-grafana/src/provision.ts`, `test/provision.test.ts`, `scripts/push.ts` | `test:unit` |
| Checking It Locally | `examples/55-grafana/scripts/render.ts`, `test/` | `test:unit`, `grafana:render`, `grafana:infra:synth` |
| Deploy | `examples/55-grafana/infra/bin/app.ts`, `scripts/push.ts` | `grafana:infra:diff`, `grafana:infra:deploy`, `grafana:push`, `grafana:infra:drift` |
| Cost | `examples/55-grafana/src/cost-inputs.ts`, `test/cost-inputs.test.ts`, `data/pricing/` | `test:unit` |
| Cleanup | `tools/src/infra/` | `grafana:infra:destroy` |

**How cdkd (0.296.28) handles the types.** The `dist` of the installed package was inspected. With a dedicated implementation: `AWS::IAM::Role`, `AWS::IAM::Policy`. Without one, through Cloud Control API: `AWS::Grafana::Workspace`.

**Primary sources** (all checked on 2026-10-13)

- Amazon Managed Grafana User Guide: [What is Amazon Managed Grafana?](https://docs.aws.amazon.com/grafana/latest/userguide/what-is-Amazon-Managed-Service-Grafana.html), [Authenticate users](https://docs.aws.amazon.com/grafana/latest/userguide/authentication-in-AMG.html), [Use AWS IAM Identity Center](https://docs.aws.amazon.com/grafana/latest/userguide/authentication-in-AMG-SSO.html), [Create a workspace](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-create-workspace.html), [Manage user and group access](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-manage-users-and-groups-AMG.html), [User roles](https://docs.aws.amazon.com/grafana/latest/userguide/Grafana-user-roles.html)
- Permissions and network: [Permissions and policies for AWS data sources](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-manage-permissions.html), [Cross-service confused deputy prevention](https://docs.aws.amazon.com/grafana/latest/userguide/cross-service-confused-deputy-prevention.html), [AWS managed policies](https://docs.aws.amazon.com/grafana/latest/userguide/security-iam-awsmanpol.html), [Configure network access](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-configure-nac.html), [Security best practices](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-Security-Best-Practices.html), [the Service Authorization Reference definition for CloudWatch](https://servicereference.us-east-1.amazonaws.com/v1/cloudwatch/cloudwatch.json)
- Workspace settings: [Configure a workspace](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-configure-workspace.html), [Extend your workspace with plugins](https://docs.aws.amazon.com/grafana/latest/userguide/grafana-plugins.html), [Update your workspace version](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-workspace-version-update.html), [Differences between Grafana versions](https://docs.aws.amazon.com/grafana/latest/userguide/version-differences.html), [Service quotas](https://docs.aws.amazon.com/grafana/latest/userguide/AMG_quotas.html), [Delete a workspace](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-edit-delete-workspace.html)
- Data sources: [Built-in data sources](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-data-sources-builtin.html), [Manually add CloudWatch](https://docs.aws.amazon.com/grafana/latest/userguide/adding--CloudWatch-manual.html), [Using the metric search option](https://docs.aws.amazon.com/grafana/latest/userguide/CloudWatch-using-the-metric-search.html), [Pricing (CloudWatch data source)](https://docs.aws.amazon.com/grafana/latest/userguide/cloudwatch-pricing.html), [AWS X-Ray](https://docs.aws.amazon.com/grafana/latest/userguide/x-ray-data-source.html), [Using Athena data source](https://docs.aws.amazon.com/grafana/latest/userguide/Athena-using-the-data-source.html), [the Amazon Managed Service for Prometheus data source](https://docs.aws.amazon.com/grafana/latest/userguide/amazon-prometheus-data-source.html), [What is Amazon Managed Service for Prometheus?](https://docs.aws.amazon.com/prometheus/latest/userguide/what-is-Amazon-Managed-Service-Prometheus.html)
- Provisioning from code: [Authenticate with service accounts](https://docs.aws.amazon.com/grafana/latest/userguide/v13-authenticating-grafana-apis.html), [Dashboard API](https://docs.aws.amazon.com/grafana/latest/userguide/v13-Grafana-API-Dashboard.html), [Data Source API](https://docs.aws.amazon.com/grafana/latest/userguide/v13-Grafana-API-Datasource.html), [Dashboard JSON model](https://docs.aws.amazon.com/grafana/latest/userguide/v13-dash-dashboard-json-model.html), [Provisioned dashboards and the version 2 schema](https://docs.aws.amazon.com/grafana/latest/userguide/v13-dash-dynamic-provisioned.html), [CreateWorkspaceServiceAccount](https://docs.aws.amazon.com/grafana/latest/APIReference/API_CreateWorkspaceServiceAccount.html), [CreateWorkspaceServiceAccountToken](https://docs.aws.amazon.com/grafana/latest/APIReference/API_CreateWorkspaceServiceAccountToken.html)
- Alerts: [Provisioning Grafana Alerting resources](https://docs.aws.amazon.com/grafana/latest/userguide/v13-alerting-setup-provision.html), [Alert rule evaluation](https://docs.aws.amazon.com/grafana/latest/userguide/v13-alerting-rules-evaluation.html), [State and health of alert rules](https://docs.aws.amazon.com/grafana/latest/userguide/v13-alerting-explore-state.html), Grafana Labs' [Alerting provisioning HTTP API](https://grafana.com/docs/grafana/latest/developers/http_api/alerting_provisioning/)
- CloudFormation: [AWS::Grafana::Workspace](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-grafana-workspace.html), [NetworkAccessControl](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-grafana-workspace-networkaccesscontrol.html), [resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)
- Grafana's source (the v13.0.9 tag): [the CloudWatch query types](https://github.com/grafana/grafana/blob/v13.0.9/public/app/plugins/datasource/cloudwatch/dataquery.gen.ts), [the dashboard kind](https://github.com/grafana/grafana/blob/v13.0.9/kinds/dashboard/dashboard_kind.cue). Grafana Labs' [Configure the Amazon CloudWatch data source](https://grafana.com/docs/grafana/latest/datasources/aws-cloudwatch/configure/)
- Pricing: [Amazon Managed Grafana Pricing](https://aws.amazon.com/grafana/pricing/), the AWS Price List for [AmazonGrafana](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonGrafana/current/ap-northeast-1/index.json) (published 2026-09-11) and [AmazonCloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json) (published 2026-10-07)

:::
