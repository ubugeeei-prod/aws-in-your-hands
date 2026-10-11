// vp run book:generate          writes the generated pages
// vp run book:generate:check    fails when a generated page is out of date
//
// Both locales are rendered from the same data/*.json record, so they cannot
// disagree about a price, a source, or a validation status.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  loadGlossary,
  loadManifest,
  loadPricing,
  loadSources,
  loadToolchain,
  loadValidation,
  repoRoot,
} from "../data/load.ts";
import type { Chapter, PlannedChapter } from "../data/schemas.ts";
import { calculate } from "../pricing/calc.ts";

type Locale = "ja" | "en";
const LOCALES: Locale[] = ["ja", "en"];
const t = <T>(locale: Locale, ja: T, en: T): T => (locale === "ja" ? ja : en);

const manifest = loadManifest();
const sources = loadSources();
const sourceById = new Map(sources.sources.map((source) => [source.id, source]));

const header = (locale: Locale, title: string, from: string) =>
  [
    "---",
    `title: ${JSON.stringify(title)}`,
    "generated: true",
    "---",
    "",
    `<!-- ${t(locale, "生成ファイル。編集しないこと。生成元", "Generated file. Do not edit. Source")}: ${from} (tools/src/book/generate.ts) -->`,
    "",
  ].join("\n");

const chapterPath = (locale: Locale, chapter: Chapter) => `/${locale}/chapters/${chapter.id}-${chapter.slug}.md`;
const chapterRef = (locale: Locale, id: string): string => {
  const chapter = manifest.chapters.find((candidate) => candidate.id === id);
  if (chapter === undefined) {
    throw new Error(`Unknown chapter ${id}`);
  }
  return `[${chapter.id} ${chapter.title[locale]}](${chapterPath(locale, chapter)})`;
};
const bullets = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

function sourceLine(locale: Locale, id: string): string {
  const source = sourceById.get(id);
  if (source === undefined) {
    throw new Error(`Unknown source ${id}`);
  }
  const checked =
    source.checkedAt === null
      ? t(locale, "執筆時に未再確認", "not re-read while writing")
      : t(locale, `確認日 ${source.checkedAt}`, `checked ${source.checkedAt}`);
  return `- [${source.title}](${source.url}) (${checked})`;
}

function plannedChapter(locale: Locale, chapter: PlannedChapter): string {
  const { outline } = chapter;
  const paths = Object.entries(manifest.paths)
    .filter(([, ids]) => ids.includes(chapter.id))
    .map(([name]) => `\`${name}\``);
  return [
    header(locale, `${chapter.id} ${chapter.title[locale]}`, "data/chapters.json"),
    `# ${chapter.id} ${chapter.title[locale]}`,
    "",
    t(
      locale,
      "> [!NOTE]\n> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`" +
        (chapter.samplePath ?? "") +
        "` はまだ存在しません。",
      "> [!NOTE]\n> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `" +
        (chapter.samplePath ?? "") +
        "` does not exist yet.",
    ),
    "",
    `## ${t(locale, "この章の成果", "Outcome")}`,
    "",
    outline.outcome[locale],
    "",
    `## ${t(locale, "前提", "Prerequisites")}`,
    "",
    chapter.prerequisites.length === 0
      ? t(locale, "なし", "None")
      : bullets(chapter.prerequisites.map((id) => chapterRef(locale, id))),
    "",
    paths.length === 0 ? "" : `${t(locale, "読書経路", "Reading paths")}: ${paths.join(", ")}\n`,
    `## ${t(locale, "構成案", "Planned architecture")}`,
    "",
    outline.architecture[locale],
    "",
    `${t(locale, "使うサービス", "Services")}: ${chapter.services.join(", ")}`,
    "",
    `## ${t(locale, "扱う内容", "Topics")}`,
    "",
    bullets(outline.topics[locale]),
    "",
    `## ${t(locale, "分散システムとして見る点", "The distributed-systems angle")}`,
    "",
    outline.distributed[locale],
    "",
    `## ${t(locale, "完成に必要なソース", "Source required for completion")}`,
    "",
    bullets(outline.requiredSource[locale]),
    "",
    `## ${t(locale, "調査の出発点にする一次情報", "Primary sources to start from")}`,
    "",
    chapter.sourceIds.length === 0
      ? t(
          locale,
          "未選定。執筆時に一次情報を調べて出典台帳へ追加する。",
          "None selected yet. Research primary sources when writing and add them to the registry.",
        )
      : chapter.sourceIds.map((id) => sourceLine(locale, id)).join("\n"),
    "",
  ].join("\n");
}

