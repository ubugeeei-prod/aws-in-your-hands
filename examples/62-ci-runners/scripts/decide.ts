// node scripts/decide.ts
//
// Sends hand-written deliveries through the real receiver, with GitHub, ECS and the claim
// table replaced by stand-ins in this file. Prints what the receiver answered and what it
// would have started. Reads only this checkout: no network, no AWS, no GitHub.

import { readFileSync } from "node:fs";

import { createApp } from "../src/app.ts";
import { memoryClaims } from "../src/claims.ts";
import { RUNNER, TIMING } from "../src/config.ts";
import { TRUSTED_EVENTS } from "../src/decide.ts";
import type { WorkflowRun } from "../src/events.ts";
import { sign } from "../src/signature.ts";

const SECRET = "local-secret";
const REPOSITORY = "example-org/notes";
const fixture = readFileSync(
  new URL("../fixtures/workflow-job-queued.json", import.meta.url),
  "utf8",
);
type Payload = { repository: Record<string, unknown>; workflow_job: Record<string, unknown> };
const changed = (change: (value: Payload) => void): string => {
  const value = JSON.parse(fixture) as Payload;
  change(value);
  return JSON.stringify(value);
};

const started: string[] = [];
let run: WorkflowRun = {
  event: "push",
  repository: { full_name: REPOSITORY },
  head_repository: { full_name: REPOSITORY },
};
let capacity = true;
const app = createApp({
  webhookSecret: async () => SECRET,
  policy: { repositories: [REPOSITORY], label: RUNNER.label, events: TRUSTED_EVENTS },
  claims: memoryClaims(TIMING.claimLease),
  github: () => ({
    run: async () => run,
    createRunner: async (name) => ({ runnerId: 1, encodedJitConfig: `jit-for-${name}` }),
    removeRunner: async () => {},
  }),
  launcher: {
    async launch(request) {
      if (!capacity) {
        throw new Error("RunTask started nothing (stand-in)");
      }
      started.push(request.runnerName);
      return { taskArn: `task-for-${request.runnerName}` };
    },
  },
  now: () => 1_800_000_000,
  nonce: () => String(started.length + 1),
  log: () => {},
});

async function deliver(what: string, body: string, secret = SECRET): Promise<void> {
  const response = await app(
    new Request("https://receiver.local/webhook", {
      method: "POST",
      body,
      headers: {
        "x-github-event": "workflow_job",
        "x-hub-signature-256": sign(secret, new TextEncoder().encode(body)),
      },
    }),
  );
  console.log(`${what.padEnd(44)} ${response.status} ${await response.text()}`);
}

await deliver("signed with another secret", fixture, "guessed");
await deliver(
  "a job for ubuntu-latest",
  changed((value) => (value.workflow_job["labels"] = ["ubuntu-latest"])),
);
await deliver(
  "a repository not on the list",
  changed((value) => (value.repository["full_name"] = "other/notes")),
);
run = { ...run, event: "pull_request", head_repository: { full_name: "outsider/notes" } };
await deliver(
  "a pull request from a fork",
  changed((value) => (value.workflow_job["id"] = 2)),
);
run = { ...run, event: "push", head_repository: { full_name: REPOSITORY } };
capacity = false;
await deliver("a queued job, no capacity", fixture);
capacity = true;
await deliver("the same delivery, sent again", fixture);
await deliver("the same delivery, a third time", fixture);
console.log(`\ntasks that would have been started: ${started.join(", ")}`);
