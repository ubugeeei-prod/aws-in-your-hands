---
title: 01 Account: Temporary Credentials, Regions, Budgets, and Cleanup
sourceRevision: 3
---

# 01 Account: Temporary Credentials, Regions, Budgets, and Cleanup

Before you build an app, you get your AWS account into a state you can use without worry.

This chapter has four jobs. You protect the root user with MFA and stop using it for everyday work. You make it possible to operate AWS from a terminal without creating long-term access keys. You arrange for a notification when spending passes a threshold. And you pick up the habit of checking that what you meant to delete is really gone. The only AWS resource you create in this chapter is one budget, and there is no app yet.

The only prerequisite is [chapter 00](/en/chapters/00-welcome.md). Commands that start with `vp run` work in the environment you set up in [chapter 02](/en/chapters/02-toolchain.md). You can go through chapter 02 up to "Entering the environment" first and then come back to this chapter.

## Create an account

<!-- section: 01.account -->

An account is the container for AWS resources and their bill, and it has a 12-digit ID. You create one by hand in a web browser, so this part can't be turned into code.

You need three things to create one.

- An email address. It is used for recovery later, so pick an inbox you will be able to read for a long time
- A payment method such as a credit card
- A phone number that can receive SMS or voice calls

Start at <https://aws.amazon.com/>. Along the way a page asks you to choose a plan. As of the date checked (2026-10-11), the official Free Tier page says the following.

- A new account receives USD 100 in credits and can earn up to USD 100 more by using specified services
- A Free plan account is closed 6 months after creation or when its credits run out, unless it is switched to the Paid plan
- Some services are not available on the Free plan
- More than 30 services have a monthly free allowance (always free) that applies on either plan

We have not checked which chapters of this book can be run while staying on the Free plan. If you run into a service that is not available, consider switching to the Paid plan at that point. The Paid plan bills you for what you use, and any remaining credits are drawn down first.

We recommend keeping a learning account separate from your work and production accounts. With a separate account, you can close the whole account along with everything you tried in it.

## Protect the root user

<!-- section: 01.root -->

The identity that signs in with the email address and password you used to create the account is called the root user. The root user's permissions can't be restricted, so it can change billing information and close the account.

For that reason, do these three things first. All of them are manual steps in the AWS Management Console, the web UI for managing your account.

1. Enable MFA. Open "Security credentials" from the account name at the top right and register a multi-factor authentication (MFA) device. You can use a passkey or an authenticator app
2. Check your means of recovery. Confirm that you can still read the root email address and that the registered phone number still works. On the Account page, under "Alternate contacts", enter contacts for billing and security as well
3. Don't create access keys for root. If any exist, delete them

Once you have gone through "Sign in from a terminal" below, you can check with a command whether MFA is enabled.

```bash
aws iam get-account-summary --query 'SummaryMap.AccountMFAEnabled'
```

A result of `1` means MFA is set up for the root user.

From here on, sign in as the root user only for operations that require root, such as changing the payment method or closing the account.

## Set up an identity for everyday work

<!-- section: 01.identity -->

The identity you sign in with for everyday work should be separate from the root user. There are two ways to set one up.

The first is IAM Identity Center, which is what AWS recommends for human users. Choose it if you expect to use several accounts or are working in an organization. From a terminal, you sign in with `aws configure sso` and `aws sso login`. This book has not reproduced the procedure, so follow "Configuring IAM Identity Center authentication with the AWS CLI" in the official documentation.

The second is to create one IAM user and use that user's console sign-in from the terminal as well. With a single personal learning account, this takes fewer steps. The rest of this book uses the second way.

On the IAM pages of the console, create this user.

- User name: `aih-dev` (any name you like)
- Console access: enabled, with a password set
- MFA: always register a device after creating the user
- Access keys: don't create any
- Permissions policies: `AdministratorAccess` and `SignInLocalDevelopmentAccess`

`SignInLocalDevelopmentAccess` is an AWS managed policy that `aws login`, used in the next section, requires.

