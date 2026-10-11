import { describe, expect, it } from "vite-plus/test";
import { fleetSettled, parseDiagnose, parseNodeHealth } from "../src/health.ts";

// The sample lines are built from the format strings in crates/celld/fleet.rs at
// v0.6.2. No real `celld diagnose` output was available to copy from.
const row = (verdict: string, check: string, detail = ""): string => JSON.stringify({ verdict, check, detail });
const peer = (node: string, address: string, restoring: number): string =>
  row(
    "ok",
    `peer ${node} at ${address}`,
    `(signed direct probe) protocol=9 owned_cells=12 resident_cells=3 websockets=0 rss_bytes=104857600 in_use_bytes=73400320 cpu_percent=1.25 fds=64/65536 pressured=false shed_cells=0 restoring=${restoring} load_age_ms=812`,
  );
const healthy = [
  row("ok", "bucket s3://example-bucket"),
  row("ok", "bucket conditional write", "(create, reject-create, update, reject-stale)"),
  row("ok", "fleet", "2 node lease(s) enumerated"),
  peer("n1", "10.20.128.11:8081", 0),
  peer("n2", "10.20.144.12:8081", 0),
].join("\n");

describe("what a node says about itself", () => {
  it("is healthy only on celld's own 200", () => {
    expect(parseNodeHealth("ACTIVE active\nHEALTH 200\nVERSION v0.6.2\n")).toEqual({
      active: true,
      healthy: true,
      version: "v0.6.2",
    });
    // 503: draining, or a joining node that has not settled.
    expect(parseNodeHealth("ACTIVE active\nHEALTH 503\nVERSION v0.6.2\n").healthy).toBe(false);
    // 000: curl could not connect.
    expect(parseNodeHealth("ACTIVE activating\nHEALTH 000\nVERSION v0.6.2\n")).toMatchObject({
      active: false,
      healthy: false,
    });
  });

  it("treats missing or strange output as not healthy and version unknown", () => {
    expect(parseNodeHealth("")).toEqual({ active: false, healthy: false, version: null });
    expect(parseNodeHealth("ACTIVE inactive\nHEALTH \nVERSION none\n")).toEqual({
      active: false,
      healthy: false,
      version: null,
    });
  });
});

describe("what `celld diagnose --json` says about the fleet", () => {
  it("reads each live peer and how many cells it is still restoring", () => {
    const view = parseDiagnose(healthy);
    expect(view.peers).toEqual([
      { node: "n1", address: "10.20.128.11:8081", restoring: 0 },
      { node: "n2", address: "10.20.144.12:8081", restoring: 0 },
    ]);
    expect(fleetSettled(view, 2)).toEqual({ settled: true });
  });

  it("is not settled while any node restores", () => {
    const view = parseDiagnose([peer("n1", "10.20.128.11:8081", 0), peer("n2", "10.20.144.12:8081", 3)].join("\n"));
    expect(fleetSettled(view, 2)).toEqual({ settled: false, reasons: ["peer n2 is still restoring 3 cell(s)"] });
  });

  it("is not settled when a node is missing, even if every answer is fine", () => {
    const view = parseDiagnose(
      [peer("n1", "10.20.128.11:8081", 0), row("skip", "peer n2", "lease is expired")].join("\n"),
    );
    expect(view.expired).toBe(1);
    expect(fleetSettled(view, 2)).toEqual({ settled: false, reasons: ["1 live peer(s) answered, expected 2"] });
  });

  it("is not settled on any failed check", () => {
    const view = parseDiagnose(
      [peer("n1", "10.20.128.11:8081", 0), row("fail", "peer n2 at 10.20.144.12:8081", "connection refused")].join(
        "\n",
      ),
    );
    expect(fleetSettled(view, 2)).toMatchObject({ settled: false });
    expect(view.failures).toEqual(["peer n2 at 10.20.144.12:8081: connection refused"]);
  });

  it("fails closed on output it cannot read", () => {
    // The text form, a changed JSON shape, a detail without the field: none of them count as healthy.
    const text = parseDiagnose("ok peer n1 at 10.20.128.11:8081: (signed direct probe) restoring=0\n");
    expect(fleetSettled(text, 1)).toMatchObject({ settled: false });
    const reshaped = parseDiagnose(JSON.stringify({ status: "ok", name: "peer n1 at 10.20.128.11:8081" }));
    expect(fleetSettled(reshaped, 1)).toMatchObject({ settled: false });
    const noField = parseDiagnose(row("ok", "peer n1 at 10.20.128.11:8081", "(signed direct probe) protocol=9"));
    expect(fleetSettled(noField, 1)).toEqual({ settled: false, reasons: ["peer n1 did not report restoring"] });
    expect(fleetSettled(parseDiagnose(""), 1)).toMatchObject({ settled: false });
  });
});
