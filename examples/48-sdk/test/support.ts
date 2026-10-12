import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GetItemCommand } from "@aws-sdk/client-dynamodb";

/**
 * Cuts the SDK off from this machine's settings: no AWS_* variable, and shared files that hold
 * only what the test wrote. Without it a `max_attempts` in ~/.aws/config would change the results.
 */
export function isolateSdkEnvironment(files: { config?: string; credentials?: string } = {}): void {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("AWS_") || name.startsWith("SMITHY_")) {
      delete process.env[name];
    }
  }
  const directory = mkdtempSync(join(tmpdir(), "aih-48-sdk-"));
  writeFileSync(join(directory, "config"), files.config ?? "");
  writeFileSync(join(directory, "credentials"), files.credentials ?? "");
  process.env.AWS_CONFIG_FILE = join(directory, "config");
  process.env.AWS_SHARED_CREDENTIALS_FILE = join(directory, "credentials");
  // The last link of the chain would otherwise try 169.254.169.254.
  process.env.AWS_EC2_METADATA_DISABLED = "true";
}

export const getNote = () =>
  new GetItemCommand({
    TableName: "notes",
    Key: { pk: { S: "OWNER#u1" }, sk: { S: "NOTE#n1" } },
  });
