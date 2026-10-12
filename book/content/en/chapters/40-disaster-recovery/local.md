---
title: "40 Disaster Recovery: Run It Locally"
---

# 40 Disaster Recovery: Run It Locally

## Run it locally

<!-- section: 40.local -->

DRS itself does not run on a laptop. The agent, the replication server, and the snapshots exist only inside AWS. What you can check locally is the decisions you make around it. No AWS account is needed.

```bash
vp run dr:demo
```

It builds two sites in memory and goes through a failover and a failback twice. The first failback only overwrites the original server with the recovery side's contents. The second stops the original server first, then counts and records the writes that exist only there. In the first, two notes disappear without leaving a record. After that it shows a recovery order failing in the middle and being run again, and the summary of a drill whose instance launched but whose notes were never checked.

<<< @/examples/40-disaster-recovery/scripts/demo.ts{demo}

The times it prints were chosen for the explanation. Nothing was launched and measured.

The tests and the other tasks are these.

```bash
vp run test:unit
vp run dr:plan kernel=6.1
vp run dr:infra:synth
vp run dr:infra:synth -c placement=public
```

`dr:plan` prints the source's conditions, the paths, the cost, and the steps to perform through the API. `dr:infra:synth` writes the stack's template to `examples/40-disaster-recovery/cdk.out/`. Neither asks AWS anything.

The tests check the following.

- The drill plan: a server whose lag exceeds the RPO, a server that reports no lag, a server whose initial sync has not finished, a time older than the retention
- The drill verdict: incomplete when one check is missing, failed when one check failed
- The recovery order: a failure in the middle, a second run, an answer that was lost
- The two sites: replication lag, split brain, and no silently lost write after failback
- Events: the shapes of the documented samples, and refusal of an unknown state
- The still-billed list: telling a drill instance from the instance of a real recovery
- The stack: the agent's permissions, where the endpoints go, and no DRS resource declared by default

To be plain about what is not reproduced locally: how long replication takes, real lag values, how long a launch takes, whether conversion succeeds, and whether the agent runs on the chapter 23 instance can only be learned on AWS. Passing tests show that the decision code does what it was written to do, and nothing more.
