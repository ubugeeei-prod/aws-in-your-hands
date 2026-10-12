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

const chapterItems = (from: number, to: number): SidebarItem[] =>
  manifest.chapters
    .filter((chapter) => Number(chapter.id) >= from && Number(chapter.id) <= to)
    .map((chapter) => ({
      // The sidebar carries the chapter's name. What follows the colon is on the page itself.
      text: {
        ja: `${chapter.id} ${short(chapter.id, chapter.title.ja)}`,
        en: `${chapter.id} ${short(chapter.id, chapter.title.en)}`,
      },
      link: chapterLink(chapter.id, chapter.slug),
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
  { text: { ja: "土台", en: "Foundations" }, items: chapterItems(0, 2) },
  { text: { ja: "ノートアプリを作る", en: "Build the Notes App" }, items: chapterItems(3, 8) },
  {
    text: { ja: "SSR、edge、ネットワーク、コンテナ", en: "SSR, Edge, Network, Containers" },
    items: chapterItems(9, 12),
  },
  {
    text: { ja: "データと独立レシピ", en: "Data and Standalone Recipes" },
    items: chapterItems(13, 18),
  },
  { text: { ja: "運用", en: "Operations" }, items: chapterItems(19, 22) },
  { text: { ja: "自分で動かす", en: "Run It Yourself" }, items: chapterItems(23, 24) },
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
