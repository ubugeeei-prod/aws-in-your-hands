import { StackStatus } from "@aws-sdk/client-cloudformation";
import { describe, expect, it } from "vite-plus/test";

import { nextStep } from "../src/stack-status.ts";

const all = Object.values(StackStatus);

// Invariant: no deploy is started on a stack that another operation is touching,
// or that someone has to repair first.
describe("what to do after a deploy stops", () => {
  it("has an answer for every status CloudFormation can report", () => {
    expect(all.length).toBeGreaterThanOrEqual(23);
    for (const status of all) {
      expect(nextStep(status).advice.length, status).toBeGreaterThan(20);
    }
  });

  it("never starts a deploy while another operation is running", () => {
    for (const status of all.filter((candidate) => candidate.endsWith("_IN_PROGRESS"))) {
      expect(nextStep(status).deployable, status).toBe(false);
    }
  });

  it("an update that fails and rolls back passes through states where both versions exist", () => {
    // The order CloudFormation reports when a resource fails half-way through an update.
    const timeline: StackStatus[] = [
      "UPDATE_IN_PROGRESS",
      "UPDATE_ROLLBACK_IN_PROGRESS",
      "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS",
      "UPDATE_ROLLBACK_COMPLETE",
    ];
    expect(timeline.map((status) => nextStep(status).state)).toEqual([
      "in-progress",
      "in-progress",
      "in-progress",
      "rolled-back",
    ]);
    expect(timeline.map((status) => nextStep(status).deployable)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    // Rolled back is not "nothing happened": requests were served meanwhile.
    expect(nextStep("UPDATE_ROLLBACK_COMPLETE").advice).toContain(
      "Data written meanwhile was not put back",
    );
  });

  it("a rollback that fails too is not deployable until it is continued", () => {
    const timeline: StackStatus[] = [
      "UPDATE_IN_PROGRESS",
      "UPDATE_ROLLBACK_IN_PROGRESS",
      "UPDATE_ROLLBACK_FAILED",
    ];
    const last = nextStep(timeline.at(-1) ?? "UPDATE_ROLLBACK_FAILED");
    expect(last).toMatchObject({ state: "needs-repair", deployable: false });
    expect(last.advice).toContain("cdk rollback");
  });

  it("a first create that failed is never called updatable", () => {
    const step = nextStep("ROLLBACK_COMPLETE");
    expect(step.state).toBe("rolled-back");
    // Deployable only because the CDK CLI deletes and re-creates it. CloudFormation cannot update it.
    expect(step.advice).toContain("can only delete");
  });

  it("with rollback disabled, the half-updated stack asks for a decision", () => {
    for (const status of ["CREATE_FAILED", "UPDATE_FAILED"] as const) {
      expect(nextStep(status).state).toBe("needs-repair");
      expect(nextStep(status).advice).toMatch(/go forward.*roll back/s);
    }
  });

  it("calls only finished operations settled", () => {
    expect(all.filter((status) => nextStep(status).state === "settled").toSorted()).toEqual([
      "CREATE_COMPLETE",
      "IMPORT_COMPLETE",
      "UPDATE_COMPLETE",
    ]);
  });
});
