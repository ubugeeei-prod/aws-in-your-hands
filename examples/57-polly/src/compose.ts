import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import { createLogger } from "@aih/example-04-http-api/src/log.ts";

import { createApp } from "./app.ts";
import type { AudioCache } from "./audio-cache.ts";
import type { Env } from "./env.ts";
import { createSpeaker } from "./speak.ts";
import type { Synthesizer } from "./synthesizer.ts";

// #region compose
/** The one place that touches the real clock and real timers. */
export function composeApp(env: Env, cache: AudioCache, synthesize: Synthesizer): Fetch {
  return createApp({
    stage: env.STAGE,
    backend: env.SPEECH_BACKEND,
    cache,
    speak: createSpeaker({
      cache,
      synthesize,
      now: Date.now,
      sleep: (ms) => sleep(ms).then(() => undefined),
    }),
    log: createLogger(env.LOG_LEVEL),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
// #endregion compose
