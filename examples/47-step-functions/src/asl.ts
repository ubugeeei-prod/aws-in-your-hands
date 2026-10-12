// The part of Amazon States Language this chapter uses, typed. JSONata states only.

/** A JSONata expression as the definition carries it: "{% ... %}". */
export type Expression = `{% ${string} %}`;
/** A JSON value in which any string of that form is evaluated. */
export type Template = string | number | boolean | null | Template[] | { [key: string]: Template };

// #region retry
export type Retrier = {
  ErrorEquals: string[];
  IntervalSeconds?: number;
  MaxAttempts?: number;
  BackoffRate?: number;
  MaxDelaySeconds?: number;
  JitterStrategy?: "FULL" | "NONE";
};
export type Catcher = {
  ErrorEquals: string[];
  /** The input of `Next`. Left out, it is the error output: { Error, Cause }. */
  Output?: Template;
  Assign?: Record<string, Template>;
  Next: string;
};
// #endregion retry

type Transition = { Next: string; End?: never } | { End: true; Next?: never };

export type TaskState = {
  Type: "Task";
  Resource: string;
  Arguments: Record<string, Template>;
  /** Written out in every state: the two documents that define the default disagree. */
  Output: Template;
  Assign?: Record<string, Template>;
  TimeoutSeconds: number;
  HeartbeatSeconds?: number;
  Retry?: Retrier[];
  Catch?: Catcher[];
} & Transition;

export type ChoiceState = {
  Type: "Choice";
  Choices: { Condition: Expression; Next: string }[];
  Default: string;
};

export type MapState = {
  Type: "Map";
  Items: Expression;
  ItemSelector?: Record<string, Template>;
  MaxConcurrency: number;
  ItemProcessor: { ProcessorConfig: { Mode: "INLINE" } } & StateGraph;
  Output: Template;
  Retry?: Retrier[];
  Catch?: Catcher[];
} & Transition;

export type SucceedState = { Type: "Succeed"; Output?: Template };
export type FailState = { Type: "Fail"; Error: string; Cause: string };
export type State = TaskState | ChoiceState | MapState | SucceedState | FailState;

export type StateGraph = { StartAt: string; States: Record<string, State> };
export type StateMachine = StateGraph & {
  Comment: string;
  QueryLanguage: "JSONata";
  TimeoutSeconds: number;
};

/** Every state a state can hand over to, including through a Catch. */
export function targetsOf(state: State): string[] {
  if (state.Type === "Succeed" || state.Type === "Fail") {
    return [];
  }
  if (state.Type === "Choice") {
    return [...state.Choices.map((choice) => choice.Next), state.Default];
  }
  return [
    ...(state.Next === undefined ? [] : [state.Next]),
    ...(state.Catch ?? []).map((catcher) => catcher.Next),
  ];
}
