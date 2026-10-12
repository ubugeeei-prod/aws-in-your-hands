import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as v from "valibot";

import { allowancesSchema, scenariosSchema, unitPricesSchema } from "../pricing/schema.ts";
import {
  glossarySchema,
  manifestSchema,
  sectionMapSchema,
  sourcesSchema,
  toolchainSchema,
  validationSchema,
} from "./schemas.ts";

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function load<T>(path: string, schema: v.GenericSchema<unknown, T>): T {
  const result = v.safeParse(
    schema,
    JSON.parse(readFileSync(new URL(path, `file://${repoRoot}`), "utf8")),
  );
  if (!result.success) {
    const problems = result.issues
      .slice(0, 10)
      .map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`${path} is not valid:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}

export const loadManifest = () => load("data/chapters.json", manifestSchema);
export const loadSources = () => load("data/sources.json", sourcesSchema);
export const loadGlossary = () => load("data/glossary.json", glossarySchema);
export const loadSectionMap = () => load("data/section-map.json", sectionMapSchema);
export const loadValidation = () => load("data/validation.json", validationSchema);
export const loadToolchain = () => load("data/toolchain.json", toolchainSchema);

export const loadPricing = () => ({
  prices: load("data/pricing/unit-prices.json", unitPricesSchema),
  allowances: load("data/pricing/allowances.json", allowancesSchema),
  scenarios: load("data/pricing/scenarios.json", scenariosSchema),
});
