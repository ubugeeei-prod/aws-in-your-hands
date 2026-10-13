import { describe, expect, it } from "vite-plus/test";

import { cdkInvocation } from "../src/cdk-args.ts";

const run = (action: Parameters<typeof cdkInvocation>[0]["action"], ...extra: string[]) =>
  cdkInvocation({ action, extra, unattended: false });

describe("what is handed to the AWS CDK CLI", () => {
  it("synthesizes without touching AWS", () => {
    expect(run("synth")).toEqual({ access: "local", args: ["synth", "--quiet"] });
  });

  it("compares templates for a diff, and creates no change set", () => {
    expect(run("diff", "-c", "stable=v1")).toEqual({
      access: "observe",
      args: ["diff", "AihWebFunctions", "--method", "template", "-c", "stable=v1"],
    });
  });

  it("names the one stack on deploy, asks before widening permissions, and keeps the outputs", () => {
    expect(run("deploy", "-c", "stable=v1")).toEqual({
      access: "mutate",
      args: [
        "deploy",
        "AihWebFunctions",
        "--require-approval",
        "broadening",
        "--outputs-file",
        "reports/webfn-outputs.json",
        "-c",
        "stable=v1",
      ],
    });
  });

  // #region foundation
  it("refuses a deploy that names no release: it would delete the endpoint and its domain name", () => {
    expect(() => run("deploy")).toThrow(/removes every revision and the endpoint/);
    expect(() => run("deploy", "-c", "allowedOrigin=https://example.com")).toThrow(/--foundation/);
  });

  it("deploys the stack without revisions only when asked to in so many words", () => {
    const { args } = run("deploy", "--foundation");
    expect(args).not.toContain("--foundation");
    expect(args.slice(0, 2)).toEqual(["deploy", "AihWebFunctions"]);
    // With a release named, the flag changes nothing.
    expect(run("deploy", "--foundation", "-c", "stable=v1").args.slice(-2)).toEqual([
      "-c",
      "stable=v1",
    ]);
  });
  // #endregion foundation

  it("does not wait for an answer nobody can give in CI", () => {
    const unattended = (action: "deploy" | "destroy") =>
      cdkInvocation({ action, extra: ["-c", "stable=v1"], unattended: true }).args;
    expect(unattended("deploy")).toContain("never");
    expect(unattended("destroy")).toEqual([
      "destroy",
      "AihWebFunctions",
      "--force",
      "-c",
      "stable=v1",
    ]);
    expect(run("destroy").args).toEqual(["destroy", "AihWebFunctions"]);
  });

  it("stops on a bad release before any AWS call", () => {
    expect(() => run("deploy", "-c", "stable=v1", "-c", "canary=v2")).toThrow(/go together/);
    expect(() => run("deploy", "-c", "canary=v2", "-c", "canaryWeight=10")).toThrow(/stable/);
    expect(() =>
      run("deploy", "-c", "stable=v1", "-c", "canary=v2", "-c", "canaryWeight=100"),
    ).toThrow(/Invalid release/);
  });
});
