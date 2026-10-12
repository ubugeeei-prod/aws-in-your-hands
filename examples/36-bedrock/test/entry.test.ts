import { PassThrough } from "node:stream";

import type { Context, LambdaFunctionURLEvent } from "aws-lambda";
import { describe, expect, it } from "vite-plus/test";

import type { Awslambda, Prelude, ResponseStream } from "@aih/example-17-ai/src/function-url.ts";

import { parseEnv } from "../src/env.ts";
import { streamWithEvent } from "../src/function-url.ts";
import { identityFromFunctionUrl } from "../src/identity.ts";
import { daysUntilEarliestEol, modelProfiles } from "../src/models.ts";
import { HAIKU, NOVA } from "./helpers.ts";

const event = (iam: unknown) =>
  ({
    version: "2.0",
    rawPath: "/me",
    rawQueryString: "",
    headers: {},
    isBase64Encoded: false,
    requestContext: {
      http: { method: "GET", path: "/me" },
      domainName: "abc.lambda-url.ap-northeast-1.on.aws",
      authorizer: iam === undefined ? undefined : { iam },
    },
  }) as unknown as LambdaFunctionURLEvent;

describe("identityFromFunctionUrl", () => {
  it("takes the signer's ID from where Lambda wrote it", () => {
    const iam = {
      accountId: "111122223333",
      userArn: "arn:aws:iam::111122223333:user/dev",
      userId: "AIDAEXAMPLE",
    };
    expect(identityFromFunctionUrl(event(iam))).toEqual({ sub: "AIDAEXAMPLE" });
  });

  it("is nobody when the event names no signer", () => {
    expect(identityFromFunctionUrl(event(undefined))).toBeUndefined();
    expect(identityFromFunctionUrl(event({ userId: "" }))).toBeUndefined();
    expect(identityFromFunctionUrl({})).toBeUndefined();
  });
});

describe("streamWithEvent", () => {
  it("hands the app the event of this invocation, and writes the answer through chapter 17's adapter", async () => {
    const preludes: Prelude[] = [];
    let marked = 0;
    const runtime: Awslambda = {
      streamifyResponse: (handler) => {
        marked += 1;
        return handler;
      },
      HttpResponseStream: {
        from: (stream, prelude) => {
          preludes.push(prelude);
          return stream;
        },
      },
    };
    const seen: unknown[] = [];
    const handler = streamWithEvent((_request, outside) => {
      seen.push(outside?.event);
      return Promise.resolve(
        Response.json({ sub: identityFromFunctionUrl(outside?.event)?.sub ?? null }),
      );
    }, runtime);

    for (const userId of ["AIDAONE", "AIDATWO"]) {
      const out = new PassThrough() as unknown as ResponseStream;
      const chunks: Buffer[] = [];
      out.on("data", (chunk: Buffer) => chunks.push(chunk));
      await handler(event({ userId }), out, {} as Context);
      expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual({ sub: userId });
    }
    expect(seen).toHaveLength(2);
    expect(preludes.map((prelude) => prelude.statusCode)).toEqual([200, 200]);
    // The handler is marked once, when it is made, not once per invocation.
    expect(marked).toBe(1);
  });
});

describe("the environment", () => {
  const base = { AI_BACKEND: "scripted", BEDROCK_MODEL_ID: NOVA };

  it("lets in only a model whose abilities and prices are written down", () => {
    expect(parseEnv(base).BEDROCK_MODEL_ID).toBe(NOVA);
    expect(() => parseEnv({ ...base, BEDROCK_MODEL_ID: "amazon.nova-9-v1:0" })).toThrow(
      /models\.ts/,
    );
    expect(() => parseEnv({ BEDROCK_MODEL_ID: NOVA })).toThrow(/AI_BACKEND/);
  });

  it("wants a guardrail's ID and version together", () => {
    expect(() => parseEnv({ ...base, GUARDRAIL_ID: "gr1abcd2ef" })).toThrow(/go together/);
    expect(() =>
      parseEnv({ ...base, GUARDRAIL_ID: "gr1abcd2ef", GUARDRAIL_VERSION: "DRAFT" }),
    ).toThrow();
    expect(
      parseEnv({ ...base, GUARDRAIL_ID: "gr1abcd2ef", GUARDRAIL_VERSION: "2" }).GUARDRAIL_VERSION,
    ).toBe("2");
  });

  it("keeps the turn limit within what the cache marks allow", () => {
    expect(() => parseEnv({ ...base, MAX_TURNS: "5" })).toThrow(/MAX_TURNS/);
    expect(parseEnv(base)).toMatchObject({
      MAX_TURNS: 4,
      MAX_OUTPUT_TOKENS: 600,
      PROMPT_CACHE: "off",
    });
  });
});

describe("model profiles", () => {
  it("records how each model returns JSON, as its card says today", () => {
    expect(modelProfiles[NOVA].structuredOutput).toBe("forced_tool");
    expect(modelProfiles[HAIKU].structuredOutput).toBe("json_schema");
  });

  it("counts the days to the earliest end of life", () => {
    const today = new Date("2026-10-13T00:00:00Z");
    expect(daysUntilEarliestEol(modelProfiles[HAIKU], today)).toBe(3);
    expect(daysUntilEarliestEol(modelProfiles[NOVA], today)).toBe(50);
    expect(
      daysUntilEarliestEol(modelProfiles[HAIKU], new Date("2026-10-20T00:00:00Z")),
    ).toBeLessThan(0);
  });
});
