import { gzipSync } from "node:zlib";

import { build, type Metafile } from "esbuild";

import type { Weight } from "./budget.ts";
import { shared, type VariantName, variants } from "./variants.ts";

export type Built = Weight & {
  name: VariantName;
  code: Uint8Array;
  /** Bytes each package contributes to the output, largest first. */
  packages: { name: string; bytes: number }[];
};

// #region owner
/** The package an input file belongs to. Paths are relative to this example's directory. */
export function ownerOf(path: string): string {
  const inModules = path.split("node_modules/").at(-1) ?? path;
  if (inModules !== path) {
    const [first = "", second = ""] = inModules.split("/");
    return first.startsWith("@") ? `${first}/${second}` : first;
  }
  // Another example, used through a workspace dependency.
  const sibling = /^\.\.\/([^/]+)\//.exec(path);
  return sibling === null ? "this example" : `examples/${sibling[1] ?? ""}`;
}
// #endregion owner

function byPackage(metafile: Metafile): Built["packages"] {
  const totals = new Map<string, number>();
  for (const output of Object.values(metafile.outputs)) {
    for (const [path, { bytesInOutput }] of Object.entries(output.inputs)) {
      const owner = ownerOf(path);
      totals.set(owner, (totals.get(owner) ?? 0) + bytesInOutput);
    }
  }
  return [...totals]
    .map(([name, bytes]) => ({ name, bytes }))
    .toSorted((a, b) => b.bytes - a.bytes);
}

// #region build
/** Bundles one variant in memory. `root` is this example's directory. */
export async function buildVariant(name: VariantName, root: string): Promise<Built> {
  const variant = variants[name];
  const result = await build({
    ...shared,
    absWorkingDir: root,
    entryPoints: [variant.entry],
    ...(variant.mainFields === undefined ? {} : { mainFields: [...variant.mainFields] }),
    minify: variant.minify,
    external: [...variant.external],
    outfile: "index.mjs",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const code = result.outputFiles[0]?.contents;
  if (code === undefined) {
    throw new Error(`esbuild produced no output for ${name}`);
  }
  return {
    name,
    code,
    bytes: code.byteLength,
    // A deployment package is a zip archive. gzip uses the same compression, without the archive's headers.
    gzipBytes: gzipSync(code).byteLength,
    packages: byPackage(result.metafile),
  };
}
// #endregion build
