---
title: "62 CI Runners: Deploy"
---

# 62 CI Runners: Deploy

This page keeps apart what can be checked locally and the steps taken against AWS and GitHub. The steps in the second half were never run.

## Check it locally

<!-- section: 62.local -->

The receiver runs with neither AWS nor GitHub, because every exchange with the outside is behind an interface.

```bash
vp run runners:decide
vp test run examples/62-ci-runners
vp run runners:infra:synth
```

`runners:decide` sends seven hand-written deliveries through the real receiver. GitHub, ECS, and DynamoDB are stand-ins inside the script. This is the command's actual output.

```text
signed with another secret                   401 {"error":"bad_signature"}
a job for ubuntu-latest                      200 {"outcome":"skipped","reason":"labels_not_ours"}
a repository not on the list                 200 {"outcome":"skipped","reason":"repository_not_allowed"}
a pull request from a fork                   200 {"outcome":"skipped","reason":"fork"}
a queued job, no capacity                    500 {"error":"launch_failed"}
the same delivery, sent again                200 {"outcome":"launched","taskArn":"task-for-aih-31000000001-1"}
the same delivery, a third time              200 {"outcome":"duplicate"}

tasks that would have been started: aih-31000000001-1
```

Lines five to seven are a failed launch and its redelivery. The delivery whose launch fails gets 500, sending it again launches, and sending it once more does not launch a second task.

The delivery's payload (`fixtures/workflow-job-queued.json`) was written by hand from GitHub's OpenAPI definition. It is not a recording of a delivery GitHub sent. Field names and types follow the definition; that it does not differ from the real thing was not checked.

The tests check the following.

- Signature: it matches the test values in GitHub's documentation, and another secret, an altered body, and a malformed header are refused
- Decision: labels, the repository list, a public repository, a fork, and `pull_request_target` each lead to no launch
- Receiver: a forged signature makes it ask nothing of GitHub or ECS. The same delivery, arriving twice in a row or at once, gives one task. A failed launch clears the registration and the claim, and a redelivery tries again. A claim left by a receiver that stopped midway can be taken again after its lease
- GitHub's API: the JWT's signature and expiry, the token narrowed to one repository and two permissions, the shape of the requests
- Stack: the task role has no permission, the receiving Lambda's role has no `*`, nothing is allowed in, the private key is not in the template, and the list of resource types

Some things cannot be reproduced locally: the deliveries GitHub really sends, the contents and length of a JIT configuration, the runner image starting, a Fargate task taking a job and ending, and DynamoDB evaluating the condition expression. The condition is tested instead through the same rule in memory.

## Deploy

<!-- section: 62.deploy -->

The steps from here on were never carried out. The operations on GitHub's pages were put together from the documentation, without looking at the pages. Use one private practice repository, and try it there. Do not try it on a public repository.

Deploy chapter 11's VPC first (`vp run net:infra:deploy`). This chapter's stack imports the VPC's ID and subnets from that stack's outputs.

Start by deploying with no repository and no app. A stack in this state refuses every delivery.

```bash
vp run runners:infra:diff
vp run runners:infra:deploy
```

The output `WebhookUrl` is where the webhook goes; `WebhookSecretArn` and `AppPrivateKeySecretArn` are the two secrets. The webhook secret was generated during the deploy. Read its value.

```bash
aws secretsmanager get-secret-value --secret-id <WebhookSecretArn> \
  --query SecretString --output text --region ap-northeast-1
```

Next, create a GitHub App with these settings.

- The webhook URL is the value of `WebhookUrl`, and the secret is the value just read
- Repository permissions: Administration read and write, Actions read-only. Nothing else
- Subscribe to the Workflow job event only
- Install it on the one practice repository only

Generating the app's private key downloads a PEM file. Put it into the other secret, then delete the local file.

```bash
aws secretsmanager put-secret-value --secret-id <AppPrivateKeySecretArn> \
  --secret-string file://<downloaded>.private-key.pem --region ap-northeast-1
```

Deploy again, passing the app's client ID and the repository's name.

```bash
vp run runners:infra:deploy -c repositories=<owner>/<repo> -c appClientId=<client-id>
```

Check that an unsigned request is refused. A 401 with `{"error":"bad_signature"}` means the function URL is reachable and the receiver is running.

```bash
curl -i -X POST <WebhookUrl>
```

Last, put `examples/62-ci-runners/workflows/ci.yml` into `.github/workflows/` of the practice repository and push. The repository variables that hold the role's ARN are chapter 20's. When the job is queued, one task should start.

```bash
aws ecs list-tasks --cluster <ClusterName> --region ap-northeast-1
aws logs tail <RunnerLogGroupName> --since 10m --region ap-northeast-1
```

When a job does not start, look in order. The delivery history in the GitHub App's settings shows the response's status code and body. On a 200 with `skipped`, the body's `reason` is why. On a 500, the receiving Lambda's log has `launch failed` with the cause. If the task started and the job did not, read the runner's log group.

Drift is checked as in other chapters.

```bash
vp run runners:infra:drift
```

When you are done, go on to [Cleanup](/en/chapters/62-ci-runners/wrap.md). An app left installed keeps sending deliveries.
