import { describe, expect, it } from "vite-plus/test";

import { buildInvocation } from "./cdkd-args.ts";

describe("cdkd invocation", () => {
  it("synth never needs AWS", () => {
    expect(buildInvocation("synth", "AihBookSite", "ap-northeast-1", [])).toEqual({
      access: "local",
      args: ["synth"],
    });
  });

  it("diff only observes", () => {
    expect(buildInvocation("diff", "AihBookSite", "ap-northeast-1", ["--fail"])).toEqual({
      access: "observe",
      args: ["diff", "AihBookSite", "--fail"],
    });
  });

  it("deploy waits for CloudFront to propagate", () => {
    const invocation = buildInvocation("deploy", "AihBookSite", "ap-northeast-1", []);
    expect(invocation.access).toBe("mutate");
    expect(invocation.args).toEqual(["deploy", "AihBookSite", "--full-wait"]);
  });

  it("destroy gets no force flag", () => {
    const { args } = buildInvocation("destroy", "AihBookSite", "ap-northeast-1", []);
    expect(args).toEqual(["destroy", "AihBookSite"]);
  });

  it("bootstrap gets the region", () => {
    expect(buildInvocation("bootstrap", "", "ap-northeast-1", []).args).toEqual([
      "bootstrap",
      "--region",
      "ap-northeast-1",
    ]);
  });
});
