---
title: "37 CloudShell and Cloud9: A Workspace Inside AWS"
sourceRevision: 1
---

# 37 CloudShell and Cloud9: A Workspace Inside AWS

Every command in this book has run on your own machine. AWS also has two workspaces you use from a browser, Cloud9 and CloudShell. This chapter looks at where each of them stands today and what a reader of this book can do with them.

The conclusion first. **Cloud9 does not accept new customers.** AWS closed it to new customers on July 25, 2024. Accounts that used it before that date can keep using it, but someone starting with AWS now cannot create a Cloud9 environment. For that reason this chapter has no Cloud9 walkthrough. It says what Cloud9 was and what you can use in its place.

CloudShell is open to everyone. It is a shell you open inside the console, and it starts out holding the credentials of the identity you signed in with. It costs nothing extra. It is not, however, a place you can carry the tools from [chapter 02](/en/chapters/02-toolchain.md) into as they are. The second half of this chapter explains why from the limits written in the official documentation, and puts the work CloudShell is suited to into one small script.

The chapter builds on the account and `aws login` from [chapter 01](/en/chapters/01-account.md), the tools from chapter 02, the VPC from [chapter 11](/en/chapters/11-network.md), and Session Manager from [chapter 23](/en/chapters/23-ec2.md). The code is in `examples/37-cloudshell/`.

There is no CDK stack in this chapter. CloudShell comes with any identity that can open the console, so there is nothing for a stack to create. The chapter does build policies that decide who may use it, but the role they attach to differs from one reader's account to the next, so they ship as a script that prints JSON, not as a stack.

Everything here was checked against the official documentation on October 13, 2026. No CloudShell session was opened to write it. A sentence about how something behaves inside CloudShell is either what the documentation says or is marked as not tried.

## Cloud9 Today

<!-- section: 37.cloud9 -->

Cloud9 was an integrated development environment in the browser. The editor, the debugger, and a terminal lived in the browser, and the work itself ran on an EC2 instance in your account or on a server of your own reached over SSH. The first kind is called an EC2 environment and the second an SSH environment.

The Cloud9 user guide now opens with this notice.

```text
AWS Cloud9 is no longer available to new customers. Existing customers of
AWS Cloud9 can continue to use the service as normal.
```

The notice links to a post on the official AWS blog. The post says that access for new customers closed on July 25, 2024, that existing customers can go on using the service as before, and that AWS will keep investing in security, availability, and performance but does not plan to add features. As far as could be checked, it gives no date for ending the service.

The post recommends two things in its place. One is the AWS IDE Toolkits, open-source plugins that add AWS operations to the IDE on your machine. The other is CloudShell. In other words, AWS's answer is to keep the editor on your machine and leave only a shell in the browser.

In an account that already uses Cloud9, environments keep running. Cloud9 itself has no charge; an EC2 environment is billed for its instance and its EBS volume. The post reminds readers to delete their Cloud9 instances once they have moved, because a forgotten instance, as chapter 23 showed, is billed for existing.

The options for a reader who wants an editor in the browser are on the [Costs, Pitfalls, and Cleanup](/en/chapters/37-cloudshell/wrap.md) page.

## The CloudShell Environment

<!-- section: 37.environment -->

CloudShell is a shell you open from the console, either from the toolbar at the lower left of any console page or from the CloudShell page. Opening it creates an environment based on Amazon Linux 2023 on the AWS side, and your browser connects to that environment over a WebSocket.

```figure
caption: CloudShell provides a shell on the AWS side that holds the credentials of the identity signed in to the console. A terminal on your machine receives credentials for the same identity through aws login.
node browser: Browser | console
node laptop: Local terminal | aws login
node shell: CloudShell | 1 vCPU, 2 GiB, $HOME 1 GB
node api: AWS APIs
edge browser -> shell: WebSocket
edge shell -> api: aws commands
edge laptop -> api: aws commands
group machine: Your machine = browser, laptop
group aws: AWS = shell, api
mark shell
```

