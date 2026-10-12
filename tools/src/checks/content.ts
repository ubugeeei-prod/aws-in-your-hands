// vp run content:check
//
// Do both languages, the manifest, the section map, and the examples still
// describe the same book? Reads only this checkout.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import config from "../../../vite.config.ts";
import { loadManifest, loadSectionMap, loadSources, repoRoot } from "../data/load.ts";
import { hasRegion, type Page, parsePage } from "./markdown.ts";

const problems: string[] = [];
const fail = (message: string): void => void problems.push(message);

const content = join(repoRoot, "book/content");
/** Markdown files under `directory`, as paths relative to `base`. */
const walk = (directory: string, base = directory): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory()
      ? walk(path, base)
      : path.endsWith(".md")
        ? [relative(base, path)]
        : [];
  });
const read = (path: string): Page => parsePage(readFileSync(join(content, path), "utf8"));

const manifest = loadManifest();
const sectionMap = loadSectionMap();
const sourceIds = new Set(loadSources().sources.map((source) => source.id));
const tasks = new Set(
  Object.keys((config as { run?: { tasks?: Record<string, unknown> } }).run?.tasks ?? {}),
);

// Files the reader would receive: tracked, or new and not ignored.
const distributed = new Set(
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line !== ""),
);

// 1. Every page exists in both languages with the same structure.
const jaPages = walk(join(content, "ja"));
const enPages = walk(join(content, "en"));
for (const path of jaPages.filter((page) => !enPages.includes(page))) {
  fail(`en/${path} is missing (ja/${path} exists)`);
}
for (const path of enPages.filter((page) => !jaPages.includes(page))) {
  fail(`ja/${path} is missing (en/${path} exists)`);
}

const allSections = new Set<string>();
for (const path of jaPages.filter((page) => enPages.includes(page))) {
  const ja = read(`ja/${path}`);
  const en = read(`en/${path}`);
  const same = (label: string, a: unknown, b: unknown): void => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      fail(
        `${path}: ${label} differ between ja and en\n      ja: ${JSON.stringify(a)}\n      en: ${JSON.stringify(b)}`,
      );
    }
  };
  same("section markers", ja.sections, en.sections);
  same("snippet imports", ja.imports, en.imports);
  same("diagrams (```text blocks)", ja.diagrams, en.diagrams);
  same("number of headings", ja.headings, en.headings);
  same("number of code blocks", ja.codeBlocks, en.codeBlocks);

  for (const section of ja.sections) {
    if (allSections.has(section)) {
      fail(`${path}: section ${section} is declared more than once`);
    }
    allSections.add(section);
  }

  // 2. Snippets come from files that exist, are distributed, and have the region.
  for (const snippet of ja.imports) {
    const file = join(repoRoot, snippet.path);
    if (!existsSync(file)) {
      fail(`${path}: imports ${snippet.path}, which does not exist`);
    } else if (!distributed.has(snippet.path)) {
      fail(
        `${path}: imports ${snippet.path}, which is ignored by git and would not be distributed`,
      );
    } else if (
      snippet.region !== undefined &&
      !hasRegion(readFileSync(file, "utf8"), snippet.region)
    ) {
      fail(`${path}: imports region "${snippet.region}" that ${snippet.path} does not declare`);
    }
  }

  // 3. Internal links point at pages that exist.
  for (const [locale, page] of [
    ["ja", ja],
    ["en", en],
  ] as const) {
    for (const link of page.links) {
      if (link.endsWith(".md") && !existsSync(join(content, link))) {
        fail(`${locale}/${path}: links to ${link}, which does not exist`);
      }
      if (link.endsWith(".md") && !link.startsWith(`/${locale}/`)) {
        fail(`${locale}/${path}: links to ${link}, a page in the other language`);
      }
    }
  }
}

