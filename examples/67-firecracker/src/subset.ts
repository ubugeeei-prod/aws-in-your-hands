// Reads the committed part of the specification. Kept apart from spec.ts so that file stays pure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as v from "valibot";

import { SPEC, type SpecSubset, specSubsetSchema } from "./spec.ts";

/** Relative to the example directory, where the tasks run. */
export const SUBSET_FILE = `spec/firecracker-v${SPEC.version}.subset.json`;

export function loadSubset(): SpecSubset {
  const file = fileURLToPath(new URL(`../${SUBSET_FILE}`, import.meta.url));
  return v.parse(specSubsetSchema, JSON.parse(readFileSync(file, "utf8")));
}
