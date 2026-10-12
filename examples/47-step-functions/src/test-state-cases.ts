// What single states of the import should do with a given answer. The unit tests hold
// the local model to this table; `sfn:test-state` asks the TestState API the same questions.

import { ABSENT_OR_MINE_WHILE_PENDING } from "./saga.ts";

export type TestStateCase = {
  name: string;
  state: string;
  input: Record<string, unknown>;
  /** What the mocked service answers: a result, or an error. */
  mock: { result: unknown } | { error: string; cause: string };
  /** How many retries the matching retrier has already used. */
  retries?: number;
  expected: {
    status: "SUCCEEDED" | "FAILED" | "RETRIABLE" | "CAUGHT_ERROR";
    nextState?: string;
  };
};

const input = {
  owner: "user-1",
  noteId: "note-1",
  title: "Minutes",
  body: "What was said",
  upload: "inbox/user-1/minutes.pdf",
};
const refused = {
  error: "DynamoDB.ConditionalCheckFailedException",
  cause: `${ABSENT_OR_MINE_WHILE_PENDING} did not hold`,
};
const lost = { error: "States.Timeout", cause: "no answer" };

// #region cases
export const TEST_STATE_CASES: TestStateCase[] = [
  {
    name: "a note that was written goes on to its attachment",
    state: "CreateNote",
    input,
    mock: { result: {} },
    expected: { status: "SUCCEEDED", nextState: "AttachFile" },
  },
  {
    name: "a note ID someone else holds is not retried and not undone",
    state: "CreateNote",
    input,
    mock: refused,
    expected: { status: "CAUGHT_ERROR", nextState: "NoteIdTaken" },
  },
  {
    name: "a first lost answer is retried",
    state: "CreateNote",
    input,
    mock: lost,
    retries: 0,
    expected: { status: "RETRIABLE" },
  },
  {
    name: "a fourth lost answer undoes the step that may have happened",
    state: "CreateNote",
    input,
    mock: lost,
    retries: 3,
    expected: { status: "CAUGHT_ERROR", nextState: "RemoveNote" },
  },
  {
    name: "an infected file is undone without any error",
    state: "Verdict",
    input: { ...input, verdict: "infected" },
    mock: { result: {} },
    expected: { status: "SUCCEEDED", nextState: "RemoveAttachment" },
  },
  {
    name: "a publish out of retries fails the execution where it stands",
    state: "Publish",
    input,
    mock: lost,
    retries: 3,
    expected: { status: "FAILED" },
  },
  {
    name: "a compensation out of retries fails the execution where it stands",
    state: "RemoveAttachment",
    input,
    mock: { error: "S3.AccessDeniedException", cause: "Access Denied" },
    retries: 3,
    expected: { status: "FAILED" },
  },
];
// #endregion cases
