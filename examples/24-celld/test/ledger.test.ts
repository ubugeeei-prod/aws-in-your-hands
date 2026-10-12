import { describe, expect, it } from "vite-plus/test";

import { joinLedgers, judge, judgeCell } from "../src/ledger.ts";
import type { Attempt, ProbeOutput } from "../src/probe.ts";
import { type Flaw, ToyFleet } from "./toy-fleet.ts";

// Every history below comes from test/toy-fleet.ts, a stand-in written for these
// tests. They show that the judge tells a kept promise from a broken one. They
// say nothing about celld: the judge has never been pointed at a real fleet.

const CELLS = 3;

/** Writes before the fault, the fault, writes after it, then one read-back through each node still up. */
function history(flaw: Flaw, fault: (fleet: ToyFleet) => string[]) {
  const fleet = new ToyFleet(["a", "b", "c"], flaw);
  const round = (via: string): void => {
    for (let cell = 1; cell <= CELLS; cell += 1) {
      fleet.request(via, cell);
    }
  };
  round("a");
  round("a");
  const faultAtSeq = fleet.attempts.length + 1;
  const survivors = fault(fleet);
  const [witness] = survivors;
  if (witness === undefined) {
    throw new Error("the fault left nobody to ask");
  }
  round(witness);
  for (const node of survivors) {
    round(node);
  }
  return { fleet, report: judge(fleet.output(), { cells: CELLS, faultAtSeq }) };
}

describe("after a node is lost, every acknowledged increment is still there", () => {
  it("holds for a fleet that makes a write durable before it answers", () => {
    const { report } = history("sound", (fleet) => {
      fleet.kill("a");
      return ["b", "c"];
    });
    expect(report.violations).toEqual([]);
    expect(report.verdict).toBe("held");
    expect(report.cells.map((cell) => cell.lastValue)).toEqual([5, 5, 5]);
  });

  it("is broken by a fleet that answers before the write is durable", () => {
    const { report } = history("acks-before-durable", (fleet) => {
      fleet.kill("a");
      return ["b", "c"];
    });
    expect(report.verdict).toBe("violated");
    expect(report.violations.map((violation) => violation.kind)).toEqual(
      Array(CELLS).fill("acknowledged-write-lost"),
    );
    expect(report.violations[0]?.detail).toBe("answered 1 after 2 had been acknowledged");
  });

  it("is not broken by the same flaw while nothing fails", () => {
    // The flaw is invisible until a node is lost. That is why the check injects a fault at all.
    const { report } = history("acks-before-durable", () => ["a"]);
    expect(report.verdict).toBe("held");
  });
});

describe("one writer at a time, as a client can see it", () => {
  it("holds when a frozen owner comes back and finds its cells taken", () => {
    const { report } = history("sound", (fleet) => {
      fleet.freeze("a");
      fleet.request("b", 1);
      fleet.resume("a");
      return ["a", "b"];
    });
    expect(report.verdict).toBe("held");
  });

  it("is broken when the old owner keeps serving from memory", () => {
    const { report } = history("ignores-the-fence", (fleet) => {
      fleet.freeze("a");
      // b takes cell 1 over and moves it forward while a cannot see.
      fleet.request("b", 1);
      fleet.request("b", 1);
      fleet.resume("a");
      // The read-back goes through b, then a: two owners give two different answers.
      return ["b", "a"];
    });
    expect(report.verdict).toBe("violated");
    expect(
      report.violations.some(
        (violation) => violation.kind === "acknowledged-write-lost" && violation.cell === 1,
      ),
    ).toBe(true);
  });

  it("needs the read-back through every node to see it", () => {
    const { report } = history("ignores-the-fence", (fleet) => {
      fleet.freeze("a");
      fleet.request("b", 1);
      fleet.resume("a");
      // Asking only b: the stale owner is never heard, so nothing looks wrong.
      return ["b"];
    });
    expect(report.verdict).toBe("held");
  });
});

