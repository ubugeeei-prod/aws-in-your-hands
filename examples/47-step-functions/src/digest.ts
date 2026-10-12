import * as v from "valibot";

import type { Retrier, StateMachine } from "./asl.ts";

export const MAX_DIGEST_NOTES = 25;

// #region input
const segment = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,64}$/));
export const digestInputSchema = v.strictObject({
  owner: segment,
  noteIds: v.pipe(v.array(segment), v.minLength(1), v.maxLength(MAX_DIGEST_NOTES)),
});
export type DigestInput = v.InferOutput<typeof digestInputSchema>;

export const digestOutputSchema = v.strictObject({
  owner: v.string(),
  notes: v.array(
    v.strictObject({ noteId: v.string(), found: v.boolean(), title: v.nullable(v.string()) }),
  ),
  missing: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export type DigestOutput = v.InferOutput<typeof digestOutputSchema>;
// #endregion input

const transient: Retrier = {
  ErrorEquals: ["States.Timeout", "States.TaskFailed"],
  IntervalSeconds: 1,
  MaxAttempts: 2,
  BackoffRate: 2,
  JitterStrategy: "FULL",
};

// A note that is still being imported is not there yet, as far as a reader can tell.
const ready = "$exists($states.result.Item) and $states.result.Item.phase.S = 'ready'";

// #region definition
/** Reads only, so running it twice costs a little and changes nothing: what an Express workflow asks for. */
export function noteDigestWorkflow(resources: { tableName: string }): StateMachine {
  return {
    Comment: "Looks up several notes of one owner in a single request",
    QueryLanguage: "JSONata",
    StartAt: "EachNote",
    TimeoutSeconds: 30,
    States: {
      EachNote: {
        Type: "Map",
        Items: "{% $states.input.noteIds %}",
        ItemSelector: {
          owner: "{% $states.input.owner %}",
          noteId: "{% $states.context.Map.Item.Value %}",
        },
        MaxConcurrency: 5,
        ItemProcessor: {
          ProcessorConfig: { Mode: "INLINE" },
          StartAt: "GetNote",
          States: {
            GetNote: {
              Type: "Task",
              Resource: "arn:aws:states:::dynamodb:getItem",
              Arguments: {
                TableName: resources.tableName,
                Key: {
                  pk: { S: "{% 'OWNER#' & $states.input.owner %}" },
                  sk: { S: "{% 'NOTE#' & $states.input.noteId %}" },
                },
                ProjectionExpression: "title, #phase",
                ExpressionAttributeNames: { "#phase": "phase" },
              },
              Output: {
                noteId: "{% $states.input.noteId %}",
                found: `{% ${ready} %}`,
                // An expression with no value is an error, so "no title" has to be said as null.
                title: `{% ${ready} ? $states.result.Item.title.S : null %}`,
              },
              TimeoutSeconds: 5,
              Retry: [transient],
              End: true,
            },
          },
        },
        Output: {
          owner: "{% $states.input.owner %}",
          notes: "{% $states.result %}",
          missing: "{% $count($states.result[found = false]) %}",
        },
        End: true,
      },
    },
  };
}
// #endregion definition
