import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { type State, type StateMachine, targetsOf } from "../src/asl.ts";
import { runStateMachine, TaskError } from "../src/interpreter.ts";
import { leftover, violations } from "../src/invariant.ts";
import { type LocalWorld, noteKey, text } from "../src/local-world.ts";
import { LOCAL, localImport, runImport } from "../src/local.ts";
import {
  attachmentKey,
  executionName,
  importInputSchema,
  importNoteWorkflow,
  REDRIVABLE,
  scanRequestSchema,
  scanVerdictSchema,
} from "../src/saga.ts";
import { INPUT, path, setup } from "./harness.ts";

const ROLLED_BACK = { status: "FAILED", error: "ImportRolledBack" };
const EVERYTHING = { note: "ready", attachment: true };
const NOTHING = { note: "absent", attachment: false };

describe("the import, when nothing goes wrong", () => {
  it("creates the note, attaches the file, waits for the scan, publishes, and tells", async () => {
    const world = setup();
    const outcome = await runImport(world, INPUT);
    expect(path(outcome)).toEqual([
      "CreateNote",
      "AttachFile",
      "WaitForScan",
      "Verdict",
      "Publish",
      "Notify",
      "Imported",
    ]);
    expect(outcome).toMatchObject({ status: "SUCCEEDED", output: { notified: true } });
    expect(leftover(world, INPUT)).toEqual(EVERYTHING);
    expect(world.objects.get(attachmentKey(INPUT))).toBe("the uploaded bytes");
    expect(world.notices).toEqual([{ message: "Imported: Minutes", saga: executionName(INPUT) }]);
  });

  it("asks the scanner with a message it can answer", async () => {
    const world = setup();
    await runImport(world, INPUT);
    expect(world.scanRequests).toEqual([
      {
        taskToken: "token-1",
        saga: "import-user-1-note-1",
        bucket: LOCAL.bucketName,
        key: "attachments/user-1/note-1",
      },
    ]);
  });
});

// #region each-step
// What each state calls when it has no way to succeed, and when it succeeds unheard.
const FORWARD = [
  { state: "CreateNote", refused: "DynamoDB.AccessDeniedException", undoes: ["RemoveNote"] },
  {
    state: "AttachFile",
    refused: "S3.AccessDeniedException",
    undoes: ["RemoveAttachment", "RemoveNote"],
  },
  {
    state: "WaitForScan",
    refused: "SQS.AccessDeniedException",
    undoes: ["RemoveAttachment", "RemoveNote"],
  },
];

describe("a step that fails", () => {
  for (const { state, refused, undoes } of FORWARD) {
    it(`${state}, refused every time: undoes what was done, last step first`, async () => {
      const world = setup();
      world.fail({ state, error: refused, times: 99, kind: "refused" });
      const outcome = await runImport(world, INPUT);
      expect(outcome).toMatchObject(ROLLED_BACK);
      expect(
        path(outcome)
          .filter((step) => !step.includes("!"))
          .slice(-undoes.length - 1),
      ).toEqual([...undoes, "RolledBack"]);
      expect(leftover(world, INPUT)).toEqual(NOTHING);
      expect(violations(world, INPUT, outcome)).toEqual([]);
      expect(world.notices).toEqual([]);
    });

    it(`${state}, done but never heard from: undoes it all the same`, async () => {
      const world = setup();
      world.fail({ state, error: "States.Timeout", times: 99, kind: "lost" });
      const outcome = await runImport(world, INPUT);
      expect(outcome).toMatchObject(ROLLED_BACK);
      expect(leftover(world, INPUT)).toEqual(NOTHING);
      expect(violations(world, INPUT, outcome)).toEqual([]);
    });
  }

  it("the scan refuses the file: no error was thrown, and the import is undone", async () => {
    const world = setup();
    world.scanner = () => ({ verdict: "infected" });
    const outcome = await runImport(world, INPUT);
    expect(path(outcome)).toEqual([
      "CreateNote",
      "AttachFile",
      "WaitForScan",
      "Verdict",
      "RemoveAttachment",
      "RemoveNote",
      "RolledBack",
    ]);
    expect(leftover(world, INPUT)).toEqual(NOTHING);
    // The upload itself is not the saga's to delete.
    expect(world.objects.has(INPUT.upload)).toBe(true);
  });

  it("the scanner reports a failure of its own: undone", async () => {
    const world = setup();
    world.scanner = () => {
      throw new TaskError("ScanFailed", "the scanner could not read the file");
    };
    const outcome = await runImport(world, INPUT);
    expect(outcome).toMatchObject(ROLLED_BACK);
    expect(violations(world, INPUT, outcome)).toEqual([]);
  });
});
// #endregion each-step

