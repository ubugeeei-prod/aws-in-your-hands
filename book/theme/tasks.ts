// What a `vp run <task>` line really runs, read from the same files that run it.
//
// A task's name says nothing about the command behind it. The book prints the command
// under every block that uses one, so a reader never has to open vite.config.ts to follow along.

import { driftArgs, isMode } from "../../tools/src/drift/args.ts";
import { buildInvocation, isAction } from "../../tools/src/infra/cdkd-args.ts";
import config from "../../vite.config.ts";

export type Task = { command: string; cwd?: string; dependsOn?: string[] };
export type Tasks = Record<string, Task | undefined>;

export type Call = { prefix: string; task: string; args: string[] };

export type Explanation = {
  task: string;
  /** Tasks that run first. */
  before: string[];
  /** The command line of the task itself. Absent when the task only gathers others. */
  command?: string;
  /** The cdkd command that line starts, when it is one of this repository's wrappers around cdkd. */
  cdkd?: { command: string; via: string; checksAccount: boolean };
};

export const tasks: Tasks = (config as { run?: { tasks?: Tasks } }).run?.tasks ?? {};

/** The `vp run` lines of a shell block, in order. Settings written before `vp` are kept. */
export function calls(shell: string): Call[] {
  return shell.split("\n").flatMap((line) => {
    const match = /^\s*((?:[A-Z_][A-Z0-9_]*=\S*\s+)*)vp run ([\w:.-]+)((?:\s+\S+)*)\s*$/.exec(line);
    if (match === null) {
      return [];
    }
    const [, prefix = "", task = "", rest = ""] = match;
    return [{ prefix, task, args: rest.trim() === "" ? [] : rest.trim().split(/\s+/) }];
  });
}

// The wrappers print this line themselves before they start cdkd; the region comes from .env.
const REGION = "${AIH_AWS_REGION:-ap-northeast-1}";
const inDirectory = (directory: string | undefined, command: string): string =>
  directory === undefined ? command : `(cd ${directory} && ${command})`;

function cdkdBehind(command: string, extra: string[]): Explanation["cdkd"] {
  const wrapper = /tools\/src\/(infra\/cdkd|drift\/cli)\.ts (\S+) (\S+) (\S+)/.exec(command);
  if (wrapper === null) {
    return undefined;
  }
  const [, script, action, appDirectory = "", stack = ""] = wrapper;
  const via = `tools/src/${script}.ts`;
  const run = (args: string[]): string =>
    inDirectory(appDirectory, `AWS_REGION=${REGION} cdkd ${args.join(" ")}`);
  if (script === "drift/cli" && isMode(action)) {
    return { command: run(driftArgs(action, stack)), via, checksAccount: true };
  }
  if (script === "infra/cdkd" && isAction(action)) {
    const invocation = buildInvocation(action, stack, REGION, extra);
    return { command: run(invocation.args), via, checksAccount: invocation.access !== "local" };
  }
  return undefined;
}

/** Throws for a task that does not exist: the page would be telling the reader to run nothing. */
export function explain(call: Call, all: Tasks = tasks): Explanation {
  const task = all[call.task];
  if (task === undefined) {
    throw new Error(`vp run ${call.task}: no such task in vite.config.ts`);
  }
  const before = task.dependsOn ?? [];
  // A task that only prints a line exists to name its dependencies.
  if (task.command.startsWith('node -e "console.log(')) {
    return { task: call.task, before };
  }
  const command = [task.command, ...call.args].join(" ");
  const cdkd = cdkdBehind(task.command, call.args);
  return {
    task: call.task,
    before,
    command: inDirectory(task.cwd, `${call.prefix}${command}`),
    ...(cdkd === undefined ? {} : { cdkd }),
  };
}

const escape = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const words = {
  ja: {
    label: "実際に実行されるコマンド",
    before: "先に実行: ",
    gathers: "次のタスクをまとめて実行: ",
    via: (script: string, checks: boolean) =>
      checks
        ? `<code>${script}</code> が、認証情報のアカウントを確かめてから起動します`
        : `<code>${script}</code> が起動します`,
  },
  en: {
    label: "What actually runs",
    before: "Runs first: ",
    gathers: "Runs these tasks: ",
    via: (script: string, checks: boolean) =>
      checks
        ? `Started by <code>${script}</code>, once it has checked which account the credentials belong to`
        : `Started by <code>${script}</code>`,
  },
} as const;

/** The block that goes under a shell block. Nothing when the list is empty. */
export function renderExplanations(list: Explanation[], locale: "ja" | "en"): string | undefined {
  if (list.length === 0) {
    return undefined;
  }
  const text = words[locale];
  const names = (items: string[]): string =>
    items.map((item) => `<code>${escape(item)}</code>`).join(locale === "ja" ? "、" : ", ");
  const command = (line: string): string =>
    `<code class="aih-runs__command">${escape(line)}</code>`;
  const rows = list.map((item) => {
    const parts = [
      ...(item.before.length === 0
        ? []
        : [
            `<p>${item.command === undefined ? text.gathers : text.before}${names(item.before)}</p>`,
          ]),
      // The wrapper's own line says less than the cdkd command it starts.
      ...(item.cdkd === undefined
        ? item.command === undefined
          ? []
          : [command(item.command)]
        : [
            command(item.cdkd.command),
            `<p>${text.via(item.cdkd.via, item.cdkd.checksAccount)}</p>`,
          ]),
    ];
    return `<dt><code>${escape(item.task)}</code></dt><dd>${parts.join("")}</dd>`;
  });
  return `<div class="aih-runs"><p class="aih-runs__label">${text.label}</p><dl>${rows.join("")}</dl></div>`;
}
