// node tools/src/fragments/apply.ts <chapter id>
//
// Applies data/fragments/<id>.json to the shared files: the manifest, source
// registry, glossary, section map, pricing data, validation record, toolchain
// list, and the task block in vite.config.ts. Chapters are written in
// parallel; each describes its additions in one fragment so that the shared
// files are only ever edited by this script.
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { repoRoot } from "../data/load.ts";
import {
  chapterSchema,
  glossarySchema,
  sectionMapSchema,
  sourcesSchema,
  toolchainSchema,
  validationSchema,
} from "../data/schemas.ts";
import { allowancesSchema, scenariosSchema, unitPriceSchema } from "../pricing/schema.ts";

const fragmentSchema = z.object({
  chapterId: z.string().regex(/^\d{2}$/),
  manifest: chapterSchema,
  sources: sourcesSchema.shape.sources.default([]),
  glossary: glossarySchema.shape.terms.default([]),
  sections: sectionMapSchema.shape.sections.default([]),
  unitPrices: z.array(unitPriceSchema).default([]),
  allowances: allowancesSchema.shape.allowances.default([]),
  unknownAllowances: allowancesSchema.shape.unknown.default([]),
  scenarios: scenariosSchema.shape.scenarios.default([]),
  validation: z
    .object({ records: validationSchema.shape.records.default([]), open: validationSchema.shape.open.default([]) })
    .default({ records: [], open: [] }),
  toolchain: toolchainSchema.shape.tools.default([]),
  tasks: z.object({
    /** Lines for run.tasks in vite.config.ts, indented with six spaces. May use fresh(), live(), infra(), node. */
    snippet: z.string(),
    /** `<name>:infra:synth` tasks to add to infra:synth. */
    synth: z.array(z.string()).default([]),
    /** Local-only tasks to add to check:all. */
    checkAll: z.array(z.string()).default([]),
    /** Directories with a tsconfig.json for `vp run typecheck`. */
    typecheck: z.array(z.string()).default([]),
  }),
});

const id = process.argv[2];
if (id === undefined) {
  console.error("usage: apply.ts <chapter id>");
  process.exit(64);
}

const path = (file: string) => `${repoRoot}${file}`;
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path(file), "utf8")) as Record<string, unknown>;
const writeJson = (file: string, value: unknown) => writeFileSync(path(file), `${JSON.stringify(value, null, 2)}\n`);

/** Replaces entries with the same key, appends the rest. */
function upsert<T>(existing: T[], incoming: T[], key: (item: T) => string): T[] {
  const incomingKeys = new Set(incoming.map(key));
  return [...existing.filter((item) => !incomingKeys.has(key(item))), ...incoming];
}

const fragment = fragmentSchema.parse(readJson(`data/fragments/${id}.json`));
if (fragment.chapterId !== id || fragment.manifest.id !== id) {
  throw new Error(`data/fragments/${id}.json describes chapter ${fragment.chapterId}/${fragment.manifest.id}`);
}

const manifest = readJson("data/chapters.json") as { chapters: { id: string }[] };
manifest.chapters = manifest.chapters.map((chapter) => (chapter.id === id ? fragment.manifest : chapter));
writeJson("data/chapters.json", manifest);

const sources = readJson("data/sources.json") as { sources: { id: string; checkedAt: string | null }[] };
const merged = upsert(sources.sources, fragment.sources, (source) => source.id);
// Sources that were read stay ahead of the ones only listed for later.
sources.sources = [
  ...merged.filter((source) => source.checkedAt !== null),
  ...merged.filter((source) => source.checkedAt === null),
];
writeJson("data/sources.json", sources);

const glossary = readJson("data/glossary.json") as { terms: { id: string }[] };
const known = new Set(glossary.terms.map((term) => term.id));
glossary.terms.push(...fragment.glossary.filter((term) => !known.has(term.id)));
writeJson("data/glossary.json", glossary);

const sectionMap = readJson("data/section-map.json") as { sections: { id: string }[] };
sectionMap.sections = upsert(sectionMap.sections, fragment.sections, (section) => section.id);
writeJson("data/section-map.json", sectionMap);

const prices = readJson("data/pricing/unit-prices.json") as { prices: { id: string }[] };
prices.prices = upsert(prices.prices, fragment.unitPrices, (price) => price.id);
writeJson("data/pricing/unit-prices.json", prices);

const allowances = readJson("data/pricing/allowances.json") as {
  allowances: { priceId: string }[];
  unknown: { priceId: string }[];
};
allowances.allowances = upsert(allowances.allowances, fragment.allowances, (entry) => entry.priceId);
allowances.unknown = upsert(allowances.unknown, fragment.unknownAllowances, (entry) => entry.priceId);
writeJson("data/pricing/allowances.json", allowances);

const scenarios = readJson("data/pricing/scenarios.json") as { scenarios: { id: string }[] };
scenarios.scenarios = upsert(scenarios.scenarios, fragment.scenarios, (scenario) => scenario.id);
writeJson("data/pricing/scenarios.json", scenarios);

const validation = readJson("data/validation.json") as {
  records: { scope: string; command: string }[];
  open: { id: string }[];
};
validation.records = upsert(
  validation.records,
  fragment.validation.records,
  (record) => `${record.scope}\n${record.command}`,
);
validation.open = upsert(validation.open, fragment.validation.open, (item) => item.id);
writeJson("data/validation.json", validation);

const toolchain = readJson("data/toolchain.json") as { tools: { name: string }[] };
toolchain.tools = upsert(toolchain.tools, fragment.toolchain, (tool) => tool.name);
writeJson("data/toolchain.json", toolchain);

// vite.config.ts: one marked block per chapter, plus three marked lists.
let config = readFileSync(path("vite.config.ts"), "utf8");
const begin = `      // >>> chapter ${id}`;
const end = `      // <<< chapter ${id}`;
const block = `${begin}\n${fragment.tasks.snippet.replace(/\s+$/, "")}\n${end}\n`;
const existing = new RegExp(
  `${begin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n`,
);
const anchor = "      // ---- chapter task blocks are inserted above this line ----\n";
if (existing.test(config)) {
  config = config.replace(existing, block);
} else if (config.includes(anchor)) {
  config = config.replace(anchor, `${block}\n${anchor}`);
} else {
  throw new Error("vite.config.ts has no chapter task anchor");
}

function extendList(marker: string, names: string[]): void {
  const pattern = new RegExp(`(const ${marker} = \\[)([^\\]]*)(\\];)`);
  const match = pattern.exec(config);
  if (match === null) {
    throw new Error(`vite.config.ts has no ${marker} list`);
  }
  const current = [...(match[2] ?? "").matchAll(/"([^"]+)"/g)].map((item) => item[1] as string);
  const next = [...new Set([...current, ...names])];
  config = config.replace(pattern, `$1${next.map((name) => `"${name}"`).join(", ")}$3`);
}
extendList("chapterSynthTasks", fragment.tasks.synth);
extendList("chapterCheckTasks", fragment.tasks.checkAll);
writeFileSync(path("vite.config.ts"), config);

const typecheckPath = "tools/src/checks/typecheck-projects.json";
const projects = JSON.parse(readFileSync(path(typecheckPath), "utf8")) as string[];
writeJson(typecheckPath, [...new Set([...projects, ...fragment.tasks.typecheck])]);

console.log(`applied chapter ${id}. Next: vp run book:generate, then vp check --fix, then vp run check:all`);
