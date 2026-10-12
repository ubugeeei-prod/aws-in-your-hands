---
title: "35 Lambda Managed Instances: Deploy"
---

# 35 Lambda Managed Instances: Deploy

No command on this page has been run against AWS yet. The steps are put together from the Lambda guide and from the contents of the pinned CDK and cdkd.

## Deploy and check

<!-- section: 35.deploy -->

Before deploying, check your IAM permissions. The identity that deploys needs two beyond the usual ones: `lambda:PassCapacityProvider` to attach the function to the capacity provider, and `iam:CreateServiceLinkedRole` to create the service-linked role when the first capacity provider in the account is made.

The order is the chapter 11 VPC first, then this chapter's stack.

```bash
vp run lmi:plan
vp run net:infra:deploy -c interfaceEndpoints=logs
vp run lmi:infra:diff
vp run lmi:infra:deploy
```

Hourly billing starts with the second line. If the chapter 11 network is already deployed for another chapter, add `logs` to the endpoints you gave then. Together with chapter 23 that is `-c interfaceEndpoints=ssm,ssmmessages,ec2messages,logs`.

The fourth line takes time. According to the guide, Lambda launches three instances and starts three execution environments before it marks the function version ACTIVE, and that usually takes several minutes. How cdkd deals with the wait was not checked.

When the deploy has finished, check that it works.

```bash
vp run lmi:smoke
```

<<< @/examples/35-lambda-managed-instances/scripts/smoke.ts

It calls `/health` through the chapter 04 client, creates a note and reads it back, and finally sends ten requests at once. Reading the note back may answer 404. That happens when another worker thread, or another execution environment, answered. The script does not treat it as a failure.

For the ten simultaneous requests it checks that all return 200 and that every request ID differs. Passing that does not prove they overlapped in one execution environment. To see overlap, use CloudWatch metrics. The namespace is `AWS/Lambda`, with `CapacityProviderName` as a dimension. Metrics are published every minute, so they are not there right after a deploy.

Logs go to two places. The function's logs are in the log group named by the stack output `HandlerLogGroupName`. The capacity provider's system logs, such as instances starting and ending, are in the log group named by `CapacityProviderLogGroupName`. If the function works and not a single log line appears, the instances have no path to CloudWatch Logs.

The instances themselves do not show up in the EC2 console or in the result of `describe-instances` by default. Instances that Lambda manages stay hidden until you change the managed resource visibility setting. Unseen, they are still running and still billed.

Drift is checked as in the other chapters.

```bash
vp run lmi:infra:drift
```

How far cdkd can compare resources it created through Cloud Control API was not checked for this chapter.

Before changing a setting, look at what would be replaced. According to the CloudFormation reference, changing a capacity provider's subnets, security groups, operator role, instance requirements, or name replaces it. What happens to the function during a replacement was not checked. The vCPU ceiling and the scaling settings change without a replacement.

To switch the function off without deleting it, deploy with zero execution environments.

```bash
vp run lmi:infra:deploy -c minExecutionEnvironments=0 -c maxExecutionEnvironments=0
```

A function switched off does not come back when requests arrive. To bring it back, deploy once more without the `-c` flags.
