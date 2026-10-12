import { describe, expect, it } from "vite-plus/test";

import {
  ADMIN_ACTIONS,
  ATTESTED_ACTIONS,
  evaluate,
  IMAGE_SHA384,
  keyPolicy,
} from "../src/policy.ts";

const ROOT = "arn:aws:iam::111122223333:root";
const ROLE = "arn:aws:iam::111122223333:role/parent";
const PCR0 = "ab".repeat(48);
const OTHER = "cd".repeat(48);

const policy = keyPolicy({ accountRoot: ROOT, enclaveRole: ROLE, measurement: PCR0 });
const call = (action: string, attestedPcrs?: Record<number, string>, principal = ROLE) =>
  evaluate(policy, { principal, action, ...(attestedPcrs === undefined ? {} : { attestedPcrs }) });

describe("the key policy", () => {
  it("gives the account the administration of the key and none of its use", () => {
    const [admin] = policy.Statement;
    expect(admin?.Principal.AWS).toBe(ROOT);
    expect(admin?.Action).toEqual([...ADMIN_ACTIONS]);
    expect(admin?.Action.some((action) => action.includes("*"))).toBe(false);
    for (const action of [
      "kms:Decrypt",
      "kms:GenerateDataKey",
      "kms:Encrypt",
      "kms:ReEncryptFrom",
      "kms:CreateGrant",
    ]) {
      expect(admin?.Action, action).not.toContain(action);
    }
  });

  it("lets nobody use the key until an image is named", () => {
    const unnamed = keyPolicy({ accountRoot: ROOT, enclaveRole: ROLE, measurement: undefined });
    expect(unnamed.Statement).toHaveLength(1);
    for (const action of ATTESTED_ACTIONS) {
      expect(
        evaluate(unnamed, { principal: ROLE, action, attestedPcrs: { 0: PCR0 } }).allowed,
      ).toBe(false);
    }
  });

  it("puts the attestation condition on every statement that hands out a key", () => {
    const using = policy.Statement.filter((statement) =>
      statement.Action.some((action) => (ATTESTED_ACTIONS as readonly string[]).includes(action)),
    );
    expect(using).toHaveLength(1);
    expect(using[0]?.Condition).toEqual({ StringEqualsIgnoreCase: { [IMAGE_SHA384]: PCR0 } });
  });
});

describe("the policy evaluator (this book's model, not KMS)", () => {
  it("refuses the role without an attestation document", () => {
    for (const action of ATTESTED_ACTIONS) {
      expect(call(action)).toEqual({ allowed: false, because: "no statement allows this call" });
    }
  });

  it("allows the role when the attested PCR0 is the one in the policy", () => {
    expect(call("kms:Decrypt", { 0: PCR0 }).allowed).toBe(true);
    // StringEqualsIgnoreCase: the case of the hex digits does not matter.
    expect(call("kms:GenerateDataKey", { 0: PCR0.toUpperCase() }).allowed).toBe(true);
  });

  it("refuses another image, a debug enclave, and another principal with the right image", () => {
    expect(call("kms:Decrypt", { 0: OTHER }).allowed).toBe(false);
    expect(call("kms:Decrypt", { 0: "0".repeat(96) }).allowed).toBe(false);
    expect(call("kms:Decrypt", { 0: PCR0 }, "arn:aws:iam::111122223333:role/other").allowed).toBe(
      false,
    );
  });

  it("does not let attestation unlock anything but the two listed actions", () => {
    expect(call("kms:Encrypt", { 0: PCR0 }).allowed).toBe(false);
    expect(call("kms:PutKeyPolicy", { 0: PCR0 }).allowed).toBe(false);
  });

  it("requires every condition key of a statement to match", () => {
    const both = structuredClone(policy);
    const conditions = both.Statement[1]?.Condition?.StringEqualsIgnoreCase;
    if (conditions === undefined) {
      throw new Error("the policy has no attested statement");
    }
    conditions["kms:RecipientAttestation:PCR8"] = OTHER;
    const ask = (attestedPcrs: Record<number, string>) =>
      evaluate(both, { principal: ROLE, action: "kms:Decrypt", attestedPcrs }).allowed;
    expect(ask({ 0: PCR0 })).toBe(false);
    expect(ask({ 0: PCR0, 8: OTHER })).toBe(true);
  });

  it("lets an explicit deny win over an allow", () => {
    const denied = {
      Statement: [
        ...policy.Statement,
        { Effect: "Deny", Principal: { AWS: ROLE }, Action: "kms:Decrypt", Resource: "*" },
      ],
    };
    expect(
      evaluate(denied, { principal: ROLE, action: "kms:Decrypt", attestedPcrs: { 0: PCR0 } }),
    ).toEqual({
      allowed: false,
      because: "explicit deny (no Sid)",
    });
  });

  it("throws on a form it does not model instead of reading it as no restriction", () => {
    const statement = policy.Statement[1];
    const variants: unknown[] = [
      { ...statement, Action: "kms:*" },
      { ...statement, Principal: { AWS: "*" } },
      { ...statement, Principal: { Service: "ec2.amazonaws.com" } },
      { ...statement, Resource: "arn:aws:kms:ap-northeast-1:111122223333:key/1" },
      { ...statement, Condition: { StringEquals: { [IMAGE_SHA384]: PCR0 } } },
      {
        ...statement,
        Condition: { StringEqualsIgnoreCase: { "kms:ViaService": "s3.amazonaws.com" } },
      },
    ];
    for (const variant of variants) {
      expect(() =>
        evaluate({ Statement: [variant] }, { principal: ROLE, action: "kms:Decrypt" }),
      ).toThrow();
    }
  });
});