function sourcesPage(locale: Locale): string {
  const usedBy = (id: string) =>
    manifest.chapters
      .filter((chapter) => chapter.sourceIds.includes(id))
      .map((chapter) => chapter.id)
      .join(", ");
  const section = (title: string, items: typeof sources.sources) => [
    `## ${title}`,
    "",
    ...items.flatMap((source) => [
      `### ${source.title}`,
      "",
      `- ID: \`${source.id}\``,
      `- URL: <${source.url}>`,
      ...(source.checkedAt === null ? [] : [`- ${t(locale, "確認日", "Checked")}: ${source.checkedAt}`]),
      ...(usedBy(source.id) === "" ? [] : [`- ${t(locale, "参照する章", "Chapters")}: ${usedBy(source.id)}`]),
      `- ${t(locale, "この出典が支える主張", "Claims this source supports")}:`,
      ...source.supports.map((claim) => `  - ${claim}`),
      ...(source.note === undefined ? [] : [`- ${t(locale, "注記", "Note")}: ${source.note}`]),
      "",
    ]),
  ];
  return [
    header(locale, t(locale, "出典台帳", "Source Registry"), "data/sources.json"),
    `# ${t(locale, "出典台帳", "Source Registry")}`,
    "",
    t(
      locale,
      "本文の仕様・料金・安全性に関する主張は、ここに記録した一次情報に基づきます。主張の文面は台帳の原文（英語）のまま載せています。",
      "Claims in this book about specifications, prices, and safety rest on the primary sources recorded here.",
    ),
    "",
    ...section(
      t(locale, "執筆時に内容を確認した出典", "Sources read while writing"),
      sources.sources.filter((source) => source.checkedAt !== null),
    ),
    ...section(
      t(
        locale,
        "未再確認の出典（後続章の調査の出発点）",
        "Sources not re-read yet (starting points for later chapters)",
      ),
      sources.sources.filter((source) => source.checkedAt === null),
    ),
  ].join("\n");
}

function glossaryPage(locale: Locale): string {
  const { terms } = loadGlossary();
  return [
    header(locale, t(locale, "用語集", "Glossary"), "data/glossary.json"),
    `# ${t(locale, "用語集", "Glossary")}`,
    "",
    t(
      locale,
      "日英で同じ概念に同じ語を当てるための対訳表です。API 名、CLI、ファイル名、resource ID は翻訳しません。",
      "The term pairs that keep both languages using one word for one concept. API names, CLI syntax, file names, and resource IDs are never translated.",
    ),
    "",
    `| ${t(locale, "日本語", "Japanese")} | ${t(locale, "英語", "English")} | ${t(locale, "初出", "First used")} | ${t(locale, "意味", "Meaning")} |`,
    "| --- | --- | --- | --- |",
    ...terms.map(
      (term) => `| ${cell(term.ja)} | ${cell(term.en)} | ${term.firstUse} | ${cell(term.definition[locale])} |`,
    ),
    "",
  ].join("\n");
}

const usd = (value: number): string => (value === 0 ? "0" : value < 0.005 ? value.toFixed(6) : value.toFixed(2));

