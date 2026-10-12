import type { BuildOptions } from "esbuild";

// One file with nothing to install beside it. CloudShell's Node.js version is not documented,
// so the syntax is held to Node.js 18 and the file imports only node: modules.
export const BUNDLE = "dist/aih-cloudshell.mjs";

export const bundleOptions = (outfile: string): BuildOptions => ({
  entryPoints: ["src/cli.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  // A reader should be able to read what they are about to run with their credentials.
  minify: false,
  logLevel: "warning",
});
