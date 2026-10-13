import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { zip, type ZipEntry } from "../src/zip.ts";

// #region package
/** The two files a Web Function needs: the server as one file, and the note that it is an ES module. */
export async function packageEntries(): Promise<ZipEntry[]> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
    // The runtime loads index.js at the root of the package unless told otherwise.
    outfile: "index.js",
    write: false,
    bundle: true,
    platform: "node",
    format: "esm",
    // Web Functions run nodejs24.x on Arm64. Nothing here is compiled for a processor.
    target: "node24",
    minify: false,
    sourcemap: false,
    // A dependency that reaches for require() would not find it in an ES module.
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: "warning",
  });
  const [bundle] = result.outputFiles;
  if (bundle === undefined) {
    throw new Error("esbuild wrote no file");
  }
  return [
    { name: "index.js", data: bundle.contents },
    // Without this, Node.js reads a .js file as CommonJS and the imports fail.
    { name: "package.json", data: Buffer.from(`${JSON.stringify({ type: "module" })}\n`) },
  ];
}

export const packageZip = async (): Promise<Buffer> => zip(await packageEntries());
// #endregion package