It is available in many Regions, Tokyo (`ap-northeast-1`) among them. Each Region has its own environment, and switching Regions in the console connects you to a different one.

The size of the environment is fixed.

- 1 vCPU and 2 GiB of memory
- A home directory (`$HOME`) of 1 GB that survives between sessions, 1 GB in each Region
- Everything outside the home directory is reset when the session ends

According to the list in the user guide, the following comes preinstalled. The guide gives no versions: the environment is updated regularly, so it tells you to check on the spot with a command such as `node --version`.

- Shells: Bash (the default), Z shell, PowerShell
- AWS commands: the AWS CLI (v2), the AWS CDK's `cdk`, the SAM CLI, the EB CLI, the ECS CLI, AWS Tools for PowerShell
- Runtimes: Node.js with npm, Python 3 with pip, Java (Amazon Corretto 21)
- Tools: git, jq, make, tmux, vim, nano, `edit`, tar, zip and unzip, wget, an SSH client, psql, kubectl, Docker, sudo

pnpm, `vp`, Nix, and cdkd are not on that list.

A session has two time limits. It ends after 20 to 30 minutes without keyboard or pointer input, and a running process does not count as input. It also ends after about 12 hours even if you keep using it. It is not meant for work that runs long, and the documentation points to EC2 for that.

There are limits on quantity as well. One account can have up to 10 shells open at once in each Region, and all the users of an account together get 200 hours a month in each Region. Both can be raised through Service Quotas. The 1 GB home directory cannot.

The contents of a home directory are deleted 120 days after the last session in that Region ended. A CloudShell home directory is not a place to keep things for long. Put what you want to keep in S3 or in a repository.

Files go up and down through the Actions menu on the page. That can be slow for large files, so the documentation also suggests going through S3.

## How the Credentials Get There

<!-- section: 37.credentials -->

A CloudShell shell holds credentials from the moment it opens, because CloudShell passes the credentials you used to sign in to the console into the environment. There is no `aws configure` and no `aws login`.

Compared with `aws login` in chapter 01, the steps differ and the result is the same: temporary credentials for the same identity.

| | Local terminal (chapter 01) | CloudShell |
| --- | --- | --- |
| How it starts | Run `aws login` and sign in in the browser | Sign in to the console and open CloudShell |
| Where the credentials are kept | `~/.aws/login/cache` | In the environment on the AWS side; the documentation does not say where |
| Whose permissions | The identity that signed in | The identity that signed in |
| Default Region | `region` in the profile | The console's Region when CloudShell was opened (the `AWS_REGION` environment variable) |
| How it ends | 12 hours at most; `aws logout` removes them | After 20 to 30 minutes without input, or about 12 hours |

The documentation describes CloudShell's credentials as temporary, regularly rotated, and scoped to the user's permissions. It does not give the rotation interval.

The permissions neither grow nor shrink. What an `aws` command can do inside CloudShell is what that identity can do in the console. The `aih-dev` user from chapter 01 has `AdministratorAccess`, so opening CloudShell gives you a shell with administrator permissions.

That property has another side. **Anyone who can open the console as a role has a shell with that role.** Even if you take care to keep no credentials on your machine, signing in to the console is enough to run as many `aws` commands as you like from a browser alone. And CloudShell can reach the internet by default. Whether a role with strong permissions may use CloudShell is something an IAM policy can decide; how to write one is on the [Design and Build](/en/chapters/37-cloudshell/build.md) page.

How the Region is chosen needs care. CloudShell puts the console's Region at the time it was opened into the `AWS_REGION` environment variable. An environment variable takes precedence over what `aws configure` sets, so a CloudShell opened from a console showing N. Virginia looks at N. Virginia unless told otherwise. The script in this chapter passes `--region` on every call to avoid that difference.

## The Network

<!-- section: 37.network -->

An environment opened the ordinary way can reach the internet, but nothing can reach it from outside, and it has no public IP address. So `npm install` and `git clone` work, but you cannot start a development server in the environment and connect to it from your browser. CloudShell has nothing that corresponds to Cloud9's preview.

