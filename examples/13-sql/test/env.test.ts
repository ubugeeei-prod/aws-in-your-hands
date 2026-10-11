import { describe, expect, it } from "vite-plus/test";
import { parseEnv, regionOfEndpoint } from "../src/env.ts";

const base = { ALLOWED_ORIGIN: "http://localhost:5173" };

describe("environment", () => {
  it("needs nothing but the origin for the local database", () => {
    expect(parseEnv({ ...base, NOTES_DB: "pglite" })).toMatchObject({ NOTES_DB: "pglite", PGLITE_DATA_DIR: ".pglite" });
  });

  it("fails at startup when the cluster endpoint is missing or is not one", () => {
    expect(() => parseEnv({ ...base, NOTES_DB: "dsql" })).toThrow("DSQL_ENDPOINT");
    expect(() => parseEnv({ ...base, NOTES_DB: "dsql", DSQL_ENDPOINT: "https://example.com" })).toThrow(
      "DSQL_ENDPOINT",
    );
  });

  it("rejects a database role name that could not be an unquoted identifier", () => {
    const endpoint = "abcdefghijklmnopqrstuvwxyz.dsql.ap-northeast-1.on.aws";
    expect(() => parseEnv({ ...base, NOTES_DB: "dsql", DSQL_ENDPOINT: endpoint, DSQL_USER: "api; DROP" })).toThrow(
      "DSQL_USER",
    );
  });

  it("signs tokens for the region in the endpoint's own name", () => {
    expect(regionOfEndpoint("abcdefghijklmnopqrstuvwxyz.dsql.ap-northeast-1.on.aws")).toBe("ap-northeast-1");
    expect(() => regionOfEndpoint("example.com")).toThrow("not an Aurora DSQL cluster endpoint");
  });
});
