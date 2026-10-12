---
title: "24 Self-hosting: Run It Locally"
---

# 24 Self-hosting: Run It Locally

## What you can check locally, and what you cannot

<!-- section: 24.local -->

You can run the following tasks locally without creating anything on AWS.

```bash
vp run test:unit
vp run celld:plan nodes=3
vp run celld:render
vp run celld:infra:synth -c nodes=3
vp run celld:fetch
```

The tests check four things.

- What the stack creates. By default there are zero resources billed by the hour, the only inbound rule is the one from the group itself, IMDSv2 is required, the buckets and volumes are retained, and the role contains no `*`
- The unit and the install script. You cannot produce a configuration that breaks celld's two requirements (the restart delay and the stop timeout), and an archive with the wrong digest is refused. The second test runs the real script under bash
- The order of an upgrade, explained under "Make it a fleet, and replace nodes one at a time" on the [Deploy](/en/chapters/24-celld/deploy.md) page
- The verdict of the check after a node is lost, explained under "Losing a node" on the same page

The local tests cannot check celld itself. celld has a command, `celld dev`, that runs a single node without a cloud bucket, and it looks like the right place to start when you write an application. The binary was not run while writing this chapter, though, so I cannot say what it is like to use.
