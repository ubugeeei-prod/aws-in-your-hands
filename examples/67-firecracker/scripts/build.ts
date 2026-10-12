// vp run firecracker:kit:build
//   node scripts/build.ts
//
// dist/kit/: the three programs as single files, and deploy/, for a Linux machine without this checkout.

import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";

import { build } from "esbuild";

const out = "dist/kit";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: {
    "guest-server": "src/guest-server.ts",
    plan: "scripts/plan.ts",
    boot: "scripts/boot.ts",
  },
  outdir: out,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  minify: false,
  logLevel: "warning",
});
cpSync("deploy", `${out}/deploy`, { recursive: true });

for (const name of readdirSync(out).toSorted()) {
  const stat = statSync(`${out}/${name}`);
  console.log(`${out}/${name}${stat.isDirectory() ? "/" : `: ${stat.size} bytes`}`);
}
