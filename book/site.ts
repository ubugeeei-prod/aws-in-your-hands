import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import manifest from "../data/chapters.json" with { type: "json" };
import { chapterParts as parts, chapterTitle } from "./theme/title.ts";

type LocalizedText = { ja: string; en: string };
type SidebarItem = {
  text: LocalizedText;
  link?: string;
  items?: SidebarItem[];
  collapsed?: boolean;
  stickyCollapsed?: boolean;
};

const chapterLink = (id: string, slug: string): string => `/ja/chapters/${id}-${slug}.md`;

const short = (id: string, title: string): string => chapterTitle(`${id} ${title}`)?.name ?? title;

const hasPage = (path: string): boolean =>
  existsSync(fileURLToPath(new URL(`./content${path}`, import.meta.url)));

const chapterParts = (id: string, slug: string): SidebarItem[] =>
  parts
    .map(([key, text]) => ({ text, link: `/ja/chapters/${id}-${slug}/${key}.md` }))
    .filter((item) => hasPage(item.link));

const chapterItems = (from: number, to: number): SidebarItem[] =>
  manifest.chapters
    .filter((chapter) => Number(chapter.id) >= from && Number(chapter.id) <= to)
    .map((chapter) => ({
      // The sidebar carries the chapter's name. What follows the colon is on the page itself.
      text: {
        ja: short(chapter.id, chapter.title.ja),
        en: short(chapter.id, chapter.title.en),
      },
      link: chapterLink(chapter.id, chapter.slug),
      ...(chapterParts(chapter.id, chapter.slug).length === 0
        ? {}
        : // Folded until opened, and then as the reader left it, on every page.
          {
            items: chapterParts(chapter.id, chapter.slug),
            collapsed: true,
            stickyCollapsed: true,
          }),
    }));

/** Chapters by number, in the order given. One that is not written yet is simply absent. */
const pick = (...ids: number[]): SidebarItem[] => ids.flatMap((id) => chapterItems(id, id));

// Links are ja source paths. Ox Content rewrites each to the locale being rendered.
const groups: SidebarItem[] = [
  {
    text: { ja: "はじめに", en: "Start Here" },
    items: [
      { text: { ja: "この本について", en: "About This Book" }, link: "/ja/index.md" },
      {
        text: { ja: "Cloudflare から来た人へ", en: "Coming from Cloudflare" },
        link: "/ja/guides/cloudflare.md",
      },
    ],
  },
  // Grouped by what the reader is doing. 00 to 24 are in the order the book does it; from 25 on,
  // chapters stand on their own and are grouped by subject, whatever their number.
  { text: { ja: "準備する", en: "Get Ready" }, items: chapterItems(0, 2) },
  { text: { ja: "アプリを作る", en: "Build the App" }, items: chapterItems(3, 8) },
  { text: { ja: "動かす場所を選ぶ", en: "Choose Where It Runs" }, items: chapterItems(9, 12) },
  { text: { ja: "データを置く", en: "Store Data" }, items: chapterItems(13, 14) },
  { text: { ja: "機能を足す", en: "Add Features" }, items: [...chapterItems(15, 18), ...pick(51)] },
  { text: { ja: "運用する", en: "Operate It" }, items: chapterItems(19, 22) },
  {
    text: { ja: "サーバーを持つ", en: "Run Your Own Servers" },
    items: pick(23, 24, 64, 66, 67, 68),
  },
  { text: { ja: "つなぐ", en: "Connect Services" }, items: pick(25, 61, 54, 47) },
  {
    text: { ja: "データを深める", en: "Deeper into Data" },
    items: pick(30, 59, 60, 39, 58, 53, 38),
  },
  { text: { ja: "分析する", en: "Analyze" }, items: pick(26, 49, 43, 27) },
  { text: { ja: "AI を深める", en: "Deeper into AI" }, items: pick(36, 56, 50, 57) },
  {
    text: { ja: "動かす場所を深める", en: "Deeper into Compute" },
    items: pick(29, 35, 41, 52, 34, 69),
  },
  { text: { ja: "守る、備える", en: "Protect and Prepare" }, items: pick(42, 46, 44, 28, 40) },
  { text: { ja: "磨く", en: "Tune It" }, items: pick(31, 32, 55) },
  { text: { ja: "開発の道具", en: "Developer Tools" }, items: pick(48, 37, 45, 62, 63) },
  { text: { ja: "本番に出す", en: "Go to Production" }, items: pick(33) },
  {
    text: { ja: "リファレンス", en: "Reference" },
    items: [
      {
        text: { ja: "本のサイトを再現する", en: "Reproduce This Site" },
        link: "/ja/reference/book-site.md",
      },
      {
        text: { ja: "章ごとの状態と不変条件", en: "State and Invariants by Chapter" },
        link: "/ja/guides/distributed.md",
      },
      { text: { ja: "料金の計算", en: "Pricing Worksheets" }, link: "/ja/reference/pricing.md" },
      { text: { ja: "出典台帳", en: "Source Registry" }, link: "/ja/reference/sources.md" },
      { text: { ja: "用語集", en: "Glossary" }, link: "/ja/reference/glossary.md" },
      { text: { ja: "ツールチェイン", en: "Toolchain" }, link: "/ja/reference/toolchain.md" },
      { text: { ja: "検証記録", en: "Validation Record" }, link: "/ja/reference/validation.md" },
    ],
  },
];

// A group whose chapters are all still unwritten would be a heading over nothing.
export const sidebar: SidebarItem[] = groups.filter((group) => (group.items?.length ?? 1) > 0);