// #region twice
describe("a step that runs twice", () => {
  for (const state of ["CreateNote", "AttachFile", "Publish"]) {
    it(`${state}: the second run changes nothing`, async () => {
      const world = setup();
      world.fail({ state, error: "States.Timeout", times: 1, kind: "lost" });
      const outcome = await runImport(world, INPUT);
      expect(path(outcome)).toContain(`${state}!States.Timeout`);
      expect(outcome.status).toBe("SUCCEEDED");
      expect(world.calls.filter((call) => call.state === state)).toHaveLength(2);
      expect(leftover(world, INPUT)).toEqual(EVERYTHING);
      expect(world.items.size).toBe(1);
      expect(world.notices).toHaveLength(1);
    });
  }

  it("Notify: the notice goes out twice, under the same saga name", async () => {
    const world = setup();
    world.fail({ state: "Notify", error: "States.Timeout", times: 1, kind: "lost" });
    const outcome = await runImport(world, INPUT);
    expect(outcome.status).toBe("SUCCEEDED");
    expect(world.notices.map((notice) => notice.saga)).toEqual([
      executionName(INPUT),
      executionName(INPUT),
    ]);
  });

  it("WaitForScan: a scanner that goes quiet is asked again, with a new token", async () => {
    const world = setup();
    world.scanner = (_request, delivery) => {
      if (delivery === 1) {
        throw new TaskError("States.Timeout", "no heartbeat in 300 seconds");
      }
      return { verdict: "clean" };
    };
    const outcome = await runImport(world, INPUT);
    expect(outcome.status).toBe("SUCCEEDED");
    expect(world.scanRequests.map((request) => request.taskToken)).toEqual(["token-1", "token-2"]);
    expect(world.scanRequests.map((request) => request.key)).toEqual([
      attachmentKey(INPUT),
      attachmentKey(INPUT),
    ]);
  });
});
// #endregion twice

// #region no-way-back
describe("past the point of no return", () => {
  it("a notice that cannot be sent does not unpublish the note", async () => {
    const world = setup();
    world.fail({
      state: "Notify",
      error: "SNS.AuthorizationErrorException",
      times: 99,
      kind: "refused",
    });
    const outcome = await runImport(world, INPUT);
    expect(outcome).toMatchObject({ status: "SUCCEEDED", output: { notified: false } });
    expect(leftover(world, INPUT)).toEqual(EVERYTHING);
  });

  it("Publish that may or may not have happened is never undone, only redriven", async () => {
    const world = setup();
    world.fail({ state: "Publish", error: "States.Timeout", times: 4, kind: "lost" });
    const failed = await runImport(world, INPUT);
    expect(failed).toMatchObject({ status: "FAILED", error: "States.Timeout" });
    expect(path(failed).slice(-1)).toEqual(["Publish!States.Timeout"]);
    // It did happen. Undoing now would take away a note readers can already see.
    expect(leftover(world, INPUT)).toEqual(EVERYTHING);
    expect(violations(world, INPUT, failed)).toEqual([]);

    if (failed.status !== "FAILED" || failed.resume === undefined) {
      throw new Error("expected a failure a redrive can resume");
    }
    const redriven = await runImport(world, INPUT, failed.resume);
    expect(path(redriven)).toEqual(["Publish", "Notify", "Imported"]);
    expect(leftover(world, INPUT)).toEqual(EVERYTHING);
  });

  it("Publish that did not happen leaves a note no reader is shown, and the redrive finishes it", async () => {
    const world = setup();
    world.fail({
      state: "Publish",
      error: "DynamoDB.InternalServerError",
      times: 4,
      kind: "refused",
    });
    const failed = await runImport(world, INPUT);
    expect(leftover(world, INPUT)).toEqual({ note: "pending", attachment: true });
    expect(violations(world, INPUT, failed)).toEqual([]);
    if (failed.status !== "FAILED" || failed.resume === undefined) {
      throw new Error("expected a failure a redrive can resume");
    }
    expect((await runImport(world, INPUT, failed.resume)).status).toBe("SUCCEEDED");
    expect(leftover(world, INPUT)).toEqual(EVERYTHING);
  });
});
// #endregion no-way-back

