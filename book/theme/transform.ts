// Build-time changes to a page's Markdown tree, so the browser gets finished HTML.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { MarkdownTransformer } from "@ox-content/vite-plugin";

import { renderFigure } from "./figure.ts";
import { importsFor } from "./imports.ts";
import { chapterTitle } from "./title.ts";

type Node = {
  type: string;
  depth?: number;
  value?: string;
  lang?: string;
  meta?: string;
  children?: Node[];
};

const escape = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * Sets a chapter's opening heading as the brand guide does: the number large and
 * apart, the name as the title, and the rest of the line as a quieter note.
 * The heading stays one <h1> with the same text, for search and screen readers.
 */
export const chapterHead: MarkdownTransformer = {
  name: "aih:chapter-head",
  transform(ast) {
    const heading = (ast.children as Node[] | undefined)?.find((node) => node.type === "heading");
    const only = heading?.children?.length === 1 ? heading.children[0] : undefined;
    if (heading?.depth !== 1 || only?.type !== "text" || only.value === undefined) {
      return ast;
    }
    const title = chapterTitle(only.value);
    if (title === undefined) {
      return ast;
    }
    const part = (name: string, text: string): Node => ({
      type: "html",
      value: `<span class="aih-chapter__${name}">${escape(text)}</span>`,
    });
    heading.children = [
      part("number", title.number),
      { type: "text", value: " " },
      part("name", title.name),
      ...(title.about === undefined
        ? []
        : [{ type: "text", value: ": " }, part("about", title.about)]),
    ];
    return ast;
  },
};

export type Origin = { path: string; region?: string };

/**
 * Where each code block of a page came from, in the order the blocks appear:
 * the file and the region for a `<<< @/path{region}` line, undefined for a fence.
 */
export function codeOrigins(markdown: string): (Origin | undefined)[] {
  const origins: (Origin | undefined)[] = [];
  let fence: string | undefined;
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    const marker = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
    if (fence !== undefined) {
      // A fence closes on a line of the same marker, at least as long, and nothing else.
      if (
        marker !== undefined &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        trimmed === marker
      ) {
        fence = undefined;
      }
    } else if (marker === undefined) {
      const imported = /^<<<\s+@\/([^\s{#]+)(?:\{([^}]+)\}|#(\S+))?/.exec(trimmed);
      if (imported !== null) {
        const region = imported[2] ?? imported[3];
        origins.push({ path: imported[1] ?? "", ...(region === undefined ? {} : { region }) });
      }
    } else {
      fence = marker;
      origins.push(undefined);
    }
  }
  return origins;
}

/** Removes the indentation every line shares. Blank lines do not count towards it. */
export function dedent(code: string): string {
  const lines = code.split("\n");
  const depths = lines
    .filter((line) => line.trim() !== "")
    .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
  const shared = depths.length === 0 ? 0 : Math.min(...depths);
  return shared === 0 ? code : lines.map((line) => line.slice(shared)).join("\n");
}

const root = fileURLToPath(new URL("../../", import.meta.url));

/**
 * For every block of code that was imported from the repository: names the file above it,
 * and puts back the imports the shown region uses. A reader should never have to guess
 * which file they are looking at, or where a name came from.
 */
export const codeTitles: MarkdownTransformer = {
  name: "aih:code-titles",
  transform(ast, context) {
    const blocks: Node[] = [];
    const collect = (node: Node): void => {
      if (node.type === "code") {
        blocks.push(node);
      }
      node.children?.forEach(collect);
    };
    collect(ast as Node);

    const origins = codeOrigins(readFileSync(context.filePath, "utf8"));
    // If the two counts disagree, something here does not understand the page. Name nothing rather than misname.
    if (origins.length !== blocks.length) {
      return ast;
    }
    blocks.forEach((block, index) => {
      const origin = origins[index];
      // Ox Content reads a title from `[name]` in the fence's info, as VitePress does.
      if (origin === undefined) {
        return;
      }
      if (!/\[.+\]/.test(block.meta ?? "")) {
        block.meta = `${block.meta ?? ""} [${origin.path}]`.trim();
      }
      // A region cut from inside a class or a function keeps that depth. Shown alone, it starts at the margin.
      if (origin.region !== undefined && block.value !== undefined) {
        block.value = dedent(block.value);
      }
      // A whole file already has its imports. Only TypeScript and JavaScript regions get them back.
      if (
        origin.region !== undefined &&
        /^(ts|js|mts|mjs)$/.test(block.lang ?? "") &&
        block.value !== undefined
      ) {
        const imports = importsFor(readFileSync(`${root}${origin.path}`, "utf8"), block.value);
        if (imports.length > 0) {
          block.value = `${imports.join("\n")}\n\n${block.value}`;
        }
      }
    });
    return ast;
  },
};

/** Draws every ```figure block. A figure that does not parse fails the build, with the page's name. */
export const figures: MarkdownTransformer = {
  name: "aih:figures",
  transform(ast, context) {
    const draw = (node: Node): void => {
      if (node.type === "code" && node.lang === "figure") {
        try {
          node.value = renderFigure(node.value ?? "");
        } catch (error) {
          throw new Error(
            `${context.filePath}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        node.type = "html";
        delete node.lang;
        delete node.meta;
      }
      node.children?.forEach(draw);
    };
    draw(ast as Node);
    return ast;
  },
};
