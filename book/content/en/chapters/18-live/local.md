---
title: "18 Live Streaming: Run It Locally"
---

# 18 Live Streaming: Run It Locally

## What you can check locally

<!-- section: 18.local -->

Live streaming can't be completed on your machine alone, because the place that receives video exists only in AWS. Even so, a good part of it can be checked locally.

```bash
vp run test:unit
vp run stream:infra:synth
vp run dev:stream:web
```

`dev:stream:web` serves the player page at <http://localhost:5183>. There's no channel yet, so it only says "No channel is configured." That is the correct behavior.

Here's what the tests look at.

| Where | File | What it checks |
| --- | --- | --- |
| Channel settings | `test/channel.test.ts` | Whether bitrate and resolution fit the type's limits. That no key ends up in the server URL |
| Stream state | `test/stream.test.ts` | That "offline" and "unknown" are never mixed up. How input time is counted |
| Events | `test/events.test.ts`, `test/timeline.test.ts` | Event shapes. That reordering and duplicates don't change the conclusion |
| Player page | `web/src/viewer.test.ts` | That 404 is treated as offline. Retry intervals. Config validation |
| Infrastructure | `infra/test/live-stack.test.ts` | That the key's value never appears in the template. Permissions, no recording, deletion settings, resource types |

Let's also be clear about what isn't reproduced locally.

- **Actual broadcasting and viewing.** Whether video arrives, how many seconds behind it is, whether the player really plays it
- **The real responses of the IVS API.** The schemas for the `GetStream` response and the events are written from the documentation's examples
- **IAM.** The scripts run with your own permissions
- **OBS settings.** That's manual work

Honestly, this chapter has not yet broadcast a single stream on a real account. What was checked locally is summarized at the end of the chapter.
