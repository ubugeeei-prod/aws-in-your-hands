---
title: "23 VM: Design and Build"
---

# 23 VM: Design and Build

## No SSH port

<!-- section: 23.access -->

Getting into a server used to mean SSH. Open port 22, hand out keys, put a bastion in front. This chapter does none of that. An open port is a way in for attackers, and a key stays on somebody's laptop for good.

Session Manager, a part of Systems Manager, takes its place. Here is how it works. A process called SSM Agent runs on the instance and opens an HTTPS connection toward Systems Manager. When you call `aws ssm start-session`, Systems Manager connects a shell through that connection. It is always the instance that starts the connection, which is why not a single inbound rule is needed. Who may get in is decided by IAM, not by a key.

Three things are required.

1. **SSM Agent.** The Amazon Linux 2023 AMIs that AWS publishes come with it installed
2. **Permissions.** The instance's role gets a managed policy called `AmazonSSMManagedInstanceCore` (next section)
3. **A path to Systems Manager.** This is the part that costs money

There are three ways to make that path. The amounts are for one month with no traffic at all.

| Where the instance sits | The way to Systems Manager | Cost of the way |
| --- | --- | --- |
| Private subnet | Three interface endpoints (`ssm`, `ssmmessages`, `ec2messages`) | 61.32 |
| Private subnet | A NAT gateway | 48.91 (`-c egress=nat` in chapter 11) |
| Public subnet | The internet gateway, and a public IPv4 address on the instance | 3.65 |

Whichever you choose, inbound stays empty. Even in a public subnet, nothing outside can start a connection to the instance.

### The default is the private subnet

To be honest, this was a close call. For just trying things out, the public subnet costs less than a fifth.

Two reasons made the private subnet the default anyway. First, a machine with a public IPv4 address is one security group rule away from being reachable from outside. Inbound is empty today, but somebody will touch the settings of a long-lived machine someday. Second, outbound traffic. An instance in a public subnet can reach anywhere on the internet on port 443. In the private subnet it reaches Systems Manager and S3, and that is all. When software on it is taken over, what the attacker can do differs.

A machine that stays for a long time, and anything that runs as several machines like chapter 24, normally goes into private subnets, so the default follows that. For a single pass through this chapter, `-c placement=public` is plenty. Inbound is empty there as well, and a test pins it.

### Connecting to the chapter 11 VPC

The interface endpoints are added with a switch on the chapter 11 stack.

```bash
vp run net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages
```

As chapter 11 showed, `-c` applies to that one command only. If you later redeploy chapter 11 without `-c`, the endpoints disappear and this chapter's instance drops out of sight for Systems Manager.

Whether all three endpoints are needed is, in fact, not certain. The Systems Manager documentation lists the three, but the same page says that SSM Agent 3.3.40.0 and later uses `ssmmessages` in place of `ec2messages`. Leaving `ec2messages` out would save USD 20.44 a month. The page does not say that the endpoint may be omitted, though, and it was not tried on a real instance, so this chapter keeps all three.

On the instance's side, this is all the code there is.

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{network}

There is no `securityGroupIngress`. It was not forgotten: that is the setting. The test checks that there is not one inbound rule and that no SSH key pair is specified.

Outbound is port 443 only. A new security group starts with an outbound rule that allows everything to everywhere, and writing one rule replaces it. DNS, time synchronization, and the instance metadata of the next section are traffic that security groups do not look at, so they work without a rule.

### What happens without a path?

This is the easiest place in the chapter to get stuck. Forget the endpoints and the deploy still succeeds. The instance starts, and its state is running. But it never shows up in Systems Manager. No error appears anywhere.

So the path can be checked on your machine before you deploy. It uses the route model from chapter 11 as it is.

<<< @/examples/23-ec2/src/access.ts{access}

Give `vp run ec2:plan` the settings you deploy chapter 11 with.

