// Build-time changes to a page's Markdown tree, so the browser gets finished HTML.

import { readFileSync } from "node:fs";

import type { MarkdownTransformer } from "@ox-content/vite-plugin";

import { renderFigure } from "./figure.ts";
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

/**
 * Where each code block of a page came from, in the order the blocks appear:
 * the imported file's path for a `<<< @/path{region}` line, undefined for a fence.
 */
export function codeOrigins(markdown: string): (string | undefined)[] {
  const origins: (string | undefined)[] = [];
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
      const imported = /^<<<\s+@\/([^\s{#]+)/.exec(trimmed)?.[1];
      if (imported !== undefined) {
        origins.push(imported);
      }
    } else {
      fence = marker;
      origins.push(undefined);
    }
  }
  return origins;
}

/**
 * Names the file above every block of code that was imported from the repository,
 * so a reader always knows which file they are looking at.
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
      if (origin !== undefined && !/\[.+\]/.test(block.meta ?? "")) {
        block.meta = `${block.meta ?? ""} [${origin}]`.trim();
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
