import { describe, expect, it } from "vite-plus/test";

import { summarize } from "../src/finding.ts";
import { createNotifier } from "../src/notify.ts";
import {
  archivedEvent,
  bareEvent,
  customActionEvent,
  failedEvent,
  longTitleEvent,
  noResourceEvent,
  passedEvent,
} from "./fixtures/finding-events.ts";

const notices = (event: unknown) => {
  const summary = summarize(event);
  if (!summary.ok) {
    throw new Error(summary.problems.join("; "));
  }
  return summary.notices;
};

describe("a Firewall Manager finding, as Security Hub sends it to EventBridge", () => {
  it("becomes one notice naming the account, the resource, and the status", () => {
    const [notice, ...rest] = notices(failedEvent);
    expect(rest).toEqual([]);
    expect(notice?.status).toBe("failed");
    expect(notice?.subject).toBe(
      "[failed] 444444444444: Security group is not in compliance with content audit security group.",
    );
    expect(notice?.body).toContain("Account: 444444444444");
    expect(notice?.body).toContain("Status: FAILED (severity HIGH)");
    expect(notice?.body).toContain(
      "Resource: AwsEc2SecurityGroup arn:aws:ec2:ap-northeast-1:444444444444:security-group/sg-0123456789abcdef0",
    );
  });

  it("tells a resource coming back from one going out", () => {
    expect(notices(passedEvent).map((notice) => notice.status)).toEqual(["passed"]);
  });

  it("does not turn a missing status into either answer", () => {
    const [notice] = notices(bareEvent);
    expect(notice?.status).toBe("unstated");
    expect(notice?.body).toContain("Status: not stated");
  });

  it("says nothing about an archived finding", () => {
    expect(notices(archivedEvent)).toEqual([]);
  });

  it("keeps the subject within what SNS accepts", () => {
    const [notice] = notices(longTitleEvent);
    expect(notice?.subject.length).toBeLessThan(100);
    expect(notice?.subject).not.toMatch(/[\n\r]/);
  });

  it("does not read an event of another shape as a finding", () => {
    for (const event of [customActionEvent, noResourceEvent, {}, null, "finding"]) {
      expect(summarize(event).ok).toBe(false);
    }
  });
});

describe("the notifier", () => {
  const setup = () => {
    const published: { subject: string; body: string }[] = [];
    const logged: Record<string, unknown>[] = [];
    const notify = createNotifier({
      publish: async (subject, body) => {
        published.push({ subject, body });
      },
      log: (entry) => logged.push(entry),
    });
    return { notify, published, logged };
  };

  it("publishes one message per finding", async () => {
    const { notify, published } = setup();
    expect(await notify(failedEvent)).toEqual({ published: 1 });
    expect(published[0]?.subject).toMatch(/^\[failed\] 444444444444/);
  });

  it("publishes an unreadable event as unreadable instead of dropping it", async () => {
    const { notify, published, logged } = setup();
    expect(await notify(noResourceEvent)).toEqual({ published: 1 });
    expect(published[0]?.subject).toBe("[unreadable] A Firewall Manager finding could not be read");
    expect(published[0]?.body).toContain("detail.findings.0.Resources");
    expect(logged[0]).toMatchObject({ level: "error" });
  });

  it("fails the invocation when publishing fails", async () => {
    const notify = createNotifier({
      publish: async () => {
        throw new Error("topic unreachable");
      },
      log: () => {},
    });
    await expect(notify(failedEvent)).rejects.toThrow("topic unreachable");
  });
});
