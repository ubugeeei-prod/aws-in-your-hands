import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";
import { z } from "zod";

import viteConfig from "../../../vite.config.ts";
import { PREVIEW_ENVIRONMENT } from "../infra/lib/ci-stack.ts";

// The workflows are never run here. These tests hold the properties that would
// hurt if they slipped: who gets credentials, which code runs with them, and
// whether CI still runs what a person runs locally.

const stepSchema = z.object({
  name: z.string().optional(),
  if: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).optional(),
});
const jobSchema = z.object({
  "runs-on": z.string(),
  if: z.string().optional(),
  needs: z.string().optional(),
  environment: z.string().optional(),
  permissions: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  strategy: z.unknown().optional(),
  steps: z.array(stepSchema).min(1),
});
const workflowSchema = z.object({
  name: z.string(),
  on: z.record(z.string(), z.unknown()),
  permissions: z.record(z.string(), z.string()),
  concurrency: z.object({ group: z.string(), "cancel-in-progress": z.boolean() }).optional(),
  jobs: z.record(z.string(), jobSchema),
});

const directory = new URL("../workflows/", import.meta.url);
const workflows = readdirSync(directory)
  .filter((file) => file.endsWith(".yml"))
  .map((file) => {
    const text = readFileSync(new URL(file, directory), "utf8");
    return { file, text, ...workflowSchema.parse(parse(text)) };
  });

const jobs = workflows.flatMap((workflow) =>
  Object.entries(workflow.jobs).map(([id, job]) => ({
    id: `${workflow.file}#${id}`,
    workflow,
    ...job,
  })),
);
const steps = jobs.flatMap((job) => job.steps.map((step) => ({ job, ...step })));
const CREDENTIALS = "aws-actions/configure-aws-credentials";
const credentialSteps = (job: (typeof jobs)[number]) =>
  job.steps.filter((step) => step.uses?.startsWith(`${CREDENTIALS}@`));
const tasks = Object.keys(
  (viteConfig as { run?: { tasks?: Record<string, unknown> } }).run?.tasks ?? {},
);