```bash
vp run ec2:plan interfaceEndpoints=ssm
```

`ssmmessages` and `ec2messages` show up as `UNREACHABLE`, and the task ends in failure. The way to S3 is the gateway endpoint that chapter 11 creates by default. It is free, and it carries operating system packages, SSM Agent updates, and this chapter's releases.

One thing to be honest about: that the Amazon Linux 2023 package repositories can be reached from a private subnet through the S3 gateway endpoint alone was not verified. That the repositories are S3 buckets was inferred from host names in sample output in the documentation. If they cannot be reached, Node.js is not installed on the first boot and the user data fails. How to investigate is under "Where people get stuck".

## The instance fetches its permissions from inside

<!-- section: 23.role -->

A Lambda function had an execution role, and an instance gets a role as well.

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{role}

EC2 cannot take a role directly. You put one role into a container called an instance profile and attach that to the instance. CDK's higher-level constructs do this silently, but writing it out shows what is being created.

`AmazonSSMManagedInstanceCore` is a policy that AWS maintains. Reading it, every statement is for `"Resource": "*"`, and `ssm:GetParameter` is among the actions. A process on this instance can therefore read values from the account's Parameter Store if it tries. The book has avoided `*` since chapter 04; using an AWS policy as it is makes this the exception. Only one permission was added by hand: reading under `releases/` in the bucket that holds releases.

### Where do the credentials come from?

The AWS CLI and the SDKs on the instance work without any access key being configured. Where do they get credentials?

The answer is IMDS, the Instance Metadata Service. There is an address, `169.254.169.254`, that is reachable only from inside the instance, and asking it returns temporary credentials for the role. They expire and are replaced automatically. This is why no key has to sit on the disk.

Convenient, and it has a weak spot: anything running on the instance can ask that address. Suppose the application has a feature that fetches a URL the user supplies. Given `http://169.254.169.254/...`, the application might fetch the credentials and hand them back in its response.

IMDS has two versions. Version 1 answers a plain GET, and the attack above goes straight through. Version 2 has you obtain a token with a PUT first and send it in a header with each request. A hole that only allows "make it GET one URL" can do neither the PUT nor the header. On top of that, a PUT carrying an `X-Forwarded-For` header is rejected, which keeps out requests relayed by a proxy.

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{instance}

`httpTokens: "required"` allows version 2 only. `httpPutResponseHopLimit` is how many network hops the reply with the token may travel. With 1 it reaches the instance itself and nothing behind it. If you run containers on the instance and want them to use the role, it has to be 2. The Amazon Linux 2023 AMI reportedly launches with version 2 required and a hop limit of 2 even when nothing is specified, but the stack writes the values down instead of relying on defaults of the AMI or the account.

One thing version 2 does not change: there is one role per instance, shared by every process on it. The notes API runs as `notes`, a user with few privileges, and it can still obtain the same credentials by going through the token steps. Think of the permissions on an instance's role as permissions given to all the code that runs on that machine.

## Choosing an AMI

<!-- section: 23.ami -->

An AMI (Amazon Machine Image) is the template for an instance's first disk. This chapter uses the arm64 build of Amazon Linux 2023.

An AMI has an ID such as `ami-0123...`, which differs by Region and changes with every new release. Write the ID into code and it is out of date in no time. So AWS publishes "the ID of the newest AMI" as a public parameter in Parameter Store.

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{ami}

Synthesizing this puts one parameter of type `AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>` into the template. The value is looked up at deploy time, and synthesis asks AWS nothing. The test checks that the parameter is named `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64` and that synthesis leaves no lookup behind.

This took two stumbles to get right, with the pinned version (aws-cdk-lib 2.273.0).

First, the commonly shown `MachineImage.latestAmazonLinux2023()` ignores a `kernel` option and asks for the parameter of the 6.1 kernel. According to the Amazon Linux documentation, `kernel-default` has meant 6.18 since August 2026. Second, using `AmazonLinux2023ImageSsmParameter` directly instead makes it try, by default, to look the AMI up during synthesis, and synthesis fails for a stack without an account. It needs `cachedInContext: false`.

