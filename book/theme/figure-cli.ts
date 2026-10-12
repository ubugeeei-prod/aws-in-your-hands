// node book/theme/figure-cli.ts <page.md>...
//
// Reads every ```figure block in the given pages and reports what does not parse
// and what is too wide for the text column. Reads files only.

import { readFileSync } from "node:fs";

import { renderFigure } from "./figure.ts";

/** The column is 760 px wide. A little over is fine: figures shrink to fit, down to a limit. */
const TOO_WIDE = 900;

let figures = 0;
let problems = 0;

for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, "utf8").split("\n");
  let start: number | undefined;
  lines.forEach((line, index) => {
    if (start === undefined) {
      if (line.trim() === "```figure") {
        start = index;
      }
      return;
    }
    if (line.trim() !== "```") {
      return;
    }
    const source = lines.slice(start + 1, index).join("\n");
    const where = `${file}:${start + 1}`;
    start = undefined;
    figures += 1;
    try {
      const html = renderFigure(source);
      const [, width = "0", height = "0"] = / width="(\d+)" height="(\d+)"/.exec(html) ?? [];
      const wide = Number(width) > TOO_WIDE;
      problems += wide ? 1 : 0;
      console.log(
        `${wide ? "wide" : "ok  "} ${where}  ${width}x${height}${wide ? `  (over ${TOO_WIDE} px: run it downwards or split it)` : ""}`,
      );
    } catch (error) {
      problems += 1;
      console.log(`FAIL ${where}  ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  if (start !== undefined) {
    problems += 1;
    console.log(`FAIL ${file}:${start + 1}  the figure block is never closed`);
  }
}

console.log(`${figures} figures, ${problems} problems`);
process.exitCode = problems === 0 ? 0 : 1;
