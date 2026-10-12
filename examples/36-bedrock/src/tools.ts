import * as v from "valibot";

import type { NoteRepository } from "@aih/example-05-dynamodb/src/repository.ts";

import type { JsonObject, ToolResultBlock, ToolSpec } from "./converse.ts";
import type { RawToolUse } from "./turn.ts";

// #region tool
/** The repository calls a tool may make. Reading only: no tool in this file can change a note. */
export type NoteReader = Pick<NoteRepository, "get" | "list">;

export type ToolAnswer = { ok: true; value: JsonObject } | { ok: false; message: string };

export type Tool = {
  description: string;
  /** What the model is told the input looks like. */
  jsonSchema: JsonObject;
  /** What the input is checked against. `call` applies it. It is here so a test can read it. */
  input: v.GenericSchema;
  /** Checks the input, then runs. A refusal is an answer the model reads, not an exception. */
  call(input: unknown): Promise<ToolAnswer>;
};

/** The names are the keys: a name the model made up has nothing to find. */
export type Tools = Record<string, Tool>;

function tool<Input>(definition: {
  description: string;
  jsonSchema: JsonObject;
  input: v.GenericSchema<unknown, Input>;
  run(input: Input): Promise<ToolAnswer>;
}): Tool {
  const { description, jsonSchema, input, run } = definition;
  return {
    description,
    jsonSchema,
    input,
    async call(value) {
      const parsed = v.safeParse(input, value);
      if (!parsed.success) {
        const problems = parsed.issues.map(
          (issue) => `${v.getDotPath(issue) ?? "input"}: ${issue.message}`,
        );
        return { ok: false, message: `The input does not fit the tool: ${problems.join("; ")}` };
      }
      return run(parsed.output);
    },
  };
}
// #endregion tool

/** A note body can be 10,000 characters. This much of it goes back to the model. */
export const MAX_BODY_CHARS_IN_RESULT = 4_000;

// #region note-tools
/**
 * The tools one caller's assistant may use. `owner` comes from the caller's verified
 * identity and is fixed here. No tool takes an owner as input, so nothing the model writes
 * can name another one.
 */
export function createNoteTools(notes: NoteReader, owner: string): Tools {
  return {
    list_notes: tool({
      description:
        "Lists the signed-in user's notes, newest first: id, title, and when each was last updated.",
      jsonSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "How many notes to list, 1 to 20. Default 10." },
        },
        required: [],
        additionalProperties: false,
      },
      // strictObject: an unknown key (an `owner`, for one) is refused, not dropped.
      input: v.strictObject({
        limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20)), 10),
      }),
      async run({ limit }) {
        const page = await notes.list(owner, { limit });
        return {
          ok: true,
          value: {
            notes: page.notes.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
            more: page.nextCursor !== null,
          },
        };
      },
    }),
    read_note: tool({
      description: "Reads one of the signed-in user's notes by its id: title and body.",
      jsonSchema: {
        type: "object",
        properties: { id: { type: "string", description: "A note id from list_notes." } },
        required: ["id"],
        additionalProperties: false,
      },
      input: v.strictObject({ id: v.pipe(v.string(), v.minLength(1), v.maxLength(64)) }),
      async run({ id }) {
        const note = await notes.get(owner, id);
        if (note === undefined) {
          // Another owner's note and a note that does not exist answer the same way.
          return { ok: false, message: `No note with id "${id}".` };
        }
        const truncated = note.body.length > MAX_BODY_CHARS_IN_RESULT;
        return {
          ok: true,
          value: {
            id: note.id,
            title: note.title,
            body: truncated ? note.body.slice(0, MAX_BODY_CHARS_IN_RESULT) : note.body,
            truncated,
            updatedAt: note.updatedAt,
          },
        };
      },
    }),
  };
}
// #endregion note-tools

// #region spec
/** The tool definitions as ConverseStream takes them. */
export function toolSpecs(tools: Tools): ToolSpec[] {
  return Object.entries(tools).map(([name, { description, jsonSchema }]) => ({
    toolSpec: { name, description, inputSchema: { json: jsonSchema } },
  }));
}
// #endregion spec

// #region call
export type ToolOutcome = { name: string; ok: boolean; result: ToolResultBlock };

const refused = (request: RawToolUse, message: string): ToolOutcome => ({
  name: request.name,
  ok: false,
  // The model reads this text and can try again with a tool that exists and an input that fits.
  result: {
    toolResult: { toolUseId: request.toolUseId, content: [{ text: message }], status: "error" },
  },
});

/** Runs one tool request, or says why not. Never throws for something the model wrote. */
export async function callTool(tools: Tools, request: RawToolUse): Promise<ToolOutcome> {
  // Object.hasOwn: "constructor" and "toString" are names too, and they are not tools.
  const found = Object.hasOwn(tools, request.name) ? tools[request.name] : undefined;
  if (found === undefined) {
    return refused(
      request,
      `There is no tool named "${request.name}". The tools are: ${Object.keys(tools).join(", ")}.`,
    );
  }
  let json: unknown;
  try {
    // A tool that takes no input may arrive with none at all.
    json = request.inputJson.trim() === "" ? {} : JSON.parse(request.inputJson);
  } catch {
    return refused(request, "The input was not valid JSON.");
  }
  const answer = await found.call(json);
  if (!answer.ok) {
    return refused(request, answer.message);
  }
  return {
    name: request.name,
    ok: true,
    result: {
      toolResult: {
        toolUseId: request.toolUseId,
        content: [{ json: answer.value }],
        status: "success",
      },
    },
  };
}
// #endregion call
