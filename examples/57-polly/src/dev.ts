import { PollyClient } from "@aws-sdk/client-polly";
import { S3Client } from "@aws-sdk/client-s3";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

import { composeApp } from "./compose.ts";
import { parseEnv } from "./env.ts";
import { fakeSynthesizer } from "./fake-synthesizer.ts";
import { InMemoryAudioCache } from "./memory-audio-cache.ts";
import { createPollySynthesizer } from "./polly.ts";
import { S3AudioCache } from "./s3-audio-cache.ts";

// #region dev
const env = parseEnv(process.env);
const port = Number(process.env["PORT"] ?? 8857);
const origin = `http://localhost:${port}`;

let app;
if (env.SPEECH_BACKEND === "polly") {
  // This server runs here. The voice does not: every new text is a billed call to Polly.
  app = composeApp(
    env,
    new S3AudioCache(new S3Client({ region: env.AWS_REGION }), env.SPEECH_BUCKET),
    createPollySynthesizer(new PollyClient({ region: env.AWS_REGION })),
  );
  console.log(
    `speech: REMOTE and BILLED. Polly in ${env.AWS_REGION}, audio in ${env.SPEECH_BUCKET}`,
  );
} else {
  const memory = new InMemoryAudioCache(origin);
  const speech = composeApp(env, memory, fakeSynthesizer);
  const AUDIO = new URLPattern({ pathname: "/local/audio/:prefix/:hash" });
  // The stand-in for S3's side of a view URL.
  app = (request: Request) => {
    const match = AUDIO.exec(request.url);
    if (request.method !== "GET" || match === null) {
      return speech(request);
    }
    const { prefix, hash } = match.pathname.groups;
    const object = memory.get(`${prefix}/${hash}`);
    return object === undefined
      ? new Response(null, { status: 404 })
      : new Response(Buffer.from(object.body), { headers: { "content-type": object.contentType } });
  };
  console.log("speech: none. A tone stands in for the voice. No AWS call, no charge");
}

// Loopback only: with SPEECH_BACKEND=polly, anyone who can reach this port spends your money.
nodeServer(app).listen(port, "127.0.0.1", () => {
  console.log(`speech API on ${origin}`);
});
// #endregion dev
