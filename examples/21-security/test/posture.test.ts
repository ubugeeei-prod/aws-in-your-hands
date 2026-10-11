import { describe, expect, it } from "vite-plus/test";
import { assess, failing, type Snapshot, snapshotSchema } from "../src/posture.ts";

const read = <T>(value: T) => ({ read: true as const, value });
const unread = (reason: string) => ({ read: false as const, reason });

/** A fresh personal account after chapter 01: root locked down, nothing else switched on. */
const personal: Snapshot = {
  root: read({ mfaEnabled: true, accessKeysPresent: false }),
  trails: read([]),
  guardDuty: read([]),
  inspector: read({ lambda: "DISABLED", ecr: "DISABLED", ec2: "DISABLED" }),
  config: read([]),
  organization: read({ member: false, allFeatures: false }),
};
const stateOf = (snapshot: Snapshot) => Object.fromEntries(assess(snapshot).map((entry) => [entry.id, entry.state]));

describe("posture", () => {
  it("passes a personal account that did chapter 01 and nothing more", () => {
    expect(snapshotSchema.safeParse(personal).success).toBe(true);
    expect(stateOf(personal)).toEqual({
      "root-mfa": "on",
      "root-access-keys": "on",
      "cloudtrail-event-history": "on",
      guardduty: "off",
      inspector: "off",
      "cloudtrail-trail": "off",
      "config-recorder": "off",
      "organization-scps": "off",
    });
    expect(failing(assess(personal))).toEqual([]);
  });

  it("fails on a root user without MFA or with access keys, whatever else is on", () => {
    const careless: Snapshot = { ...personal, root: read({ mfaEnabled: false, accessKeysPresent: true }) };
    expect(failing(assess(careless)).map((entry) => entry.id)).toEqual(["root-mfa", "root-access-keys"]);
  });

  it("does not report a check it could not make as passed, or as off", () => {
    const blind: Snapshot = { ...personal, root: unread("AccessDenied"), guardDuty: unread("AccessDenied") };
    expect(stateOf(blind)).toMatchObject({
      "root-mfa": "unknown",
      "root-access-keys": "unknown",
      guardduty: "unknown",
    });
    expect(failing(assess(blind)).map((entry) => entry.id)).toEqual(["root-mfa", "root-access-keys"]);
  });

  it("counts only what is actually running", () => {
    const partial: Snapshot = {
      ...personal,
      guardDuty: read([{ id: "d1", status: "DISABLED" }]),
      trails: read([
        { name: "one-region", multiRegion: false, logging: true },
        { name: "stopped", multiRegion: true, logging: false },
      ]),
      config: read([{ name: "default", recording: false }]),
      organization: read({ member: true, allFeatures: false }),
    };
    expect(stateOf(partial)).toMatchObject({
      guardduty: "off",
      "cloudtrail-trail": "off",
      "config-recorder": "off",
      "organization-scps": "off",
    });
  });

  it("puts every paid control outside the tier that fails the task", () => {
    const paid = assess(personal).filter((entry) => entry.charge !== "free");
    expect(paid.map((entry) => entry.id)).toEqual(["guardduty", "inspector", "cloudtrail-trail", "config-recorder"]);
    expect(paid.every((entry) => entry.tier !== "everyone")).toBe(true);
  });
});
