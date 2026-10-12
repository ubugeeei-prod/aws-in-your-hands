import { generateKeyPairSync } from "node:crypto";

import type { GithubApp, HttpRequest } from "../src/github.ts";
import { TOKEN_PERMISSIONS } from "../src/github.ts";
import type { LaunchPlan, RunTaskOverrides } from "../src/job.ts";
import type { RunningTask, Tokens } from "../src/limits.ts";
import type { Ports, RunTaskResult } from "../src/ports.ts";

export const NOW = new Date("2026-10-13T03:00:00Z");
export const NO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
export const SETTINGS = {
  allowedRepositories: ["acme/notes"],
  model: "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
} as const;

// Not a key: the fake below never signs with it. test/github.test.ts covers the signature.
const app: GithubApp = {
  clientId: "Iv23liTEST",
  installationId: 4242,
  owner: "acme",
  privateKey: "",
};

export type World = {
  tasks: RunningTask[];
  tokens: Tokens;
  /** What GitHub answers to the token request. */
  github: { status: number; body: unknown };
  runTask: (plan: LaunchPlan, overrides: RunTaskOverrides) => RunTaskResult;
  /** Task ARNs for which StopTask throws. */
  unstoppable: string[];
};

/** Fake ports over a world the test sets up. Every call is recorded in order. */
export function fakePorts(overrides: Partial<World> = {}) {
  const world: World = {
    tasks: [],
    tokens: NO_TOKENS,
    github: {
      status: 201,
      body: {
        token: "ghs_minted",
        expires_at: "2026-10-13T04:00:00Z",
        permissions: { ...TOKEN_PERMISSIONS, metadata: "read" },
        repositories: [{ full_name: "acme/notes" }],
      },
    },
    runTask: (plan) => {
      const taskArn = `arn:aws:ecs:ap-northeast-1:111111111111:task/sandbox/${plan.jobId}`;
      world.tasks.push({ taskArn, startedBy: plan.startedBy });
      return { taskArn };
    },
    unstoppable: [],
    ...overrides,
  };
  const calls: string[] = [];
  const launched: { plan: LaunchPlan; overrides: RunTaskOverrides }[] = [];
  const requests: HttpRequest[] = [];
  const stopped: { taskArn: string; reason: string }[] = [];
  const ports: Ports = {
    now: () => NOW,
    runningTasks: async () => {
      calls.push("runningTasks");
      return [...world.tasks];
    },
    tokensSince: async () => {
      calls.push("tokensSince");
      return world.tokens;
    },
    githubApp: async () => {
      calls.push("githubApp");
      // The launcher signs with whatever key the secret holds; the fake hands it a request-shaped app.
      return { ...app, privateKey: TEST_KEY };
    },
    http: async (request) => {
      calls.push("http");
      requests.push(request);
      return world.github;
    },
    runTask: async (plan, taskOverrides) => {
      calls.push("runTask");
      launched.push({ plan, overrides: taskOverrides });
      return world.runTask(plan, taskOverrides);
    },
    stopTask: async (taskArn, reason) => {
      calls.push("stopTask");
      if (world.unstoppable.includes(taskArn)) {
        throw new Error("ServerException");
      }
      stopped.push({ taskArn, reason });
      world.tasks = world.tasks.filter((task) => task.taskArn !== taskArn);
    },
  };
  return { ports, world, calls, launched, requests, stopped };
}

/** A key made for the test run, so that the launcher's real signing code runs. */
export const TEST_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
