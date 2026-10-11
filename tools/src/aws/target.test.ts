import { describe, expect, it } from "vite-plus/test";
import { checkTarget, resolveTarget } from "./target.ts";

const identity = { accountId: "111111111111", arn: "arn:aws:sts::111111111111:assumed-role/dev/me" };

describe("target", () => {
  it("defaults to the Tokyo region", () => {
    expect(resolveTarget({})).toEqual({ region: "ap-northeast-1", expectedAccountId: undefined });
  });

  it("rejects an account ID that is not 12 digits", () => {
    expect(() => resolveTarget({ AIH_AWS_ACCOUNT_ID: "my-account" })).toThrow(/12-digit/);
  });

  it("refuses to change AWS until the account is named", () => {
    const check = checkTarget(resolveTarget({}), identity, "mutate");
    expect(check.ok).toBe(false);
  });

  it("allows reading AWS without a named account", () => {
    expect(checkTarget(resolveTarget({}), identity, "observe")).toEqual({ ok: true });
  });

  it("refuses when the credentials belong to another account, even for reads", () => {
    const target = resolveTarget({ AIH_AWS_ACCOUNT_ID: "222222222222" });
    expect(checkTarget(target, identity, "observe").ok).toBe(false);
    expect(checkTarget(target, identity, "mutate").ok).toBe(false);
  });

  it("allows changes when the credentials match the named account", () => {
    const target = resolveTarget({ AIH_AWS_ACCOUNT_ID: "111111111111" });
    expect(checkTarget(target, identity, "mutate")).toEqual({ ok: true });
  });
});
