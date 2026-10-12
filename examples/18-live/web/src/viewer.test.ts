import { describe, expect, it } from "vite-plus/test";

import { parseConfig } from "./config.ts";
import { retryDelayMs, viewFor } from "./viewer.ts";

describe("what the page shows", () => {
  it("treats 404 as offline, not as a failure", () => {
    const view = viewFor(
      { kind: "error", type: "ErrorNotAvailable", code: 404, message: "Failed to load playlist" },
      0,
    );
    expect(view).toEqual({ name: "offline", retryInMs: 5_000 });
  });

  it("goes offline when a live stream ends", () => {
    expect(viewFor({ kind: "state", state: "Ended" }, 0).name).toBe("offline");
  });

  it("says the channel is full on 429 and does not retry", () => {
    expect(
      viewFor({ kind: "error", type: "ErrorNotAvailable", code: 429, message: "" }, 0),
    ).toEqual({ name: "full" });
  });

  it("shows any other error with its type and code", () => {
    const view = viewFor({ kind: "error", type: "ErrorNetwork", code: 503, message: "segment" }, 0);
    expect(view).toEqual({ name: "failed", message: "ErrorNetwork 503: segment" });
  });
});

describe("retrying while offline", () => {
  it("backs off and never waits longer than a minute", () => {
    expect([0, 1, 2, 3, 4, 20].map(retryDelayMs)).toEqual([
      5_000, 10_000, 20_000, 40_000, 60_000, 60_000,
    ]);
  });
});

describe("page config", () => {
  it("accepts a page with no channel yet", () => {
    expect(parseConfig({ playbackUrl: null }).playbackUrl).toBeNull();
  });

  it("refuses a playback URL that is not HTTPS", () => {
    expect(() => parseConfig({ playbackUrl: "http://example.com/x.m3u8" })).toThrow();
    expect(() => parseConfig({ playbackUrl: "javascript:alert(1)" })).toThrow();
  });

  it("requires the playback URL field and drops everything else", () => {
    expect(() => parseConfig({})).toThrow();
    expect(parseConfig({ playbackUrl: null, streamKey: "sk_x" })).toEqual({ playbackUrl: null });
  });
});
