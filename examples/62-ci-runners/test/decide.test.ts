import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { RUNNER } from "../src/config.ts";
import { admit, type Job, type Policy, runnerName, screen, TRUSTED_EVENTS } from "../src/decide.ts";
import { workflowJobSchema } from "../src/events.ts";
import { payload, REPOSITORY } from "./fakes.ts";

const policy: Policy = { repositories: [REPOSITORY], label: RUNNER.label, events: TRUSTED_EVENTS };
const parse = (body: string) => v.parse(workflowJobSchema, JSON.parse(body));
const job: Job = { repository: REPOSITORY, installationId: 1, jobId: 2, runId: 3 };
const run = (event: string, head: string | null, base = REPOSITORY) => ({
  event,
  repository: { full_name: base },
  head_repository: head === null ? null : { full_name: head },
});

describe("screening a delivery", () => {
  it("launches for a queued job of an allowed private repository that asks for our label", () => {
    expect(screen(parse(payload()), policy)).toEqual({
      kind: "launch",
      job: {
        repository: REPOSITORY,
        installationId: 50000001,
        jobId: 31000000001,
        runId: 9100000001,
      },
    });
  });

  it.each(["in_progress", "completed", "waiting"])("skips a job that is %s", (action) => {
    const delivery = parse(payload((value) => (value.action = action)));
    expect(screen(delivery, policy)).toEqual({ kind: "skip", reason: "not_queued" });
  });

  it.each([[["ubuntu-latest"]], [[]], [["self-hosted", "aih-fargate"]], [["AIH-FARGATE"]]])(
    "skips a job whose labels are %j",
    (labels) => {
      const delivery = parse(payload((value) => (value.workflow_job["labels"] = labels)));
      expect(screen(delivery, policy)).toEqual({ kind: "skip", reason: "labels_not_ours" });
    },
  );

  it("skips a repository that is not on the list, however similar its name", () => {
    for (const name of ["example-org/notes-fork", "attacker/notes", "example-org/Notes"]) {
      const delivery = parse(payload((value) => (value.repository["full_name"] = name)));
      expect(screen(delivery, policy)).toEqual({ kind: "skip", reason: "repository_not_allowed" });
    }
  });

  it("allows nothing when the list is empty", () => {
    const empty = { ...policy, repositories: [] };
    expect(screen(parse(payload()), empty)).toEqual({
      kind: "skip",
      reason: "repository_not_allowed",
    });
  });

  it("skips a public repository even when it is on the list", () => {
    const delivery = parse(payload((value) => (value.repository["private"] = false)));
    expect(screen(delivery, policy)).toEqual({ kind: "skip", reason: "public_repository" });
  });

  it("skips a delivery that names no app installation", () => {
    const delivery = parse(payload((value) => delete value.installation));
    expect(screen(delivery, policy)).toEqual({ kind: "skip", reason: "not_from_app" });
  });
});

describe("admitting a run", () => {
  it("admits a run whose code came from the repository itself", () => {
    expect(admit(run("push", REPOSITORY), job, policy)).toBeNull();
    expect(admit(run("pull_request", REPOSITORY), job, policy)).toBeNull();
  });

  it("refuses a pull request from a fork", () => {
    expect(admit(run("pull_request", "outsider/notes"), job, policy)).toBe("fork");
  });

  it("refuses a run whose head repository is gone or whose base is another repository", () => {
    expect(admit(run("pull_request", null), job, policy)).toBe("fork");
    expect(admit(run("push", REPOSITORY, "other/notes"), job, policy)).toBe("fork");
  });

  it("refuses pull_request_target and any event not on the list", () => {
    expect(admit(run("pull_request_target", REPOSITORY), job, policy)).toBe("event_not_trusted");
    expect(admit(run("issue_comment", REPOSITORY), job, policy)).toBe("event_not_trusted");
  });
});

describe("the delivery schema", () => {
  it("refuses ids that are not positive integers", () => {
    for (const id of [0, -1, 1.5, "1", null]) {
      const body = JSON.parse(payload((value) => (value.workflow_job["id"] = id)));
      expect(v.safeParse(workflowJobSchema, body).success).toBe(false);
    }
  });

  it("gives each attempt a runner name of its own", () => {
    expect(runnerName(7, "a1")).toBe("aih-7-a1");
    expect(runnerName(7, "a1")).not.toBe(runnerName(7, "b2"));
  });
});