// #region compensation-fails
describe("a compensation that fails", () => {
  it("ends the execution in that state, and a redrive finishes the undoing", async () => {
    const world = setup();
    world.scanner = () => ({ verdict: "infected" });
    // One try and three retries, all refused.
    world.fail({
      state: "RemoveAttachment",
      error: "S3.AccessDeniedException",
      times: 4,
      kind: "refused",
    });
    const failed = await runImport(world, INPUT);
    expect(failed).toMatchObject({
      status: "FAILED",
      error: "S3.AccessDeniedException",
      resume: { state: "RemoveAttachment" },
    });
    // Half undone, and the execution says where. Nobody is shown the pending note.
    expect(leftover(world, INPUT)).toEqual({ note: "pending", attachment: true });
    expect(violations(world, INPUT, failed)).toEqual([]);

    if (failed.status !== "FAILED" || failed.resume === undefined) {
      throw new Error("expected a failure a redrive can resume");
    }
    const redriven = await runImport(world, INPUT, failed.resume);
    expect(path(redriven)).toEqual(["RemoveAttachment", "RemoveNote", "RolledBack"]);
    expect(leftover(world, INPUT)).toEqual(NOTHING);
    expect(violations(world, INPUT, redriven)).toEqual([]);
  });

  it("undoes again without harm when the first undoing was done but not heard", async () => {
    const world = setup();
    world.scanner = () => ({ verdict: "infected" });
    world.fail({ state: "RemoveAttachment", error: "States.Timeout", times: 1, kind: "lost" });
    world.fail({ state: "RemoveNote", error: "States.Timeout", times: 1, kind: "lost" });
    const outcome = await runImport(world, INPUT);
    expect(outcome).toMatchObject(ROLLED_BACK);
    expect(leftover(world, INPUT)).toEqual(NOTHING);
  });
});
// #endregion compensation-fails

// #region two-imports
describe("two imports of one note ID", () => {
  const other = { ...INPUT, title: "Someone else's" };
  const otherName = "import-from-elsewhere";

  async function importedByAnother(world: LocalWorld) {
    const first = await runStateMachine(localImport, other, world, {
      name: otherName,
      startTime: "2026-10-12T00:00:00.000Z",
    });
    expect(first.status).toBe("SUCCEEDED");
  }

  it("the second stops at once and touches nothing of the first", async () => {
    const world = setup();
    await importedByAnother(world);
    const outcome = await runImport(world, INPUT);
    expect(path(outcome)).toEqual([
      "CreateNote!DynamoDB.ConditionalCheckFailedException",
      "NoteIdTaken",
    ]);
    expect(outcome).toMatchObject({ status: "FAILED", error: "NoteIdTaken" });
    const stored = world.items.get(noteKey(INPUT.owner, INPUT.noteId));
    expect(text(stored?.["title"])).toBe("Someone else's");
    expect(text(stored?.["saga"])).toBe(otherName);
    expect(world.objects.has(attachmentKey(INPUT))).toBe(true);
  });

  it("a compensation never deletes a note another import published", async () => {
    const world = setup();
    await importedByAnother(world);
    // Straight into the undoing, as if this import had got that far.
    const outcome = await runImport(world, INPUT, {
      state: "RemoveNote",
      input: INPUT,
      variables: {},
    });
    expect(outcome).toMatchObject({
      status: "FAILED",
      error: "DynamoDB.ConditionalCheckFailedException",
    });
    expect(world.items.size).toBe(1);
  });
});
// #endregion two-imports

