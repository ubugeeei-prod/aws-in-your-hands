// vp run sandbox:plan [-- --repository owner/name] [--minutes n] [--budget usd] [--running n] [--spent usd]
//   node scripts/plan.ts
//
// Prints what the launcher would decide for one request, and what the task would be
// started with. Calls nothing: no AWS, no GitHub, no agent.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { agentCommand, agentSettings } from "../src/agent.ts";
import { firewallRulesSource } from "../src/egress.ts";
import { decide, jobRequestSchema, overridesFor } from "../src/job.ts";
import { SETTINGS_PATH } from "../src/run.ts";

const { values } = parseArgs({
  options: {
    repository: { type: "string", default: "acme/notes" },
    allowed: { type: "string", default: "acme/notes" },
    minutes: { type: "string", default: "30" },
    budget: { type: "string", default: "2" },
    running: { type: "string", default: "0" },
    spent: { type: "string", default: "0" },
  },
});

const request = v.parse(jobRequestSchema, {
  requestId: "0b9f6c1e-52a7-4a3e-9d55-3f1f0c2a7e10",
  repository: values.repository,
  task: "Fix the failing test in src/notes.test.ts",
  minutes: Number(values.minutes),
  budgetUsd: Number(values.budget),
});
// A fixed clock, so that two runs print the same thing.
const now = new Date("2026-10-13T03:00:00Z");
const decision = decide(request, {
  allowedRepositories: values.allowed.split(","),
  running: Number(values.running),
  spentTodayUsd: Number(values.spent),
  now,
});

const print = (title: string, value: unknown): void =>
  console.log(
    `# ${title}\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`,
  );

if ("refuse" in decision) {
  print("the launcher refuses", decision);
  process.exit(0);
}
const plan = decision.launch;
print("the launcher would call RunTask with", {
  clientToken: plan.clientToken,
  startedBy: plan.startedBy,
  overrides: overridesFor(plan, "<installation token, made at launch>"),
});
print(
  "inside the task, the agent would be started as",
  agentCommand({
    task: request.task,
    model: "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
    region: "ap-northeast-1",
    maxTurns: 80,
    maxBudgetUsd: request.budgetUsd,
    settingsPath: SETTINGS_PATH,
  })
    .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
    .join(" "),
);
print(`with ${SETTINGS_PATH}`, agentSettings());
print("the same allowlist as a Network Firewall rule source", firewallRulesSource());
