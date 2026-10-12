---
title: "35 Lambda Managed Instances: Costs, Pitfalls, and Cleanup"
---

# 35 Lambda Managed Instances: Costs, Pitfalls, and Cleanup

The last page of the chapter. It goes through the arithmetic of where this becomes cheaper than standard Lambda, the limits, where people trip, what to change for production, and the cleanup.

## The break-even arithmetic

<!-- section: 35.break-even -->

Standard Lambda and Lambda Managed Instances bill in different units. Standard Lambda bills the function's memory multiplied by time (GB-seconds), and only while a request is running. Lambda Managed Instances bills instance-hours whether or not there are requests. The charge per request is the same on both.

The values the calculation uses are gathered in these types.

<<< @/examples/35-lambda-managed-instances/src/break-even.ts{model}

<<< @/examples/35-lambda-managed-instances/src/break-even.ts{costs}

The request charge is the same on both sides, so it drops out of the comparison. What remains is standard Lambda's GB-seconds against the fixed cost of the instances.

Now think of the average number of requests in flight. If exactly one request is in flight for the whole month, standard Lambda bills the function's memory times the seconds in a month (2,628,000) in GB-seconds. Whether a request takes 50 ms or 2 seconds, the same average number in flight gives the same GB-seconds. So the break-even can be stated as an average number of requests in flight, not as a number of requests.

<<< @/examples/35-lambda-managed-instances/src/break-even.ts{break-even}

Put in the Tokyo `arm64` prices. Standard Lambda is USD 0.0000133334 per GB-second, so a 1 GB function with one request in flight all month costs USD 35.04. The fixed cost of this chapter's layout, three instances with the management fee and the endpoint, was USD 269.77.

| Memory of the standard Lambda function | Requests in flight where the bills cross (average) | Requests a month, at 100 ms each |
| --- | --- | --- |
| 256 MB | 30.8 | 809 million |
| 512 MB | 15.4 | 405 million |
| 1 GB | 7.7 | 202 million |
| 2 GB | 3.8 | 101 million |

The API from chapter 04, which gets by on 256 MB, is not cheaper on Lambda Managed Instances until more than 30 requests are in flight at all times on average. At 100 ms a request, that is a little over 300 requests a second for a month. A function that uses 2 GB, on the other hand, crosses over at about 4 in flight on average.

Three cautions for reading this table.

First, **the fleet may not be able to carry the load at which the bills cross**. Whether three `m6g.large` (6 vCPUs together) can handle 30 concurrent requests on average depends on how much CPU one request uses. An API that spends most of its time waiting for DynamoDB might manage. One that is heavy on JSON conversion or cryptography will not. If it cannot, instances are added, the fixed cost rises, and the crossing point moves to the right. This chapter measured none of that, so the table holds on the condition that three are enough.

Second, **an average is not enough**. When load comes in waves, instances are added for the peak and stay for a while in the trough. Standard Lambda costs 0 in the trough. The bigger the waves, the better standard Lambda does.

Third, **discounts move the point**. Savings Plans and Reserved Instances lower the instance charge only. The management fee stays at 15% of the undiscounted list price. The function takes an `ec2Discount`, and a test reproduces the example on the AWS pricing page (`m7g.xlarge` in `us-east-1`, 72% off under a 3-year Compute Savings Plan, USD 160.36 in total). The discount rate for Tokyo was not looked up, so this chapter gives no discounted amounts.

<<< @/examples/35-lambda-managed-instances/test/break-even.test.ts

## Limits, and what could not be confirmed

<!-- section: 35.limits -->

Quotas change. The values below were read on 2026-10-13 in "Lambda Managed Instances quotas" in the Lambda guide. Check the current ones on that page or in the Service Quotas console.

- Capacity providers: up to 1,000 per account
- Function versions on one capacity provider: up to 100. Cannot be raised
- vCPUs of one capacity provider: up to 15,000
- APIs that manage capacity providers: 15 reads a second and 1 write a second. Cannot be raised
- Minimum and maximum execution environments: 0 to 15,000
- Requests one execution environment takes at once: up to 64 per vCPU
- Function timeout: 900 seconds. For asynchronous invocations and event source mappings it can be extended to 5,400 seconds

EC2 quotas apply as they are, in addition: the account's vCPU limit, the EBS volume limit, and the number of IP addresses left in the subnets. The reason Lambda cannot launch an instance may lie with EC2, not with Lambda.

Some things standard Lambda has are absent on Lambda Managed Instances.

