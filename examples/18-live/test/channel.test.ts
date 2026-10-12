import { describe, expect, it } from "vite-plus/test";

import { encoderProblems, maxVideoKbps, rtmpsServer } from "../src/channel.ts";

const hd = { width: 1280, height: 720, videoKbps: 3000, keyframeSeconds: 2 };

describe("encoder settings against the channel type", () => {
  it("accepts 720p at 3 Mbps on a BASIC channel", () => {
    expect(encoderProblems("BASIC", hd)).toEqual([]);
  });

  it("catches a bitrate a BASIC channel would disconnect", () => {
    expect(encoderProblems("BASIC", { ...hd, videoKbps: 4500 })).toHaveLength(1);
    expect(encoderProblems("STANDARD", { ...hd, videoKbps: 4500 })).toEqual([]);
  });

  it("uses the lower BASIC limit at 480p and below", () => {
    expect(maxVideoKbps("BASIC", { width: 852, height: 480 })).toBe(1500);
    expect(maxVideoKbps("BASIC", { width: 480, height: 852 })).toBe(1500);
    expect(maxVideoKbps("BASIC", { width: 1280, height: 720 })).toBe(3500);
  });

  it("catches input larger than 1080p on every type", () => {
    for (const type of ["BASIC", "STANDARD", "ADVANCED_SD", "ADVANCED_HD"] as const) {
      expect(encoderProblems(type, { ...hd, width: 2560, height: 1440 }), type).not.toEqual([]);
    }
  });

  it("accepts portrait 1080p", () => {
    expect(
      encoderProblems("STANDARD", {
        width: 1080,
        height: 1920,
        videoKbps: 6000,
        keyframeSeconds: 2,
      }),
    ).toEqual([]);
  });

  it("catches a long keyframe interval", () => {
    expect(encoderProblems("BASIC", { ...hd, keyframeSeconds: 10 })).toHaveLength(1);
  });
});

describe("ingest server", () => {
  it("is RTMPS on port 443 and holds no key", () => {
    const server = rtmpsServer("a1b2c3d4e5f6.global-contribute.live-video.net");
    expect(server).toBe("rtmps://a1b2c3d4e5f6.global-contribute.live-video.net:443/app/");
    expect(server).not.toContain("sk_");
  });
});
