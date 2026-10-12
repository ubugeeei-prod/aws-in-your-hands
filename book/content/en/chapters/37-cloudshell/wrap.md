---
title: "37 CloudShell and Cloud9: Costs, Pitfalls, and Cleanup"
---

# 37 CloudShell and Cloud9: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It covers the cost, the options when you want an editor in the browser, how this differs from Cloudflare and Vercel, where people get stuck, and the cleanup.

## Cost

<!-- section: 37.cost -->

CloudShell has no additional charge. The pricing page says that CloudShell itself is not billed, and that the other resources you use from it, and data transfer, are billed at their usual rates (checked 2026-10-13).

For this chapter's script, that means the AWS APIs that `whoami`, `budget`, `left`, and `empty` call are treated the same as when you type the same commands on your machine. Nothing in this chapter is billed for existing, so there is no pricing scenario either.

In place of a price there is a limit on quantity: 200 hours a month in each Region, for all the users of an account together. Once it is reached, CloudShell cannot be opened in that Region for the rest of the month. An increase can be requested through Service Quotas.

An environment inside a VPC is free as far as CloudShell goes. Reaching the internet from it needs NAT, though, and as chapter 11 worked out, a NAT gateway costs about USD 49 a month for existing.

In an account that still uses Cloud9, Cloud9 itself is free, and the instance and volume of an EC2 environment are billed.

## When You Want an Editor in the Browser

<!-- section: 37.alternatives -->

The editors CloudShell has are `vim`, `nano`, and `edit`. None is an editor with a file tree and a debugger, as Cloud9 was. Here are the options for using an environment that runs inside AWS from an editor, as far as they could be confirmed. None of them was run for this book.

**Connect the editor on your machine to chapter 23's instance.** This is closest to what AWS recommends. The editor stays on your machine, and only running the code is handed to a machine inside AWS.

Chapter 23's instance has no SSH port open. SSH can still be carried through Session Manager. In `~/.ssh/config` on your machine you write a setting that passes the SSH connection through `aws ssm start-session`. This is the setting from the official documentation.

```text
# SSH over Session Manager
Host i-* mi-*
    ProxyCommand sh -c "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p'"
    User ec2-user
```

With that in place, an editor that can open a remote machine over SSH can connect using the instance ID as the host name. On the instance, an SSH server has to be running and your public key has to be registered. Chapter 23's stack registers no key, so it cannot be used as it is. Also, according to the documentation, the contents of SSH and port-forwarding sessions are not kept in Session Manager's logs: SSH encrypts the traffic, and Session Manager is only the tunnel.

If you use VS Code, the AWS Toolkit for VS Code has a command that connects VS Code to an EC2 instance. Its documentation says it was tested on Amazon Linux 2023 and Ubuntu 22.04, that it needs SSH on your machine, and that the instance's role needs the permissions included in `AmazonSSMManagedInstanceCore`. Chapter 23's instance already has them.

If all you want is to run a development server on the instance and look at it in your own browser, you do not need to connect an editor at all. `vp run ec2:forward` from chapter 23 connects a port on your machine to a port on the instance.

With any of these, the instance is billed for existing. Read the cost section of chapter 23 before you start.

**The development environments AWS provides.** On the date checked, these three are the ones whose status could be confirmed from the documentation.

| Environment | New customers | What it is |
| --- | --- | --- |
| Cloud9 | Not accepted (since 2024-07-25) | An IDE in the browser, running on EC2 or your own server |
| Dev Environments in CodeCatalyst | Not accepted | A cloud development environment whose tools are set by a devfile |
| Code Editor in SageMaker Studio | No closing notice found | An editor based on Code-OSS (the open-source VS Code), using one EC2 instance and one EBS volume |

The documentation describes Code Editor as a tool for writing analytics and machine learning code, and it is part of SageMaker Studio. This book does not expect it to be used for web application development. Using it is billed for the instance and the volume. The amounts were not checked.