- **Scaling in to zero by itself.** When requests stop, execution environments go down to the minimum and no further
- **Scaling out as a request arrives.** More capacity comes afterwards, and a request that is too early gets 429
- **Functions below 1 vCPU or below 2 GB**
- **Firecracker isolation between functions.** Functions on one capacity provider must trust one another

The following could not be confirmed from the documentation. Check for yourself before relying on any of it.

- Whether SnapStart, provisioned concurrency, function URLs, response streaming, or Lambda@Edge can be combined with it. The guide pages for each say nothing about Lambda Managed Instances. That is not the same as saying they do not work
- For event source mappings, the quotas page names SQS, DynamoDB Streams, Kinesis Data Streams, Amazon MSK, and self-managed Apache Kafka as supported. Other event sources were not checked
- The size and the price of the EBS volumes attached to the instances
- Whether it can actually be used in Regions other than Tokyo. What was checked is the number of Regions whose price list carries a price (30)

## Failures and how to look into them

<!-- section: 35.failures -->

Nothing was run on AWS, so what follows is the symptoms listed in the troubleshooting page of the Lambda guide, and what the shape of the stack lets you expect.

**The function version never becomes ACTIVE.** A few minutes for instances to start is normal. If it lasts longer, check the state of the capacity provider (`GetCapacityProvider`), the subnets and security groups, and the EC2 vCPU quota. The capacity provider's system logs say why an instance failed to launch.

**Publishing fails with a generic error such as "Internal error occurred during publishing".** The guide tells you to check the `lambda:PassCapacityProvider` permission first.

**The function works and no logs appear.** The instances have no path to CloudWatch Logs. Check the chapter 11 network settings with `vp run lmi:plan`.

**429 comes back.** That is throttling. CloudWatch has a metric per reason (`ConcurrencyThrottles`, `CPUThrottles`, `MemoryThrottles`, `DiskThrottles`). If CPU is the reason, give the function more vCPUs or raise the ceiling on instances. If the concurrency limit is the reason, revisit `PerExecutionEnvironmentMaxConcurrency`. In this stack the API Gateway stage also throttles at 10 requests a second, so first find out which of the two the 429 came from.

**Data from another request gets mixed in.** That is the bug covered earlier in [Design and Build](/en/chapters/35-lambda-managed-instances/build.md). It happens only as load rises, so look for it by comparing the request ID in the logs with the one on the response.

**Load has dropped and the instances do not go away.** The guide says that scaling in slowly is by design.

**The capacity provider cannot be deleted.** It cannot be while even one function version is attached. Delete the function first.

## For production

<!-- section: 35.production -->

- **Keep the notes outside.** The in-memory repository is separate for each worker thread. Replace it with DynamoDB from chapter 05. That needs a path from the instances to DynamoDB (the gateway endpoint from chapter 11) and permissions on the execution role
- **Use three zones.** Lambda launches three instances by default. The chapter 11 network has two zones, so making it three with `-c availabilityZones=` matches the default behaviour better
- **Do not narrow the instance types.** This stack allows one type so that the bill is predictable, and it cannot launch when that type has no capacity
- **Set the vCPU ceiling from load and budget.** 12 is a practice value. The ceiling is the cap on the bill and, at the same time, the cap on the load you can carry
- **Do not put functions you do not trust on the same capacity provider.** What must be kept apart goes on separate capacity providers
- **Propagate tags.** With `PropagateTags` set, the instances, volumes, and network interfaces are tagged, and the cost allocation in [chapter 32](/en/chapters/32-limits.md) can show the breakdown
- **Be idempotent.** A request that timed out keeps running in the background. Make writes whose result does not change when they are retried
- **Consider the discounts.** Once you have decided to keep it running, the instances qualify for Savings Plans or Reserved Instances. The management fee does not go down
- **Deploy with the AWS CDK CLI.** cdkd is a tool for development and testing. For this chapter, also bear in mind that the function and the capacity provider go through Cloud Control API, and check your production route separately

## Cleanup

<!-- section: 35.cleanup -->

It costs USD 8.87 a day just to exist, so delete it as soon as you have tried it.

```bash
vp run lmi:infra:destroy
vp run net:infra:destroy
```

There is an order. A capacity provider with a function version attached cannot be deleted, so inside the stack the function has to go first and the capacity provider after it. In the template the function refers to the capacity provider, so deleting in reverse dependency order gives that sequence, but that cdkd really deletes in that order, and waits for the instances to terminate, was not checked.

Run the second line only if no other chapter is using the chapter 11 network. If you keep the network, deploy it again without the `logs` endpoint. The endpoint keeps being billed after this chapter's stack is gone.

