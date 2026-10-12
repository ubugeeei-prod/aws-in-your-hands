// What one task does from start to finish, with the commands and the network handed in.

import * as v from "valibot";

import { agentCommand, agentEnvironment } from "./agent.ts";
import { REPOSITORY_PATTERN } from "./config.ts";
import { allowsUrl } from "./egress.ts";
import { pullRequest } from "./github.ts";

const numeric = v.pipe(v.string(), v.transform(Number), v.number(), v.finite());

// #region environment
/** What the launcher put in the container's environment. Checked again here: the task trusts nothing it was handed. */
export const taskEnvironmentSchema = v.object({
  JOB_ID: v.pipe(v.string(), v.minLength(1)),
  REPOSITORY: v.pipe(v.string(), v.regex(REPOSITORY_PATTERN)),
  BASE_BRANCH: v.pipe(v.string(), v.minLength(1)),
  WORK_BRANCH: v.pipe(v.string(), v.startsWith("agent/")),
  TASK: v.pipe(v.string(), v.minLength(1)),
  MAX_BUDGET_USD: numeric,
  MAX_TURNS: v.pipe(numeric, v.integer(), v.minValue(1)),
  DEADLINE_SECONDS: v.pipe(numeric, v.integer()),
  GIT_TOKEN: v.pipe(v.string(), v.minLength(1)),
  MODEL: v.pipe(v.string(), v.minLength(1)),
  AWS_REGION: v.pipe(v.string(), v.minLength(1)),
});
export type TaskEnvironment = v.InferOutput<typeof taskEnvironmentSchema>;
// #endregion environment

export type ExecResult = { code: number | null; timedOut: boolean };
export type Exec = (
  argv: string[],
  options: { cwd: string; env: Record<string, string>; timeoutMs?: number },
) => Promise<ExecResult>;

export type Deps = {
  exec: Exec;
  fetch: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<{ status: number; json: () => Promise<unknown> }>;
  now: () => Date;
  /** The variables this process itself was started with. */
  inherited: Record<string, string | undefined>;
};

export type Outcome =
  | { status: "pull_request"; url: string }
  | { status: "no_changes" }
  | { status: "agent_failed"; code: number | null }
  | { status: "deadline" }
  | { status: "failed"; step: string };

export const WORKSPACE = "/workspace";
const REPOSITORY_DIR = `${WORKSPACE}/repo`;
/** Written into the image by the Dockerfile, on the read-only root: the agent cannot edit its own rules. */
export const SETTINGS_PATH = "/etc/claude-code/managed-settings.json";
/** Time kept back from the deadline for the commit, the push, and the pull request. */
export const PUSH_MARGIN_MS = 120_000;

// #region git
/**
 * Answers Git's question for github.com only, from an environment variable, so the token is
 * in no URL, no argument, and no file. Hooks are off: the agent may have written some.
 */
const CREDENTIAL_HELPER =
  '!f() { test "$1" = get && printf \'username=x-access-token\\npassword=%s\\n\' "$GIT_TOKEN"; }; f';

const git = (...args: string[]): string[] => [
  "git",
  "-c",
  "core.hooksPath=/dev/null",
  // An empty value drops every helper configured elsewhere, in the repository's own config too.
  "-c",
  "credential.helper=",
  "-c",
  "credential.https://github.com.helper=",
  "-c",
  `credential.https://github.com.helper=${CREDENTIAL_HELPER}`,
  ...args,
];
// #endregion git

// #region run
export async function runJob(env: TaskEnvironment, deps: Deps): Promise<Outcome> {
  const remote = `https://github.com/${env.REPOSITORY}.git`;
  if (env.WORK_BRANCH === env.BASE_BRANCH || !allowsUrl(remote).allowed) {
    return { status: "failed", step: "check" };
  }
  const base = { PATH: deps.inherited["PATH"] ?? "", HOME: deps.inherited["HOME"] ?? WORKSPACE };
  // Only the two commands that talk to GitHub get the token.
  const withToken = { ...base, GIT_TOKEN: env.GIT_TOKEN, GIT_TERMINAL_PROMPT: "0" };
  const ok = async (argv: string[], environment: Record<string, string>, cwd: string) =>
    (await deps.exec(argv, { cwd, env: environment })).code === 0;

  const cloned = await ok(
    git(
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--branch",
      env.BASE_BRANCH,
      remote,
      REPOSITORY_DIR,
    ),
    withToken,
    WORKSPACE,
  );
  if (!cloned) {
    return { status: "failed", step: "clone" };
  }
  if (!(await ok(git("switch", "-c", env.WORK_BRANCH), base, REPOSITORY_DIR))) {
    return { status: "failed", step: "branch" };
  }

  const remaining = env.DEADLINE_SECONDS * 1000 - deps.now().getTime() - PUSH_MARGIN_MS;
  if (remaining <= 0) {
    return { status: "deadline" };
  }
  const job = {
    task: env.TASK,
    model: env.MODEL,
    region: env.AWS_REGION,
    maxTurns: env.MAX_TURNS,
    maxBudgetUsd: env.MAX_BUDGET_USD,
    settingsPath: SETTINGS_PATH,
  };
  const agent = await deps.exec(agentCommand(job), {
    cwd: REPOSITORY_DIR,
    env: agentEnvironment(deps.inherited, job),
    timeoutMs: remaining,
  });
  if (agent.timedOut) {
    return { status: "deadline" };
  }
  // A run that ended in an error is not offered for review.
  if (agent.code !== 0) {
    return { status: "agent_failed", code: agent.code };
  }

  await ok(git("add", "--all"), base, REPOSITORY_DIR);
  const identity = [
    "-c",
    "user.name=agent-sandbox",
    "-c",
    "user.email=agent-sandbox@users.noreply.github.com",
  ];
  // Fails when there is nothing new to commit, which the comparison below tells apart.
  await ok(
    git(...identity, "commit", "--message", `Agent job ${env.JOB_ID}`),
    base,
    REPOSITORY_DIR,
  );
  const same = await ok(
    git("diff", "--quiet", `origin/${env.BASE_BRANCH}`, "HEAD"),
    base,
    REPOSITORY_DIR,
  );
  if (same) {
    return { status: "no_changes" };
  }

  // The address and the branch are written out: neither comes from the repository's config.
  const pushed = await ok(
    git("push", remote, `HEAD:refs/heads/${env.WORK_BRANCH}`),
    withToken,
    REPOSITORY_DIR,
  );
  if (!pushed) {
    return { status: "failed", step: "push" };
  }

  const request = pullRequest(
    {
      repository: env.REPOSITORY,
      head: env.WORK_BRANCH,
      base: env.BASE_BRANCH,
      title: `Agent job ${env.JOB_ID}`,
      body: `Written by a coding agent in the sandbox.\n\nTask:\n\n${env.TASK}`,
    },
    env.GIT_TOKEN,
  );
  const answer = await deps.fetch(request.url, request);
  if (answer.status !== 201) {
    return { status: "failed", step: "pull_request" };
  }
  const created = v.safeParse(v.object({ html_url: v.string() }), await answer.json());
  return created.success
    ? { status: "pull_request", url: created.output.html_url }
    : { status: "failed", step: "pull_request" };
}
// #endregion run
