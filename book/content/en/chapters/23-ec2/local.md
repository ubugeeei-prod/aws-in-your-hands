---
title: "23 VM: Run It Locally"
---

# 23 VM: Run It Locally

## Checking it on your machine

<!-- section: 23.local -->

This has been all about a machine, yet most of it can be checked on yours. No AWS account is needed.

Copy `examples/23-ec2/.env.example` to `.env` in the same directory and start it.

```bash
vp run dev:ec2
```

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/notes
```

Stop it with Ctrl+C, start it again, and run the second line. The note is still there. That is the difference from `dev:api` in chapter 04. The file appears at `examples/23-ec2/.data/notes.json`.

The tests and the other tasks:

```bash
vp run test:unit
vp run ec2:plan
vp run ec2:render
vp run ec2:app:build
vp run ec2:infra:synth
```

`ec2:render` checks that the unit and scripts kept in `deploy/` match what the current code generates. If they differ, `vp run ec2:render --write` rewrites them, and you read the diff. The task keeps things that will run as root on the instance in the repository in a form that can be reviewed.

`ec2:app:build` bundles the API into one JavaScript file (`dist/server.mjs`). No `node_modules` goes onto the instance.

Here is what the tests see and what they do not.

| Where | What it sees | What it does not see |
| --- | --- | --- |
| `test/file-notes.test.ts` | The file and memory when a write stops at each step | A real disk and a real power loss |
| `test/shutdown.test.ts` | The order of events after SIGTERM, over a real socket | systemd sending the signal |
| `test/machine.test.ts` | The contents of the unit and user data, injection refused, that it parses as bash | That it runs on Amazon Linux 2023 |
| `test/data-volume.test.ts` | The script's decision: format or not | The real `blkid` and `mkfs` |
| `test/remote.test.ts` | How commands for the instance are built | Systems Manager delivering them |
| `infra/test/ec2-stack.test.ts` | Empty inbound, IMDSv2, permissions, volume settings | AWS behaving as the template says |

Everything in the right column can only be checked on a real instance. And this chapter has not been through a real instance yet. The commands in the next section are prepared, and that is all.
