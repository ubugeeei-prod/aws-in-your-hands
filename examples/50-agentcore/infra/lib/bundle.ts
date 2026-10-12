import { fileURLToPath } from "node:url";

import { buildSync } from "esbuild";

// #region bundle
/** The file name AgentCore Runtime is told to start. */
export const ENTRY_FILE = "app.js";

/**
 * Writes the agent as one JavaScript file. Direct code deployment runs Node.js 22 and does
 * not run TypeScript, and every dependency has to be in the archive.
 */
export function bundleAgent(outdir: string): void {
  buildSync({
    entryPoints: { app: fileURLToPath(new URL("../../src/server.ts", import.meta.url)) },
    outdir,
    bundle: true,
    platform: "node",
    // CommonJS: a `.js` file with no package.json next to it is loaded as CommonJS.
    format: "cjs",
    target: "node22",
    minify: false,
    sourcemap: false,
    logLevel: "warning",
  });
}
// #endregion bundle