`AdministratorAccess` grants broad permissions. The book uses it here anyway because CDK creates IAM roles on every deployment, and an identity that can't work with IAM can't create this book's samples. This choice is reasonable only for **a learning account that you alone use**. Don't use it in a shared account or in an account that holds data you need to protect. Narrowing the permissions is covered in [chapter 21](/en/chapters/21-security.md).

You create no access keys because an access key is a secret with no expiry. It gets saved in a file, it can be committed by accident, and when it leaks it does not expire on its own. With the method in the next section, the only credentials left on your machine are ones that expire.

## Sign in from a terminal

<!-- section: 01.login -->

`aws login` is a command that obtains temporary credentials for the terminal, with the same access you have when signed in to the console. Temporary credentials are an access key, a secret key, and a session token that come with an expiry.

`aws login` needs AWS CLI 2.32.0 or later. This book's environment has 2.35.11.

```bash
aws login --profile aih
```

The first time, it asks for a Region. Answer `ap-northeast-1`. When the browser opens, sign in as `aih-dev`, the user you created in the previous section. After you sign in, `~/.aws/config` contains this profile.

```ini
[profile aih]
login_session = arn:aws:iam::111111111111:user/aih-dev
region = ap-northeast-1
```

There are no secrets in this file. The credentials themselves are stored in `~/.aws/login/cache`, and the CLI and SDKs refresh them every 15 minutes. A session expires after at most 12 hours, and when it does you run `aws login` again. When you are done, `aws logout --profile aih` removes the credentials.

You can check at any time which identity you are using and which account you are about to operate on, with this task.

```bash
AWS_PROFILE=aih vp run account:whoami
```

```text
action:  identify credentials (reads AWS)
account: 111111111111
region:  ap-northeast-1
caller:  arn:aws:iam::111111111111:user/aih-dev
```

This task only asks AWS STS who the caller is, and changes nothing.

To avoid typing `AWS_PROFILE` every time, copy `.env.example` to `.env` at the repository root and fill in your account ID.

<<< @/.env.example

`AIH_AWS_ACCOUNT_ID` is a safeguard. A task that changes AWS refuses to run unless the account of the credentials in use matches this value. It prevents the accident of deploying while a profile from some other job is still selected. The following function makes the decision, and it has tests.

<<< @/tools/src/aws/target.ts{check}

Don't put AWS credentials in `.env`. `.env` is excluded from git.

The flow from `aws login` to this point has not yet been run through in a real AWS account. The verification notes at the end of the chapter have the details.

## The Region is Tokyo

<!-- section: 01.region -->

A Region is a geographic unit in which AWS offers services. This book uses Tokyo, `ap-northeast-1`. Most resources belong to a Region and are not visible from other Regions. So if you forget to switch the Region at the top right of the console, something you created appears to be missing.

Some things don't belong to a Region, though, and some need a different Region specified. In the order this book meets them, they are as follows.

- IAM users, roles, and policies: one set for the whole account, with no Region
- Budgets (AWS Budgets) and billing: account-wide, with the API endpoint in `us-east-1`
- CloudFront distributions: served worldwide. The management API endpoint is in `us-east-1`
- ACM certificates attached to CloudFront: they must be created in `us-east-1`

A chapter that uses a feature not offered in the Tokyo Region states the exception in that chapter.

## Set up a budget notification

<!-- section: 01.budget -->

A budget is a mechanism that notifies you when spending passes, or is forecast to pass, a threshold. It is easy to misread, so note that **it is not a cap that stops spending**.

According to the official documentation, budget information is updated up to three times a day, with roughly 8 to 12 hours between updates. There is also a delay between using a resource and that usage appearing in billing. So by the time a notification arrives, spending may already be past the threshold. What a budget prevents is first learning about overspending from next month's bill. It does not prevent the overspending itself.

For that reason, the chapters that publish an endpoint anyone can call (04, 05, 06, 07, 08, 09, 10, 12, 13, 14, 15, 17, 18, 19, 20, and 21) each limit how much they accept. Each of those chapters also states what it bounds, how far, and what it cannot fully bound. The budget notification is the last resort: it is how you find out, some hours late, that one of those limits was not holding.

