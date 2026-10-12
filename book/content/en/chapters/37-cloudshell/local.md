---
title: "37 CloudShell and Cloud9: Run It Locally"
---

# 37 CloudShell and Cloud9: Run It Locally

## Run It Locally

<!-- section: 37.local -->

This chapter's code can be checked on your machine with no CloudShell and no AWS account.

```bash
vp test run examples/37-cloudshell
```

The tests come in three layers.

The first checks decisions only: how the budget's state is classified, how state keys are read, how the billed types are picked out, how targets are split into batches of 1,000, and which actions the three policies let through.

The second tests the loop that empties a bucket. It builds a versioned bucket in memory and makes failures happen in a fixed order. It checks the following.

- 2,501 versions and delete markers are all deleted, in requests of at most 1,000 each
- When S3 refuses one key, the loop stops in that round and returns the refused key. With the cause removed, calling the same loop again deletes the rest
- An object written after the listing was taken is deleted in the next round
- When deletes report success and nothing goes away, the loop stops with an error and does not spin

The third runs the built file as it is. The test builds `aih-cloudshell.mjs`, puts a fake executable named `aws` first on PATH, and runs the same commands a reader would type in CloudShell. The fake `aws` gives fixed answers and records every argument it was called with. That makes these checks possible.

- Without `--yes`, `delete-objects` is never called
- With `--yes`, a missing `--account`, or one that differs from the signed-in account, stops the command before it touches the bucket
- With `AWS_REGION` pointing at another Region, the calls still go to Tokyo
- Given cdkd's state bucket, the command refuses without calling `aws` once
- The built file imports nothing but modules built into Node.js

The answers the fake `aws` gives were written by hand. They were not recorded from a real account. The field names come from the API references, the help of the pinned AWS CLI, and cdkd's type definitions. The values are made up.

A task uses the same fake to let you look at the script's output.

```bash
vp run cloudshell:demo
```

```text
The answers below are fixtures. Nothing here reached AWS.

$ node aih-cloudshell.mjs whoami
action:  identify credentials (reads AWS)
account: 111111111111
region:  ap-northeast-1
caller:  arn:aws:iam::111111111111:user/aih-dev
(exit 0)

$ node aih-cloudshell.mjs left
action:  list what cdkd still records (reads AWS)
account: 111111111111
region:  ap-northeast-1
caller:  arn:aws:iam::111111111111:user/aih-dev
AihEc2 (region not recorded): 2 resources
  billed while idle (chapter 23): AWS::EC2::Volume vol-0example
  billed while idle (chapter 23): AWS::EC2::Instance i-0123456789abcdef0
AihHello (ap-northeast-1): 1 resources
  bucket: aihhello-practicebucket-example
AihNetwork (ap-northeast-1): 5 resources
  billed while idle (chapter 11): AWS::EC2::NatGateway nat-0example
  billed while idle (chapter 11): AWS::EC2::EIP eipalloc-0example
  billed while idle (chapter 11): AWS::EC2::VPCEndpoint vpce-0interface
3 stacks recorded in cdkd-state-111111111111; 5 resources of a kind that is billed while idle.
This is cdkd's record, not a look at the resources. A stack deployed another way is not in it.
(exit 0)
```

This is the `whoami` and `left` part of what `vp run cloudshell:demo` prints. As its first line says, the account, the stacks, and the IDs are made up, and nothing reached AWS.

The policy JSON is printed by the next task. The argument is one of `use`, `use-no-files`, `deny`, and `vpc-only`.

```bash
vp run cloudshell:policy use-no-files
```

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "UseCloudShell",
      "Effect": "Allow",
      "Action": [
        "cloudshell:CreateEnvironment",
        "cloudshell:CreateSession",
        "cloudshell:GetEnvironmentStatus",
        "cloudshell:PutCredentials",
        "cloudshell:StartEnvironment"
      ],
      "Resource": "*"
    }
  ]
}
```

`Resource` is `*`, and not out of laziness: the documentation says `cloudshell:CreateEnvironment` accepts nothing but `*` as its `Resource`. The task only prints JSON. It neither creates a policy nor attaches one.

What cannot be checked locally is just as clear. Whether the fake `aws` answers in the same shape as the real one, whether this file runs on CloudShell's Node.js, and how real IAM evaluates these policies are not things a local test can tell you. Each is settled only by running the steps on the [Deploy](/en/chapters/37-cloudshell/deploy.md) page in a real CloudShell.
