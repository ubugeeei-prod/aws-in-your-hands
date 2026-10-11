import { defaultTheme, defineTheme, oxContent } from "@ox-content/vite-plugin";
import { defineConfig } from "vite-plus";
import { sidebar } from "./site.ts";

// The site is served from the root of its own CloudFront distribution.
const base = "/";

// Set when a real public URL exists. Without it Ox Content omits canonical and
// hreflang links instead of pointing them at a made-up host.
const siteUrl = process.env.AIH_BOOK_SITE_URL;

export default defineConfig({
  base,
  plugins: [
    oxContent({
      srcDir: "content",
      outDir: "dist",
      base,
      // API docs generated from JSDoc; this book has prose only.
      docs: false,
      highlight: true,
      containers: true,
      codeGroups: true,
      // `<<< @/examples/...` resolves from the repository root, so every snippet
      // in the prose is read from the same file the example actually runs.
      codeImports: { rootDir: ".." },
      i18n: {
        enabled: true,
        defaultLocale: "ja",
        locales: [
          { code: "ja", name: "日本語" },
          { code: "en", name: "English" },
        ],
        hideDefaultLocale: false,
        // No message dictionaries: each locale is a file tree under content/.
        check: false,
      },
      ssg: {
        siteName: "AWS in Your Hands",
        ...(siteUrl === undefined ? {} : { siteUrl }),
        pagination: true,
        readerChrome: true,
        localeSwitcher: true,
        notFound: true,
        theme: defineTheme({
          extends: defaultTheme,
          aside: true,
          sidebar,
        }),
      },
    }),
  ],
  build: { outDir: "dist" },
});
