---
title: "11 Network: Run It Locally"
---

# 11 Network: Run It Locally

## Check it on your machine

<!-- section: 11.local -->

People tend to think you can learn nothing about a network without deploying it. The address allocation, the routes, and the costs decided up to [Design and Build](/en/chapters/11-network/build.md) can all be checked on your machine, without an AWS account.

```bash
vp run net:plan
```

This task builds the plan from the settings and prints the subnets, the routes, the hourly-billed parts, and the monthly cost.

<<< @/examples/11-network/src/report.ts{report}

The same task shows what a different layout would do.

```bash
vp run net:plan egress=nat
vp run net:plan interfaceEndpoints=ecr.api,ecr.dkr,logs
vp run net:plan cidr=10.20.0.0/24 subnetPrefix=26
```

The monthly cost is on your screen before you add a NAT gateway, so the bill is not the first place you learn it.

These tasks run the tests and synth.

```bash
vp run test:unit
vp run net:infra:synth
```

The stack tests check that the template of the default layout has no NAT gateway and no Elastic IP address. If someone changes a default and an hourly-billed resource slips in, this test fails. They also check that only public route tables have a route to the internet, that the gateway endpoints are attached to the private route tables only, that no resource is kept when the stack is destroyed, and that synth asks AWS nothing.

Some things can't be reproduced on your machine.

- Whether packets actually arrive. The model looks at route tables only
- How security groups and network ACLs are evaluated
- DNS resolution for interface endpoints
- Whether those zone names are usable in your account
- That cdkd can create the resources as the template says
