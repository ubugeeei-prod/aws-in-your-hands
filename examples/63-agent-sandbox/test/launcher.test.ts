import { describe, expect, it } from "vite-plus/test";

import { LIMITS } from "../src/config.ts";
import { startedBy } from "../src/job.ts";
import { launch } from "../src/launcher.ts";
import { fakePorts, NOW, SETTINGS } from "./helpers.ts";

const ID = "0b9f6c1e-52a7-4a3e-9d55-3f1f0c2a7e10";
const request = (extra: Record<string, unknown> = {}) => ({
  requestId: ID,
  repository: "acme/notes",
  task: "Fix the failing test",
  ...extra,
});

describe("the launcher", () => {
  it("starts one task, with a token made for that repository alone", async () => {
    const fake = fakePorts();
    const result = await launch(request({ minutes: 20 }), fake.ports, SETTINGS);
    expect(result).toEqual({
      launched: `arn:aws:ecs:ap-northeast-1:111111111111:task/sandbox/${ID}`,
      jobId: ID,
      workBranch: `agent/${ID}`,
      deadline: "2026-10-13T03:20:00.000Z",
    });
    expect(fake.calls).toEqual(["runningTasks", "tokensSince", "githubApp", "http", "runTask"]);
    expect(JSON.parse(fake.requests[0]?.body ?? "{}")).toMatchObject({ repositories: ["notes"] });
    const environment = fake.launched[0]?.overrides.containerOverrides[0]?.environment ?? [];
    expect(environment).toContainEqual({ name: "GIT_TOKEN", value: "ghs_minted" });
    expect(environment).toContainEqual({ name: "WORK_BRANCH", value: `agent/${ID}` });
  });

  it("starts one task when the same request is delivered twice", async () => {
    const fake = fakePorts();
    const first = await launch(request(), fake.ports, SETTINGS);
    const second = await launch(request(), fake.ports, SETTINGS);
    expect(first).toHaveProperty("launched");
    expect(second).toEqual({
      alreadyLaunched: [`arn:aws:ecs:ap-northeast-1:111111111111:task/sandbox/${ID}`],
      jobId: ID,
    });
    expect(fake.launched).toHaveLength(1);
    // The second delivery made no second token either.
    expect(fake.requests).toHaveLength(1);
  });

  it("starts one task when two deliveries race past the first look", async () => {
    // Both saw no task; ECS knows the client token from the one that got there first.
    const arn = `arn:aws:ecs:ap-northeast-1:111111111111:task/sandbox/${ID}`;
    const fake = fakePorts({ runTask: () => ({ conflict: [arn] }) });
    expect(await launch(request(), fake.ports, SETTINGS)).toEqual({
      alreadyLaunched: [arn],
      jobId: ID,
    });
  });

  it("makes no credential for a request it refuses", async () => {
    const refusals: [Record<string, unknown>, Parameters<typeof fakePorts>[0], string][] = [
      [{ repository: "acme/web" }, {}, "repository_not_allowed"],
      [{ minutes: LIMITS.maxMinutes + 1 }, {}, "minutes_over_limit"],
      [{ budgetUsd: 50 }, {}, "budget_over_limit"],
      [{ extra: true }, {}, "invalid_request"],
      [
        {},
        {
          tasks: [1, 2].map((n) => ({
            taskArn: `arn:task/${n}`,
            startedBy: startedBy(
              `0b9f6c1e-52a7-4a3e-9d55-3f1f0c2a7e0${n}`,
              NOW.getTime() / 1000 + 600,
            ),
          })),
        },
        "too_many_running",
      ],
      [
        {},
        { tokens: { input: 0, output: 4_000_000, cacheRead: 0, cacheWrite: 0 } },
        "daily_budget_spent",
      ],
    ];
    for (const [extra, world, reason] of refusals) {
      const fake = fakePorts(world);
      expect(await launch(request(extra), fake.ports, SETTINGS)).toMatchObject({ refused: reason });
      expect(fake.calls, reason).not.toContain("githubApp");
      expect(fake.calls, reason).not.toContain("http");
      expect(fake.calls, reason).not.toContain("runTask");
    }
  });

  it("starts nothing with a token that is wider than it asked for", async () => {
    const fake = fakePorts({
      github: {
        status: 201,
        body: {
          token: "ghs_wide",
          expires_at: "2026-10-13T04:00:00Z",
          permissions: { contents: "write", pull_requests: "write", administration: "write" },
          repositories: [{ full_name: "acme/notes" }],
        },
      },
    });
    expect(await launch(request(), fake.ports, SETTINGS)).toMatchObject({ failed: "token" });
    expect(fake.calls).not.toContain("runTask");
  });

  it("starts nothing when GitHub says no, and says so when ECS does", async () => {
    const denied = fakePorts({ github: { status: 403, body: { message: "Forbidden" } } });
    expect(await launch(request(), denied.ports, SETTINGS)).toEqual({
      failed: "token",
      detail: "GitHub answered 403",
    });
    expect(denied.calls).not.toContain("runTask");
    const noCapacity = fakePorts({ runTask: () => ({ failure: "RESOURCE:ENI" }) });
    expect(await launch(request(), noCapacity.ports, SETTINGS)).toEqual({
      failed: "run_task",
      detail: "RESOURCE:ENI",
    });
  });

  it("refuses a repository on the list when the app is installed on another owner", async () => {
    const fake = fakePorts();
    const settings = { ...SETTINGS, allowedRepositories: ["other/notes"] };
    expect(
      await launch(request({ repository: "other/notes" }), fake.ports, settings),
    ).toMatchObject({
      refused: "repository_not_allowed",
    });
    expect(fake.calls).not.toContain("http");
  });
});
