import * as v from "valibot";

import alwaysThrottled from "../fixtures/transcripts/always-throttled.json" with { type: "json" };
import answerDirect from "../fixtures/transcripts/answer-direct.json" with { type: "json" };
import cutMidAnswer from "../fixtures/transcripts/cut-mid-answer.json" with { type: "json" };
import cutMidToolUse from "../fixtures/transcripts/cut-mid-tool-use.json" with { type: "json" };
import guardrailBlocked from "../fixtures/transcripts/guardrail-blocked.json" with { type: "json" };
import injected from "../fixtures/transcripts/injected.json" with { type: "json" };
import inventedTool from "../fixtures/transcripts/invented-tool.json" with { type: "json" };
import malformedInput from "../fixtures/transcripts/malformed-input.json" with { type: "json" };
import runawayTools from "../fixtures/transcripts/runaway-tools.json" with { type: "json" };
import structuredJsonValid from "../fixtures/transcripts/structured-json-valid.json" with { type: "json" };
import structuredMaxTokens from "../fixtures/transcripts/structured-max-tokens.json" with { type: "json" };
import structuredToolRepair from "../fixtures/transcripts/structured-tool-repair.json" with { type: "json" };
import structuredToolValid from "../fixtures/transcripts/structured-tool-valid.json" with { type: "json" };
import structuredUnrepairable from "../fixtures/transcripts/structured-unrepairable.json" with { type: "json" };
import throttledThenAnswer from "../fixtures/transcripts/throttled-then-answer.json" with { type: "json" };
import toolThenAnswer from "../fixtures/transcripts/tool-then-answer.json" with { type: "json" };
import { type Transcript, transcriptSchema } from "./scripted-model.ts";

export const transcriptNames = [
  "answer-direct",
  "tool-then-answer",
  "invented-tool",
  "malformed-input",
  "guardrail-blocked",
  "cut-mid-tool-use",
  "cut-mid-answer",
  "throttled-then-answer",
  "always-throttled",
  "runaway-tools",
  "injected",
  "structured-tool-valid",
  "structured-tool-repair",
  "structured-json-valid",
  "structured-unrepairable",
  "structured-max-tokens",
] as const;
export type TranscriptName = (typeof transcriptNames)[number];

const raw: Record<TranscriptName, unknown> = {
  "answer-direct": answerDirect,
  "tool-then-answer": toolThenAnswer,
  "invented-tool": inventedTool,
  "malformed-input": malformedInput,
  "guardrail-blocked": guardrailBlocked,
  "cut-mid-tool-use": cutMidToolUse,
  "cut-mid-answer": cutMidAnswer,
  "throttled-then-answer": throttledThenAnswer,
  "always-throttled": alwaysThrottled,
  "runaway-tools": runawayTools,
  injected,
  "structured-tool-valid": structuredToolValid,
  "structured-tool-repair": structuredToolRepair,
  "structured-json-valid": structuredJsonValid,
  "structured-unrepairable": structuredUnrepairable,
  "structured-max-tokens": structuredMaxTokens,
};

/** Every transcript, checked against the schema when this file loads. */
export const transcripts = Object.fromEntries(
  transcriptNames.map((name) => [name, v.parse(transcriptSchema, raw[name])]),
) as Record<TranscriptName, Transcript>;
