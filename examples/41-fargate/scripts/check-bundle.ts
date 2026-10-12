// vp run fargate:bundle:check
//   node scripts/check-bundle.ts
//
// Runs both files that go into the image away from this workspace's
// node_modules. The server has to answer and stop on SIGTERM; the job has to
// finish with 0, and with 75 when it is interrupted. No Docker involved.

import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const directory = mkdtempSync(join(tmpdir(), "aih-fargate-bundle-"));
const children: ChildProcess[] = [];
const start = (file: string, env: Record<string, string>): ChildProcess => {
  const child = spawn(process.execPath, [file], {
    cwd: directory,
    env: { PATH: process.env["PATH"], ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  children.push(child);
  return child;
};
const linesOf = (child: ChildProcess) =>
  createInterface({ input: child.stdout ?? process.stdin })[Symbol.asyncIterator]();

try {
  for (const file of ["server.mjs", "job.mjs"]) {
    copyFileSync(join("dist", file), join(directory, file));
  }

  const server = start("server.mjs", {
    PORT: "0",
    ALLOWED_ORIGIN: "http://localhost:5173",
    APP_VERSION: "bundle",
  });
  const serverExit = once(server, "exit");
  const first = await linesOf(server).next();
  if (first.done === true) {
    throw new Error("the server bundle exited before it listened");
  }
  const { port } = JSON.parse(first.value) as { port: number };
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  if (response.status !== 200 || response.headers.get("x-app-version") !== "bundle") {
    throw new Error(`unexpected answer from the server bundle: ${response.status}`);
  }
  server.kill("SIGTERM");
  const [serverCode] = (await serverExit) as [number | null];
  if (serverCode !== 0) {
    throw new Error(`the server bundle exited with ${serverCode} after SIGTERM`);
  }
  console.log(`ok   server.mjs answers on its own (port ${port}) and exits with 0 on SIGTERM`);

  const whole = start("job.mjs", { JOB_ITEMS: "3", JOB_ITEM_MS: "10" });
  const [wholeCode] = (await once(whole, "exit")) as [number | null];
  if (wholeCode !== 0) {
    throw new Error(`the job bundle exited with ${wholeCode}`);
  }
  console.log("ok   job.mjs finishes three items and exits with 0");

  const cut = start("job.mjs", { JOB_ITEMS: "1000", JOB_ITEM_MS: "20" });
  const cutExit = once(cut, "exit");
  for await (const line of linesOf(cut)) {
    if ((JSON.parse(line) as { message: string }).message === "item done") {
      cut.kill("SIGTERM");
      break;
    }
  }
  const [cutCode] = (await cutExit) as [number | null];
  if (cutCode !== 75) {
    throw new Error(`the interrupted job bundle exited with ${cutCode}, not 75`);
  }
  console.log("ok   job.mjs stops between two items on SIGTERM and exits with 75");
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  for (const child of children) {
    child.kill("SIGKILL");
  }
  rmSync(directory, { recursive: true, force: true });
}
