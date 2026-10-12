// Serves the brand's own files next to the book: the mark, and the cover's scripts.
//
// The scripts are written in TypeScript that Node can run by removing the types,
// so that is all that happens to them on the way to the browser. No bundler.

import { readdirSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite-plus";

import { colors } from "./theme.ts";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** Everything under /brand/, by file name. */
export function brandFiles(): Map<string, { type: string; body: string }> {
  const files = new Map<string, { type: string; body: string }>();

  for (const name of readdirSync(here("./brand")).filter((file) => file.endsWith(".svg"))) {
    files.set(name, { type: "image/svg+xml", body: readFileSync(here(`./brand/${name}`), "utf8") });
  }
  // An <img> has no text colour to inherit, so the header gets one mark per theme.
  const mark = files.get("mark.svg")?.body ?? "";
  for (const [name, colour] of [
    ["navy", colors.navy],
    ["white", colors.white],
  ] as const) {
    files.set(`mark-${name}.svg`, {
      type: "image/svg+xml",
      body: mark.replace("currentColor", colour),
    });
  }

  const scripts = readdirSync(here("./motion")).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  );
  for (const name of scripts) {
    const source = stripTypeScriptTypes(readFileSync(here(`./motion/${name}`), "utf8"));
    files.set(name.replace(/\.ts$/, ".js"), {
      type: "text/javascript",
      // The browser asks for the file it is told to: point imports at the emitted names.
      body: source.replaceAll(/(from\s+"\.\/[\w-]+)\.ts"/g, '$1.js"'),
    });
  }
  return files;
}

export function brandAssets(base: string): Plugin {
  return {
    name: "aih:brand-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const prefix = `${base}brand/`;
        const path = request.url?.split("?")[0] ?? "";
        const file = path.startsWith(prefix)
          ? brandFiles().get(path.slice(prefix.length))
          : undefined;
        if (file === undefined) {
          next();
          return;
        }
        response.setHeader("content-type", `${file.type}; charset=utf-8`);
        response.end(file.body);
      });
    },
    generateBundle() {
      for (const [name, file] of brandFiles()) {
        this.emitFile({ type: "asset", fileName: `brand/${name}`, source: file.body });
      }
    },
  };
}
