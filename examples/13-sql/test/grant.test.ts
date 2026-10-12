import { describe, expect, it } from "vite-plus/test";

import { grantStatements } from "../src/grant.ts";

const ARN = "arn:aws:iam::123456789012:role/AihSql-HandlerRole-AbC123";

describe("grant statements", () => {
  it("gives the API's role rows in the app schema and no way to change the schema", () => {
    const statements = grantStatements("notes_api", ARN);

    expect(statements.mapToIam).toBe(`AWS IAM GRANT notes_api TO '${ARN}'`);
    const privileges = statements.privileges.join("\n");
    expect(privileges).toContain("SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app");
    expect(privileges).not.toMatch(/\b(ALL PRIVILEGES|CREATE|DROP|TRUNCATE)\b/);
  });

  it("refuses names that would change the meaning of the statement", () => {
    expect(() => grantStatements("notes_api", `${ARN}'; DROP TABLE app.notes; --`)).toThrow(
      "not an IAM role ARN",
    );
    expect(() => grantStatements("notes_api", "arn:aws:iam::123456789012:user/someone")).toThrow(
      "not an IAM role ARN",
    );
    expect(() => grantStatements("admin; DROP", ARN)).toThrow("not a plain database role name");
  });
});