describe("a request without an answer", () => {
  it("may have been applied: the next value can be one higher, and that is not a fault", () => {
    const fleet = new ToyFleet(["a", "b"]);
    fleet.request("a", 1);
    fleet.loseNextResponse();
    expect(fleet.request("a", 1)).toMatchObject({ status: 0, n: null });
    expect(fleet.request("a", 1)).toMatchObject({ status: 200, n: 3 });
    expect(judge(fleet.output(), { cells: 1 }).verdict).toBe("held");
  });

  it("explains one extra step, not two: a request applied twice is reported", () => {
    const { report } = history("replays-requests", () => ["b"]);
    expect(report.verdict).toBe("violated");
    expect(report.violations[0]).toMatchObject({ kind: "unexplained-write", cell: 1 });
  });

  it("does not excuse a counter that went back", () => {
    const attempts: Attempt[] = [
      { seq: 1, cell: 1, status: 200, n: 1 },
      { seq: 2, cell: 1, status: 503, n: null },
      { seq: 3, cell: 1, status: 0, n: null },
      { seq: 4, cell: 1, status: 200, n: 1 },
    ];
    expect(judgeCell(1, attempts).violations).toEqual([
      {
        kind: "acknowledged-write-lost",
        cell: 1,
        seq: 4,
        detail: "answered 1 after 1 had been acknowledged",
      },
    ]);
  });

  it("is never counted as an acknowledgement, whatever the body said", () => {
    const { summary, violations } = judgeCell(1, [
      { seq: 1, cell: 1, status: 200, n: 1 },
      { seq: 2, cell: 1, status: 500, n: 2 },
      { seq: 3, cell: 1, status: 200, n: null },
      { seq: 4, cell: 1, status: 200, n: 3 },
    ]);
    expect(summary).toMatchObject({ acknowledged: 2, unknown: 2, longestOutage: 2, lastValue: 3 });
    expect(violations).toEqual([]);
  });
});

describe("what the check refuses to conclude", () => {
  const ok = (seq: number, cell: number, n: number): Attempt => ({ seq, cell, status: 200, n });
  const ledger = (attempts: Attempt[], rest: Partial<ProbeOutput> = {}): ProbeOutput => ({
    attempts,
    complete: true,
    malformed: [],
    ...rest,
  });

  it("is inconclusive when a cell never answered again after the fault", () => {
    const report = judge(ledger([ok(1, 1, 1), { seq: 2, cell: 1, status: 503, n: null }]), {
      cells: 1,
      faultAtSeq: 2,
    });
    expect(report.verdict).toBe("inconclusive");
    expect(report.notes).toEqual([
      "cell 1: no acknowledgement after the fault, so its earlier writes were never read back",
    ]);
  });

  it("is inconclusive when nothing had been acknowledged before the fault", () => {
    const report = judge(ledger([{ seq: 1, cell: 1, status: 503, n: null }, ok(2, 1, 1)]), {
      cells: 1,
      faultAtSeq: 2,
    });
    expect(report.verdict).toBe("inconclusive");
  });

  it("is inconclusive when the output was cut off or held lines it could not read", () => {
    expect(judge(ledger([ok(1, 1, 1)], { complete: false }), { cells: 1 }).verdict).toBe(
      "inconclusive",
    );
    expect(judge(ledger([ok(1, 1, 1)], { malformed: ["curl: (7)"] }), { cells: 1 }).verdict).toBe(
      "inconclusive",
    );
  });

  it("is inconclusive when a cell is missing from the ledger", () => {
    expect(judge(ledger([ok(1, 1, 1)]), { cells: 2 }).verdict).toBe("inconclusive");
  });

  it("still reports a violation in an incomplete ledger", () => {
    const report = judge(ledger([ok(1, 1, 2), ok(2, 1, 1)], { complete: false }), { cells: 1 });
    expect(report.verdict).toBe("violated");
  });

  it("joins several probe runs into one ordered ledger", () => {
    const joined = joinLedgers([
      ledger([ok(1, 1, 1), ok(2, 1, 2)]),
      ledger([ok(1, 1, 3)]),
      ledger([], { complete: false }),
    ]);
    expect(joined.attempts.map((attempt) => attempt.seq)).toEqual([1, 2, 3]);
    expect(joined.complete).toBe(false);
  });
});
