import * as v from "valibot";

// #region command
// Forty characters, so that owner/note/command fits the 128 SQS allows for a
// deduplication ID. A UUID is thirty-six.
const id = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,40}$/));

// JSON.stringify escapes control characters and lone surrogates. These two
// pass through it, and SQS refuses a body that contains them.
const sendable = v.check(
  (text: string) => !/[￾￿]/.test(text),
  "contains a character SQS does not accept",
);

export const commandSchema = v.object({
  version: v.literal(1),
  commandId: id,
  owner: id,
  noteId: id,
  change: v.variant("type", [
    v.object({
      type: v.literal("append"),
      line: v.pipe(v.string(), v.minLength(1), v.maxLength(500), sendable),
    }),
    v.object({
      type: v.literal("retitle"),
      title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120), sendable),
    }),
  ]),
});
export type Command = v.InferOutput<typeof commandSchema>;
// #endregion command

// #region identity
/** One note, one line of commands: nothing else has to wait for it. */
export const groupIdOf = (command: Command): string => `${command.owner}/${command.noteId}`;

/**
 * Names the work, not the delivery. The queue uses it for five minutes after
 * a send; the worker's ledger uses it for as long as the command can come back.
 */
export const commandKeyOf = (command: Command): string =>
  `${command.owner}/${command.noteId}/${command.commandId}`;
// #endregion identity

export class UnreadableCommand extends Error {
  readonly reason: "not_json" | "not_a_command";

  constructor(reason: "not_json" | "not_a_command", detail: string) {
    super(`${reason}: ${detail}`);
    this.name = "UnreadableCommand";
    this.reason = reason;
  }
}

/** Throws UnreadableCommand: a body that will be no more readable on the next delivery. */
export function parseCommand(body: string): Command {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new UnreadableCommand("not_json", body.slice(0, 40));
  }
  const result = v.safeParse(commandSchema, json);
  if (!result.success) {
    const [issue] = result.issues;
    throw new UnreadableCommand(
      "not_a_command",
      `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`,
    );
  }
  return result.output;
}
