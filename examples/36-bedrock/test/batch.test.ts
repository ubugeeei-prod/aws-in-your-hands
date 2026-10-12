import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import {
  manifestSchema,
  parseOutputLine,
  planBatch,
  summaryRecord,
  toJsonl,
} from "../src/batch.ts";

const note = (n: number) => ({
  id: `n${n}`,
  title: `note ${n}`,
  body: "金曜までに負荷試験を終える。",
});
const records = (count: number) =>
  Array.from({ length: count }, (_, n) => summaryRecord(note(n), 400));

describe("batch input", () => {
  it("writes one Converse request per line, without a model ID", () => {
    const [record] = records(1);
    expect(record?.recordId).toBe("n0");
    expect(Object.keys(record?.modelInput ?? {}).toSorted()).toEqual([
      "inferenceConfig",
      "messages",
      "system",
    ]);
    expect(record?.modelInput["inferenceConfig"]).toMatchObject({ maxTokens: 400 });

    const lines = toJsonl(records(3)).split("\n");
    expect(lines).toHaveLength(4);
    expect(lines.at(-1)).toBe("");
    expect(JSON.parse(lines[2] ?? "")).toMatchObject({ recordId: "n2" });
  });

  it("refuses a note ID that could not be found again in the output", () => {
    expect(() => summaryRecord({ ...note(1), id: "a b" }, 400)).toThrow(/record ID/);
  });

  it("refuses a job below the minimum before anything is uploaded", () => {
    expect(planBatch(records(99))).toEqual({
      ok: false,
      problems: ["99 records: a job needs at least 100"],
    });
    expect(planBatch(records(100))).toMatchObject({ ok: true, records: 100 });
  });

  it("refuses duplicate record IDs and a file over the size limit", () => {
    const twice = [...records(100), ...records(1)];
    expect(planBatch(twice)).toMatchObject({ ok: false, problems: ["record IDs are not unique"] });
    const small = { minRecords: 1, maxRecordsPerFile: 2, maxFileBytes: 100 };
    const plan = planBatch(records(3), small);
    expect(plan.ok ? [] : plan.problems).toHaveLength(2);
  });
});

describe("batch output", () => {
  const modelOutput = {
    output: { message: { role: "assistant", content: [{ text: "負荷試験が残っています。" }] } },
    stopReason: "end_turn",
    usage: { inputTokens: 210, outputTokens: 14, totalTokens: 224 },
  };

  it("reads a summary and whether it is whole", () => {
    const line = JSON.stringify({ recordId: "n1", modelInput: {}, modelOutput });
    expect(parseOutputLine(line)).toEqual({
      recordId: "n1",
      ok: true,
      summary: "負荷試験が残っています。",
      complete: true,
    });
    const cut = JSON.stringify({
      recordId: "n2",
      modelOutput: { ...modelOutput, stopReason: "max_tokens" },
    });
    expect(parseOutputLine(cut)).toMatchObject({ ok: true, complete: false });
  });

  it("reads a line that carries an error in place of an output", () => {
    const line = JSON.stringify({
      recordId: "n3",
      modelInput: {},
      error: { errorCode: 400, errorMessage: "bad request" },
    });
    expect(parseOutputLine(line)).toEqual({ recordId: "n3", ok: false, reason: "400 bad request" });
  });

  it("calls anything else a failure instead of throwing", () => {
    expect(parseOutputLine("{")).toMatchObject({ ok: false });
    expect(parseOutputLine('{"recordId":"n4"}')).toMatchObject({ ok: false });
  });

  it("reads the manifest's counts", () => {
    const manifest = {
      totalRecordCount: 100,
      processedRecordCount: 100,
      successRecordCount: 98,
      errorRecordCount: 2,
      inputTokenCount: 21_000,
      outputTokenCount: 1_400,
    };
    expect(v.parse(manifestSchema, manifest).errorRecordCount).toBe(2);
  });
});
