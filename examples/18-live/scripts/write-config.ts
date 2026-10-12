// vp run stream:config
//   node scripts/write-config.ts
//
// Writes the deployed channel's playback URL into the built page
// (web/dist/config.json). Run `vp run preview:stream:web` afterwards.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { parseConfig } from "../web/src/config.ts";

try {
  const { target } = await preflight({
    access: "observe",
    action: "read stack outputs for the player config",
    stack: "AihLive",
  });
  const outputs = await readStackOutputs(process.cwd(), "AihLive", target.region);
  // Validated with the schema the page itself uses to read the file.
  const config = parseConfig({ playbackUrl: requireOutput(outputs, "PlaybackUrl") });
  const path = resolve("web/dist/config.json");
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`wrote ${path}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
