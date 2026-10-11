import { describe, expect, it } from "vite-plus/test";
import { eventRecordSchema, parseIvsEvent, toRecord } from "../src/events.ts";
import { handleEvent } from "../src/handler.ts";
import { parseLoggedEvents } from "../src/logged-events.ts";
import { bitrateBreach, channelArn, stateChange } from "./events.ts";

const streamId = "st-1A2b3c4D5e6F78ghij9Klmn";

describe("IVS events", () => {
  it("reads a stream state change", () => {
    const record = toRecord(
      parseIvsEvent(stateChange("Stream Start", streamId, "2026-10-11T10:00:07Z")),
      new Date("2026-10-11T10:00:09.500Z"),
    );
    expect(record).toMatchObject({ name: "Stream Start", streamId, channelArn, lagMs: 2500, detail: null });
  });

  it("keeps the reason a session ended", () => {
    const event = stateChange("Session Ended", streamId, "2026-10-11T10:00:07Z", { code: "MultitrackInputNotAllowed" });
    expect(toRecord(parseIvsEvent(event), new Date("2026-10-11T10:00:08Z")).detail).toBe("MultitrackInputNotAllowed");
  });

  it("reads a limit breach with its numbers", () => {
    const record = toRecord(parseIvsEvent(bitrateBreach), new Date("2026-10-11T10:05:01Z"));
    expect(record).toMatchObject({ name: "Ingest Bitrate", detail: "3500000 bits per second, exceeded by 1200000" });
  });

  it("records an event name it has never seen", () => {
    const record = toRecord(
      parseIvsEvent(stateChange("Some Future Event", streamId, "2026-10-11T10:00:07Z")),
      new Date("2026-10-11T10:00:08Z"),
    );
    expect(record.name).toBe("Some Future Event");
  });

  it("refuses events from another source", () => {
    expect(() =>
      parseIvsEvent({ ...stateChange("Stream Start", streamId, "2026-10-11T10:00:07Z"), source: "x" }),
    ).toThrow();
  });

  it("shows an event that arrived hours late as late", () => {
    const record = toRecord(
      parseIvsEvent(stateChange("Stream End", streamId, "2026-10-11T10:00:00Z")),
      new Date("2026-10-11T13:00:00Z"),
    );
    expect(record.lagMs).toBe(3 * 3_600_000);
  });
});

describe("event handler", () => {
  const now = new Date("2026-10-11T10:00:09Z");

  it("writes one record that the status script can read back", () => {
    const lines: string[] = [];
    expect(handleEvent(stateChange("Stream Start", streamId, "2026-10-11T10:00:07Z"), now, (l) => lines.push(l))).toBe(
      true,
    );
    expect(lines).toHaveLength(1);
    expect(eventRecordSchema.parse(JSON.parse(lines[0] ?? ""))).toMatchObject({ name: "Stream Start" });
  });

  it("logs an unreadable event and does not throw", () => {
    const lines: string[] = [];
    expect(handleEvent({ source: "aws.ivs", "detail-type": "IVS Something New" }, now, (l) => lines.push(l))).toBe(
      false,
    );
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ kind: "ivs-event-unreadable" });
  });
});

describe("events read back from the log", () => {
  const line = (event: unknown): string => {
    const lines: string[] = [];
    handleEvent(event, new Date("2026-10-11T10:00:09Z"), (l) => lines.push(l));
    return `2026-10-11T10:00:09.000Z\t4f6a0c1e-0000-4000-8000-000000000000\tINFO\t${lines[0] ?? ""}`;
  };

  it("counts an event delivered twice once", () => {
    const start = line(stateChange("Stream Start", streamId, "2026-10-11T10:00:07Z"));
    expect(parseLoggedEvents([start, start])).toHaveLength(1);
  });

  it("skips Lambda's own lines and other JSON", () => {
    const messages = [
      "START RequestId: 4f6a0c1e Version: $LATEST",
      "REPORT RequestId: 4f6a0c1e Duration: 2.31 ms Billed Duration: 3 ms",
      '{"kind":"ivs-event-unreadable","issues":[]}',
      "INFO {not json",
      line(stateChange("Stream End", streamId, "2026-10-11T11:00:00Z")),
    ];
    expect(parseLoggedEvents(messages).map((record) => record.name)).toEqual(["Stream End"]);
  });

  it("orders by event time, not by arrival", () => {
    const end = line(stateChange("Stream End", streamId, "2026-10-11T11:00:00Z"));
    const start = line(stateChange("Stream Start", streamId, "2026-10-11T10:00:07Z"));
    expect(parseLoggedEvents([end, start]).map((record) => record.name)).toEqual(["Stream Start", "Stream End"]);
  });
});