describe("workflows", () => {
  it("covers pull requests, deploys, previews, and scheduled drift", () => {
    expect(workflows.map((workflow) => workflow.file).toSorted()).toEqual([
      "deploy.yml",
      "drift.yml",
      "pr.yml",
      "preview.yml",
    ]);
  });

  it("pins every action to a full commit SHA, one SHA per action", () => {
    const pins = new Map<string, Set<string>>();
    for (const step of steps.filter((candidate) => candidate.uses !== undefined)) {
      const match = /^([\w-]+\/[\w-]+)@([0-9a-f]{40})$/.exec(step.uses ?? "");
      expect(match, `${step.job.id}: ${step.uses}`).not.toBeNull();
      pins.set(match?.[1] ?? "", (pins.get(match?.[1] ?? "") ?? new Set()).add(match?.[2] ?? ""));
    }
    expect([...pins.keys()].toSorted()).toEqual([
      "actions/checkout",
      "actions/upload-artifact",
      CREDENTIALS,
      "cachix/install-nix-action",
    ]);
    for (const shas of pins.values()) {
      expect(shas.size).toBe(1);
    }
    // A bare SHA says nothing to a reviewer: each one carries the release it was read from.
    for (const { text } of workflows) {
      for (const line of text.split("\n").filter((candidate) => /^\s*-? ?uses:/.test(candidate))) {
        expect(line).toMatch(/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
      }
    }
  });

  it("holds no long-lived credential, account ID, or secret reference", () => {
    for (const { file, text } of workflows) {
      expect(text, file).not.toMatch(/secrets\./);
      expect(text, file).not.toMatch(/aws-access-key-id|aws-secret-access-key|aws-session-token/);
      expect(text, file).not.toMatch(/AKIA[0-9A-Z]{16}/);
      expect(text, file).not.toMatch(/(?<![0-9a-f])\d{12}(?![0-9a-f])/);
      expect(text, file).not.toMatch(/arn:aws/);
    }
  });

  it("gets credentials only through OIDC, for the expected account", () => {
    for (const job of jobs) {
      for (const step of credentialSteps(job)) {
        expect(Object.keys(step.with ?? {}).toSorted(), job.id).toEqual([
          "allowed-account-ids",
          "aws-region",
          "role-to-assume",
        ]);
        expect(step.with?.["role-to-assume"]).toMatch(
          /^\$\{\{ vars\.AIH_(PLAN|DEPLOY|PREVIEW|DRIFT)_ROLE_ARN \}\}$/,
        );
        expect(step.with?.["allowed-account-ids"]).toBe("${{ vars.AIH_AWS_ACCOUNT_ID }}");
        expect(job.env?.["AIH_AWS_ACCOUNT_ID"]).toBe("${{ vars.AIH_AWS_ACCOUNT_ID }}");
      }
    }
  });

  it("grants id-token: write to exactly the jobs that assume a role, and nothing else to write", () => {
    for (const workflow of workflows) {
      expect(workflow.permissions, workflow.file).toEqual({ contents: "read" });
    }
    for (const job of jobs) {
      const assumesRole = credentialSteps(job).length > 0;
      expect(job.permissions?.["id-token"] === "write", job.id).toBe(assumesRole);
      const { "id-token": _token, ...rest } = job.permissions ?? {};
      expect(Object.values(rest).every((level) => level === "read" || level === "none")).toBe(true);
    }
  });

  it("each role is assumed by the kind of job its trust policy names", () => {
    const roleOf = (job: (typeof jobs)[number]) =>
      /AIH_([A-Z]+)_ROLE_ARN/.exec(`${credentialSteps(job)[0]?.with?.["role-to-assume"]}`)?.[1];
    const used = new Set<string>();
    for (const job of jobs.filter((candidate) => credentialSteps(candidate).length > 0)) {
      const role = roleOf(job) ?? "";
      used.add(role);
      const triggers = Object.keys(job.workflow.on);
      if (role === "PLAN") {
        // sub is repo:<repo>:pull_request only when the job names no environment.
        expect(triggers).toEqual(["pull_request"]);
        expect(job.environment).toBeUndefined();
      } else if (role === "DEPLOY") {
        expect(job.environment).toBe("production");
        expect(triggers).not.toContain("pull_request");
      } else if (role === "PREVIEW") {
        expect(job.environment).toBe(PREVIEW_ENVIRONMENT);
      } else {
        // sub is repo:<repo>:ref:refs/heads/<branch>: no environment, never a pull request.
        expect(role).toBe("DRIFT");
        expect(job.environment).toBeUndefined();
        expect(triggers.toSorted()).toEqual(["schedule", "workflow_dispatch"]);
      }
    }
    expect([...used].toSorted()).toEqual(["DEPLOY", "DRIFT", "PLAN", "PREVIEW"]);
  });

  it("gives credentials to pull request code only from this repository", () => {
    for (const job of jobs) {
      if (credentialSteps(job).length > 0 && "pull_request" in job.workflow.on) {
        expect(job.if, job.id).toContain(
          "github.event.pull_request.head.repo.full_name == github.repository",
        );
      }
    }
    // The job that runs on every pull request, forks included, has no way to reach AWS.
    const check = jobs.find((job) => job.id === "pr.yml#check");
    expect(check?.permissions).toBeUndefined();
    expect(check === undefined ? [] : credentialSteps(check)).toEqual([]);
  });

  it("runs only `vp` inside the Nix shell, and only tasks that exist", () => {
    const runs = steps.filter((step) => step.run !== undefined);
    expect(runs.length).toBeGreaterThan(0);
    for (const step of runs) {
      const match =
        /^nix develop --command vp (install --frozen-lockfile|run ([a-z:]+)( .+)?)$/.exec(
          step.run ?? "",
        );
      expect(match, `${step.job.id}: ${step.run}`).not.toBeNull();
      if (match?.[2] !== undefined) {
        expect(tasks, step.run).toContain(match[2]);
      }
    }
    for (const job of jobs) {
      const first = job.steps.find((step) => step.run !== undefined);
      expect(first?.run, job.id).toBe("nix develop --command vp install --frozen-lockfile");
    }
  });

  it("never interpolates event data into a shell command", () => {
    for (const step of steps.filter((candidate) => candidate.run !== undefined)) {
      expect(step.run).not.toMatch(/\$\{\{\s*(github|inputs)\./);
    }
  });

  it("never cancels a run that is changing AWS", () => {
    for (const workflow of workflows) {
      const changes = Object.values(workflow.jobs).some((job) =>
        job.steps.some((step) => /ship:cfn:(deploy|destroy)/.test(step.run ?? "")),
      );
      if (changes) {
        expect(workflow.concurrency?.["cancel-in-progress"], workflow.file).toBe(false);
      }
    }
  });

  it("checks before deploying, and calls the API after", () => {
    const deploy = workflows.find((workflow) => workflow.file === "deploy.yml")?.jobs["deploy"];
    const runs = (deploy?.steps ?? []).flatMap((step) =>
      step.run === undefined ? [] : [step.run.split(" vp run ")[1]],
    );
    expect(runs.filter((run) => run !== undefined)).toEqual([
      "check:all",
      "ship:cfn:status -c stage=prod",
      "ship:cfn:deploy -c stage=prod",
      "ship:smoke -c stage=prod",
      "ship:cfn:status -c stage=prod",
    ]);
  });

  it("keeps the drift report even when the gate fails", () => {
    const detect = workflows.find((workflow) => workflow.file === "drift.yml")?.jobs["detect"];
    const upload = detect?.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.if).toBe("always()");
    expect(upload?.with?.["path"]).toBe("reports/drift/");
  });
});
