// Batch inference: the same requests, written to a file, answered some time later at half
// the price. This file shapes the input and reads the output. Nothing here calls AWS.

import * as v from "valibot";

import { converseResponseSchema } from "@aih/example-17-ai/src/converse-stream.ts";
import { buildSummaryRequest } from "@aih/example-17-ai/src/prompt.ts";

// #region limits
/** The published defaults for Nova 2 Lite and Claude Haiku 4.5, read on 2026-10-13. */
export type BatchLimits = { minRecords: number; maxRecordsPerFile: number; maxFileBytes: number };

export const BATCH_LIMITS: BatchLimits = {
  minRecords: 100,
  maxRecordsPerFile: 100_000,
  maxFileBytes: 1024 ** 3,
};
// #endregion limits

// #region record
export type BatchRecord = { recordId: string; modelInput: Record<string, unknown> };

const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** One note as one line of the input file. The body is a Converse request without its model ID. */
export function summaryRecord(
  note: { id: string; title: string; body: string },
  maxOutputTokens: number,
): BatchRecord {
  if (!RECORD_ID.test(note.id)) {
    throw new Error(`"${note.id}" cannot be a record ID`);
  }
  // The model is named once, on the job. Every record shares it.
  const { modelId: _modelId, ...modelInput } = buildSummaryRequest(note, {
    modelId: "",
    maxOutputTokens,
  });
  return { recordId: note.id, modelInput };
}

export const toJsonl = (records: BatchRecord[]): string =>
  records.map((record) => `${JSON.stringify(record)}\n`).join("");
// #endregion record

// #region plan
export type BatchPlan =
  | { ok: true; records: number; bytes: number }
  | { ok: false; problems: string[] };

/** Whether one input file is within the job's limits, checked before anything is uploaded. */
export function planBatch(records: BatchRecord[], limits: BatchLimits = BATCH_LIMITS): BatchPlan {
  const problems: string[] = [];
  const bytes = Buffer.byteLength(toJsonl(records), "utf8");
  if (records.length < limits.minRecords) {
    problems.push(`${records.length} records: a job needs at least ${limits.minRecords}`);
  }
  if (records.length > limits.maxRecordsPerFile) {
    problems.push(`${records.length} records: one file holds at most ${limits.maxRecordsPerFile}`);
  }
  if (bytes > limits.maxFileBytes) {
    problems.push(`${bytes} bytes: one file holds at most ${limits.maxFileBytes}`);
  }
  if (new Set(records.map((record) => record.recordId)).size !== records.length) {
    // The output does not keep the input's order. The record ID is the only way back.
    problems.push("record IDs are not unique");
  }
  return problems.length === 0
    ? { ok: true, records: records.length, bytes }
    : { ok: false, problems };
}
// #endregion plan

// #region output
const outputLineSchema = v.union([
  v.object({ recordId: v.string(), modelOutput: converseResponseSchema }),
  v.object({
    recordId: v.string(),
    error: v.object({ errorCode: v.number(), errorMessage: v.string() }),
  }),
]);

export type BatchResult =
  | { recordId: string; ok: true; summary: string; complete: boolean }
  | { recordId: string; ok: false; reason: string };

/** One line of the output file. A line that fits neither shape is a failure, not a crash. */
export function parseOutputLine(line: string): BatchResult {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { recordId: "", ok: false, reason: "not JSON" };
  }
  const parsed = v.safeParse(outputLineSchema, json);
  if (!parsed.success) {
    return { recordId: "", ok: false, reason: "not a batch output line" };
  }
  if ("error" in parsed.output) {
    const { errorCode, errorMessage } = parsed.output.error;
    return { recordId: parsed.output.recordId, ok: false, reason: `${errorCode} ${errorMessage}` };
  }
  const { output, stopReason } = parsed.output.modelOutput;
  return {
    recordId: parsed.output.recordId,
    ok: true,
    summary: output.message.content.map((block) => block.text ?? "").join(""),
    // As in chapter 17: a summary that stopped for any other reason is not saved as one.
    complete: stopReason === "end_turn",
  };
}

export const manifestSchema = v.object({
  totalRecordCount: v.number(),
  processedRecordCount: v.number(),
  successRecordCount: v.number(),
  errorRecordCount: v.number(),
  inputTokenCount: v.number(),
  outputTokenCount: v.number(),
});
// #endregion output
