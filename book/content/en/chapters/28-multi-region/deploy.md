---
title: "28 Multi-Region: Deploy"
---

# 28 Multi-Region: Deploy

This page prepares the two stacks for AWS, then gives the order of the deploys, the steps for checking them, and how to run a failover drill. None of the steps on this page was run.

## Getting ready for AWS

<!-- section: 28.infra -->

There is one stack class, used twice with a different Region.

<<< @/examples/28-multi-region/infra/bin/app.ts{stacks}

The two differ only in which one defines the table and in the direction of the bucket's replication.

A replica of the table exists in Osaka too, yet the definition is in the Tokyo stack alone, for a reason. According to the DynamoDB documentation, CloudFormation cannot coordinate a resource that spans Regions, such as a global table, across stacks. If you define the replicas in a separate stack per Region, updates fail with drift errors. The recommended way is to pick one Region as the reference and write every replica in that Region's stack. The Osaka stack only refers to the table with the same name, by name.

The same documentation has one more warning. Do not change the type of an existing `AWS::DynamoDB::Table` resource to `AWS::DynamoDB::GlobalTable` in a template. The table may be deleted. To turn chapter 05's table into the shape of this chapter, do not rewrite it in place. Follow the documented steps: set the table to be retained and remove it from the stack, add the replicas, then import it as the new type. This chapter's stack creates a new table.

The function's permissions are limited to the replica in its own Region.

<<< @/examples/28-multi-region/infra/lib/region-stack.ts{role}

The actions are the same five as in chapter 05. The Region is part of the resource's ARN, so Tokyo's function cannot touch Osaka's replica, and the reverse holds too. A test checks that the name of the other Region does not appear in either stack's policies.

The function is told through environment variables which Region it is in and whether it takes writes.

<<< @/examples/28-multi-region/infra/lib/region-stack.ts{function}

### Created only when asked for

Whatever costs money, needs a domain, or assumes the other stack already exists is created only when named in the context.

<<< @/examples/28-multi-region/infra/bin/app.ts{context}

The values are checked against a schema, so a slip such as `-c rtc=yes` stops at synth and does not deploy the default setup.

With `-c domain=...`, each of the two stacks gains Route 53 and API Gateway resources.

<<< @/examples/28-multi-region/infra/lib/region-stack.ts{dns}

Five types are added. A Regional custom domain name in API Gateway needs a certificate in the same Region, so each stack needs one certificate. The health check calls that Region's API at its own URL and not at the shared name, because where the shared name leads is decided by this health check's result. Two records are created with the same name, told apart by `SetIdentifier`. The CloudFormation reference says a failover alias record must turn on `EvaluateTargetHealth`, so it is on, and a test pins it.

This stack does not create the hosted zone. You pass the ID and the name of a zone you already own. Without a domain, this part cannot be used.

### The types cdkd handles

The default setup uses 12 resource types in the Tokyo stack and 11 in the Osaka stack. The only difference is `AWS::DynamoDB::GlobalTable`, and the others were used in chapters 05 and 22. The pinned cdkd (0.296.28) has a dedicated provider for every one of them. Of the five types added with a domain, `AWS::CertificateManager::Certificate` and `AWS::Route53::RecordSet` have dedicated providers, and `AWS::Route53::HealthCheck`, `AWS::ApiGatewayV2::DomainName`, and `AWS::ApiGatewayV2::ApiMapping` go through the Cloud Control API. Those three are on the list of types the Cloud Control API supports.

Reading the installed package told two things about cdkd's global table provider. Its list of handled properties has `Replicas` but neither `MultiRegionConsistency` nor `GlobalTableWitnesses`. It is unlikely that this version of cdkd can create an MRSC table. The other is that when a stack declares a Region, cdkd deploys that stack to that Region. The name of the bucket that holds cdkd's state has no Region in it, and bootstrap is described as once per account. Whether a bootstrap done for Tokyo is enough to deploy the Osaka stack was not confirmed.

All of this comes from reading the package and the templates. Nothing was created on AWS.

## Deploying and checking

<!-- section: 28.deploy -->

The order matters.

