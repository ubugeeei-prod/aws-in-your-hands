import { describe, expect, it } from "vite-plus/test";

import { parseHealthEvent, parseHealthTime } from "../src/event.ts";
import { documented, raw, withDetail, written } from "./fixtures.ts";

describe("the documented samples", () => {
  it.each(documented.map((fixture) => fixture.name))("parses %s", (name) => {
    expect(parseHealthEvent(raw(name))).toMatchObject({ ok: true });
  });

  it("reads a sample that leaves out lastUpdatedTime, which the field table calls required", () => {
    const result = parseHealthEvent(raw("docs-account-elb-api-issue"));
    expect(result.ok && result.event.detail.lastUpdatedTime).toBeUndefined();
  });

  it("reads a sample that leaves out resources and affectedEntities as empty lists", () => {
    const retirement = parseHealthEvent(raw("docs-account-ec2-instance-retirement"));
    expect(retirement.ok && retirement.event.resources).toEqual([]);
    const elb = parseHealthEvent(raw("docs-account-elb-api-issue"));
    expect(elb.ok && elb.event.detail.affectedEntities).toEqual([]);
  });
});

describe("times", () => {
  it("reads the documented form as UTC", () => {
    expect(parseHealthTime("Fri, 27 Jan 2023 06:02:51 GMT")).toBe(Date.UTC(2023, 0, 27, 6, 2, 51));
    expect(parseHealthTime("Fri, 3 Jun 2022 05:01:10 GMT")).toBe(Date.UTC(2022, 5, 3, 5, 1, 10));
  });

  it("does not check the weekday, which is wrong in the documented samples", () => {
    // 27 January 2026 is a Tuesday.
    expect(parseHealthTime("Thu, 27 Jan 2026 13:44:13 GMT")).toBe(
      Date.UTC(2026, 0, 27, 13, 44, 13),
    );
  });

  it("refuses another zone, another format, and a date that does not exist", () => {
    expect(parseHealthTime("Fri, 27 Jan 2023 06:02:51 PST")).toBeUndefined();
    expect(parseHealthTime("2023-01-27T06:02:51Z")).toBeUndefined();
    expect(parseHealthTime("Tue, 31 Feb 2026 00:00:00 GMT")).toBeUndefined();
    expect(parseHealthTime("Tue, 13 Oct 2026 24:00:00 GMT")).toBeUndefined();
  });
});

describe("what does not fit", () => {
  it("keeps the envelope of an abuse event, whose detail is not documented", () => {
    const result = parseHealthEvent(raw("abuse-event-undocumented-detail"));
    expect(result).toMatchObject({
      ok: false,
      envelope: { "detail-type": "AWS Health Abuse Event", region: "us-east-1" },
    });
  });

  it("refuses a category or a status it does not know, and names the field", () => {
    const category = parseHealthEvent(
      withDetail("tokyo-lambda-issue-open", { eventTypeCategory: "somethingNew" }),
    );
    expect(category.ok === false && category.issues.join()).toContain("detail.eventTypeCategory");
    const status = parseHealthEvent(withDetail("tokyo-lambda-issue-open", { statusCode: "done" }));
    expect(status.ok === false && status.issues.join()).toContain("detail.statusCode");
  });

  it("refuses an event from another source", () => {
    expect(parseHealthEvent({ ...raw("tokyo-lambda-issue-open"), source: "aws.ec2" }).ok).toBe(
      false,
    );
  });

  it("drops a field it does not know instead of failing", () => {
    expect(parseHealthEvent(withDetail("tokyo-lambda-issue-open", { somethingNew: "x" })).ok).toBe(
      true,
    );
  });

  it("parses every fixture written for this chapter except the abuse event", () => {
    const failed = written.filter((fixture) => !parseHealthEvent(fixture.event).ok);
    expect(failed.map((fixture) => fixture.name)).toEqual(["abuse-event-undocumented-detail"]);
  });
});
