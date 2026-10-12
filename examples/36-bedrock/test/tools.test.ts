import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { seededNotes } from "../src/local-notes.ts";
import { callTool, createNoteTools, MAX_BODY_CHARS_IN_RESULT, toolSpecs } from "../src/tools.ts";
import { ALICE, BOB, BOBS_SECRET, toolsFor } from "./helpers.ts";

const ask = (name: string, inputJson: string) => ({ toolUseId: "tooluse_t", name, inputJson });

describe("note tools", () => {
  it("lists and reads the caller's own notes", async () => {
    const tools = await toolsFor(ALICE);
    const listed = await callTool(tools, ask("list_notes", "{}"));
    expect(listed.ok).toBe(true);
    expect(JSON.stringify(listed.result)).toContain("n1release");
    expect(JSON.stringify(listed.result)).not.toContain("b1salary");

    const read = await callTool(tools, ask("read_note", '{"id":"n1release"}'));
    expect(read.result.toolResult).toMatchObject({ toolUseId: "tooluse_t", status: "success" });
    expect(JSON.stringify(read.result)).toContain("負荷試験");
  });

  it("answers for another owner's note exactly as for a note that does not exist", async () => {
    const tools = await toolsFor(ALICE);
    const theirs = await callTool(tools, ask("read_note", '{"id":"b1salary"}'));
    const missing = await callTool(tools, ask("read_note", '{"id":"zzzzzzzz"}'));
    expect(theirs.ok).toBe(false);
    expect(theirs.result.toolResult.status).toBe("error");
    expect(JSON.stringify(theirs.result)).not.toContain(BOBS_SECRET);
    expect(JSON.stringify(theirs.result).replace("b1salary", "ID")).toBe(
      JSON.stringify(missing.result).replace("zzzzzzzz", "ID"),
    );
    // The same note is there for its owner.
    const own = await callTool(await toolsFor(BOB), ask("read_note", '{"id":"b1salary"}'));
    expect(JSON.stringify(own.result)).toContain(BOBS_SECRET);
  });

  it("has no input through which an owner could be named", async () => {
    const tools = await toolsFor(ALICE);
    for (const input of ['{"owner":"local-bob"}', '{"limit":5,"owner":"local-bob"}']) {
      const outcome = await callTool(tools, ask("list_notes", input));
      expect(outcome.ok, input).toBe(false);
    }
    const withOwner = await callTool(
      tools,
      ask("read_note", '{"id":"b1salary","owner":"local-bob"}'),
    );
    expect(withOwner.ok).toBe(false);
    for (const spec of toolSpecs(tools)) {
      expect(JSON.stringify(spec.toolSpec.inputSchema)).not.toMatch(/owner|sub|user/i);
    }
  });

  it("refuses a tool the model made up, including names every object has", async () => {
    const tools = await toolsFor(ALICE);
    for (const name of ["delete_note", "constructor", "toString", "__proto__"]) {
      const outcome = await callTool(tools, ask(name, "{}"));
      expect(outcome.ok, name).toBe(false);
      expect(outcome.result.toolResult.status).toBe("error");
      expect(JSON.stringify(outcome.result)).toContain("list_notes, read_note");
    }
  });

  it("refuses input that is not JSON, or JSON that does not fit, and says which field", async () => {
    const tools = await toolsFor(ALICE);
    const broken = await callTool(tools, ask("read_note", '{"id": "n1rel'));
    expect(JSON.stringify(broken.result)).toContain("not valid JSON");
    const unfit = await callTool(tools, ask("list_notes", '{"limit":500}'));
    expect(unfit.ok).toBe(false);
    expect(JSON.stringify(unfit.result)).toContain("limit");
    const array = await callTool(tools, ask("read_note", "[]"));
    expect(array.ok).toBe(false);
  });

  it("sends back only the first part of a long note, and says so", async () => {
    const notes = await seededNotes();
    await notes.create(ALICE, {
      id: "n9long",
      title: "long",
      body: "あ".repeat(10_000),
      version: 1,
      createdAt: "2026-10-09T09:00:00.000Z",
      updatedAt: "2026-10-09T09:00:00.000Z",
    });
    const outcome = await callTool(
      createNoteTools(notes, ALICE),
      ask("read_note", '{"id":"n9long"}'),
    );
    const block = outcome.result.toolResult.content[0];
    const value = block !== undefined && "json" in block ? block.json : {};
    expect(value["truncated"]).toBe(true);
    expect(String(value["body"])).toHaveLength(MAX_BODY_CHARS_IN_RESULT);
  });

  it("tells the model about exactly the fields the check knows", async () => {
    const tools = await toolsFor(ALICE);
    for (const [name, tool] of Object.entries(tools)) {
      const told = Object.keys(tool.jsonSchema["properties"] as Record<string, unknown>);
      // A known field with a wrong value fails on its type. An unknown field fails as unknown.
      const kindOf = (key: string) => {
        const result = v.safeParse(tool.input, { [key]: {} });
        return result.success
          ? "accepted"
          : result.issues.find((issue) => v.getDotPath(issue) === key)?.type;
      };
      for (const key of told) {
        expect(kindOf(key), `${name}.${key}`).not.toBe("strict_object");
        expect(kindOf(key), `${name}.${key}`).not.toBe("accepted");
      }
      expect(kindOf("somethingElse"), name).toBe("strict_object");
      expect(tool.jsonSchema["additionalProperties"], name).toBe(false);
    }
  });
});