Being able to reach out is also a risk. The documentation carries a warning that users can export data from CloudShell, and an ordinary environment has no setting that narrows this exit.

For when you do want to narrow it, CloudShell can create an environment inside a VPC. You choose a VPC, a subnet, and security groups, and the environment then communicates as something inside that subnet. It can reach resources in the private subnets of chapter 11's VPC without a bastion.

A VPC environment is less convenient than an ordinary one, though. The documentation lists these constraints.

- The home directory does not persist. Its contents are gone when the environment times out, is deleted, or is restarted
- Upload and download from the Actions menu are not available
- It gets no public IP address, so reaching the internet requires a private subnet with NAT. Placing it in a public subnet does not give it internet access
- One identity can create at most two environments, each with at most five security groups
- The VPC's local DNS zone is not used by default

The default configuration of chapter 11 has no NAT gateway. A CloudShell environment created in that VPC should have no route to the internet and should reach no AWS API other than S3 and DynamoDB, which have gateway endpoints. That is an inference from the documentation and was not tried.

## Whether This Book's Tools Run in CloudShell

<!-- section: 37.toolchain -->

The tools of chapter 02 were a combination: Nix pins the versions, `vp` runs the tasks, and cdkd deploys. Whether that can be carried into CloudShell follows from the limits in the documentation, one at a time.

**Nix cannot be kept from one session to the next.** Nix puts packages in `/nix`, and the official Nix manual describes no way to put them anywhere else. In CloudShell, files outside the home directory are deleted when the session ends, and `/nix` is outside the home directory.

sudo is available in CloudShell, so reinstalling Nix in every session may be possible. It was not tried. Even if it works, it is not worth it. Measured on a local machine, the five tools this book's devShell uses (Node.js, pnpm, the AWS CLI, git, and `vp`) come with their dependencies to 166 packages and 1.83 GiB. That was measured on October 13, 2026 on macOS (Apple silicon), and the figure will differ on the Linux that CloudShell runs. It is still not an amount to fetch into a 1 vCPU environment for every session that ends after 20 to 30 minutes. How much space there is outside the home directory is not in the documentation.

Running on the preinstalled Node.js without Nix is hard as well. First, the documentation does not give CloudShell's Node.js version. This book's code relies on Node.js stripping TypeScript types as it runs, and an old Node.js cannot do that. Second, there is nowhere to put the dependencies. This repository's `node_modules` measures 1.9 GB locally and does not fit in a 1 GB home directory. Outside the home directory it would have to be installed again every session.

Nor can the preinstalled `cdk` stand in for cdkd. CloudShell has the AWS CDK CLI, and an AWS tutorial even deploys with `cdk deploy` from CloudShell. But this book's stacks are created by cdkd and recorded in cdkd's state. As chapter 02 said, managing one stack through two routes makes the records disagree.

So the book divides the work.

- What stays on your machine is synth, diff, deploy, drift detection, destroy, and the tests. Anything that needs the repository and the pinned tools runs there
- What CloudShell does is the checks and small cleanups that need only the AWS CLI: the current identity and account, the state of the budget, the stacks cdkd still records, a look at the logs, and emptying a bucket before a destroy

The second list is useful when your machine is not at hand: when you are away and start to wonder whether a stack was left running, or in the middle of moving to a new machine. The next page builds a one-file script for it.

## When Not to Use CloudShell

<!-- section: 37.when-not -->

If you have the environment from chapter 02 at hand, there is little reason to open CloudShell. The same checks are available as `vp run account:whoami` and the tasks of each chapter, and those run on pinned versions.

It is better not to use it in these cases.

- Work that runs long. A session ends after 20 to 30 minutes without input, and a running process does not count as input
- Work you want to reproduce. The versions of the preinstalled tools change when AWS decides and are not documented. Nothing promises that the same command gives the same result next month
- A place to keep files. They are deleted after 120 days without use, they are separate in each Region, and there is only 1 GB
- Work with strong permissions in a production account. You would be giving administrator permissions to a shell whose exit cannot be narrowed. If you do use it, decide first who may open it, with the policies on the next page