Three things to check after deleting.

- **No instance is left.** Instances that Lambda manages do not appear in the EC2 console by default. Switch the managed resource visibility setting to see them, or check the bill a few days later
- **The log groups.** The two the stack created are deleted with it
- **The service-linked role `AWSServiceRoleForLambda`.** It stays in the account and costs nothing. It can be deleted once every capacity provider is gone

## As a distributed system

<!-- section: 35.distributed -->

Take the owners of state one at a time.

In this chapter's layout the owner of the notes is a `Map` per worker thread. There are as many owners as execution environments times threads, so where a given note lives is not determined. As an owner of data you mean to keep, it is useless.

The owner of a request's state is that request. The invariant was: what the handling of a request reads belongs to that request. Standard Lambda kept this invariant on the platform's side, by having an execution environment handle one request at a time. On Lambda Managed Instances the code keeps it. Types do not. A module-scope `let` has the same type in both environments and passes the type check the same way. Only a test that overlaps two requests in a fixed order can show it breaking.

Partial failure changes shape as well. A timeout means only that the caller stopped waiting, not that the work stopped. A write that you cannot call a success or a failure may complete in the background. That is the same case as the lost response in chapter 08, and the answer is the same: idempotency.

The owner of capacity changes too. On standard Lambda, capacity was AWS's, and up to the account's concurrency limit you could treat it as there. On Lambda Managed Instances, capacity is instances in your own account: a limited number, and slow to grow. Until it has grown, what exceeds it is refused.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (8 files, 52 tests: two requests in flight swapping request IDs, and not swapping them with `AsyncLocalStorage`, replayed with function calls and over real sockets; two worker threads holding separate `Map`s; settings validation; the model of the path to CloudWatch Logs; pricing inputs; the break-even arithmetic; stack assertions). Type check. `lmi:infra:synth` (defaults, `-c instanceType=m7g.large`, `-c minExecutionEnvironments=0 -c maxExecutionEnvironments=0`, `-c maxVCpuCount=16`). `lmi:plan` (defaults, `instanceType=m7g.large`, a network without the endpoint, an invalid setting). `node src/dev.ts`, the command behind `dev:lmi`, was started and `/health` and `POST /notes` were called with `curl`, and it was started with `SCOPE=module` as well. All on 2026-10-13.

**Not checked yet.** Nothing was run against AWS: none of `net:infra:deploy`, `lmi:infra:diff`, `lmi:infra:deploy`, `lmi:smoke`, `lmi:infra:drift`, `lmi:infra:destroy`. So all of the following wait for a real deploy. That cdkd 0.296.28 creates and deletes the capacity provider, and a function with `CapacityProviderConfig`, through Cloud Control API. That `$LATEST.PUBLISHED` is published automatically. That API Gateway can invoke the unqualified function. That a function version becomes ACTIVE in private subnets with only the CloudWatch Logs endpoint. That three instances start, how they are placed over two zones, and the size and price of their EBS volumes. Concurrency on Lambda's own execution environment, the number of worker threads, scaling, throttling, instance replacement, and behaviour after a timeout. That "three are enough", which the break-even table assumes.

What primary sources did not settle. No list of unsupported features was found. The guide pages for SnapStart, provisioned concurrency, and function URLs say nothing about Lambda Managed Instances. The pricing page does not say whether the free tier covers requests to Lambda Managed Instances. Beyond CloudWatch Logs and X-Ray, the destinations the instances must reach from the VPC were not confirmed. The current list of Regions was not confirmed, only the count of Regions whose price list carries a price. The default for requests one execution environment takes at once is 64 per vCPU for Node.js in the Lambda guide and 10 in a type comment of `aws-cdk-lib`, and the two disagree. The stack does not set the value, and the text quotes the guide. The scaling headroom is "doubling within five minutes" in the guide and "a 50% increase" in the launch post, worded differently. Savings Plans rates for Tokyo were not looked up.

