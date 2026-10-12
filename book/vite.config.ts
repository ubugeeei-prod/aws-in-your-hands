import { oxContent } from "@ox-content/vite-plugin";
import { defineConfig } from "vite-plus";

import { brandAssets } from "./theme/assets.ts";
import { brandTheme } from "./theme/theme.ts";
import { chapterHead, codeTitles, figures, taskCommands } from "./theme/transform.ts";

const base = "/";

// Unset until a real URL exists, so canonical and hreflang links never point at a made-up host.
const siteUrl = process.env.AIH_BOOK_SITE_URL;

export default defineConfig({
  base,
  plugins: [
    brandAssets(base),
    oxContent({
      srcDir: "content",
      outDir: "dist",
      base,
      // API docs from JSDoc. This book is prose only.
      docs: false,
      highlight: true,
      containers: true,
      codeGroups: true,
      // `// [!code highlight]` style marks, for where a chapter wants to point at a line.
      codeAnnotations: { notation: "both" },
      // Japanese has no spaces to break lines at. BudouX finds the phrase boundaries at build time.
      budoux: { language: "ja" },
      // codeTitles counts fences, so it has to see the figures while they are still fences.
      transformers: [chapterHead, codeTitles, taskCommands, figures],
      search: { placeholder: "Search / 検索" },
      // robots.txt and llms.txt, once the site has a URL to put in them.
      siteMaps: siteUrl === undefined ? false : { robots: true, llms: true },
      // `<<< @/...` resolves from the repository root.
      codeImports: { rootDir: ".." },
      i18n: {
        enabled: true,
        defaultLocale: "ja",
        locales: [
          { code: "ja", name: "日本語" },
          { code: "en", name: "English" },
        ],
        hideDefaultLocale: false,
        // No message dictionaries. Each locale is a file tree under content/.
        check: false,
      },
      ssg: {
        siteName: "AWS in Your Hands",
        ...(siteUrl === undefined ? {} : { siteUrl }),
        pagination: true,
        breadcrumbs: true,
        lastUpdated: true,
        jsonLd: true,
        // Each page's Markdown is published beside it and linked from the page's head, for tools that read it.
        markdownSource: { alternate: true, copy: false },
        // The cover turns the sidebar and the outline off for itself.
        pageChrome: true,
        minifyHtml: true,
        readerChrome: true,
        localeSwitcher: true,
        notFound: true,
        theme: brandTheme(base),
      },
    }),
  ],
  build: { outDir: "dist" },
});