// 4. Written chapters: revisions line up, so a stale translation is visible.
for (const chapter of manifest.chapters) {
  const file = `chapters/${chapter.id}-${chapter.slug}.md`;
  if (!jaPages.includes(file)) {
    fail(`chapter ${chapter.id}: ja/${file} is missing`);
    continue;
  }
  for (const id of chapter.sourceIds) {
    if (!sourceIds.has(id)) {
      fail(`chapter ${chapter.id}: source "${id}" is not in data/sources.json`);
    }
  }
  for (const id of chapter.prerequisites) {
    if (!manifest.chapters.some((candidate) => candidate.id === id)) {
      fail(`chapter ${chapter.id}: prerequisite ${id} does not exist`);
    }
  }
  if (chapter.writing.ja === "planned") {
    continue;
  }
  const ja = read(`ja/${file}`);
  const en = enPages.includes(file) ? read(`en/${file}`) : undefined;
  if (!("sourceRevision" in chapter)) {
    continue;
  }
  if (ja.frontmatter["revision"] !== String(chapter.sourceRevision)) {
    fail(
      `chapter ${chapter.id}: ja revision is ${ja.frontmatter["revision"]}, manifest sourceRevision is ${chapter.sourceRevision}`,
    );
  }
  if (
    en !== undefined &&
    en.frontmatter["sourceRevision"] !== String(chapter.translatedRevision.en)
  ) {
    fail(
      `chapter ${chapter.id}: en sourceRevision is ${en.frontmatter["sourceRevision"]}, manifest translatedRevision.en is ${chapter.translatedRevision.en}`,
    );
  }
  if (chapter.translatedRevision.en !== chapter.sourceRevision) {
    fail(
      `chapter ${chapter.id}: the English text was translated from revision ${chapter.translatedRevision.en}, but the Japanese source is at ${chapter.sourceRevision}`,
    );
  }
  if (chapter.samplePath !== null && !existsSync(join(repoRoot, chapter.samplePath))) {
    fail(`chapter ${chapter.id}: samplePath ${chapter.samplePath} does not exist`);
  }
  if (ja.sections.filter((section) => section.startsWith(`${chapter.id}.`)).length === 0) {
    fail(
      `chapter ${chapter.id}: has no section markers, so nothing maps its explanations to source`,
    );
  }
}

// 5. The section-to-source map covers every marked section, and only real things.
const mapped = new Set(sectionMap.sections.map((section) => section.id));
for (const id of allSections) {
  if (!mapped.has(id)) {
    fail(`section ${id} is marked in the prose but missing from data/section-map.json`);
  }
}
for (const section of sectionMap.sections) {
  if (!allSections.has(section.id)) {
    fail(`data/section-map.json: section ${section.id} is not marked in any page`);
  }
  for (const source of section.sources) {
    if (!existsSync(join(repoRoot, source))) {
      fail(`section ${section.id}: source ${source} does not exist`);
    } else if (!statSync(join(repoRoot, source)).isDirectory() && !distributed.has(source)) {
      fail(
        `section ${section.id}: source ${source} is ignored by git and would not be distributed`,
      );
    }
  }
  for (const task of section.tasks) {
    if (!tasks.has(task)) {
      fail(`section ${section.id}: task "${task}" is not defined in vite.config.ts`);
    }
  }
  if (section.verification === "aws") {
    fail(
      `section ${section.id}: is marked verified in AWS; record the run in data/validation.json and relax this check when that is true`,
    );
  }
}

// 6. Distributed code is finished code.
for (const path of distributed) {
  if (
    /^(examples|tools|book\/infra)\/.*\.(ts|js|vue)$/.test(path) &&
    !path.startsWith("tools/src/checks/")
  ) {
    const source = readFileSync(join(repoRoot, path), "utf8");
    if (/\b(TODO|FIXME|XXX)\b/.test(source)) {
      fail(`${path}: contains an unfinished-work marker`);
    }
  }
}

if (problems.length > 0) {
  console.error(
    `content check found ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`,
  );
  process.exit(1);
}
console.log(
  `content check passed: ${jaPages.length} pages per language, ${allSections.size} mapped sections, ${manifest.chapters.length} chapters`,
);