In the end, as far as could be confirmed, there is no way today for a new customer to get the Cloud9 experience of opening a browser and finding an editor there. Keeping the editor on your machine is also what AWS itself recommends.

CloudShell has the Kiro CLI installed as well. It is a tool for asking questions in natural language in the terminal and having commands put together for you. It needs a sign-in separate from CloudShell's, and it can only act within the permissions of the signed-in identity. This book does not cover it.

## How This Differs from Cloudflare and Vercel

<!-- section: 37.compare -->

Neither Cloudflare nor Vercel appears to have a counterpart to CloudShell. That is, as far as could be confirmed, neither has a shell that opens inside the dashboard and starts out holding the account's credentials (checked 2026-10-13).

With Cloudflare, `wrangler` runs on your machine or in CI. `wrangler login` opens a browser, is authorized through OAuth, and stores tokens in the configuration directory on your machine. In CI, an API token goes into `CLOUDFLARE_API_TOKEN`. The page on starting from the Workers dashboard was read as well: what it describes is creating and deploying an application from a template or a Git repository, and no shell appears in it.

Vercel has the same shape. You install the `vercel` CLI on your machine and sign in with `vercel login`. CI uses `VERCEL_TOKEN`.

There is no need to read this difference as AWS being ahead. On Cloudflare and Vercel, the dashboard and the deployment flow are built so that you do not have to open a shell. Pushing to Git deploys, and the logs and the settings are on the page. CloudShell is useful on AWS because many operations cannot be finished in the console pages alone, and those operations need a CLI and credentials.

For a reader who is well served by Cloudflare or Vercel, CloudShell is no reason to move. It is enough to remember it as a stopgap until your local environment is ready when you do come to use AWS, and as a way to check on things when your machine is not at hand.

## Where People Get Stuck

| Symptom | What to check |
| --- | --- |
| CloudShell will not open and says you lack permissions | Whether the four launch actions are allowed, and whether an explicit deny is attached |
| The shell opens, but `aws` commands say there are no credentials | Whether `cloudshell:PutCredentials` is allowed |
| A resource you created is not there | The console's Region. `AWS_REGION` is set to it. Pass `--region` |
| A command you installed yesterday is gone | What `dnf` and the like install lives outside the home directory and is gone when the session ends |
| A file in the home directory is gone | Whether you opened the environment of another Region, whether 120 days passed without use, or whether it is a VPC environment |
| A confirmation appears when you paste | Safe Paste, which has you confirm a multiline paste before it runs. On by default |
| It no longer opens | `.bashrc` may be broken. Deleting the home directory from Actions restores the defaults, and deletes everything in it |
| `Failed to open sessions` appears | A corporate proxy may not be letting WebSockets through |
| It says it cannot be opened for the rest of the month | The 200-hour monthly limit was reached. Check in Service Quotas |

## Cleanup

<!-- section: 37.cleanup -->

This chapter creates nothing in AWS. The only thing to clean up is the file inside CloudShell.

```bash
rm aih-cloudshell.mjs
```

To delete the CloudShell environment as a whole, choose to delete the home directory from Actions on the CloudShell page. What is deleted cannot be brought back. If you do nothing, the home directory is deleted after 120 days without use in that Region.

If you attached a policy printed by `cloudshell:policy` to a role, detach it when it is no longer needed. You attached it yourself, so no task in this book removes it.

