---
title: "37 CloudShell and Cloud9: Design and Build"
---

# 37 CloudShell and Cloud9: Design and Build

This page builds the script to take into CloudShell and the policies that decide who may use CloudShell. The script is one file with four commands: `whoami` shows the current identity and account, `budget` shows the state of chapter 01's budget, `left` shows the stacks cdkd still records, and `empty` empties a bucket.

## One File

<!-- section: 37.bundle -->

As the [Overview](/en/chapters/37-cloudshell.md) page showed, CloudShell has nowhere to keep dependencies, and its Node.js version is not documented. The script is therefore built to meet two conditions.

- It runs as a single file and needs no `npm install`
- Its syntax is one an older Node.js can read

The source is TypeScript as in the earlier chapters, validated with Valibot. esbuild turns it into one `.mjs`. The build runs on your machine, and only the resulting file goes to CloudShell.

<<< @/examples/37-cloudshell/scripts/bundle.ts

With `target` set to `node18`, esbuild emits syntax that Node.js 18 can read. Chapter 23's bundle used `node24` because there you chose the Node.js version on the instance yourself. In CloudShell you cannot, so the script aims low. It has not been run on Node.js 18: the only Node.js at hand is 24.

When it starts, the script first checks the Node.js version.

<<< @/examples/37-cloudshell/src/cli.ts{guard}

To call AWS it uses the AWS CLI, not the SDK. The documentation says the AWS CLI is installed in CloudShell, and it uses the credentials already there. Bundling the SDK is possible, but the file would grow until you could no longer read it before running it. A file that runs with your credentials is better kept at a size you can read.

Only this function starts a process.

<<< @/examples/37-cloudshell/src/aws-cli.ts{run}

The arguments passed to `aws` are assembled by functions in another file. They run nothing, so a test can check which command gets which arguments.

<<< @/examples/37-cloudshell/src/commands.ts{args}

Every call carries `--region`. CloudShell puts the console's Region at the time it was opened into `AWS_REGION`, so without it a call could go to a Region other than Tokyo, where this book's stacks are. Only the budget call names `us-east-1`: as chapter 01 said, that is where the AWS Budgets API endpoint is.

## Checking the Identity and the Account

<!-- section: 37.whoami -->

Every command begins by calling `aws sts get-caller-identity` and printing the account and the caller. In CloudShell this check matters more than it does locally. If you switch between accounts or roles in the console, it is easy to mistake which account an open shell belongs to.

<<< @/examples/37-cloudshell/src/account.ts{caller}

The account is compared with chapter 01's `checkTarget`, unchanged. Locally it was compared with `AIH_AWS_ACCOUNT_ID` in `.env`; CloudShell has no `.env`, so the account is passed as `--account`. A command that changes AWS refuses to run without it.

<<< @/examples/37-cloudshell/src/cli.ts{target}

For the budget, the script takes three figures from the answer of `aws budgets describe-budget` and compares them: the limit, the actual spend for the period, and the forecast.

<<< @/examples/37-cloudshell/src/account.ts{budget}

The amounts arrive as decimal strings. All the script needs to know is which side of the limit a figure is on, so it compares them as numbers. That is no way to compute a bill. The last line of the output is the same in every state: as chapter 01 said, a budget only sends a notification and stops no spending.

## Reading the Stacks cdkd Records

<!-- section: 37.left -->

Finding what was left behind means knowing what is deployed. This book's stacks were created by cdkd, so they do not appear in the list of CloudFormation stacks. The record is in the state bucket created in chapter 02.

The pinned version of cdkd keeps each stack's state in a bucket named `cdkd-state-<account ID>`, at `cdkd/<stack name>/<Region>/state.json`. Even without cdkd, reading those keys from S3 tells you what is recorded.

<<< @/examples/37-cloudshell/src/stacks.ts{keys}

Other files, such as locks, are kept under the same prefix. Only `state.json` counts as a stack. The older form of the key, without a Region, is in the pinned version's source too, so the script reads it as well.

A state holds the type and the ID of every resource in the stack. Buckets are shown by name, because that is the name to give `empty`. Then the script picks out the types that earlier chapters described as billed for existing.

<<< @/examples/37-cloudshell/src/stacks.ts{idle}

This table is not a price list. It only records which types count as billed while idle, with the number of the chapter that says so. The amounts are in the chapters the table points to. A test checks that each type in the table really is used in the example of the chapter it points to. Resources of types that are not in the table can cost money too.

VPC endpoints alone are not decided by type. As chapter 11 showed, a gateway endpoint has no hourly charge and an interface endpoint does, so the script tells them apart by a property kept in the state.

The output always ends with these two lines.

<<< @/examples/37-cloudshell/src/stacks.ts{render}

What `left` reads is cdkd's record, not the resources. What is not in the record is invisible to it: something created by hand in the console, or deployed by anything other than cdkd. The reverse holds too. A resource deleted by hand keeps being listed for as long as the record has it. Finding where the record and the real thing disagree is the job of drift detection from chapter 02, and that runs on your machine.

