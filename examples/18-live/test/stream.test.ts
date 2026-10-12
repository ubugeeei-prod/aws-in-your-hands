import { describe, expect, it } from "vite-plus/test";

import { describeStatus, inputMinutesSoFar, interpretGetStream } from "../src/stream.ts";

const live = {
  channelArn: "arn:aws:ivs:ap-northeast-1:123456789012:channel/abcdABCDefgh",
  streamId: "st-1A2b3c4D5e6F78ghij9Klmn",
  state: "LIVE",
  health: "HEALTHY",
  startTime: "2026-10-11T10:00:00Z",
  viewerCount: 3,
  playbackUrl: "https://example.playback.live-video.net/api/video/v1/x.m3u8",
};

describe("GetStream", () => {
  it("reads ChannelNotBroadcasting as offline", () => {
    expect(interpretGetStream({ kind: "error", name: "ChannelNotBroadcasting" })).toEqual({
      state: "offline",
    });
  });

  it("never reports another error as offline", () => {
    for (const name of [
      "AccessDeniedException",
      "ResourceNotFoundException",
      "ThrottlingException",
      "TimeoutError",
    ]) {
      expect(() => interpretGetStream({ kind: "error", name }), name).toThrow(
        /unknown, not offline/,
      );
    }
  });

  it("reads a live stream", () => {
    expect(interpretGetStream({ kind: "response", stream: live })).toEqual({
      state: "live",
      streamId: "st-1A2b3c4D5e6F78ghij9Klmn",
      health: "HEALTHY",
      startedAt: new Date("2026-10-11T10:00:00Z"),
      viewerCount: 3,
    });
  });

  it("does not show a timed-out viewer count as -1 viewers", () => {
    const status = interpretGetStream({ kind: "response", stream: { ...live, viewerCount: -1 } });
    expect(status).toMatchObject({ state: "live", viewerCount: null });
  });

  it("rejects a response without a stream instead of guessing offline", () => {
    expect(() => interpretGetStream({ kind: "response", stream: undefined })).toThrow();
    expect(() =>
      interpretGetStream({ kind: "response", stream: { ...live, state: "PAUSED" } }),
    ).toThrow();
  });
});

describe("input time", () => {
  const start = new Date("2026-10-11T10:00:00Z");

  it("rounds up to the minute", () => {
    expect(inputMinutesSoFar(start, new Date("2026-10-11T10:00:01Z"))).toBe(1);
    expect(inputMinutesSoFar(start, new Date("2026-10-11T10:01:00Z"))).toBe(1);
    expect(inputMinutesSoFar(start, new Date("2026-10-11T10:01:01Z"))).toBe(2);
  });

  it("keeps counting for a stream nobody stopped", () => {
    expect(inputMinutesSoFar(start, new Date("2026-10-13T10:00:00Z"))).toBe(2880);
  });

  it("says in words that a live channel is accruing", () => {
    const status = interpretGetStream({ kind: "response", stream: live });
    expect(describeStatus(status, new Date("2026-10-11T12:30:00Z"))).toContain("150 so far");
    expect(describeStatus({ state: "offline" }, new Date())).toMatch(/^OFFLINE/);
  });
});