Here you create a budget of USD 10 per month. It is defined in the following file.

<<< @/examples/01-account/budget.json

`IncludeCredit` is set to `false` so that spending offset by credits also counts toward the notification. With `true`, the budget does not move while credits remain, and the first notification arrives in the month the credits run out.

You supply the notification recipients yourself. Copy `examples/01-account/notifications.example.json` to a file named `notifications.json` and replace the email address.

<<< @/examples/01-account/notifications.example.json

The first notification fires when actual spending passes 50% of the budget, and the second when the month-end forecast passes 100%.

```bash
vp run account:budget:create
```

This task changes AWS. Before it runs, it prints the target account and stops if that does not match `AIH_AWS_ACCOUNT_ID`. A budget whose notifications reach no one is useless, so the task also stops if `notifications.json` still contains the example address.

To check that the budget was created, look under "Billing and Cost Management" → "Budgets" in the console.

This book has not checked what AWS Budgets itself costs. Check the official pricing page.

## How to think about cleanup

<!-- section: 01.cleanup -->

Much of what AWS charges for is either how long a resource exists or how much is stored. Some things are billed until you delete them, even when you are not using them. For that reason, each chapter of this book ends with these three items.

1. The task that deletes what the chapter created
2. What remains after deletion (logs, backups, buckets with retention settings, and so on)
3. What the remaining items cost

A few days after cleaning up, look at "Billing and Cost Management" → "Bills" in the console and confirm that usage has not grown since the day you cleaned up. Billing does not update immediately, so looking on the same day tells you nothing.

This task deletes the budget you created in this chapter.

```bash
vp run account:budget:delete
```

Starting with the next chapter you create resources that cost money, though, so we recommend keeping the budget.

To stop using the account altogether, sign in as the root user and close it from the Account page. This is also a manual step.

## Where you might get stuck

| Symptom | What to check |
| --- | --- |
| Running `aws login` reports that there is no such command | The AWS CLI is older than 2.32.0. Check `aws --version` and run the command inside the chapter 02 environment |
| Commands after `aws login` fail with a permissions error | Whether `SignInLocalDevelopmentAccess` is attached to the IAM user |
| `vp run account:whoami` says it cannot determine the credentials | Whether `AWS_PROFILE` matches the profile name created with `aws login`, and whether the session is more than 12 hours old |
| A task stops and says the account ID is different | You are using another profile. Review `AWS_PROFILE` and `AIH_AWS_ACCOUNT_ID` in `.env` |
| Something you created does not show up in the console | Whether the Region at the top right is set to Tokyo |

::: details Verification notes for this chapter

**Checked locally.** The check in `tools/src/aws/target.ts` is covered by unit tests.

**Not checked yet.** `aws login`, `account:whoami`, and `account:budget:create` have not been run in a real AWS account. It is also unconfirmed whether the AWS SDK for JavaScript v3 (3.1149.0) used by this book's tools can read `aws login` credentials as they are. As a workaround if it cannot, the official documentation describes a profile that uses `credential_process` to have the CLI supply the credentials.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Sign in from a terminal | `tools/src/aws/target.ts`, `tools/src/aws/target.test.ts`, `tools/src/aws/preflight.ts`, `tools/src/aws/whoami.ts`, `.env.example` | `account:whoami` |
| Set up a budget notification | `examples/01-account/budget.json`, `examples/01-account/notifications.example.json`, `tools/src/aws/budget.ts` | `account:budget:create` |
| How to think about cleanup | `tools/src/aws/budget.ts` | `account:budget:delete` |

**Primary sources**

- [Login for AWS local development using console credentials](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html) (checked 2026-10-11)
- [Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html) (checked 2026-10-11)
- [AWS Free Tier](https://aws.amazon.com/free/) (checked 2026-10-11)
- [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html) (not rechecked at the time of writing)

:::