Resource types cdkd handles. In the installed `@go-to-k/cdkd` 0.296.28 package, `AWS::ApiGatewayV2::Api`, `Integration`, `Route`, `Stage`, `AWS::EC2::SecurityGroup`, `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, and `AWS::Logs::LogGroup` are registered with providers of their own. `AWS::Lambda::CapacityProvider` is not registered and goes through Cloud Control API. `CapacityProviderConfig` and `FunctionScalingConfig` of `AWS::Lambda::Function` are marked "not yet implemented" in its own provider, and cdkd switches a function that has them to Cloud Control API automatically. What was read is the JavaScript inside the npm package, not the source on GitHub.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| What it costs just to exist | `examples/35-lambda-managed-instances/src/cost.ts`, `src/report.ts`, `scripts/plan.ts`, `test/pricing.test.ts`, `data/pricing/` | `lmi:plan`, `test:unit` |
| The whole picture | `examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts`, `infra/bin/app.ts`, `src/config.ts`, `test/config.test.ts` | `lmi:infra:synth`, `test:unit` |
| One execution environment handles several requests at once | `examples/35-lambda-managed-instances/src/lambda.ts`, `src/app.ts` | `test:unit` |
| A request ID kept in module scope | `examples/35-lambda-managed-instances/src/scope.ts`, `src/audit.ts`, `test/scope.test.ts`, `test/harness.ts` | `test:unit` |
| Where per-request values belong | `examples/35-lambda-managed-instances/src/scope.ts`, `test/scope.test.ts`, `test/server.test.ts` | `test:unit`, `dev:lmi` |
| A separate module for each worker thread | `examples/35-lambda-managed-instances/src/app.ts`, `test/threads.test.ts`, `test/fixtures/thread.ts` | `test:unit` |
| The capacity provider and the network | `examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts`, `src/network.ts`, `test/network.test.ts`, `examples/11-network/infra/lib/import-network.ts` | `lmi:plan`, `lmi:infra:synth`, `test:unit` |
| Putting the function on the capacity provider, and whether cdkd can create these resources | `examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts`, `infra/test/managed-instances-stack.test.ts` | `lmi:infra:synth`, `test:unit` |
| Run it locally | `examples/35-lambda-managed-instances/src/dev.ts`, `.env.example`, `scripts/plan.ts` | `dev:lmi`, `test:unit`, `lmi:plan`, `lmi:infra:synth` |
| Deploy and check | `examples/35-lambda-managed-instances/scripts/smoke.ts`, `tools/src/infra/` | `net:infra:deploy`, `lmi:infra:diff`, `lmi:infra:deploy`, `lmi:smoke`, `lmi:infra:drift` |
| The break-even arithmetic | `examples/35-lambda-managed-instances/src/break-even.ts`, `src/prices.ts`, `src/report.ts`, `test/break-even.test.ts` | `lmi:plan`, `test:unit` |
| Cleanup | `tools/src/infra/` | `lmi:infra:destroy`, `net:infra:destroy` |

**Primary sources** (all checked on 2026-10-13)

- Lambda Managed Instances: [Overview](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances.html), [Core concepts](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-core-concepts.html), [Capacity providers](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-capacity-providers.html), [Scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-scaling.html), [Runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-runtimes.html), [Node.js runtime](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-nodejs-runtime.html), [Execution environment](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-execution-environment.html), [$LATEST.PUBLISHED](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-version-publishing.html), [Networking](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-networking.html), [Security and permissions](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-security.html), [Operator role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-operator-role.html), [Quotas](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-quotas.html), [Tag propagation](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-tag-propagation.html), [Getting started](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-getting-started.html), [Troubleshooting](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-troubleshooting.html), [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- Launch and pricing: [Introducing AWS Lambda Managed Instances](https://aws.amazon.com/blogs/aws/introducing-aws-lambda-managed-instances-serverless-simplicity-with-ec2-flexibility/) (2025-11-30), [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json) (the management fee and requests; the 36 per-Region files were read and those with a Lambda Managed Instances price counted), [EC2](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.json) (`m6g.large` and `m7g.large`; about 446 MB). The prices of standard Lambda, Fargate, and interface endpoints are the ones read for chapters 04, 12, and 11 and were not read again for this chapter
- API and CloudFormation: [CreateCapacityProvider](https://docs.aws.amazon.com/lambda/latest/api/API_CreateCapacityProvider.html), [CreateFunction](https://docs.aws.amazon.com/lambda/latest/api/API_CreateFunction.html), [AWS::Lambda::CapacityProvider](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-capacityprovider.html), [LambdaManagedInstancesCapacityProviderConfig](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-function-lambdamanagedinstancescapacityproviderconfig.html)
- Pinned packages: [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (`aws-lambda/lib/capacity-provider.d.ts` and the JavaScript beside it), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (the JavaScript in `dist/`)
- Node.js: [Asynchronous context tracking](https://nodejs.org/docs/latest-v24.x/api/async_context.html)
- Comparison: [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/) (Cloudflare), [Fluid compute](https://vercel.com/docs/fluid-compute), [Functions usage and pricing](https://vercel.com/docs/functions/usage-and-pricing) (Vercel)

:::
