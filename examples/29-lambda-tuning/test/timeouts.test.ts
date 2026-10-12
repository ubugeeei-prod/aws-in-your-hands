import { describe, expect, it } from "vite-plus/test";

import {
  ANSWER_MARGIN_MS,
  checkHttpChain,
  checkQueueChain,
  FUNCTION_TIMEOUT_SECONDS,
  HTTP_API_INTEGRATION_SECONDS,
  type HttpChain,
  SDK,
} from "../src/timeouts.ts";

const chapter: HttpChain = {
  callerSeconds: HTTP_API_INTEGRATION_SECONDS,
  functionSeconds: FUNCTION_TIMEOUT_SECONDS,
  answerMarginMs: ANSWER_MARGIN_MS,
  sdk: SDK,
};
const rules = (chain: HttpChain) => checkHttpChain(chain).map((finding) => finding.rule);

describe("the timeouts behind the HTTP API", () => {
  it("are in order as this chapter sets them", () => {
    expect(checkHttpChain(chapter)).toEqual([]);
  });

  it("must end the function before API Gateway stops waiting", () => {
    expect(rules({ ...chapter, functionSeconds: 30 })).toContain("function-outlives-caller");
    expect(rules({ ...chapter, functionSeconds: 900 })).toContain("function-outlives-caller");
    expect(rules({ ...chapter, functionSeconds: 29 })).toEqual([]);
  });

  it("must keep time back to answer", () => {
    expect(rules({ ...chapter, answerMarginMs: 0 })).toContain("no-time-to-answer");
    expect(rules({ ...chapter, answerMarginMs: 10_000 })).toContain("no-time-to-answer");
  });

  it("must not leave the SDK's timeouts at their default of none", () => {
    expect(
      rules({ ...chapter, sdk: { connectionTimeoutMs: 0, requestTimeoutMs: 0, maxAttempts: 3 } }),
    ).toEqual(["sdk-timeout-off"]);
    expect(rules({ ...chapter, sdk: { ...SDK, requestTimeoutMs: 0 } })).toEqual([
      "sdk-timeout-off",
    ]);
  });

  it("must let one SDK attempt finish before the handler's deadline", () => {
    expect(rules({ ...chapter, sdk: { ...SDK, requestTimeoutMs: 8500 } })).toEqual([
      "attempt-outlives-deadline",
    ]);
    expect(rules({ ...chapter, sdk: { ...SDK, requestTimeoutMs: 8000 } })).toEqual([]);
  });

  it("counts the first try as an attempt", () => {
    expect(rules({ ...chapter, sdk: { ...SDK, maxAttempts: 0 } })).toEqual(["attempts"]);
  });
});

describe("the timeouts around a queue", () => {
  it("accept six times the function timeout, as chapter 08 sets it", () => {
    expect(
      checkQueueChain({ functionSeconds: 30, visibilitySeconds: 180, batchWindowSeconds: 0 }),
    ).toEqual([]);
  });

  it("ask for the batch window on top", () => {
    const findings = checkQueueChain({
      functionSeconds: 30,
      visibilitySeconds: 180,
      batchWindowSeconds: 20,
    });
    expect(findings.map((finding) => finding.rule)).toEqual(["visibility-below-recommendation"]);
    expect(findings[0]?.message).toContain("200 s");
  });

  it("name the case Lambda refuses outright", () => {
    expect(
      checkQueueChain({
        functionSeconds: 60,
        visibilitySeconds: 30,
        batchWindowSeconds: 0,
      }).map((finding) => finding.rule),
    ).toEqual(["function-outlives-visibility", "visibility-below-recommendation"]);
  });
});