// #region broken
describe("definitions broken on purpose", () => {
  const withState = (name: string, change: (state: State) => State): StateMachine => {
    const definition = importNoteWorkflow(LOCAL);
    const state = definition.States[name];
    if (state === undefined) {
      throw new Error(`no state named ${name}`);
    }
    return { ...definition, States: { ...definition.States, [name]: change(state) } };
  };
  const run = (definition: StateMachine, world: LocalWorld) =>
    runStateMachine(definition, INPUT, world, {
      name: executionName(INPUT),
      startTime: "2026-10-13T00:00:00.000Z",
    });

  it("undoing only the steps before the failed one leaves a note behind", async () => {
    // "CreateNote failed, so there is nothing to undo."
    const naive = withState("CreateNote", (state) =>
      state.Type === "Task"
        ? { ...state, Catch: [{ ErrorEquals: ["States.ALL"], Next: "RolledBack" }] }
        : state,
    );
    const world = setup();
    world.fail({ state: "CreateNote", error: "States.Timeout", times: 99, kind: "lost" });
    const outcome = await run(naive, world);
    expect(outcome).toMatchObject(ROLLED_BACK);
    expect(violations(world, INPUT, outcome)).toEqual([
      "ImportRolledBack, but found pending note, no attachment",
    ]);
  });

  it("catching a failed Publish and undoing leaves a published note without its file", async () => {
    const eager = withState("Publish", (state) =>
      state.Type === "Task"
        ? {
            ...state,
            Catch: [
              {
                ErrorEquals: ["States.ALL"],
                Output: "{% $states.input %}",
                Next: "RemoveAttachment",
              },
            ],
          }
        : state,
    );
    const world = setup();
    world.fail({ state: "Publish", error: "States.Timeout", times: 4, kind: "lost" });
    const outcome = await run(eager, world);
    expect(violations(world, INPUT, outcome)).toEqual([
      "a published note without its attachment (found ready note, no attachment)",
    ]);
  });
});
// #endregion broken

describe("the definition", () => {
  const states = Object.entries(localImport.States);

  it("only names states that exist, and reaches every one of them", () => {
    const names = Object.keys(localImport.States);
    const reached = new Set([localImport.StartAt]);
    for (const [, state] of states) {
      for (const target of targetsOf(state)) {
        expect(names).toContain(target);
        reached.add(target);
      }
    }
    expect([...reached].toSorted()).toEqual(names.toSorted());
  });

  it("gives every task a timeout shorter than the execution's", () => {
    for (const [, state] of states) {
      if (state.Type === "Task") {
        expect(state.TimeoutSeconds).toBeLessThan(localImport.TimeoutSeconds);
      }
    }
    const scan = localImport.States["WaitForScan"];
    expect(scan).toMatchObject({ HeartbeatSeconds: 300, TimeoutSeconds: 1800 });
    // Both attempts of the scan fit inside the execution.
    expect(2 * 1800).toBeLessThan(localImport.TimeoutSeconds);
  });

  it("lets a failure end the execution only where a redrive can finish the work", () => {
    const uncaught = states
      .filter(
        ([, state]) =>
          state.Type === "Task" &&
          !(state.Catch ?? []).some((catcher) => catcher.ErrorEquals.includes("States.ALL")),
      )
      .map(([name]) => name);
    expect(uncaught.toSorted()).toEqual([...REDRIVABLE].toSorted());
  });

  it("never retries a refused condition", () => {
    for (const name of ["CreateNote", "Publish", "RemoveNote"]) {
      expect(localImport.States[name]).toMatchObject({
        Retry: [{ ErrorEquals: ["DynamoDB.ConditionalCheckFailedException"], MaxAttempts: 0 }, {}],
      });
    }
  });
});

describe("what comes in from outside", () => {
  it("refuses an upload outside the inbox, and an owner that would change the key", () => {
    expect(v.safeParse(importInputSchema, INPUT).success).toBe(true);
    for (const bad of [
      { ...INPUT, upload: "attachments/user-2/note-9" },
      { ...INPUT, upload: "inbox/user-1/../../secrets" },
      { ...INPUT, owner: "user-1/other" },
      { ...INPUT, noteId: "" },
      { ...INPUT, extra: true },
    ]) {
      expect(v.safeParse(importInputSchema, bad).success).toBe(false);
    }
  });

  it("checks the scan request and the verdict", () => {
    const request = { taskToken: "t", saga: "s", bucket: "b", key: "k" };
    expect(v.safeParse(scanRequestSchema, request).success).toBe(true);
    expect(v.safeParse(scanRequestSchema, { ...request, taskToken: "" }).success).toBe(false);
    expect(v.safeParse(scanVerdictSchema, { verdict: "clean" }).success).toBe(true);
    expect(v.safeParse(scanVerdictSchema, { verdict: "probably fine" }).success).toBe(false);
  });
});
