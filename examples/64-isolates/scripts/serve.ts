// vp run dev:isolates
//   node scripts/serve.ts
//
// Chapter 04's app in workerd on this machine. No AWS, no Docker.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

import { renderConfig } from "../src/capnp.ts";
import { localDeployment } from "../src/deployments.ts";
import { WORKERD_BINARY } from "../src/runtime.ts";

// #region serve
const port = Number(process.env["PORT"] ?? 8787);
writeFileSync("dist/local.capnp", renderConfig(localDeployment(port)));

const child = spawn(WORKERD_BINARY, ["serve", "dist/local.capnp"], { stdio: "inherit" });
console.log(`notes API in workerd on http://localhost:${port}`);
// #endregion serve

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 1));
