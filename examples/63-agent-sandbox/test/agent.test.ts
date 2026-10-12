import { describe, expect, it } from "vite-plus/test";

import { agentCommand, agentEnvironment, agentSettings } from "../src/agent.ts";
import { allows } from "../src/egress.ts";

const job = {
  task: "Fix the failing test",
  model: "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
  region: "ap-northeast-1",
  maxTurns: 80,
  maxBudgetUsd: 2,
  settingsPath: "/etc/claude-code/managed-settings.json",
};
const after = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];

describe("the agent's command line", () => {
  const argv = agentCommand(job);

  it("runs once, without a terminal, and without the repository's own configuration", () => {
    expect(argv.slice(0, 4)).toEqual(["claude", "--bare", "-p", job.task]);
    expect(after(argv, "--output-format")).toBe("stream-json");
    expect(argv).toContain("--no-session-persistence");
  });

  it("denies what it was not given, and never skips the permission system", () => {
    expect(after(argv, "--permission-mode")).toBe("dontAsk");
    expect(argv).not.toContain("--dangerously-skip-permissions");
    expect(argv.join(" ")).not.toContain("bypassPermissions");
    expect(after(argv, "--tools")).toBe("Bash,Edit,Read,Write");
    expect(after(argv, "--tools")).not.toMatch(/Web/);
  });

  it("carries both of the agent's own limits and the pinned model", () => {
    expect(after(argv, "--max-turns")).toBe("80");
    expect(after(argv, "--max-budget-usd")).toBe("2");
    expect(after(argv, "--model")).toBe(job.model);
  });

  it("passes a task that looks like a flag as the prompt, not as a flag", () => {
    const hostile = agentCommand({ ...job, task: "--dangerously-skip-permissions" });
    // Still in the prompt's position, directly after -p.
    expect(hostile[hostile.indexOf("-p") + 1]).toBe("--dangerously-skip-permissions");
    expect(hostile.filter((arg) => arg === "--dangerously-skip-permissions")).toHaveLength(1);
  });
});

describe("the agent's settings", () => {
  const settings = agentSettings();

  it("turns the Bash sandbox on and closes its ways out", () => {
    expect(settings.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
    });
    expect(settings.sandbox.network.strictAllowlist).toBe(true);
    expect(settings.permissions.deny).toEqual(["WebFetch", "WebSearch"]);
  });

  it("allows only hosts the book's own evaluator allows", () => {
    for (const entry of settings.sandbox.network.allowedDomains) {
      const [host = "", port] = entry.split(":");
      expect(port).toBe("443");
      expect(allows(host, 443), entry).toMatchObject({ allowed: true });
    }
  });
});

describe("the agent's environment", () => {
  const inherited = {
    PATH: "/usr/local/bin:/usr/bin",
    HOME: "/home/node",
    GIT_TOKEN: "ghs_secret",
    TASK: "…",
    AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc",
    AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
    AWS_BEARER_TOKEN_BEDROCK: "should-not-pass",
  };
  const environment = agentEnvironment(inherited, job);

  it("is built from a list of names to keep, so the Git token is not in it", () => {
    expect(Object.keys(environment).toSorted()).toEqual([
      "ANTHROPIC_MODEL",
      "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
      "AWS_REGION",
      "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
      "CLAUDE_CODE_USE_BEDROCK",
      "DISABLE_AUTOUPDATER",
      "HOME",
      "PATH",
    ]);
    expect(JSON.stringify(environment)).not.toContain("ghs_secret");
  });

  it("points Claude Code at Bedrock with one pinned model", () => {
    expect(environment).toMatchObject({
      CLAUDE_CODE_USE_BEDROCK: "1",
      AWS_REGION: "ap-northeast-1",
      ANTHROPIC_MODEL: job.model,
    });
  });
});
