import { oxContent } from "@ox-content/vite-plugin";
import { defineConfig } from "vite-plus";

import { brandAssets } from "./theme/assets.ts";
import { brandTheme } from "./theme/theme.ts";

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
        readerChrome: true,
        localeSwitcher: true,
        notFound: true,
        theme: brandTheme(base),
      },
    }),
  ],
  build: { outDir: "dist" },
});
