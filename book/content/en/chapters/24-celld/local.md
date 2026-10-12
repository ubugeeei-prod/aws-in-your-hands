---
title: "24 Self-hosting: Run It Locally"
---

# 24 Self-hosting: Run It Locally

## What you can check locally, and what you cannot

<!-- section: 24.local -->

```bash
vp run test:unit
vp run celld:plan nodes=3
vp run celld:render
vp run celld:infra:synth -c nodes=3
vp run celld:fetch
```

The tests check the following.

- What the stack creates: no hourly resource by default, one inbound rule from the group itself, IMDSv2 required, buckets and volumes set to stay, no `*` in the role
- The unit and the install script: celld's two requirements (restart delay and stop grace) cannot be broken, and an archive with the wrong digest is refused (the real script, run by bash)
- The order of an upgrade. The section after next
- The judging of the check that loses a node. The section after that

What cannot be checked is celld itself. celld has a command, `celld dev`, that runs one node without a cloud bucket. If you write an application, that looks like the place to start. But this chapter was written without running the binary, so I cannot tell you what it is like.
