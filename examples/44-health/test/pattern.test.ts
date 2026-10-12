import { describe, expect, it } from "vite-plus/test";

import { matches } from "../src/pattern.ts";
import { DELIVERIES, patternsFor } from "../src/watch.ts";
import { documented, raw, withDetail, written } from "./fixtures.ts";

const [tokyo, global] = DELIVERIES;
const rulesMatching = (delivery: (typeof DELIVERIES)[number], event: unknown) =>
  patternsFor(delivery)
    .filter(({ pattern }) => matches(pattern, event))
    .map(({ name }) => name);

describe("the matcher", () => {
  it("matches a string against the listed strings, and a nested object field by field", () => {
    const pattern = { source: ["a", "b"], detail: { page: ["1"] } };
    expect(matches(pattern, { source: "b", detail: { page: "1", other: true } })).toBe(true);
    expect(matches(pattern, { source: "c", detail: { page: "1" } })).toBe(false);
    expect(matches(pattern, { source: "a", detail: { page: "2" } })).toBe(false);
  });

  it("does not match a field that is missing or is not a string", () => {
    const pattern = { detail: { page: ["1"] } };
    expect(matches(pattern, { detail: {} })).toBe(false);
    expect(matches(pattern, {})).toBe(false);
    expect(matches(pattern, { detail: { page: 1 } })).toBe(false);
  });

  it("has no wildcard: the pattern the user guide warns about matches nothing", () => {
    expect(matches({ source: ["aws.health*"] }, { source: "aws.health" })).toBe(false);
  });
});

describe("the rules in ap-northeast-1", () => {
  it("pass every first page written for Tokyo to exactly one rule", () => {
    const firstPages = written.filter(
      ({ name }) => name.startsWith("tokyo-") && !name.endsWith("page-2"),
    );
    expect(firstPages.length).toBeGreaterThan(5);
    for (const { name, event } of firstPages) {
      expect(rulesMatching(tokyo, event), name).toEqual(["Events"]);
    }
  });

  it("pass public and account-specific events alike", () => {
    expect(rulesMatching(tokyo, raw("docs-public-ec2-operational-issue"))).toEqual(["Events"]);
    expect(rulesMatching(tokyo, raw("docs-account-ec2-instance-retirement"))).toEqual(["Events"]);
  });

  it("do not invoke the function for a later page", () => {
    expect(rulesMatching(tokyo, raw("tokyo-lambda-runtime-lifecycle-page-2"))).toEqual([]);
    // The documented sample is page 1 of 10.
    expect(rulesMatching(tokyo, raw("docs-account-lambda-planned-lifecycle"))).toEqual(["Events"]);
  });

  it("pass an abuse event through its own rule, whatever its detail holds", () => {
    expect(rulesMatching(tokyo, raw("abuse-event-undocumented-detail"))).toEqual(["Abuse"]);
  });

  it("do not match an event of another source or type", () => {
    const event = raw("tokyo-lambda-issue-open");
    expect(rulesMatching(tokyo, { ...event, source: "aws.ec2" })).toEqual([]);
    expect(rulesMatching(tokyo, { ...event, "detail-type": "EC2 Instance State-change" })).toEqual(
      [],
    );
  });
});

describe("the rules in us-east-1", () => {
  it("drop the copies that the backup Region of us-west-2 receives", () => {
    const copy = raw("docs-account-ec2-backup-copy");
    expect(rulesMatching(global, copy)).toEqual([]);
    expect(
      rulesMatching(global, withDetail("docs-account-ec2-backup-copy", { backupEvent: "false" })),
    ).toEqual(["Events"]);
    // Tokyo is nobody's backup Region, so its rule does not look at the flag.
    expect(rulesMatching(tokyo, copy)).toEqual(["Events"]);
  });

  it("pass the events delivered there", () => {
    expect(rulesMatching(global, raw("docs-account-ec2-instance-retirement"))).toEqual(["Events"]);
    expect(rulesMatching(global, raw("abuse-event-undocumented-detail"))).toEqual(["Abuse"]);
  });
});

describe("the list as a whole", () => {
  it("never sends one event to two rules of the same Region", () => {
    for (const delivery of DELIVERIES) {
      for (const { name, event } of [...documented, ...written]) {
        expect(rulesMatching(delivery, event).length, `${delivery.region} ${name}`).toBeLessThan(2);
      }
    }
  });

  it("filters on no field whose values the documentation does not enumerate", () => {
    for (const delivery of DELIVERIES) {
      const fields = patternsFor(delivery).flatMap(({ pattern }) => [
        ...Object.keys(pattern),
        ...Object.keys((pattern["detail"] as object | undefined) ?? {}),
      ]);
      expect(new Set(fields)).toEqual(
        new Set([
          "source",
          "detail-type",
          "detail",
          "page",
          ...(delivery.dropBackupCopies ? ["backupEvent"] : []),
        ]),
      );
    }
  });
});
