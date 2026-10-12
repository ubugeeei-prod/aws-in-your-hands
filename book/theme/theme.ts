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

const japanese =
  '"Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo';

const css = readFileSync(fileURLToPath(new URL("./brand.css", import.meta.url)), "utf8");

export function brandTheme(base: string) {
  return defineTheme({
    extends: defaultTheme,
    name: "open-current",
    aside: true,
    sidebar,
    colors: {
      primary: colors.navy,
      primaryHover: colors.navy,
      background: colors.white,
      backgroundAlt: colors.paper,
      text: colors.navy,
      textMuted: colors.slate,
      border: colors.line,
      codeBackground: colors.navy,
      codeBackgroundTop: colors.navy,
      codeText: colors.white,
    },
    darkColors: {
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
    },
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
    layout: { maxContentWidth: "760px", headerHeight: "64px" },
    header: {
      logoLight: `${base}brand/mark-navy.svg`,
      logoDark: `${base}brand/mark-white.svg`,
      logoWidth: 34,
      logoHeight: 34,
    },
    tokens: {
      "brand-orange": colors.orange,
      "brand-pink": colors.pink,
      "brand-navy": colors.navy,
    },
    css,
    // The cover's scripts are fetched only by the page that has a cover.
    js: `if (document.querySelector("[data-aih-cover]")) { import(${JSON.stringify(`${base}brand/cover.js`)}); }`,
  });
}