`dist/` on your machine is ignored by git. Delete it and `vp run cloudshell:build` makes it again.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (the actions the three policies let through; how the budget's state is classified; how state keys and resources are read; that each type in the table of billed types is in the example of the chapter it points to; the batches of 1,000; the loop that empties an in-memory bucket, with a refusal partway, a re-run, a write partway, and a case that never ends). A test that runs the built file with a fake `aws` on PATH. The type check. `cloudshell:build`, `cloudshell:demo`, and `cloudshell:policy`. The output quoted in the chapter is from local runs on October 13, 2026. They used Node.js 24.21.0 and AWS CLI 2.35.11, both from the devShell.

The size of the tools was measured locally too. The devShell's five tools and their dependencies are 166 packages and 1,968,352,824 bytes (the sum of `narSize` from `nix path-info -r`), and the repository's `node_modules` is 1.9 GB by `du -sh`. Both are values on macOS (Apple silicon).

**Not checked yet.** Nothing was run against AWS. No CloudShell was opened, so the following are unconfirmed: CloudShell's Node.js version, and that `aih-cloudshell.mjs` runs on it; that it runs on Node.js 18; the upload steps from Actions; and that `whoami`, `budget`, `left`, and `empty` can read what the real `aws` prints. In particular, the output of `--query 'Contents[].Key'` for an empty prefix, the `NextToken` of `list-object-versions` with `--max-items`, and what a successful `delete-objects` prints in quiet mode are shapes the fake decided. That `left` can read the `state.json` cdkd really writes is unconfirmed as well. The behavior of the three policies when attached to a real role, an environment inside a VPC, whether Nix can be installed in CloudShell, and SSH and an editor connection through Session Manager were not run either.

What could not be confirmed from primary sources. The versions of Node.js and the rest in CloudShell (the guide leaves them out on purpose). The free space outside the home directory. The rotation interval of the credentials and where they are kept. The CPU architecture of the CloudShell environment (the guide's steps for reinstalling the AWS CLI fetch the x86_64 file, but it is not stated). The date on which Cloud9 ends. The AWS lifecycle page was opened, but its list of services could not be read, so which stage Cloud9 is classified in is unconfirmed. The date CodeCatalyst closed to new customers. The prerequisites and the price of Code Editor in SageMaker Studio. Whether the Cloudflare dashboard has a feature for editing code in the browser (the page that was read does not mention one).

**Not used.** A CDK stack (there is no resource to create). The AWS SDK for JavaScript (the guide says it is installed in CloudShell, but its version is unknown and bundling it would make the file large, so the AWS CLI is used). The `cdk` installed in CloudShell (this book's stacks are managed by cdkd). Docker (available in CloudShell, but not needed for this chapter's work).

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| One File | `examples/37-cloudshell/scripts/bundle.ts`, `scripts/build.ts`, `src/cli.ts`, `src/aws-cli.ts`, `src/commands.ts`, `test/bundle.test.ts` | `cloudshell:build`, `test:unit` |
| Checking the Identity and the Account | `examples/37-cloudshell/src/account.ts`, `src/cli.ts`, `test/account.test.ts`, `tools/src/aws/target.ts` | `test:unit` |
| Reading the Stacks cdkd Records | `examples/37-cloudshell/src/stacks.ts`, `test/stacks.test.ts` | `test:unit` |
| Emptying a Bucket Before a Destroy | `examples/37-cloudshell/src/empty.ts`, `src/aws-cli.ts`, `test/empty.test.ts` | `test:unit` |
| Policies That Decide Who May Use CloudShell | `examples/37-cloudshell/src/policy.ts`, `scripts/policy.ts`, `test/policy.test.ts` | `cloudshell:policy`, `test:unit` |
| Run It Locally | `examples/37-cloudshell/scripts/demo.ts`, `test/support/` | `cloudshell:demo`, `test:unit` |
| Taking It to CloudShell and Running It | `examples/37-cloudshell/scripts/build.ts`, `src/cli.ts` | `cloudshell:build` |

**Primary sources** (all checked 2026-10-13)

- CloudShell user guide: [What is AWS CloudShell?](https://docs.aws.amazon.com/cloudshell/latest/userguide/welcome.html), [Compute environment](https://docs.aws.amazon.com/cloudshell/latest/userguide/vm-specs.html), [Service quotas and restrictions](https://docs.aws.amazon.com/cloudshell/latest/userguide/limits.html), [Concepts](https://docs.aws.amazon.com/cloudshell/latest/userguide/working-with-aws-cloudshell.html), [Getting started](https://docs.aws.amazon.com/cloudshell/latest/userguide/getting-started.html), [Manage AWS services from CLI](https://docs.aws.amazon.com/cloudshell/latest/userguide/working-with-aws-cli.html), [Using CloudShell in Amazon VPC](https://docs.aws.amazon.com/cloudshell/latest/userguide/using-cshell-in-vpc.html), [Required IAM permissions for VPC environments](https://docs.aws.amazon.com/cloudshell/latest/userguide/aws-cloudshell-vpc-permissions-1.html), [Managing access with IAM policies](https://docs.aws.amazon.com/cloudshell/latest/userguide/sec-auth-with-identities.html), [Logging and monitoring](https://docs.aws.amazon.com/cloudshell/latest/userguide/logging-and-monitoring.html), [Security FAQs](https://docs.aws.amazon.com/cloudshell/latest/userguide/cloudshell-security-faqs.html), [Security best practices](https://docs.aws.amazon.com/cloudshell/latest/userguide/security-best-practices.html), [Troubleshooting](https://docs.aws.amazon.com/cloudshell/latest/userguide/troubleshooting.html), [Kiro CLI in CloudShell](https://docs.aws.amazon.com/cloudshell/latest/userguide/q-cli-features-in-cloudshell.html), [Deploying a Lambda function using the AWS CDK](https://docs.aws.amazon.com/cloudshell/latest/userguide/tutorial-docker-cdk-deploy.html)
- CloudShell, elsewhere: [Endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/cloudshell.html), [AWSCloudShellFullAccess](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSCloudShellFullAccess.html), [the service reference JSON](https://servicereference.us-east-1.amazonaws.com/v1/cloudshell/cloudshell.json) (11 actions, v1.4), [Pricing](https://aws.amazon.com/cloudshell/pricing/), [FAQs](https://aws.amazon.com/cloudshell/faqs/)
- Cloud9: [What is AWS Cloud9?](https://docs.aws.amazon.com/cloud9/latest/user-guide/welcome.html) (the notice at the top), [How to migrate from AWS Cloud9 to AWS IDE Toolkits or AWS CloudShell](https://aws.amazon.com/blogs/devops/how-to-migrate-from-aws-cloud9-to-aws-ide-toolkits-or-aws-cloudshell/), [Pricing](https://aws.amazon.com/cloud9/pricing/), [AWS Lifecycle Changes](https://docs.aws.amazon.com/general/latest/gr/service-lifecycle.html) (the definitions only)
- Other environments: [Dev Environments in CodeCatalyst](https://docs.aws.amazon.com/codecatalyst/latest/userguide/devenvironment.html), [Code Editor in SageMaker Studio](https://docs.aws.amazon.com/sagemaker/latest/dg/code-editor.html), [Working with Amazon EC2 (AWS Toolkit for VS Code)](https://docs.aws.amazon.com/toolkit-for-vscode/latest/userguide/ec2-overview.html), [SSH connections through Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-getting-started-enable-ssh-connections.html)
- APIs and the CLI: [DeleteObjects](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html), [ListObjectVersions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html), [s3api list-object-versions](https://docs.aws.amazon.com/cli/latest/reference/s3api/list-object-versions.html), [s3 cp](https://docs.aws.amazon.com/cli/latest/reference/s3/cp.html), [DescribeBudget](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_DescribeBudget.html), [logs tail](https://docs.aws.amazon.com/cli/latest/reference/logs/tail.html). The inputs and outputs of `sts get-caller-identity`, `s3api list-objects-v2`, and `s3api delete-objects` were checked in the help of AWS CLI 2.35.11
- Nix: [Installing a Binary Distribution](https://nix.dev/manual/nix/2.28/installation/installing-binary)
- cdkd 0.296.28: `dist/index.d.ts` in the npm tarball (`StackState`, `ResourceState`) and the source under `dist/` (the name of the state bucket and the form of the key)
- Cloudflare and Vercel: [Wrangler General commands](https://developers.cloudflare.com/workers/wrangler/commands/general/), [Workers: Get started (Dashboard)](https://developers.cloudflare.com/workers/get-started/dashboard/), [Vercel CLI Overview](https://vercel.com/docs/cli)

:::
