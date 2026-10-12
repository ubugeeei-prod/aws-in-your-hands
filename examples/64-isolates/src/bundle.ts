import { build } from "esbuild";

// #region bundle
/** One ES module with the entry point and everything it imports, for a runtime that has no node_modules. */
export async function bundleWorker(entry: string, outfile: string): Promise<void> {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    // Neither "node" nor "browser": the bundle may assume only what workerd provides.
    platform: "neutral",
    mainFields: ["module", "main"],
    target: "es2023",
    // Left as imports for workerd to resolve: it implements node:crypto and node:async_hooks itself.
    external: ["node:*"],
    minify: false,
    logLevel: "warning",
  });
}
// #endregion bundle
