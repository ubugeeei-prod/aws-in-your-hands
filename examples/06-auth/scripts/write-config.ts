// Part of `vp run app:publish`.
//   node scripts/write-config.ts
//
// Replaces the local config.json in web/dist with one written from the
// stack's outputs, so one build can be pointed at any deployment.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { parseConfig } from "../web/src/config.ts";

try {
  const { target } = await preflight({
    access: "observe",
    action: "read stack outputs for the SPA config",
    stack: "AihNotesApp",
  });
  const outputs = await readStackOutputs(process.cwd(), "AihNotesApp", target.region);
  // Validated with the schema the SPA itself uses to read the file.
  const config = parseConfig({
    apiUrl: requireOutput(outputs, "ApiUrl"),
    auth: {
      mode: "cognito",
      issuer: requireOutput(outputs, "Issuer"),
      domain: requireOutput(outputs, "AuthDomain"),
      clientId: requireOutput(outputs, "UserPoolClientId"),
    },
  });
  const path = resolve("web/dist/config.json");
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`wrote ${path} for ${config.apiUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
