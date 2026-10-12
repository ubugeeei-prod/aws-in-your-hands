// vp run calls:config
//   node scripts/write-config.ts
//
// Writes the deployed API and user pool into the built page (web/dist/config.json),
// with media turned on. Run `vp run preview:calls:web` afterwards.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { parseCallsConfig } from "../web/src/config.ts";

try {
  const { target } = await preflight({
    access: "observe",
    action: "read stack outputs for the page config",
    stack: "AihCalls",
  });
  const outputs = await readStackOutputs(process.cwd(), "AihCalls", target.region);
  // Validated with the schema the page itself uses to read the file.
  const config = parseCallsConfig({
    apiUrl: requireOutput(outputs, "ApiUrl"),
    auth: {
      mode: "cognito",
      issuer: requireOutput(outputs, "Issuer"),
      domain: requireOutput(outputs, "AuthDomain"),
      clientId: requireOutput(outputs, "UserPoolClientId"),
    },
    media: "chime",
  });
  const path = resolve("web/dist/config.json");
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`wrote ${path} for ${config.apiUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
