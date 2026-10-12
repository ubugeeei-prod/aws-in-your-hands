import * as v from "valibot";

import described from "../fixtures/converse/described.json" with { type: "json" };
import maxTokens from "../fixtures/converse/max-tokens.json" with { type: "json" };
import refused from "../fixtures/converse/refused.json" with { type: "json" };
import throttledThenDescribed from "../fixtures/converse/throttled-then-described.json" with { type: "json" };
import { type Script, scriptSchema } from "./scripted-model.ts";

export const scriptNames = [
  "described",
  "refused",
  "max-tokens",
  "throttled-then-described",
] as const;
export type ScriptName = (typeof scriptNames)[number];

export const scripts: Record<ScriptName, Script> = {
  described: v.parse(scriptSchema, described),
  refused: v.parse(scriptSchema, refused),
  "max-tokens": v.parse(scriptSchema, maxTokens),
  "throttled-then-described": v.parse(scriptSchema, throttledThenDescribed),
};

/** A 1 x 1 PNG: the smallest thing chapter 07 would have accepted as an upload. */
export const SAMPLE_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);
