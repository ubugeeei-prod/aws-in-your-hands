---
title: "23 VM: Design and Build"
---

# 23 VM: Design and Build

The [previous page](/en/chapters/23-ec2.md) covered the cost and the overall layout. This page builds the way into the instance, its permissions, the AMI, and the script that runs on the first boot.

## No SSH port

<!-- section: 23.access -->

For a long time, getting into a server meant SSH. You opened port 22, handed out keys, and put a bastion host in front. This chapter does none of that, because an open port is a way in for attackers and a key you hand out stays on somebody's computer.

Session Manager, a part of Systems Manager, takes the place of SSH. A process called SSM Agent runs on the instance and keeps an HTTPS connection open toward Systems Manager. When you call `aws ssm start-session` on your machine, Systems Manager connects a shell through that connection. The instance is always the side that opens the connection, so no inbound rule is needed at all. IAM decides who may get in, and no key is involved.

Three things are required.

1. **SSM Agent.** The Amazon Linux 2023 AMIs that AWS publishes come with it installed
2. **Permissions.** The instance's role gets a managed policy called `AmazonSSMManagedInstanceCore`, which the next section covers
3. **A path to Systems Manager.** The path is the part that costs money

There are three ways to provide that path. The amounts are for one month with no traffic at all.

| Where the instance sits | The path to Systems Manager | Cost of the path |
| --- | --- | --- |
| Private subnet | Three interface endpoints (`ssm`, `ssmmessages`, `ec2messages`) | 61.32 |
| Private subnet | A NAT gateway | 48.91 (`-c egress=nat` in chapter 11) |
| Public subnet | The internet gateway, and a public IPv4 address on the instance | 3.65 |

Whichever you choose, the inbound rules stay empty. Even in a public subnet, nothing outside can open a connection to the instance.

### The default is the private subnet

For trying things out, the public subnet costs less than a fifth as much, so choosing the default was not easy.

Two reasons made the private subnet the default anyway. The first is that a machine with a public IPv4 address becomes reachable from outside as soon as one rule is added to its security group. The inbound rules are empty today, but the settings of a long-lived machine get changed by somebody sooner or later. The second is outbound traffic. An instance in a public subnet can reach anywhere on the internet on port 443, while an instance in the private subnet reaches Systems Manager and S3 and nothing else. That changes what an attacker can do after taking over software on the machine.

A machine that stays for a long time, and anything that runs as several machines as in chapter 24, normally goes into private subnets, and the default follows that practice. For a single pass through this chapter, `-c placement=public` is enough. The inbound rules are empty in that layout too, and a test pins that.

### Connecting to the chapter 11 VPC

You add the interface endpoints by changing a setting of the chapter 11 stack.

```bash
vp run net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages
```

As chapter 11 showed, `-c` applies to that one command only. If you later redeploy chapter 11 without `-c`, the endpoints are deleted and Systems Manager can no longer see this chapter's instance.

Whether all three endpoints are needed is not certain. The Systems Manager documentation lists the three, but the same page says that SSM Agent 3.3.40.0 and later uses `ssmmessages` in place of `ec2messages`. Leaving `ec2messages` out would save USD 20.44 a month. The page does not say that the endpoint may be omitted, however, and this was not tried on a real instance, so the chapter keeps all three.

On the instance's side, the code is only this.

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{network}

The missing `securityGroupIngress` is not an oversight. Leaving it out is the setting that allows no inbound traffic. The test checks that there is no inbound rule at all and that no SSH key pair is specified.

Outbound traffic is limited to port 443. A new security group starts with an outbound rule that allows all traffic to every destination, and writing one rule of your own replaces it. DNS, time synchronization, and the instance metadata covered in the next section are traffic that security groups do not inspect, so they work without a rule.

### What happens without a path

A missing path is the easiest way to get stuck in this chapter. If you forget the endpoints, the deploy still succeeds, the instance starts, and its state is running. It never appears in Systems Manager, though, and no error shows up anywhere.

For that reason you can check on your machine, before deploying, whether the path exists. The check uses the route model from chapter 11 unchanged.

<<< @/examples/23-ec2/src/access.ts{access}

