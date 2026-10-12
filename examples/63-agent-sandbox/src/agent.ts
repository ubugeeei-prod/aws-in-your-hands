// How the task starts Claude Code: the command line, the settings file, and the environment.
// Every flag and key here is one its documentation names; nothing in this file runs it.

import { sandboxAllowedDomains } from "./egress.ts";

export type AgentJob = {
  task: string;
  model: string;
  region: string;
  maxTurns: number;
  maxBudgetUsd: number;
  settingsPath: string;
};

// #region command
/** `claude -p`: one prompt, no terminal, and an exit status at the end. */
export function agentCommand(job: AgentJob): string[] {
  return [
    "claude",
    // Skips the hooks, MCP servers and CLAUDE.md of the repository. A cloned repository is input, not configuration.
    "--bare",
    "-p",
    job.task,
    // One JSON object per line on stdout: every tool call and its result go to the task's log.
    "--output-format",
    "stream-json",
    "--verbose",
    // Nobody is there to answer a prompt. What is not allowed below is denied.
    "--permission-mode",
    "dontAsk",
    // The tools that exist at all. WebFetch and WebSearch run outside the Bash sandbox, so they are left out.
    "--tools",
    "Bash,Edit,Read,Write",
    "--allowedTools",
    "Bash,Edit,Read,Write",
    "--max-turns",
    String(job.maxTurns),
    // The agent's own count of what it spent. An estimate, and enforced by the process it limits.
    "--max-budget-usd",
    String(job.maxBudgetUsd),
    "--settings",
    job.settingsPath,
    "--no-session-persistence",
    "--model",
    job.model,
  ];
}
// #endregion command

// #region settings
/** The settings file: the Bash sandbox on, with the same allowlist the network enforces. */
export function agentSettings() {
  return {
    sandbox: {
      enabled: true,
      // If the sandbox cannot start, stop. The default would be to run commands without it.
      failIfUnavailable: true,
      // No retry outside the sandbox.
      allowUnsandboxedCommands: false,
      // An unprivileged container cannot mount a fresh /proc. The task around it is the boundary.
      enableWeakerNestedSandbox: true,
      network: {
        allowedDomains: sandboxAllowedDomains(),
        // Deny what is not listed, instead of asking.
        strictAllowlist: true,
      },
    },
    permissions: {
      deny: ["WebFetch", "WebSearch"],
    },
  };
}
// #endregion settings

// #region environment
/** The variables the agent's process gets. A list of names to keep, never a list of names to remove. */
const PASSED_ON = [
  "PATH",
  "HOME",
  "LANG",
  "TMPDIR",
  // The task role's credentials. The agent needs them to call the model, so it has them.
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
] as const;

export function agentEnvironment(
  inherited: Record<string, string | undefined>,
  job: Pick<AgentJob, "model" | "region">,
): Record<string, string> {
  const kept = Object.fromEntries(
    PASSED_ON.flatMap((name) => {
      const value = inherited[name];
      return value === undefined ? [] : [[name, value] as const];
    }),
  );
  return {
    ...kept,
    CLAUDE_CODE_USE_BEDROCK: "1",
    AWS_REGION: job.region,
    // Pinned: an alias would follow Claude Code's default to a model the role may not call.
    ANTHROPIC_MODEL: job.model,
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}
// #endregion environment
