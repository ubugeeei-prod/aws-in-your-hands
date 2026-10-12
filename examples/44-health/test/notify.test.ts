import { describe, expect, it } from "vite-plus/test";

import { CLAIM_MS, type Ledger, memoryLedger } from "../src/ledger.ts";
import type { Message } from "../src/message.ts";
import { type Deps, handle } from "../src/notify.ts";
import { SERVICES } from "../src/watch.ts";
import { raw, withDetail } from "./fixtures.ts";

function harness(over: Partial<Deps> = {}) {
  const sent: Message[] = [];
  const logged: Record<string, unknown>[] = [];
  const ledger = memoryLedger();
  const clock = { now: Date.parse("2026-10-13T18:05:00Z") };
  const deps: Deps = {
    ledger,
    services: SERVICES,
    now: () => clock.now,
    log: (line) => logged.push(line),
    publish: async (message) => {
      sent.push(message);
    },
    ...over,
  };
  return { sent, logged, ledger, clock, deps, deliver: (event: unknown) => handle(event, deps) };
}

const OPEN = "tokyo-lambda-issue-open";
const UPDATE = "tokyo-lambda-issue-update";
const CLOSED = "tokyo-lambda-issue-closed";

describe("one notification per state of an event", () => {
  it("sends one message for an event delivered twice", async () => {
    const { deliver, sent } = harness();
    expect(await deliver(raw(OPEN))).toMatchObject({ action: "sent", change: "new" });
    expect(await deliver(raw(OPEN))).toEqual({ action: "skipped", why: "duplicate" });
    expect(sent).toHaveLength(1);
  });

  it("sends one message when the same state arrives as a different EventBridge event", async () => {
    const { deliver, sent } = harness();
    await deliver(raw(OPEN));
    await deliver({ ...raw(OPEN), id: "another-id", time: "2026-10-13T18:04:55Z" });
    expect(sent).toHaveLength(1);
  });

  it("follows an incident through open, update and closure with three messages", async () => {
    const { deliver, sent } = harness();
    await deliver(raw(OPEN));
    await deliver(raw(UPDATE));
    await deliver(raw(CLOSED));
    expect(sent.map((message) => message.subject)).toEqual([
      "[AWS Health] INCIDENT LAMBDA ap-northeast-1 open: AWS_LAMBDA_OPERATIONAL_ISSUE",
      "[AWS Health] INCIDENT LAMBDA ap-northeast-1 update: AWS_LAMBDA_OPERATIONAL_ISSUE",
      "[AWS Health] INCIDENT LAMBDA ap-northeast-1 closed: AWS_LAMBDA_OPERATIONAL_ISSUE",
    ]);
  });

  it("does not announce an update that arrives after the closure it preceded", async () => {
    const { deliver, sent } = harness();
    await deliver(raw(OPEN));
    await deliver(raw(CLOSED));
    expect(await deliver(raw(UPDATE))).toEqual({ action: "skipped", why: "stale" });
    expect(await deliver(raw(OPEN))).toEqual({ action: "skipped", why: "stale" });
    expect(sent).toHaveLength(2);
    expect(sent.at(-1)?.subject).toContain("closed");
  });

  it("announces a closure once, also when it is the first thing heard of the event", async () => {
    const { deliver, sent } = harness();
    await deliver(raw(CLOSED));
    await deliver(raw(CLOSED));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toContain("Status: closed");
    expect(sent[0]?.body).toContain("What to do: Closed on AWS's side.");
  });

  it("keeps two accounts' copies of one event ARN apart", async () => {
    const { deliver, sent } = harness();
    await deliver(raw("tokyo-ec2-retirement"));
    await deliver(withDetail("tokyo-ec2-retirement", { affectedAccount: "210987654321" }));
    expect(sent).toHaveLength(2);
  });
});

