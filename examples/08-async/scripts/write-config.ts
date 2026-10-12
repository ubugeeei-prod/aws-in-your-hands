// Part of `vp run async:publish`.
//   node scripts/write-config.ts
//
// This chapter adds no screen: it publishes chapter 07's SPA, built once,
// with a config.json that points at this chapter's stack.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseConfig } from "@aih/example-06-auth/web/src/config.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

const STACK = "AihAsync";

try {
  const { target } = await preflight({
    access: "observe",
    action: "read stack outputs for the SPA config",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const config = parseConfig({
    apiUrl: requireOutput(outputs, "ApiUrl"),
    auth: {
      mode: "cognito",
      issuer: requireOutput(outputs, "Issuer"),
      domain: requireOutput(outputs, "AuthDomain"),
      clientId: requireOutput(outputs, "UserPoolClientId"),
    },
  });
  // Chapter 07's build output. `vp run uploads:publish` writes its own config over this one.
  const path = resolve("../07-uploads/web/dist/config.json");
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`wrote ${path} for ${config.apiUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
