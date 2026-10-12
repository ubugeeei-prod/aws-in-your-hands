---
title: "23 VM: Run It Locally"
---

# 23 VM: Run It Locally

## Checking it on your machine

<!-- section: 23.local -->

The chapter so far has built things that run on an EC2 instance, but most of them can be checked on your own machine. No AWS account is needed.

Copy `examples/23-ec2/.env.example` to `.env` in the same directory and start the API.

```bash
vp run dev:ec2
```

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/notes
```

Stop it with Ctrl+C, start it again, and run the second line. The note is still there, which is the difference from `dev:api` in chapter 04. The notes file is created at `examples/23-ec2/.data/notes.json`.

These are the tests and the other tasks.

```bash
vp run test:unit
vp run ec2:plan
vp run ec2:render
vp run ec2:app:build
vp run ec2:infra:synth
```

`ec2:render` checks that the unit and scripts kept in `deploy/` match what the current code generates. If they differ, rewrite them with `vp run ec2:render --write` and read the diff. The task exists so that everything that runs as root on the instance is in the repository in a form that can be reviewed.

`ec2:app:build` bundles the API into one JavaScript file (`dist/server.mjs`). No `node_modules` directory is put on the instance.

The table lists what the tests check and what they do not.

| Where | What it sees | What it does not see |
| --- | --- | --- |
| `test/file-notes.test.ts` | The file and memory when a write stops at each step | A real disk and a real power loss |
| `test/shutdown.test.ts` | The order of events after SIGTERM, over a real socket | systemd sending the signal |
| `test/machine.test.ts` | The contents of the unit and user data, injection refused, that it parses as bash | That it runs on Amazon Linux 2023 |
| `test/data-volume.test.ts` | The script's decision whether to format | The real `blkid` and `mkfs` |
| `test/remote.test.ts` | How commands for the instance are built | Systems Manager delivering them |
| `infra/test/ec2-stack.test.ts` | Empty inbound rules, IMDSv2, permissions, volume settings | AWS behaving as the template says |

Everything in the right column can be checked only on a real instance, and this chapter has not been run on one yet. The commands on the [next page](/en/chapters/23-ec2/deploy.md) are prepared but have not been executed.
