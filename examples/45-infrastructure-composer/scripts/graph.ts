// vp run composer:graph [<example directory | template.json>] [<stack>] [--figure] [--against <template.json>]
//
// Prints the template of a synthesized stack as a graph. Reads files only: no AWS, no network.
// This is not Infrastructure Composer. It follows Ref, Fn::GetAtt, Fn::Sub and DependsOn.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { chooseTemplate } from "../src/cdk-out.ts";
import { diffGraphs } from "../src/diff.ts";
import { type Graph, templateGraph } from "../src/graph.ts";
import { renderDiff, renderFigure, renderText, FIGURE_NODE_LIMIT } from "../src/render.ts";
import { summarize } from "../src/summary.ts";
import { parseTemplate } from "../src/template.ts";

const FIXTURE = join(import.meta.dirname, "../fixtures/notes-api.template.json");

function fail(message: string): never {
  console.error(message);
  process.exit(64);
}

function locate(target: string, stack: string | undefined): string {
  const path = resolve(target);
  if (!existsSync(path)) {
    fail(`not found: ${path}`);
  }
  if (statSync(path).isFile()) {
    return path;
  }
  const out = existsSync(join(path, "cdk.out")) ? join(path, "cdk.out") : path;
  const choice = chooseTemplate(readdirSync(out), stack);
  return choice.ok ? join(out, choice.file) : fail(`${out}: ${choice.reason}`);
}

// Every CDK stack carries one AWS::CDK::Metadata resource that nothing names.
function read(file: string): Graph {
  try {
    return templateGraph(parseTemplate(readFileSync(file, "utf8")), {
      omitTypes: ["AWS::CDK::Metadata"],
    });
  } catch (error) {
    return fail(
      `cannot read ${file} as a template: ${error instanceof Error ? error.message : error}`,
    );
  }
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { figure: { type: "boolean", default: false }, against: { type: "string" } },
});
const [target, stack] = positionals;
const file = target === undefined ? FIXTURE : locate(target, stack);
const name = basename(file).replace(/\.template\.json$/, "");
const graph = read(file);

if (values.figure) {
  const figure = renderFigure(`${name}: which resource names which`, graph);
  console.log(
    figure ??
      `${graph.nodes.length} resources: more than the ${FIGURE_NODE_LIMIT} one figure holds`,
  );
} else {
  console.log(renderText(name, graph, summarize(graph)));
}

if (values.against !== undefined) {
  const other = locate(values.against, undefined);
  console.log(`\nagainst ${basename(other)}`);
  const diff = diffGraphs(graph, read(other));
  console.log(renderDiff(diff));
  // Two templates for one stack that disagree: the reviewer has to know before anything else.
  process.exitCode = diff.same ? 0 : 1;
}
