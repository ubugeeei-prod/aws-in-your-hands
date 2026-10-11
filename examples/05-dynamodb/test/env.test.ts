import { describe, expect, it } from "vite-plus/test";
import { parseEnv } from "../src/env.ts";

const base = { ALLOWED_ORIGIN: "http://localhost:5173" };

describe("environment", () => {
  it("needs nothing about a table when notes are kept in memory", () => {
    expect(parseEnv({ ...base, NOTES_STORE: "memory" })).toMatchObject({ NOTES_STORE: "memory", LOG_LEVEL: "info" });
  });

  it("requires the table name when notes are kept in DynamoDB", () => {
    expect(() => parseEnv({ ...base, NOTES_STORE: "dynamodb" })).toThrow(/TABLE_NAME/);
    expect(parseEnv({ ...base, NOTES_STORE: "dynamodb", TABLE_NAME: "notes" })).toMatchObject({ TABLE_NAME: "notes" });
  });

  it("refuses to start without saying where notes are kept", () => {
    expect(() => parseEnv(base)).toThrow(/NOTES_STORE/);
  });

  it("rejects an endpoint that is not a URL", () => {
    expect(() =>
      parseEnv({ ...base, NOTES_STORE: "dynamodb", TABLE_NAME: "notes", DYNAMODB_ENDPOINT: "localhost:8000" }),
    ).toThrow(/DYNAMODB_ENDPOINT/);
  });
});