Give `vp run ec2:plan` the settings you deploy chapter 11 with.

```bash
vp run ec2:plan interfaceEndpoints=ssm
```

`ssmmessages` and `ec2messages` are reported as `UNREACHABLE`, and the task ends in failure. The path to S3 is the gateway endpoint that chapter 11 creates by default. It is free, and it carries operating system packages, SSM Agent updates, and this chapter's releases.

It was not verified that the Amazon Linux 2023 package repositories can be reached from a private subnet through the S3 gateway endpoint alone. That the repositories are S3 buckets was itself only inferred from host names in sample output in the documentation. If the repositories cannot be reached, Node.js is not installed on the first boot and the user data script fails. [Where people get stuck](/en/chapters/23-ec2/wrap.md) explains how to investigate that.

## The instance fetches its permissions from inside

<!-- section: 23.role -->

A Lambda function had an execution role, and an instance is given a role in the same way.

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{role}

EC2 cannot take a role directly. You put one role into a container called an instance profile and attach the profile to the instance. CDK's higher-level constructs create the profile for you, but the stack writes it out so that you can see what is created.

`AmazonSSMManagedInstanceCore` is a policy that AWS maintains. Every statement in it applies to `"Resource": "*"`, and `ssm:GetParameter` is among its actions. A process on this instance can therefore read values from the account's Parameter Store if it tries. The book has avoided `*` since chapter 04, and this is an exception because the AWS policy is used as it is. The stack adds one permission of its own, which is to read under `releases/` in the bucket that holds releases.

### Where the credentials come from

The AWS CLI and the SDKs work on the instance without any access key being configured, because they get credentials from IMDS, the Instance Metadata Service. The address `169.254.169.254` is reachable only from inside the instance, and a request to it returns temporary credentials for the role. The credentials expire and are replaced automatically. This mechanism is why no key has to be stored on the disk.

The weak point is that anything running on the instance can query that address. Suppose the application has a feature that fetches the content of a URL the user supplies. Given `http://169.254.169.254/...` as the URL, the application might fetch the credentials and return them in its response.

IMDS has two versions. Version 1 answers a plain GET, so the attack just described works as is. In version 2 you first obtain a token with a PUT and then send it in a header with each request. A hole that only lets an attacker make the application GET one URL allows neither the PUT nor the added header. A PUT that carries an `X-Forwarded-For` header is also rejected, so requests relayed through a proxy do not get through.

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{instance}

`httpTokens: "required"` makes the instance accept version 2 only. `httpPutResponseHopLimit` sets how many network hops the response that carries the token may travel, and with 1 it reaches only the instance itself. Set it to 2 when you run containers on the instance and want them to use the role. The Amazon Linux 2023 AMI is said to launch with version 2 required and a hop limit of 2 even when nothing is specified, but the stack writes the values in code instead of relying on the defaults of the AMI or the account.

Version 2 does not change the fact that an instance has one role, shared by every process on it. The notes API runs as `notes`, a user with few privileges, and it can still obtain the same credentials by following the token steps. Treat the permissions on an instance's role as permissions given to all the code that runs on that machine.

## Choosing an AMI

<!-- section: 23.ami -->

An AMI (Amazon Machine Image) is the template that becomes the contents of an instance's first disk. This chapter uses the arm64 build of Amazon Linux 2023.

An AMI has an ID such as `ami-0123...`. The ID differs by Region and changes with every new release, so an ID written into code is soon out of date. AWS therefore publishes the ID of the newest AMI as a public parameter in Parameter Store.

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{ami}

Synthesizing the template from this code produces one parameter of type `AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>`. The value is looked up at deploy time, and synthesis asks AWS nothing. The test checks that the parameter is named `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64` and that synthesis leaves no lookup behind.

Arriving at this code took two failed attempts with the pinned version, aws-cdk-lib 2.273.0.

First, the commonly shown `MachineImage.latestAmazonLinux2023()` ignores the `kernel` option and uses the parameter for the 6.1 kernel. According to the Amazon Linux documentation, `kernel-default` has meant 6.18 since August 2026. Second, when you use `AmazonLinux2023ImageSsmParameter` directly instead, it tries by default to look the AMI up during synthesis, and synthesis fails for a stack that has no account specified. `cachedInContext: false` avoids that.

