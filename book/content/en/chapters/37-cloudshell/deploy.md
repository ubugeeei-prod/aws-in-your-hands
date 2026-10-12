---
title: "37 CloudShell and Cloud9: Deploy"
---

# 37 CloudShell and Cloud9: Deploy

This chapter deploys nothing to AWS. What moves is one file, and where it goes is the CloudShell home directory. The steps on this page have not yet been run in a real CloudShell.

## Taking It to CloudShell and Running It

<!-- section: 37.run -->

First, build the file on your machine.

```bash
vp run cloudshell:build
```

```text
dist/aih-cloudshell.mjs: 29578 bytes, sha256 0e3cb632e0266585191ee8f2cfd90a2d2688a3e4ff19e33054cac90cd2d561d7
```

This output is from a local build on October 13, 2026. Change the source and both the size and the hash change. The file is about 30 KB of text, so you can open and read it before you take it anywhere.

Next, sign in to the console and open CloudShell, with the console's Region set to Tokyo. On the CloudShell page choose Upload file from Actions and upload `dist/aih-cloudshell.mjs`. The file lands in the home directory. The home directory persists, so one upload is enough, though only for the environment in that Region.

Once it is uploaded, look at the Node.js version first.

```bash
node --version
```

If it is older than 18, the script does not run; it says so and exits. CloudShell's Node.js version is not documented, so what this prints has not been confirmed.

Start with the commands that only read.

```bash
node aih-cloudshell.mjs whoami
node aih-cloudshell.mjs budget
node aih-cloudshell.mjs left
```

Check that `account` in the `whoami` output is your practice account. If you have switched to another account in the console, a different ID appears here.

If `left` shows a stack you thought you had destroyed, it was left behind. Run the destroy on your machine, because cdkd is not in CloudShell. You could delete the resources directly with `aws` commands on the spot, but then cdkd's state and the real resources disagree, and a later destroy on your machine may stop partway. Unless something has to be stopped in a hurry, it is safer to go back to your machine and run `vp run <name>:infra:destroy`.

To empty a bucket, look at the counts first, without `--yes`.

```bash
node aih-cloudshell.mjs empty <bucket name>
node aih-cloudshell.mjs empty <bucket name> --yes --account <12-digit account ID>
```

The second line changes AWS. Deleted versions cannot be brought back. The bucket's name is on the `bucket:` line of the `left` output. If the session ends partway, run the same command again.

The file stays in the home directory after you are done. `rm aih-cloudshell.mjs` removes it.

## Commands You Can Use Without the Script

<!-- section: 37.commands -->

The AWS CLI is installed, so the `aws` commands from earlier chapters can be typed as they are. Here are some likely ones, each with its Region stated.

```bash
aws sts get-caller-identity
aws iam get-account-summary --query 'SummaryMap.AccountMFAEnabled'
aws logs tail <log group name> --since 30m --region ap-northeast-1
aws s3 ls --region ap-northeast-1
```

The first two lines are from chapter 01. `aws logs tail` on the third prints a log group's logs going back in time: `--since 30m` covers the last 30 minutes, and `--follow` keeps waiting for new logs. While `--follow` waits, however, CloudShell is still counting the time without input. Leave the page untouched and the whole session ends after 20 to 30 minutes.

`--format short` shortens the timestamp and makes a line easier to read. The log group's name comes from the stack outputs on your machine or from the CloudWatch pages of the console.

You cannot get into chapter 23's instance from CloudShell with Session Manager. Starting a Session Manager session needs the Session Manager plugin besides the AWS CLI, and the plugin is not on the list of what CloudShell has installed. Whether it can be installed was not tried. To get into an instance with a browser alone, starting the session from the Systems Manager pages of the console is the surer way.