function pricingPage(locale: Locale): string {
  const { prices, allowances, scenarios } = loadPricing();
  const out = [
    header(locale, t(locale, "料金の計算", "Pricing Worksheets"), "data/pricing/*.json"),
    `# ${t(locale, "料金の計算", "Pricing Worksheets")}`,
    "",
    t(
      locale,
      "この本の料金の数値は、すべてここにある入力と単価から `tools/src/pricing/calc.ts` が計算したものです。通貨は USD、1 か月は 730 時間、プランは従量課金（on-demand / pay-as-you-go）、税は含みません。使用量は説明のための仮定であり、あなたのアプリの見積もりではありません。",
      "Every price figure in this book is computed by `tools/src/pricing/calc.ts` from the inputs and unit prices on this page. Currency is USD, a month is 730 hours, the plan is on-demand (pay-as-you-go), and tax is excluded. The usage numbers are assumptions made for illustration, not an estimate for your application.",
    ),
    "",
    t(
      locale,
      "「定価」は無料枠・credits・割引を一切引かない金額です。「毎月の無料枠適用後」は、一次情報で確認できた always-free 枠だけを数量から引いた金額で、同じアカウントの他の利用がその枠を使っていない場合に限ります。credits は反映していません。",
      '"List" is the amount before any free allowance, credit, or discount. "After monthly free allowance" subtracts only the always-free allowances confirmed from a primary source, and holds only when nothing else in the account uses those allowances. Credits are not reflected.',
    ),
    "",
  ];

  for (const scenario of scenarios.scenarios) {
    const result = calculate(scenario, prices.prices, allowances);
    out.push(
      `## ${scenario.title[locale]}`,
      "",
      `ID: \`${scenario.id}\` / ${t(locale, "章", "chapter")}: ${chapterRef(locale, scenario.chapter)}`,
      "",
      `${t(locale, "前提", "Assumptions")}:`,
      "",
      bullets(scenario.assumptions[locale]),
      "",
    );
    if (result.lines.length > 0) {
      out.push(
        `| ${t(locale, "単価 ID", "Price ID")} | ${t(locale, "数量", "Quantity")} | ${t(locale, "単位", "Unit")} | ${t(locale, "数量の根拠", "Basis")} | ${t(locale, "定価", "List")} | ${t(locale, "無料枠", "Free allowance")} | ${t(locale, "無料枠適用後", "After allowance")} |`,
        "| --- | ---: | --- | --- | ---: | ---: | ---: |",
        ...result.lines.map(
          (line) =>
            `| \`${line.priceId}\` | ${line.quantity.toLocaleString("en-US")} | ${line.unit} | ${cell(line.basis)} | ${usd(line.listUsd)} | ${line.allowance === null ? "-" : line.allowance.toLocaleString("en-US")} | ${usd(line.afterAllowanceUsd)} |`,
        ),
        "",
      );
    }
    out.push(
      `- ${t(locale, "定価の小計", "List subtotal")}: **USD ${result.listUsd.toFixed(2)}** / ${t(locale, "月", "month")}`,
      `- ${t(locale, "毎月の無料枠適用後の小計", "Subtotal after monthly free allowance")}: **USD ${result.afterAllowanceUsd.toFixed(2)}** / ${t(locale, "月", "month")}`,
      ...(result.unknownAllowances.length === 0
        ? []
        : [
            `- ${t(locale, "無料枠を確認できず、何も引いていない単価", "Prices whose free allowance could not be confirmed (nothing deducted)")}: ${result.unknownAllowances.map((id) => `\`${id}\``).join(", ")}`,
          ]),
      "",
    );
  }

  out.push(
    `## ${t(locale, "単価", "Unit prices")}`,
    "",
    `| ID | ${t(locale, "リージョン", "Region")} | usageType | ${t(locale, "単位", "Unit")} | ${t(locale, "段階（開始 - 終了: USD）", "Tiers (from - to: USD)")} | ${t(locale, "出典の公開日", "Offer published")} | ${t(locale, "確認日", "Checked")} |`,
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...prices.prices.map(
      (price) =>
        `| \`${price.id}\` | ${price.region} | ${price.usageType} | ${price.unit} | ${price.tiers.map((tier) => `${tier.from.toLocaleString("en-US")} - ${tier.to === null ? "∞" : tier.to.toLocaleString("en-US")}: ${tier.usd}`).join("<br>")} | ${price.offerPublicationDate.slice(0, 10)} | ${price.checkedAt} |`,
    ),
    "",
    t(
      locale,
      "出典はいずれも AWS Price List bulk API（`sourceUrl` は `data/pricing/unit-prices.json` に記録）。CloudFront の単価は日本の edge のものです。",
      "Every unit price comes from the AWS Price List bulk API (each `sourceUrl` is recorded in `data/pricing/unit-prices.json`). CloudFront prices are those for Japan edge locations.",
    ),
    "",
    `## ${t(locale, "毎月の無料枠", "Monthly free allowances")}`,
    "",
    `| ${t(locale, "単価 ID", "Price ID")} | ${t(locale, "数量", "Quantity")} | ${t(locale, "出典", "Source")} | ${t(locale, "注記", "Note")} |`,
    "| --- | ---: | --- | --- |",
    ...allowances.allowances.map(
      (entry) =>
        `| \`${entry.priceId}\` | ${entry.quantity.toLocaleString("en-US")} | \`${entry.sourceId}\` | ${cell(entry.note)} |`,
    ),
    "",
    `${t(locale, "確認できなかった無料枠（0 としてではなく「不明」として扱い、何も引かない）", "Allowances that could not be confirmed (treated as unknown, not as zero; nothing is deducted)")}:`,
    "",
    bullets(allowances.unknown.map((entry) => `\`${entry.priceId}\`: ${entry.reason}`)),
    "",
  );
  return out.join("\n");
}

function validationPage(locale: Locale): string {
  const validation = loadValidation();
  const kind = { local: t(locale, "ローカル", "local"), aws: "AWS" };
  const status = {
    passed: t(locale, "成功", "passed"),
    failed: t(locale, "失敗", "failed"),
    "not-run": t(locale, "未実行", "not run"),
  };
  return [
    header(locale, t(locale, "検証記録", "Validation Record"), "data/validation.json"),
    `# ${t(locale, "検証記録", "Validation Record")}`,
    "",
    t(
      locale,
      "「書いたこと」と「動かして確かめたこと」を分けて記録します。ローカルで通ったことは、AWS 上で動くことの証拠ではありません。",
      "This page keeps what was written apart from what was run and confirmed. A local pass is not evidence that something works in AWS.",
    ),
    "",
    `${t(locale, "実行環境", "Environment")}: ${validation.environment.os}, ${validation.environment.cpu}, Nix ${validation.environment.nix} (${validation.environment.recordedAt})`,
    "",
    `| ${t(locale, "対象", "Scope")} | ${t(locale, "コマンド", "Command")} | ${t(locale, "種別", "Kind")} | ${t(locale, "結果", "Result")} | ${t(locale, "実行日", "Ran")} | ${t(locale, "補足", "Note")} |`,
    "| --- | --- | --- | --- | --- | --- |",
    ...validation.records.map(
      (record) =>
        `| ${cell(record.scope)} | \`${cell(record.command)}\` | ${kind[record.kind]} | ${status[record.status]} | ${record.ranAt ?? "-"} | ${cell(record.note[locale])} |`,
    ),
    "",
    `## ${t(locale, "未解決事項と再開手順", "Open items and how to resume")}`,
    "",
    ...validation.open.flatMap((item) => [
      `### ${item.id}`,
      "",
      item.summary[locale],
      "",
      `${t(locale, "再開手順", "To resume")}: ${item.resume[locale]}`,
      "",
    ]),
  ].join("\n");
}

function toolchainPage(locale: Locale): string {
  const toolchain = loadToolchain();
  return [
    header(locale, t(locale, "ツールチェイン", "Toolchain"), "data/toolchain.json"),
    `# ${t(locale, "ツールチェイン", "Toolchain")}`,
    "",
    t(
      locale,
      `この本のコードを検証した版の組み合わせです（記録日 ${toolchain.recordedAt}）。版は下表の「固定している場所」で固定されており、\`latest\` には依存しません。`,
      `The combination of versions this book's code was checked with (recorded ${toolchain.recordedAt}). Each is pinned where the table says; nothing depends on \`latest\`.`,
    ),
    "",
    `| ${t(locale, "ツール", "Tool")} | ${t(locale, "版", "Version")} | ${t(locale, "供給元", "Provided by")} | ${t(locale, "固定している場所", "Pinned in")} |`,
    "| --- | --- | --- | --- |",
    ...toolchain.tools.map(
      (tool) => `| ${tool.name} | ${tool.version} | ${cell(tool.providedBy)} | \`${tool.pinnedIn}\` |`,
    ),
    "",
    `- ${t(locale, "検証済みの OS/CPU", "Verified platforms")}: ${toolchain.verifiedPlatforms.join(", ")}`,
    `- ${t(locale, "Nix 式はあるが未検証の OS/CPU", "Platforms with a Nix expression but no verification")}: ${toolchain.unverifiedPlatforms.join(", ")}`,
    "",
  ].join("\n");
}

export function generateAll(): Map<string, string> {
  const files = new Map<string, string>();
  for (const locale of LOCALES) {
    for (const chapter of manifest.chapters) {
      if (chapter.writing.ja === "planned") {
        files.set(`book/content${chapterPath(locale, chapter)}`, plannedChapter(locale, chapter as PlannedChapter));
      }
    }
    files.set(`book/content/${locale}/reference/sources.md`, sourcesPage(locale));
    files.set(`book/content/${locale}/reference/glossary.md`, glossaryPage(locale));
    files.set(`book/content/${locale}/reference/pricing.md`, pricingPage(locale));
    files.set(`book/content/${locale}/reference/validation.md`, validationPage(locale));
    files.set(`book/content/${locale}/reference/toolchain.md`, toolchainPage(locale));
  }
  return files;
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const stale: string[] = [];
  for (const [path, content] of generateAll()) {
    const absolute = `${repoRoot}${path}`;
    const current = existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
    if (current === content) {
      continue;
    }
    if (check) {
      stale.push(path);
    } else {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
      console.log(`wrote ${path}`);
    }
  }
  if (stale.length > 0) {
    console.error(`Out of date (run \`vp run book:generate\`):\n  ${stale.join("\n  ")}`);
    process.exit(1);
  }
  console.log(check ? "generated pages are up to date" : "done");
}
