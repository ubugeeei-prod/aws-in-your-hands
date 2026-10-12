import { describe, expect, it } from "vite-plus/test";

import {
  allowedActions,
  allowShell,
  canLaunch,
  CLOUDSHELL_ACTIONS,
  denyPublicEnvironments,
  denyShell,
  LAUNCH_ACTIONS,
  type PolicyDocument,
} from "../src/policy.ts";

// What AdministratorAccess amounts to for this purpose: every action, on everything.
const administrator: PolicyDocument = {
  Version: "2012-10-17",
  Statement: [{ Sid: "Everything", Effect: "Allow", Action: ["*"], Resource: "*" }],
};

describe("a policy that lets a role use CloudShell", () => {
  it("allows the four launch actions and the credentials, and nothing else", () => {
    const document = allowShell({ credentials: true, fileTransfer: false });
    expect(allowedActions([document])).toEqual([
      "CreateEnvironment",
      "CreateSession",
      "GetEnvironmentStatus",
      "PutCredentials",
      "StartEnvironment",
    ]);
    expect(canLaunch([document])).toBe(true);
  });

  it("names every action: no wildcard to grow when AWS adds one", () => {
    for (const use of [
      { credentials: true, fileTransfer: true },
      { credentials: false, fileTransfer: false },
    ]) {
      const actions = allowShell(use).Statement.flatMap((statement) => statement.Action);
      expect(actions.every((action) => /^cloudshell:[A-Za-z]+$/.test(action))).toBe(true);
    }
  });

  it("adds upload and download only when asked", () => {
    const transfer = ["GetFileDownloadUrls", "GetFileUploadUrls"];
    expect(allowedActions([allowShell({ credentials: true, fileTransfer: true })])).toEqual(
      expect.arrayContaining(transfer),
    );
    expect(allowedActions([allowShell({ credentials: true, fileTransfer: false })])).not.toEqual(
      expect.arrayContaining(transfer),
    );
  });

  it("can open a shell that holds no credentials", () => {
    const document = allowShell({ credentials: false, fileTransfer: false });
    expect(canLaunch([document])).toBe(true);
    expect(allowedActions([document])).not.toContain("PutCredentials");
  });

  it("never lets approving a command, deleting, or stopping through", () => {
    const allowed = allowedActions([allowShell({ credentials: true, fileTransfer: true })]);
    for (const action of ["ApproveCommand", "DeleteEnvironment", "StopEnvironment"]) {
      expect(allowed).not.toContain(action);
    }
  });

  it("cannot launch with any one of the four launch actions missing", () => {
    for (const missing of LAUNCH_ACTIONS) {
      const document = allowShell({ credentials: true, fileTransfer: false });
      const statement = document.Statement[0];
      if (statement === undefined) {
        throw new Error("no statement");
      }
      statement.Action = statement.Action.filter((action) => action !== `cloudshell:${missing}`);
      expect(canLaunch([document])).toBe(false);
    }
  });
});

describe("a policy that takes CloudShell away", () => {
  it("wins over an administrator's allow", () => {
    expect(allowedActions([administrator])).toEqual([...CLOUDSHELL_ACTIONS]);
    expect(allowedActions([administrator, denyShell()])).toEqual([]);
    expect(canLaunch([administrator, denyShell()])).toBe(false);
  });

  it("denies the whole namespace, including actions added later", () => {
    expect(denyShell().Statement).toEqual([
      { Sid: "DenyCloudShell", Effect: "Deny", Action: ["cloudshell:*"], Resource: "*" },
    ]);
  });
});

describe("a policy that allows only VPC environments", () => {
  it("denies creating an environment when no VPC is named, and touches nothing else", () => {
    expect(denyPublicEnvironments().Statement).toEqual([
      {
        Sid: "DenyCloudShellNonVpcEnvironments",
        Effect: "Deny",
        Action: ["cloudshell:CreateEnvironment"],
        Resource: "*",
        Condition: { Null: { "cloudshell:VpcIds": "true" } },
      },
    ]);
  });
});
