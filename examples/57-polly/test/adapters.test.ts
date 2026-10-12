import { type PollyClient, PollyServiceException } from "@aws-sdk/client-polly";
import {
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vite-plus/test";

import { createPollySynthesizer } from "../src/polly.ts";
import { S3AudioCache } from "../src/s3-audio-cache.ts";
import { SpeechThrottled } from "../src/synthesizer.ts";

// Nothing here reaches AWS. These show what S3 and Polly are asked, and how their documented
// answers are read. They do not show that S3 enforces a condition.

type Sent = { name: string; input: Record<string, unknown> };

/** A client whose `send` answers from a script instead of from the network. */
function scripted<Client>(answers: (unknown | Error)[]) {
  const sent: Sent[] = [];
  const client = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input });
      const answer = answers.shift();
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  } as unknown as Client;
  return { client, sent };
}

const s3Error = (name: string, status: number) =>
  new S3ServiceException({
    name,
    $fault: "client",
    $metadata: { httpStatusCode: status },
    message: name,
  });
const BODY = new Uint8Array([1, 2, 3]);

describe("the bucket as a cache", () => {
  it("creates with If-None-Match, so S3 decides between two writers", async () => {
    const { client, sent } = scripted<S3Client>([{ ETag: '"abc"' }]);
    const result = await new S3AudioCache(client, "cache").create("speech/k", BODY, "audio/mpeg");
    expect(result).toEqual({ created: true, etag: '"abc"' });
    expect(sent).toEqual([
      {
        name: PutObjectCommand.name,
        input: {
          Bucket: "cache",
          Key: "speech/k",
          Body: BODY,
          ContentType: "audio/mpeg",
          IfNoneMatch: "*",
        },
      },
    ]);
  });

  it("reads 412 and 409 as: someone else wrote, or is writing", async () => {
    for (const error of [
      s3Error("PreconditionFailed", 412),
      s3Error("ConditionalRequestConflict", 409),
    ]) {
      const { client } = scripted<S3Client>([error, error]);
      const cache = new S3AudioCache(client, "cache");
      expect(await cache.create("claims/k", BODY, "application/json")).toEqual({ created: false });
      expect(await cache.replace("claims/k", '"old"', BODY, "application/json")).toEqual({
        replaced: false,
      });
    }
  });

  it("replaces with If-Match on the ETag it read", async () => {
    const { client, sent } = scripted<S3Client>([{ ETag: '"new"' }]);
    const result = await new S3AudioCache(client, "cache").replace(
      "claims/k",
      '"old"',
      BODY,
      "application/json",
    );
    expect(result).toEqual({ replaced: true, etag: '"new"' });
    expect(sent[0]?.input).toMatchObject({ IfMatch: '"old"' });
    expect(sent[0]?.input).not.toHaveProperty("IfNoneMatch");
  });

  it("does not take a claim that was deleted in between", async () => {
    const { client } = scripted<S3Client>([s3Error("NoSuchKey", 404)]);
    expect(
      await new S3AudioCache(client, "cache").replace("claims/k", '"old"', BODY, "text/plain"),
    ).toEqual({ replaced: false });
  });

  it("does not mistake an access error for a lost race", async () => {
    const { client } = scripted<S3Client>([
      s3Error("AccessDenied", 403),
      s3Error("AccessDenied", 403),
    ]);
    const cache = new S3AudioCache(client, "cache");
    await expect(cache.create("speech/k", BODY, "audio/mpeg")).rejects.toThrow("AccessDenied");
    await expect(cache.exists("speech/k")).rejects.toThrow("AccessDenied");
  });

  it("answers absent for a 404, on HEAD and on GET", async () => {
    const { client, sent } = scripted<S3Client>([
      new NotFound({ $metadata: { httpStatusCode: 404 }, message: "NotFound" }),
      new NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: "NoSuchKey" }),
      {},
    ]);
    const cache = new S3AudioCache(client, "cache");
    expect(await cache.exists("speech/k")).toBe(false);
    expect(await cache.read("claims/k")).toBeUndefined();
    expect(await cache.exists("speech/k")).toBe(true);
    expect(sent[0]?.name).toBe(HeadObjectCommand.name);
  });

  it("signs a view URL for one key, for a limited time, without calling S3", async () => {
    const client = new S3Client({
      region: "ap-northeast-1",
      credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "not-a-real-secret" },
    });
    const url = new URL(await new S3AudioCache(client, "cache").presignView("speech/k", 3600));
    expect(url.pathname).toBe("/speech/k");
    expect(url.hostname).toBe("cache.s3.ap-northeast-1.amazonaws.com");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });
});

describe("Polly as the synthesizer", () => {
  const audio = { transformToByteArray: async () => BODY };

  it("sends SSML, the voice, and the engine this app fixed for that voice", async () => {
    const { client, sent } = scripted<PollyClient>([
      { AudioStream: audio, ContentType: "audio/mpeg", RequestCharacters: 6 },
      { AudioStream: audio, ContentType: "audio/mpeg", RequestCharacters: 6 },
    ]);
    const synthesize = createPollySynthesizer(client);
    const speech = await synthesize({ ssml: "<speak>牛乳を買う。</speak>", voice: "Kazuha" });
    await synthesize({ ssml: "<speak>牛乳を買う。</speak>", voice: "Mizuki" });

    expect(speech).toEqual({ audio: BODY, contentType: "audio/mpeg", characters: 6 });
    expect(sent.map((command) => command.input)).toEqual([
      {
        Engine: "neural",
        VoiceId: "Kazuha",
        OutputFormat: "mp3",
        TextType: "ssml",
        Text: "<speak>牛乳を買う。</speak>",
      },
      {
        Engine: "standard",
        VoiceId: "Mizuki",
        OutputFormat: "mp3",
        TextType: "ssml",
        Text: "<speak>牛乳を買う。</speak>",
      },
    ]);
  });

  it("turns what the SDK marks as throttling into SpeechThrottled, and nothing else", async () => {
    const throttle = Object.assign(
      new PollyServiceException({
        name: "ThrottlingException",
        $fault: "client",
        $metadata: { httpStatusCode: 400 },
        message: "Rate exceeded",
      }),
      { $retryable: { throttling: true } },
    );
    const invalid = new PollyServiceException({
      name: "InvalidSsmlException",
      $fault: "client",
      $metadata: { httpStatusCode: 400 },
      message: "Invalid SSML request",
    });
    const { client } = scripted<PollyClient>([throttle, invalid, {}]);
    const synthesize = createPollySynthesizer(client);
    const input = { ssml: "<speak>a</speak>", voice: "Kazuha" } as const;
    await expect(synthesize(input)).rejects.toBeInstanceOf(SpeechThrottled);
    await expect(synthesize(input)).rejects.toThrow("Invalid SSML request");
    await expect(synthesize(input)).rejects.toThrow("no audio");
  });
});
