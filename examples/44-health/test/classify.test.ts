import { describe, expect, it } from "vite-plus/test";

import { classify } from "../src/classify.ts";
import { parseHealthEvent } from "../src/event.ts";
import { SERVICES } from "../src/watch.ts";
import { parsed, withDetail } from "./fixtures.ts";

const kindOf = (name: string) => classify(parsed(name).detail, SERVICES).kind;
const classifyWith = (name: string, detail: Record<string, unknown>) => {
  const result = parseHealthEvent(withDetail(name, detail));
  if (!result.ok) {
    throw new Error(result.issues.join("; "));
  }
  return classify(result.event.detail, SERVICES);
};

describe("issues", () => {
  it("calls a public issue of a listed service an incident", () => {
    expect(kindOf("tokyo-lambda-issue-open")).toBe("incident");
    expect(kindOf("docs-public-ec2-operational-issue")).toBe("incident");
  });

  it("calls an issue posted under 'multiple services' an incident", () => {
    expect(kindOf("tokyo-multiple-services-issue")).toBe("incident");
  });

  it("still reports a public issue of a service that is not on the list", () => {
    expect(classify(parsed("tokyo-unlisted-service-issue").detail, SERVICES)).toEqual({
      kind: "inform",
      reason: "a public issue of WORKSPACES, which is not on the list",
    });
  });

  it("calls an account-specific issue an incident whatever the service", () => {
    expect(classifyWith("docs-account-elb-api-issue", { service: "SOMETHINGELSE" }).kind).toBe(
      "incident",
    );
  });

  it("keeps a closed issue an incident, so that its closure is announced", () => {
    expect(kindOf("tokyo-lambda-issue-closed")).toBe("incident");
  });
});

describe("scheduled changes", () => {
  it("gives the start time as the date to act by", () => {
    expect(classify(parsed("tokyo-ec2-retirement").detail, SERVICES)).toEqual({
      kind: "act-by-date",
      reason: "a scheduled change",
      by: Date.UTC(2026, 9, 20, 2, 0, 0),
    });
    expect(kindOf("docs-account-lambda-planned-lifecycle")).toBe("act-by-date");
  });

  it("only informs when the change is labelled informational or is over", () => {
    expect(classifyWith("tokyo-ec2-retirement", { actionability: "INFORMATIONAL" }).kind).toBe(
      "inform",
    );
    expect(classifyWith("tokyo-ec2-retirement", { statusCode: "closed" }).kind).toBe("inform");
  });

  it("asks for action when the label is missing", () => {
    expect(classifyWith("tokyo-ec2-retirement", { actionability: undefined }).kind).toBe(
      "act-by-date",
    );
  });
});

describe("account notifications and abuse", () => {
  it("asks for action on an account notification without a label, with no date", () => {
    expect(classify(parsed("tokyo-s3-open-access-notification").detail, SERVICES)).toEqual({
      kind: "act-by-date",
      reason: "an account notification",
      by: undefined,
    });
  });

  it("only informs when the notification is labelled informational", () => {
    expect(
      classifyWith("tokyo-s3-open-access-notification", { actionability: "INFORMATIONAL" }).kind,
    ).toBe("inform");
  });

  it("asks for action on the documented abuse report, although its category is issue", () => {
    expect(
      classifyWith("docs-account-elb-api-issue", {
        eventTypeCode: "AWS_ABUSE_PII_CONTENT_REMOVAL_REPORT",
        service: "ABUSE",
      }),
    ).toEqual({ kind: "act-by-date", reason: "an abuse report", by: undefined });
  });
});

describe("what is ignored", () => {
  it("ignores a copy sent to the backup Region", () => {
    expect(kindOf("docs-account-ec2-backup-copy")).toBe("ignore");
  });

  it("ignores every page after the first", () => {
    expect(classify(parsed("tokyo-lambda-runtime-lifecycle-page-2").detail, SERVICES)).toEqual({
      kind: "ignore",
      reason: "page 2 of 2",
    });
  });

  it("ignores nothing else among the fixtures", () => {
    for (const name of [
      "tokyo-lambda-issue-open",
      "tokyo-unlisted-service-issue",
      "tokyo-ec2-retirement",
      "tokyo-lambda-runtime-lifecycle",
      "tokyo-s3-open-access-notification",
      "docs-account-elb-api-issue",
    ]) {
      expect(kindOf(name), name).not.toBe("ignore");
    }
  });

  it("informs about an investigation, a category the guide lists without describing", () => {
    expect(
      classifyWith("tokyo-lambda-issue-open", { eventTypeCategory: "investigation" }).kind,
    ).toBe("inform");
  });
});
