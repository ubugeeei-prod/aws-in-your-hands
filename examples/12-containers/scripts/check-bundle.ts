// vp run ecs:bundle:check
//   node scripts/check-bundle.ts
//
// Runs dist/server.mjs, the file that goes into the image, away from this
// workspace's node_modules: it has to start with nothing but Node.js, answer,
// and stop cleanly on SIGTERM. No Docker involved.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { healthSchema } from "@aih/example-04-http-api/src/contract.ts";

const directory = mkdtempSync(join(tmpdir(), "aih-bundle-"));
let child: ReturnType<typeof spawn> | undefined;
try {
  copyFileSync("dist/server.mjs", join(directory, "server.mjs"));
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: directory,
    env: { PATH: process.env["PATH"], PORT: "0", ALLOWED_ORIGIN: "http://localhost:5173", APP_VERSION: "bundle" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = once(child, "exit");
  const lines = createInterface({ input: child.stdout ?? process.stdin })[Symbol.asyncIterator]();

  const first = await lines.next();
  if (first.done === true) {
    throw new Error("the bundle exited before it listened");
  }
  const { port } = JSON.parse(first.value) as { port: number };

  const response = await fetch(`http://127.0.0.1:${port}/health`);
  healthSchema.parse(await response.json());
  if (response.status !== 200 || response.headers.get("x-app-version") !== "bundle") {
    throw new Error(`unexpected answer from the bundle: ${response.status}`);
  }
  console.log(`ok   the bundle answers on its own (port ${port})`);

  child.kill("SIGTERM");
  const [code] = (await exited) as [number | null];
  if (code !== 0) {
    throw new Error(`the bundle exited with ${code} after SIGTERM`);
  }
  console.log("ok   it exits with 0 on SIGTERM");
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  child?.kill("SIGKILL");
  rmSync(directory, { recursive: true, force: true });
}