```bash
vp run mr:infra:synth
vp run mr:standby:infra:deploy
vp run mr:infra:deploy
vp run mr:status
```

Osaka goes first because the replication configuration of Tokyo's bucket needs its destination, Osaka's bucket. The table is created by the Tokyo stack, so Osaka's function cannot read it until the Tokyo deploy has finished. Until then, Osaka's health check path returns `503`.

`mr:status` goes through the two Regions in turn.

<<< @/examples/28-multi-region/scripts/mr.ts{status}

When the table's replicas show `ACTIVE` in both Regions and the health check path returns `200`, the setup is ready.

Next, cause the conflict this chapter is about, on the real table.

```bash
vp run mr:conflict
vp run mr:conflict --apply
```

Without `--apply` the task only prints what it would do. With it, the task creates one note in Tokyo, waits until Osaka can read it, and then sends an edit of the same version to both Regions at once.

<<< @/examples/28-multi-region/scripts/mr.ts{conflict}

The expected result cannot be narrowed to one. If the two `PUT` requests arrive closer together than the replication lag, both should get a `200`, and five seconds later both Regions should hold the same single title. If the difference in latency from your machine to Tokyo and to Osaka is larger than the replication lag, the one that arrives later gets a `409`. Record which happened. Two `200` answers mean that what the tests on the [Design and Build page](/en/chapters/28-multi-region/build.md) show has happened on the real table.

### Adding settings later

Replication in the other direction is added once Tokyo's bucket exists.

```bash
vp run mr:standby:infra:deploy -c back=on
```

The context has to be passed on every deploy. A deploy without it removes, as a difference, what was created with it. Settings you mean to keep are safer written in the `context` of `examples/28-multi-region/cdk.json`.

To add a domain, pass the same values to both stacks.

```bash
vp run mr:standby:infra:deploy -c domain=<name> -c zoneId=<zone ID> -c zoneName=<zone name>
vp run mr:infra:deploy -c domain=<name> -c zoneId=<zone ID> -c zoneName=<zone name>
```

The two stacks each request a certificate for the same domain in their own Region and validate it through DNS. Whether that works when two stacks handle the validation record at the same time was not confirmed.

The drift check (`vp run mr:infra:drift`) exists for the Tokyo stack only, because this book's drift tasks are built for one stack in one Region. The Osaka stack has `diff`, `deploy`, and `destroy`.

## A failover drill

<!-- section: 28.failover-drill -->

You cannot cause a Region failure yourself. What you can do is make Route 53 believe Tokyo is unhealthy. There is a setting for that.

```bash
vp run mr:infra:deploy -c drill=on -c domain=<name> -c zoneId=<zone ID> -c zoneName=<zone name>
```

With `-c drill=on`, only the health check path of Tokyo's function starts returning `503`. Every other path works as before. This is exactly the state the [Design and Build page](/en/chapters/28-multi-region/build.md) dealt with: judged unhealthy, and in fact running.

These are the times a drill measures.

1. When the deploy finished
2. When Tokyo's health check turned unhealthy in the Route 53 console
3. When `x-aih-region` on a request to the shared name first said `ap-northeast-3`
4. When every client you have at hand got `ap-northeast-3` and nothing else

From 1 to 2 is detection, from 2 to 3 is DNS, and from 3 to 4 is the clients, and each can be compared with the breakdown in `examples/28-multi-region/src/objectives.ts`. Sending the same edits as `mr:conflict` between 3 and 4 shows, on the real services, what a client that remembers the old destination causes.

To go back, deploy without `-c drill=on`. Once the health check is healthy again, Route 53 returns Tokyo again. Going back has a window of the same length as switching. Notes written in Osaka have reached Tokyo through the table's replication. Images written in Osaka are not in Tokyo unless `-c back=on` was set.

Here is what this drill does not check. Tokyo is in fact running, so no data is written to Tokyo that fails to reach Osaka. The drill tells nothing about how much data a real failure loses. For an experiment that stops replication, the DynamoDB documentation says AWS Fault Injection Service has actions for global tables. How to use them was not looked into. Whether sign-in, the secrets, and the deploy machinery from the list on the [Overview page](/en/chapters/28-multi-region.md) work without Tokyo is also outside this drill.
