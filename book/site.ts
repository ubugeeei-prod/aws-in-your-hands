import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import manifest from "../data/chapters.json" with { type: "json" };
import { chapterTitle } from "./theme/title.ts";

type LocalizedText = { ja: string; en: string };
type SidebarItem = {
  text: LocalizedText;
  link?: string;
  items?: SidebarItem[];
  collapsed?: boolean;
};

const chapterLink = (id: string, slug: string): string => `/ja/chapters/${id}-${slug}.md`;

const short = (id: string, title: string): string => chapterTitle(`${id} ${title}`)?.name ?? title;

// A chapter is several pages: its opening page, then these, in this order, where they exist.
const parts = [
  ["build", { ja: "しくみと実装", en: "Design and Build" }],
  ["more", { ja: "実装のつづき", en: "Build, Continued" }],
  ["local", { ja: "手元で動かす", en: "Run It Locally" }],
  ["deploy", { ja: "デプロイ", en: "Deploy" }],
  ["wrap", { ja: "費用、注意点、片付け", en: "Costs, Pitfalls, and Cleanup" }],
] as const;

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
        : { items: chapterParts(chapter.id, chapter.slug), collapsed: true }),
    }));

// Links are ja source paths. Ox Content rewrites each to the locale being rendered.
export const sidebar: SidebarItem[] = [
  {
    text: { ja: "はじめに", en: "Start Here" },
    items: [
      { text: { ja: "この本について", en: "About This Book" }, link: "/ja/index.md" },
      {
        text: { ja: "Cloudflare から来た人へ", en: "Coming from Cloudflare" },
        link: "/ja/guides/cloudflare.md",
      },
      {
        text: { ja: "分散システムの案内", en: "Distributed Systems Guide" },
        link: "/ja/guides/distributed.md",
      },
    ],
  },
  // Grouped by what the reader is doing, in the order the book does it.
  { text: { ja: "準備する", en: "Get Ready" }, items: chapterItems(0, 2) },
  { text: { ja: "アプリを作る", en: "Build the App" }, items: chapterItems(3, 8) },
  { text: { ja: "動かす場所を選ぶ", en: "Choose Where It Runs" }, items: chapterItems(9, 12) },
  { text: { ja: "データを置く", en: "Store Data" }, items: chapterItems(13, 14) },
  { text: { ja: "機能を足す", en: "Add Features" }, items: chapterItems(15, 18) },
  { text: { ja: "運用する", en: "Operate It" }, items: chapterItems(19, 22) },
  { text: { ja: "サーバーを持つ", en: "Run Your Own Servers" }, items: chapterItems(23, 24) },
  {
    text: { ja: "リファレンス", en: "Reference" },
    items: [
      {
        text: { ja: "本のサイトを再現する", en: "Reproduce This Site" },
        link: "/ja/reference/book-site.md",
      },
      { text: { ja: "料金の計算", en: "Pricing Worksheets" }, link: "/ja/reference/pricing.md" },
      { text: { ja: "出典台帳", en: "Source Registry" }, link: "/ja/reference/sources.md" },
      { text: { ja: "用語集", en: "Glossary" }, link: "/ja/reference/glossary.md" },
      { text: { ja: "ツールチェイン", en: "Toolchain" }, link: "/ja/reference/toolchain.md" },
      { text: { ja: "検証記録", en: "Validation Record" }, link: "/ja/reference/validation.md" },
    ],
  },
];
