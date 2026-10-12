---
title: "18 Live Streaming: Run It Locally"
---

# 18 Live Streaming: Run It Locally

## What you can check locally

<!-- section: 18.local -->

The place that receives video exists only in AWS, so you cannot run live streaming end to end on your machine. You can still check a good part of it locally.

```bash
vp run test:unit
vp run stream:infra:synth
vp run dev:stream:web
```

`dev:stream:web` serves the viewing page at <http://localhost:5183>. No channel exists yet, so the page only says "No channel is configured," and that is the correct behavior.

The tests check the following.

| Where | File | What it checks |
| --- | --- | --- |
| Channel settings | `test/channel.test.ts` | Whether bitrate and resolution fit the type's limits. That no key ends up in the server URL |
| Stream state | `test/stream.test.ts` | That "offline" and "unknown" are never mixed up. How input time is counted |
| Events | `test/events.test.ts`, `test/timeline.test.ts` | Event shapes. That reordering and duplicates don't change the conclusion |
| Viewing page | `web/src/viewer.test.ts` | That 404 is treated as offline. Retry intervals. Config validation |
| Infrastructure | `infra/test/live-stack.test.ts` | That the key's value never appears in the template. Permissions, no recording, deletion settings, resource types |

Four things cannot be reproduced locally.

- Actual broadcasting and viewing. Whether video arrives, how many seconds behind it is, and whether the player really plays it cannot be known on your machine
- The real responses of the IVS API. The schemas for the `GetStream` response and the events are written from the examples in the documentation
- IAM. The scripts run with your own permissions
- OBS settings. You enter them by hand

This chapter has not yet broadcast a single stream on a real account. What was checked locally is listed in "Verification notes for this chapter," at the end of the [costs, pitfalls, and cleanup page](/en/chapters/18-live/wrap.md).