### "Latest" causes replacements

Looking up the newest ID is convenient, but it does not suit a machine that runs for a long time.

When the AMI ID changes, the instance is **replaced**. The CloudFormation documentation lists a change to `ImageId` as Replacement, and the cdkd source treats it the same way. New AMIs are released often, so deploying the same code as last month can swap the machine for a new one. When that happens, the contents of the root volume are lost with the old instance. A comment in the CDK type definitions also says not to keep state on the instance when you use this image.

For that reason this chapter keeps data that must not be lost off the root volume ([Data goes on a separate volume](/en/chapters/23-ec2/more.md)). It also lets you pin the AMI.

```bash
aws ssm get-parameter --region ap-northeast-1 --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text
vp run ec2:infra:deploy -c amiId=ami-xxxxxxxxxxxxxxxxx
```

The first line prints the current ID (it needs credentials). When you pass that ID with `-c amiId=`, the template contains the ID itself, and it stays the same until you change it. For practice, "latest" is fine. For a machine you leave running, pin the AMI and patch on your own schedule ([Patching](/en/chapters/23-ec2/deploy.md)).

In both cases, make a habit of reading `vp run ec2:infra:diff` before a deploy. Whether cdkd's diff shows a change of the AMI behind the parameter as a replacement was not verified.

## What the first boot does

<!-- section: 23.user-data -->

A freshly started instance has no Node.js, no notes API, and no user to run the API as. User data provides them. If you hand a shell script to the instance when you create it, the script runs as root on the first boot.

A TypeScript function assembles the script.

<<< @/examples/23-ec2/src/user-data.ts{user-data}

The script installs Node.js, creates a user with few privileges, writes the settings file, the systemd unit, and two scripts, enables the service, and finally prepares the data volume. The assembled result is kept in `examples/23-ec2/deploy/user-data.sh`, so you can read exactly what runs without reading the TypeScript.

The function is pure, and its only input is the settings. Neither the clock nor any value decided at deploy time goes in, so the same settings always produce the same script. What the tests read is therefore what runs on the instance.

### Distrust every value that enters a root shell

User data runs as root. Settings are embedded in it as text, so a value that contains `; rm -rf /` or `$(...)` would be executed as written.

<<< @/examples/23-ec2/src/machine.ts{spec}

Every embedded value passes through this schema. Paths may contain only letters, digits, `.`, `_`, and `-`, and names must be short strings that start with a lowercase letter. Quotes, spaces, and line breaks cannot get in. The tests confirm that a dangerous value in any field makes script generation stop with an exception.

Secrets are kept out as well. Any process on the instance can read user data through IMDS, and so can anyone outside who is allowed to call `aws ec2 describe-instance-attribute`. This chapter's sample has no secrets, but if it had any, user data would be the wrong place for them. A test also checks that the settings file has exactly six entries, which are the allowed origin, the log level, the stage, the host, the port, and the path of the notes file.

### The limits of user data

Relying on user data too much causes trouble in three ways.

First, it runs once, on the first boot. If you fix the script later and deploy, it does not run again on the running instance. As far as the cdkd source shows, a change to `UserData` does not even reach the instance. CloudFormation would restart the instance, and the script would still not run. To change how the machine is set up, you replace the instance or go in and change it by hand.

Second, failures are hard to notice. If the script fails on line 5, the instance still shows as running, because from EC2's point of view the operating system is up. The script in this chapter sets `set -euo pipefail` so that it stops at the first failure, since a machine that stopped partway is easier to spot than one that is half configured. `vp run ec2:status` shows the result, and the output stays in `/var/log/cloud-init-output.log` on the instance.

Third, user data is limited to 16 KB. The script is about 4 KB today, and user data is not a place to put application code.

The third limit shapes the design. User data prepares the machine and does not install the application, because the application is something you replace many times. [Deploying, and getting into the instance](/en/chapters/23-ec2/deploy.md) builds the procedure for replacing it.
