import { readFileSync } from "node:fs";

import { createApp } from "../src/app.ts";
import { memoryClaims } from "../src/claims.ts";
import { RUNNER, TIMING } from "../src/config.ts";
import { TRUSTED_EVENTS } from "../src/decide.ts";
import type { WorkflowRun } from "../src/events.ts";
import type { GitHub } from "../src/github.ts";
import type { Launch } from "../src/launcher.ts";
import type { ReceiveDeps } from "../src/receive.ts";
import { sign } from "../src/signature.ts";

export const SECRET = "a-webhook-secret-for-tests";
export const REPOSITORY = "example-org/notes";

type Payload = {
  action: string;
  workflow_job: Record<string, unknown>;
  repository: Record<string, unknown>;
  installation?: Record<string, unknown>;
};

/** The hand-written fixture, with whatever a test wants changed. */
export function payload(change: (value: Payload) => void = () => {}): string {
  const value = JSON.parse(
    readFileSync(new URL("../fixtures/workflow-job-queued.json", import.meta.url), "utf8"),
  ) as Payload;
  change(value);
  return JSON.stringify(value);
}

export function delivery(
  body: string,
  options: { secret?: string; event?: string; signature?: string } = {},
): Request {
  return new Request("https://receiver.test/webhook", {
    method: "POST",
    body,
    headers: {
      "x-github-event": options.event ?? "workflow_job",
      "x-github-delivery": "00000000-0000-4000-8000-000000000001",
      "x-hub-signature-256":
        options.signature ?? sign(options.secret ?? SECRET, new TextEncoder().encode(body)),
    },
  });
}

/** Everything outside the receiver, in memory, recording what was asked of it. */
export function world() {
  const state = {
    now: 1_800_000_000,
    run: {
      event: "push",
      repository: { full_name: REPOSITORY },
      head_repository: { full_name: REPOSITORY },
    } as WorkflowRun,
    runners: new Map<number, string>(),
    removed: [] as number[],
    launches: [] as Launch[],
    tokensFor: [] as string[],
    failLaunch: false,
    failRemove: false,
    failComplete: false,
    logs: [] as Record<string, unknown>[],
  };
  const claims = memoryClaims(TIMING.claimLease);
  let nextRunner = 1;
  const github: GitHub = {
    async run() {
      return state.run;
    },
    async createRunner(name) {
      const runnerId = nextRunner++;
      state.runners.set(runnerId, name);
      return { runnerId, encodedJitConfig: `jit-for-${name}` };
    },
    async removeRunner(runnerId) {
      if (state.failRemove) {
        throw new Error("GitHub answered 500 to a runner removal");
      }
      state.runners.delete(runnerId);
      state.removed.push(runnerId);
    },
  };
  const deps: ReceiveDeps = {
    webhookSecret: async () => SECRET,
    policy: { repositories: [REPOSITORY], label: RUNNER.label, events: TRUSTED_EVENTS },
    claims: {
      ...claims,
      async complete(key, taskArn, now) {
        if (state.failComplete) {
          throw new Error("DynamoDB did not answer");
        }
        await claims.complete(key, taskArn, now);
      },
    },
    github: (_installationId, repository) => {
      state.tokensFor.push(repository);
      return github;
    },
    launcher: {
      async launch(request) {
        if (state.failLaunch) {
          throw new Error("RunTask started nothing: RESOURCE:ENI");
        }
        state.launches.push(request);
        return {
          taskArn: `arn:aws:ecs:ap-northeast-1:111122223333:task/c/${state.launches.length}`,
        };
      },
    },
    now: () => state.now,
    nonce: () => `n${state.launches.length + state.removed.length + 1}`,
    log: (entry) => state.logs.push(entry),
  };
  return { state, deps, claims, app: createApp(deps) };
}
