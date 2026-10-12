import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import {
  type Deps,
  type ExecResult,
  PUSH_MARGIN_MS,
  runJob,
  taskEnvironmentSchema,
} from "../src/run.ts";

const TOKEN = "ghs_secret_token";
const NOW = new Date("2026-10-13T03:00:00Z");
const env = (extra: Record<string, string> = {}) =>
  v.parse(taskEnvironmentSchema, {
    JOB_ID: "0b9f6c1e-52a7-4a3e-9d55-3f1f0c2a7e10",
    REPOSITORY: "acme/notes",
    BASE_BRANCH: "main",
    WORK_BRANCH: "agent/0b9f6c1e-52a7-4a3e-9d55-3f1f0c2a7e10",
    TASK: "Fix the failing test",
    MAX_BUDGET_USD: "2",
    MAX_TURNS: "80",
    DEADLINE_SECONDS: String(NOW.getTime() / 1000 + 1800),
    GIT_TOKEN: TOKEN,
    MODEL: "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
    AWS_REGION: "ap-northeast-1",
    ...extra,
  });

type Call = { argv: string[]; env: Record<string, string>; timeoutMs?: number };
const kind = (argv: string[]): string =>
  argv[0] === "claude"
    ? "agent"
    : (argv.find((arg, index) => index > 0 && argv[index - 1] !== "-c" && !arg.startsWith("-")) ??
      "?");

/** A scripted world: each step answers as told, and everything that was run is recorded. */
function world(answers: Record<string, Partial<ExecResult>> = {}, pullStatus = 201) {
  const calls: Call[] = [];
  const requests: { url: string; headers: Record<string, string>; body: string }[] = [];
  const deps: Deps = {
    exec: async (argv, options) => {
      calls.push({ argv, env: options.env, timeoutMs: options.timeoutMs });
      // `git diff --quiet` exits 1 when the branch differs from its base.
      const fallback = kind(argv) === "diff" ? { code: 1 } : { code: 0 };
      return { timedOut: false, ...fallback, ...answers[kind(argv)] } as ExecResult;
    },
    fetch: async (url, init) => {
      requests.push({ url, headers: init.headers, body: init.body });
      return {
        status: pullStatus,
        json: async () => ({ html_url: "https://github.com/acme/notes/pull/7" }),
      };
    },
    now: () => NOW,
    inherited: { PATH: "/usr/bin", HOME: "/home/node", GIT_TOKEN: TOKEN },
  };
  return { deps, calls, requests, kinds: () => calls.map((call) => kind(call.argv)) };
}

describe("one job, start to finish", () => {
  it("clones, branches, runs the agent, commits, pushes the work branch, and opens the pull request", async () => {
    const w = world();
    expect(await runJob(env(), w.deps)).toEqual({
      status: "pull_request",
      url: "https://github.com/acme/notes/pull/7",
    });
    expect(w.kinds()).toEqual(["clone", "switch", "agent", "add", "commit", "diff", "push"]);
    expect(w.requests.map((request) => request.url)).toEqual([
      "https://api.github.com/repos/acme/notes/pulls",
    ]);
  });

  it("gives the Git token to the clone and the push, and to nothing else", async () => {
    const w = world();
    await runJob(env(), w.deps);
    const withToken = w.calls.filter((call) => Object.values(call.env).includes(TOKEN));
    expect(withToken.map((call) => kind(call.argv))).toEqual(["clone", "push"]);
    // Not in any argument either: a process list shows arguments to everyone in the container.
    for (const call of w.calls) {
      expect(call.argv.join(" ")).not.toContain(TOKEN);
    }
    const agent = w.calls.find((call) => kind(call.argv) === "agent");
    expect(Object.keys(agent?.env ?? {})).not.toContain("GIT_TOKEN");
  });

  it("pushes to a written-out address and branch, with hooks and other credential helpers off", async () => {
    const w = world();
    await runJob(env(), w.deps);
    const push = w.calls.find((call) => kind(call.argv) === "push")?.argv ?? [];
    expect(push.slice(-3)).toEqual([
      "push",
      "https://github.com/acme/notes.git",
      "HEAD:refs/heads/agent/0b9f6c1e-52a7-4a3e-9d55-3f1f0c2a7e10",
    ]);
    expect(push).not.toContain("origin");
    expect(push).not.toContain("--force");
    for (const call of w.calls.filter((item) => item.argv[0] === "git")) {
      expect(call.argv).toContain("core.hooksPath=/dev/null");
      expect(call.argv).toContain("credential.helper=");
    }
  });

  it("stops the agent before the deadline, leaving time for the push", async () => {
    const w = world();
    await runJob(env(), w.deps);
    const agent = w.calls.find((call) => kind(call.argv) === "agent");
    expect(agent?.timeoutMs).toBe(1800_000 - PUSH_MARGIN_MS);
  });
});

describe("when a step goes wrong", () => {
  it("pushes nothing when the agent ends in an error", async () => {
    const w = world({ agent: { code: 1 } });
    expect(await runJob(env(), w.deps)).toEqual({ status: "agent_failed", code: 1 });
    expect(w.kinds()).toEqual(["clone", "switch", "agent"]);
    expect(w.requests).toEqual([]);
  });

  it("pushes nothing when the agent ran into the deadline", async () => {
    const w = world({ agent: { code: 143, timedOut: true } });
    expect(await runJob(env(), w.deps)).toEqual({ status: "deadline" });
    expect(w.kinds()).not.toContain("push");
  });

  it("does not start the agent when the deadline is already too near", async () => {
    const w = world();
    const late = env({ DEADLINE_SECONDS: String(NOW.getTime() / 1000 + 60) });
    expect(await runJob(late, w.deps)).toEqual({ status: "deadline" });
    expect(w.kinds()).toEqual(["clone", "switch"]);
  });

  it("opens no pull request when nothing changed", async () => {
    const w = world({ commit: { code: 1 }, diff: { code: 0 } });
    expect(await runJob(env(), w.deps)).toEqual({ status: "no_changes" });
    expect(w.kinds()).not.toContain("push");
    expect(w.requests).toEqual([]);
  });

  it("reports the step that failed: the clone, the push, the pull request", async () => {
    expect(await runJob(env(), world({ clone: { code: 128 } }).deps)).toEqual({
      status: "failed",
      step: "clone",
    });
    const rejected = world({ push: { code: 1 } });
    expect(await runJob(env(), rejected.deps)).toEqual({ status: "failed", step: "push" });
    expect(rejected.requests).toEqual([]);
    expect(await runJob(env(), world({}, 422).deps)).toEqual({
      status: "failed",
      step: "pull_request",
    });
  });

  it("refuses to run at all if the work branch is the base branch", async () => {
    const w = world();
    const same = env({ BASE_BRANCH: "agent/x", WORK_BRANCH: "agent/x" });
    expect(await runJob(same, w.deps)).toEqual({ status: "failed", step: "check" });
    expect(w.calls).toEqual([]);
  });

  it("refuses an environment whose work branch is not an agent branch", () => {
    expect(v.safeParse(taskEnvironmentSchema, { ...env(), WORK_BRANCH: "main" }).success).toBe(
      false,
    );
    expect(
      v.safeParse(taskEnvironmentSchema, { ...env(), REPOSITORY: "acme/notes/../x" }).success,
    ).toBe(false);
  });
});