## Emptying a Bucket Before a Destroy

<!-- section: 37.empty -->

cdkd does not delete a bucket that has anything in it. That is why earlier chapters had tasks such as `uploads:empty`. This does the same with the AWS CLI alone.

On a bucket with versioning enabled, `aws s3 rm --recursive` does not empty it. A delete without a version ID only adds a delete marker and leaves every earlier version in place. To empty the bucket, every version and every delete marker has to be deleted by its version ID.

<<< @/examples/37-cloudshell/src/empty.ts{plan}

S3's DeleteObjects accepts at most 1,000 keys in one request, so the targets are split into batches of 1,000. The invariant of this chapter is: no request carries more than 1,000 keys, and every version and delete marker that was listed becomes a target exactly once.

cdkd's two buckets are refused by name. The state bucket is the record of every stack, and chapter 02 left it to be deleted by hand, last. It is not something a script should delete mechanically.

The deleting is a loop: list, delete what was seen, and list again from the start.

<<< @/examples/37-cloudshell/src/empty.ts{loop}

It keeps no position between rounds because none is needed. What was deleted does not appear in the next listing, so reading from the start always shows only what is left. That has two advantages. If the session ends partway, running the same command again resumes with the rest. And an object someone wrote after the listing was taken is found in the next round.

S3 can refuse some keys and accept others, for instance a key the caller lacks permission for, or a version protected by Object Lock. The script stops in the round where a key was refused: the same key would be refused for the same reason in the next round, so going on would never finish. It prints the refused keys with their error codes and exits with status 1.

The part that calls AWS is in a different file from the loop.

<<< @/examples/37-cloudshell/src/aws-cli.ts{bucket}

The keys to delete are passed in a file, not as an argument: a thousand keys with their version IDs are too long for one argument. `--expected-bucket-owner` is given the current account's ID, so if the bucket belongs to another account, S3 refuses the request. A mistyped name that happens to match a bucket in someone else's account stops there.

## Policies That Decide Who May Use CloudShell

<!-- section: 37.iam -->

Whether someone can use CloudShell is decided in IAM. CloudShell's operations are actions that begin with `cloudshell:`, and on the date checked there were 11 of them.

<<< @/examples/37-cloudshell/src/policy.ts{actions}

Opening CloudShell from the console needs four of these. With any one missing, you get a permissions error in place of a prompt. `PutCredentials` is the action that passes the console's credentials to the shell. Without it the shell still opens, but it holds no credentials, and using `aws` commands means configuring them yourself.

The managed policy AWS provides is `AWSCloudShellFullAccess`, and what it contains is an allow for `cloudshell:*`. According to the documentation, an identity with the Administrator or the Developer power user managed policy can open CloudShell too. That is why `aih-dev` from chapter 01 can use CloudShell with nothing added.

To let a role with narrow permissions use CloudShell, allow only the actions it needs, by name.

<<< @/examples/37-cloudshell/src/policy.ts{documents}

`allowShell` uses no wildcard, so the allow does not widen when AWS adds an action. A role allowed `cloudshell:*` gains every action that is added, without anyone doing anything. `ApproveCommand`, for example, approves a command sent to CloudShell from another service's console, and is not needed just to open a shell.

All this policy decides is whether the shell opens. What can be done in the open shell is decided by the role's other policies. With CloudShell allowed and no permission to read S3, `aws s3 ls` in the shell is refused.

In the other direction, to take CloudShell away from a role with strong permissions, add `denyShell`. An explicit deny takes precedence over every allow, so even with `AdministratorAccess` CloudShell no longer opens. To apply the same restriction to every account in an organization, put the same statement in an SCP, which [chapter 21](/en/chapters/21-security.md) covered.

`denyPublicEnvironments` is for allowing only environments inside a VPC. It denies creating an environment with no VPC named, so an environment whose exit cannot be narrowed can no longer be created. According to the documentation, though, an environment that already exists can still be entered. To prevent that, each user has to delete their environment from the page. Creating a VPC environment also needs EC2 permissions, such as creating a network interface. The list is in the official documentation and is not part of this chapter's code.

A small function checks which actions the three policies let through.

<<< @/examples/37-cloudshell/src/policy.ts{evaluate}

This function does not reproduce IAM's evaluation. It looks only at action names and two kinds of wildcard, and treats a statement with a condition as if it were not there. What it can confirm is that the policies this file prints are written without a slip. Whether a real role can open CloudShell is checked with the IAM policy simulator or by opening the console as that role. Neither was done for this book.

CloudShell's operations are recorded in CloudTrail. Creating an environment, starting a session, passing credentials, and issuing the URLs for upload and download become events named `createEnvironment`, `createSession`, `putCredentials`, and `getFileUploadUrls` and `getFileDownloadUrls`. That tells you who opened CloudShell and when. No event in the documentation's list, on the other hand, records the commands typed in the shell. A call to AWS from the shell is subject to CloudTrail like any other API call. Data sent out with `curl` leaves no trace in CloudTrail.
