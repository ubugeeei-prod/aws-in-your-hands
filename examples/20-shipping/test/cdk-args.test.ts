import { describe, expect, it } from "vite-plus/test";
import { buildCdkInvocation, stageFrom } from "../src/cdk-args.ts";

const base = { region: "ap-northeast-1", unattended: false, extra: [] as string[] };

describe("CDK CLI invocations", () => {
  it("synth needs no AWS access", () => {
    expect(buildCdkInvocation({ ...base, action: "synth", target: "api" })).toEqual({
      access: "local",
      stack: null,
      args: ["synth", "--quiet"],
    });
  });

  it("the stage picks the stack, so prod is never touched by default", () => {
    const stackFor = (extra: string[]) => buildCdkInvocation({ ...base, action: "deploy", target: "api", extra }).stack;
    expect(stackFor([])).toBe("AihShipApi");
    expect(stackFor(["-c", "stage=prod"])).toBe("AihShipApiProd");
    expect(stackFor(["--context", "stage=pr-42"])).toBe("AihShipApiPr42");
  });

  it("refuses a stage it does not know rather than deploying something", () => {
    expect(() => stageFrom(["-c", "stage=production"])).toThrow("stage must be");
    expect(() => buildCdkInvocation({ ...base, action: "destroy", target: "api", extra: ["-c", "stage=*"] })).toThrow();
  });

  it("diff compares templates and only reads", () => {
    const diff = buildCdkInvocation({ ...base, action: "diff", target: "api", extra: ["-c", "stage=prod"] });
    expect(diff.access).toBe("observe");
    expect(diff.args).toEqual(["diff", "AihShipApiProd", "--method", "template", "-c", "stage=prod"]);
  });

  it("lets the caller ask for a change-set diff instead", () => {
    const diff = buildCdkInvocation({ ...base, action: "diff", target: "api", extra: ["--method", "change-set"] });
    expect(diff.args).toEqual(["diff", "AihShipApi", "--method", "change-set"]);
  });

  it("a person is asked before permissions widen; CI is not asked anything", () => {
    const approval = (unattended: boolean) =>
      buildCdkInvocation({ ...base, unattended, action: "deploy", target: "api" }).args.slice(2, 4);
    expect(approval(false)).toEqual(["--require-approval", "broadening"]);
    expect(approval(true)).toEqual(["--require-approval", "never"]);
  });

  it("never disables CloudFormation's rollback on its own", () => {
    for (const unattended of [true, false]) {
      const { args } = buildCdkInvocation({ ...base, unattended, action: "deploy", target: "api" });
      expect(args.join(" ")).not.toMatch(/--no-rollback|-R\b|--hotswap|--express|--method direct/);
    }
  });

  it("destroy skips the prompt only where nobody could answer it", () => {
    expect(buildCdkInvocation({ ...base, action: "destroy", target: "api" }).args).toEqual(["destroy", "AihShipApi"]);
    expect(
      buildCdkInvocation({ ...base, unattended: true, action: "destroy", target: "api", extra: ["-c", "stage=pr-9"] })
        .args,
    ).toEqual(["destroy", "AihShipApiPr9", "--force", "-c", "stage=pr-9"]);
  });

  it("will not deploy the CI roles for the placeholder repository", () => {
    expect(() => buildCdkInvocation({ ...base, action: "deploy", target: "ci" })).toThrow("githubRepository");
    const deploy = buildCdkInvocation({
      ...base,
      action: "deploy",
      target: "ci",
      extra: ["-c", "githubRepository=octo-org/octo-repo"],
    });
    expect(deploy.stack).toBe("AihShipCi");
  });

  it("bootstraps the account and Region of the credentials in use", () => {
    expect(() => buildCdkInvocation({ ...base, action: "bootstrap", target: "api" })).toThrow("account ID");
    expect(buildCdkInvocation({ ...base, action: "bootstrap", target: "api", accountId: "111111111111" })).toEqual({
      access: "mutate",
      stack: null,
      args: ["bootstrap", "aws://111111111111/ap-northeast-1"],
    });
  });
});