### "Latest" is a trigger for replacement

A handy mechanism, and a poor match for a machine that lives long.

When the AMI ID changes, the instance is **replaced**. The CloudFormation documentation lists a change to `ImageId` as Replacement, and the cdkd source treats it the same way. New AMIs come out often. In other words, deploying the same code as last month can swap the machine for a brand-new one. What was on the root volume goes away with the old instance. A comment in the CDK type definitions says as much: with this image, do not keep state on the instance.

That is why this chapter does two things. One is to keep data that must not be lost off the root volume (see "Data goes on a separate volume"). The other is to let you pin the AMI.

```bash
aws ssm get-parameter --region ap-northeast-1 --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text
vp run ec2:infra:deploy -c amiId=ami-xxxxxxxxxxxxxxxxx
```

The first line prints the current ID (it needs credentials). Pass it with `-c amiId=` and the template holds the ID itself, which does not change until you change it. For practice, "latest" is fine. For a machine you leave running, pin it and patch on your own schedule (see "Patching").

Either way, get into the habit of reading `vp run ec2:infra:diff` before a deploy. To be honest, whether cdkd's diff shows a change of the AMI behind the parameter as a replacement was not verified.

## What the first boot does

<!-- section: 23.user-data -->

A freshly started instance has no Node.js, no notes API, and no user to run it as. Providing them is the job of user data. Hand a shell script to the instance at launch and it runs as root on the first boot.

The script is put together by a TypeScript function.

<<< @/examples/23-ec2/src/user-data.ts{user-data}

It does five things: installs Node.js, creates a user with few privileges, writes the settings file, the systemd unit, and two scripts, enables the service, and prepares the data volume. The result is kept in `examples/23-ec2/deploy/user-data.sh`, so you can read exactly what runs without reading TypeScript.

The function is pure. Its only input is the settings: no clock, and no value that is decided at deploy time. The same settings always give the same script. What the tests read is therefore what the instance runs.

### Distrust every value that enters a root shell

User data runs as root. Settings are embedded in it as text, so if `; rm -rf /` or `$(...)` slips into a value, it is executed as written.

<<< @/examples/23-ec2/src/machine.ts{spec}

Every embedded value passes through this schema. Paths are letters, digits, `.`, `_`, and `-` only. Names are short strings that start with a lowercase letter. No quotes, no spaces, no line breaks. The tests confirm that with a dangerous value in any field, generating the script itself stops with an exception.

No secrets go in either. User data can be read through IMDS by any process on the instance, and from outside by anyone who may call `aws ec2 describe-instance-attribute`. This chapter's sample has no secrets, but if it had, this would not be the place for them. A test also checks that the settings file has exactly six entries: the allowed origin, the log level, the stage, the host, the port, and the path of the notes file.

### The limits of user data

Useful, and it hurts if you lean on it too much.

**It runs once.** On the first boot only. Fix the script and deploy later, and it does not run again on the running instance. As far as the cdkd source shows, a change to `UserData` does not even reach the instance. CloudFormation would restart the instance, and the script would still not run. To change how the machine is set up, you replace the instance or go in and change it by hand.

**Failures are hard to notice.** If the script dies on line 5, the instance is still running. As far as EC2 can tell, the operating system is up. This script uses `set -euo pipefail` so that it stops at the first failure: a stopped machine is easier to spot than a half-configured one. `vp run ec2:status` shows the result. The output stays in `/var/log/cloud-init-output.log` on the instance.

**16 KB at most.** The script is about 4 KB today. It is not a place to stuff application code.

That last point shapes the design. User data prepares the machine and does not install the application, because the application is something you replace many times. The way to replace it is built under "Deploying, and getting in".