describe("never zero for an open issue", () => {
  it("sends on the retry when the first publish failed", async () => {
    let failures = 1;
    const sent: Message[] = [];
    const { deliver, clock, ledger } = harness({
      publish: async (message) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error("SNS did not answer");
        }
        sent.push(message);
      },
    });

    await expect(deliver(raw(OPEN))).rejects.toThrow("SNS did not answer");
    expect([...ledger.entries.values()][0]).toMatchObject({ notified: false });

    // Lambda's first retry comes a minute later.
    clock.now += 60_000;
    expect(await deliver(raw(OPEN))).toMatchObject({ action: "sent", change: "retry" });
    expect(sent).toHaveLength(1);
    expect([...ledger.entries.values()][0]).toMatchObject({ notified: true });
  });

  it("leaves a copy alone while another invocation is sending, and takes over if that one died", async () => {
    const sent: Message[] = [];
    let alive = false;
    const { deliver, clock } = harness({
      publish: async (message) => {
        if (!alive) {
          throw new Error("the function was killed");
        }
        sent.push(message);
      },
    });
    await expect(deliver(raw(OPEN))).rejects.toThrow("the function was killed");

    // A second delivery ten seconds later cannot tell a dead sender from a slow one.
    alive = true;
    clock.now += 10_000;
    expect(await deliver(raw(OPEN))).toEqual({ action: "skipped", why: "in-flight" });

    clock.now += CLAIM_MS;
    expect(await deliver(raw(OPEN))).toMatchObject({ action: "sent", change: "retry" });
    expect(sent).toHaveLength(1);
  });

  it("sends twice rather than not at all when it dies between publishing and recording", async () => {
    const inner = memoryLedger();
    let writes = 0;
    const flaky: Ledger = {
      read: inner.read,
      write: async (key, next, previous) => {
        writes += 1;
        if (writes === 2) {
          throw new Error("died before recording");
        }
        return inner.write(key, next, previous);
      },
    };
    const { deliver, sent, clock } = harness({ ledger: flaky });

    await expect(deliver(raw(OPEN))).rejects.toThrow("died before recording");
    expect(sent).toHaveLength(1);
    clock.now += 60_000;
    expect(await deliver(raw(OPEN))).toMatchObject({ action: "sent", change: "retry" });
    expect(sent).toHaveLength(2);
  });

  it("decides again when another copy wrote between its read and its write", async () => {
    const inner = memoryLedger();
    const sneaked: Message[] = [];
    let first = true;
    const racing: Ledger = {
      read: async (key) => {
        const seen = await inner.read(key);
        if (first) {
          first = false;
          // A second invocation handles the same event in between, start to finish.
          await handle(raw(OPEN), {
            ledger: inner,
            services: SERVICES,
            now: () => 0,
            log: () => {},
            publish: async (message) => {
              sneaked.push(message);
            },
          });
        }
        return seen;
      },
      write: inner.write,
    };
    const { deliver, sent } = harness({ ledger: racing });

    expect(await deliver(raw(OPEN))).toEqual({ action: "skipped", why: "duplicate" });
    expect(sneaked).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  it("reports an event it cannot read instead of dropping it, once", async () => {
    const { deliver, sent } = harness();
    await deliver(raw("abuse-event-undocumented-detail"));
    await deliver(raw("abuse-event-undocumented-detail"));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe(
      "[AWS Health] UNREADABLE AWS Health Abuse Event: open the dashboard",
    );
    expect(sent[0]?.body).toContain("detail.eventArn");
  });

  it("reports something that is not even an event", async () => {
    const { deliver, sent } = harness();
    await deliver("not an event");
    expect(sent[0]?.subject).toContain("UNREADABLE");
  });
});

describe("what is not sent", () => {
  it("sends nothing for an ignored event, writes nothing, and logs why", async () => {
    const { deliver, sent, ledger, logged } = harness();
    expect(await deliver(raw("docs-account-ec2-backup-copy"))).toEqual({
      action: "ignored",
      why: "a copy sent to the backup Region",
    });
    expect(sent).toHaveLength(0);
    expect(ledger.entries.size).toBe(0);
    expect(logged).toEqual([
      expect.objectContaining({ message: "ignored", service: "EC2", kind: "ignore" }),
    ]);
  });

  it("stays quiet while a planned change is only ticked off, and speaks when its date moves", async () => {
    const { deliver, sent } = harness();
    await deliver(raw("tokyo-ec2-retirement"));
    expect(
      await deliver(
        withDetail("tokyo-ec2-retirement", { lastUpdatedTime: "Wed, 14 Oct 2026 02:00:00 GMT" }),
      ),
    ).toMatchObject({ action: "advanced" });
    expect(sent).toHaveLength(1);

    await deliver(
      withDetail("tokyo-ec2-retirement", {
        lastUpdatedTime: "Thu, 15 Oct 2026 02:00:00 GMT",
        startTime: "Thu, 22 Oct 2026 02:00:00 GMT",
      }),
    );
    // The long event type code is cut at the end of the subject; the body has it whole.
    expect(sent.map((message) => message.subject.slice(0, 56))).toEqual([
      "[AWS Health] ACT BY 2026-10-20 EC2 ap-northeast-1 upcomi",
      "[AWS Health] ACT BY 2026-10-22 EC2 ap-northeast-1 update",
    ]);
  });
});

describe("the message", () => {
  it("says what kind it is, what to do, and which resources", async () => {
    const { deliver, sent } = harness();
    await deliver(raw("tokyo-ec2-retirement"));
    const body = sent[0]?.body ?? "";
    expect(body).toContain("act-by-date: a scheduled change");
    expect(body).toContain("Act by: 2026-10-20T02:00:00Z");
    expect(body).toContain("Affected: i-0123456789abcdef0 (PENDING)");
    expect(body).toContain("Region: ap-northeast-1, delivered to ap-northeast-1");
  });

  it("keeps the subject within what SNS accepts", async () => {
    const { deliver, sent } = harness();
    await deliver(
      withDetail("tokyo-lambda-issue-open", {
        eventTypeCode: `AWS_LAMBDA_${"VERY_LONG_".repeat(12)}ISSUE`,
        service: "LAMBDA\nINJECTED",
      }),
    );
    const subject = sent[0]?.subject ?? "";
    expect(subject.length).toBeLessThan(100);
    expect(subject).not.toMatch(/\p{Cc}/u);
  });

  it("says that a multi-page event lists more resources in the dashboard", async () => {
    const { deliver, sent } = harness();
    await deliver(raw("docs-account-lambda-planned-lifecycle"));
    expect(sent[0]?.body).toContain("(page 1 of 10; the dashboard has the rest)");
    expect(sent[0]?.body).toContain("arn:lambda-1-101002932 (RESOLVED)");
  });
});
