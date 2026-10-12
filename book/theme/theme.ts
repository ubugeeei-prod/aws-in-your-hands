// The book's look, as an Ox Content theme: Open Current / Horizon.
//
// Text and controls are white and navy. Orange and neon pink mark a position
// or carry light, and stay off the surfaces people read.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defaultTheme, defineTheme } from "@ox-content/vite-plugin";

import { sidebar } from "../site.ts";

export const colors = {
  white: "#FFFFFF",
  navy: "#101B2B",
  orange: "#FF8A00",
  pink: "#F300DF",
  // Navy mixed toward white, for secondary text and hairlines. Both pass 4.5:1 where they carry text.
  slate: "#55606F",
  line: "#D5D9DF",
  paper: "#F4F5F7",
  // The same roles on navy.
  haze: "#A9B1BD",
  seam: "#2B3748",
  deep: "#0B1420",
} as const;

// Code is always set on navy, in the brand's own hues: pink for the words of the language,
// orange for what is quoted, lavender for what is called. Every pair passes 4.5:1 on both navies.
const syntax = {
  "syntax-foreground": "#EEF1F6",
  "syntax-token-comment": "#8793A5",
  "syntax-token-keyword": "#FF8FE6",
  "syntax-token-function": "#BBA8FF",
  "syntax-token-string": "#FFB45C",
  "syntax-token-string-expression": "#FFB45C",
  "syntax-token-constant": "#FFD9A8",
  "syntax-token-parameter": "#EEF1F6",
  "syntax-token-punctuation": "#A9B1BD",
} as const;

const japanese =
  '"Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo';

const css = readFileSync(fileURLToPath(new URL("./brand.css", import.meta.url)), "utf8");

const night = {
  primary: colors.white,
  primaryHover: colors.white,
  background: colors.navy,
  backgroundAlt: colors.deep,
  text: colors.white,
  textMuted: colors.haze,
  border: colors.seam,
  codeBackground: colors.deep,
  codeBackgroundTop: colors.deep,
  codeText: colors.white,
} as const;

export function brandTheme(base: string) {
  return defineTheme({
    extends: defaultTheme,
    name: "open-current",
    aside: true,
    sidebar,
    // Navy is the book's ground, as on the cover, whatever the system asks for.
    // Paper is there for a reader who chooses it; brand.css holds those colours.
    colors: night,
    darkColors: night,
    fonts: {
      sans: {
        family: "Hubot Sans",
        path: "@fontsource/hubot-sans",
        weights: [400, 600, 700],
        subsets: ["latin"],
        selfHost: true,
        display: "swap",
        // Hubot Sans draws its zero with a bar through it. In a book full of chapter numbers
        // and prices that reads as a theta, so digits are left to the next family.
        unicodeRange: "U+0000-002F, U+003A-10FFFF",
        fallbacks: [japanese, "system-ui", "sans-serif"],
      },
      mono: {
        family: "Commit Mono",
        path: "@fontsource/commit-mono",
        weights: [400, 700],
        subsets: ["latin"],
        selfHost: true,
        display: "swap",
        fallbacks: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", japanese, "monospace"],
      },
      named: {
        jp: {
          family: "Noto Sans JP",
          path: "@fontsource/noto-sans-jp",
          weights: [400, 700],
          subsets: ["japanese", "latin"],
          selfHost: true,
          display: "swap",
          fallbacks: ["sans-serif"],
        },
        display: {
          family: "Syne",
          path: "@fontsource/syne",
          weights: [600, 700],
          subsets: ["latin"],
          selfHost: true,
          display: "swap",
          fallbacks: ['"Hubot Sans"', japanese, "sans-serif"],
        },
      },
    },
    layout: { maxContentWidth: "720px", headerHeight: "56px", sidebarWidth: "18rem" },
    footer: {
      message: "AWS in Your Hands: An open field guide",
    },
    // The mark is drawn in CSS from brand/mark.svg, so it takes the text colour of either ground.
    header: { showLogo: false },
    tokens: { ...syntax, "syntax-background": colors.deep },
    darkTokens: { ...syntax, "syntax-background": colors.deep },
    toggleTransition: "circle",
    css,
    // The cover gets its cloud; every other page gets the thin one behind the text.
    js: [
      // The chapter you are in shows its pages. The others stay folded.
      `document.querySelector(".sidebar .nav-link.active")?.closest("details")?.setAttribute("open", "");`,
      `import(${JSON.stringify(`${base}brand/`)} + (document.querySelector("[data-aih-cover]") ? "cover.js" : "ground.js"));`,
      `if (document.querySelector(".toc-link")) { import(${JSON.stringify(`${base}brand/reading.js`)}); }`,
      `if (document.querySelector(".content .ox-code")) { import(${JSON.stringify(`${base}brand/fold.js`)}); }`,
    ].join("\n"),
  });
}
