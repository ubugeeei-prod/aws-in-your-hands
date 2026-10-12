import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import type { State } from "../src/asl.ts";
import {
  digestInputSchema,
  digestOutputSchema,
  MAX_DIGEST_NOTES,
  noteDigestWorkflow,
} from "../src/digest.ts";
import { runStateMachine } from "../src/interpreter.ts";
import type { LocalWorld } from "../src/local-world.ts";
import { LOCAL, localDigest, runImport } from "../src/local.ts";
import { INPUT, path, setup } from "./harness.ts";

const digest = (world: LocalWorld, noteIds: string[]) =>
  runStateMachine(localDigest, { owner: INPUT.owner, noteIds }, world, {
    name: "digest-1",
    startTime: "2026-10-13T00:00:00.000Z",
  });

describe("the digest", () => {
  it("reports each note in the order asked, and says which are missing", async () => {
    const world = setup();
    await runImport(world, INPUT);
    const outcome = await digest(world, ["nope", INPUT.noteId]);
    expect(outcome).toMatchObject({
      status: "SUCCEEDED",
      output: {
        owner: "user-1",
        notes: [
          { noteId: "nope", found: false, title: null },
          { noteId: "note-1", found: true, title: "Minutes" },
        ],
        missing: 1,
      },
    });
    if (outcome.status !== "SUCCEEDED") {
      throw new Error("expected an output");
    }
    expect(v.safeParse(digestOutputSchema, outcome.output).success).toBe(true);
  });

  // #region pending
  it("does not show a note whose import is still under way", async () => {
    const world = setup();
    // Stopped with the note written and not yet published.
    world.fail({
      state: "Publish",
      error: "DynamoDB.InternalServerError",
      times: 4,
      kind: "refused",
    });
    await runImport(world, INPUT);
    const outcome = await digest(world, [INPUT.noteId]);
    expect(outcome).toMatchObject({
      output: { notes: [{ noteId: "note-1", found: false, title: null }], missing: 1 },
    });
  });
  // #endregion pending

  it("does not find another owner's note under the same ID", async () => {
    const world = setup();
    await runImport(world, INPUT);
    const outcome = await runStateMachine(
      localDigest,
      { owner: "user-2", noteIds: [INPUT.noteId] },
      world,
      { name: "digest-2", startTime: "2026-10-13T00:00:00.000Z" },
    );
    expect(outcome).toMatchObject({ output: { missing: 1 } });
  });

  it("gives the same answer when it runs twice, and writes nothing", async () => {
    const world = setup();
    await runImport(world, INPUT);
    const before = JSON.stringify([...world.items]);
    const first = await digest(world, [INPUT.noteId, "nope"]);
    const second = await digest(world, [INPUT.noteId, "nope"]);
    expect(second).toEqual(first);
    expect(JSON.stringify([...world.items])).toBe(before);
  });

  it("retries a throttled read, and fails as a whole when one read keeps failing", async () => {
    const throttled = "DynamoDB.ProvisionedThroughputExceededException";
    const world = setup();
    await runImport(world, INPUT);
    world.fail({ state: "GetNote", error: throttled, times: 1, kind: "refused" });
    const retried = await digest(world, [INPUT.noteId]);
    expect(path(retried)).toEqual([`GetNote!${throttled}`, "GetNote", "EachNote"]);
    expect(retried.status).toBe("SUCCEEDED");

    world.fail({ state: "GetNote", error: throttled, times: 99, kind: "refused" });
    const failed = await digest(world, [INPUT.noteId, "nope"]);
    expect(failed).toMatchObject({ status: "FAILED", error: throttled });
  });
});

describe("the digest's definition", () => {
  const tasks = (states: Record<string, State>): State[] =>
    Object.values(states).flatMap((state) =>
      state.Type === "Map" ? [state, ...tasks(state.ItemProcessor.States)] : [state],
    );

  it("uses nothing an Express workflow cannot run", () => {
    for (const state of tasks(noteDigestWorkflow(LOCAL).States)) {
      if (state.Type === "Task") {
        expect(state.Resource).not.toMatch(/\.(sync(:2)?|waitForTaskToken)$/);
      }
      if (state.Type === "Map") {
        expect(state.ItemProcessor.ProcessorConfig.Mode).toBe("INLINE");
      }
    }
    // Five minutes is the most an Express execution may take.
    expect(localDigest.TimeoutSeconds).toBeLessThanOrEqual(300);
  });

  it("only reads", () => {
    const resources = tasks(localDigest.States).flatMap((state) =>
      state.Type === "Task" ? [state.Resource] : [],
    );
    expect(resources).toEqual(["arn:aws:states:::dynamodb:getItem"]);
  });

  it("limits how many notes one request may ask for", () => {
    const ids = Array.from({ length: MAX_DIGEST_NOTES + 1 }, (_, index) => `n-${index}`);
    expect(v.safeParse(digestInputSchema, { owner: "u", noteIds: ids.slice(1) }).success).toBe(
      true,
    );
    expect(v.safeParse(digestInputSchema, { owner: "u", noteIds: ids }).success).toBe(false);
    expect(v.safeParse(digestInputSchema, { owner: "u", noteIds: [] }).success).toBe(false);
  });
});
