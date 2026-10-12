import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type CdkdResult = { exitCode: number; stdout: string; stderr: string };

export function cdkdBinary(appDir: string): string {
  const binary = resolve(appDir, "node_modules/.bin/cdkd");
  if (!existsSync(binary)) {
    throw new Error(
      `cdkd is not installed in ${appDir}. Run \`vp install\` from the repository root.`,
    );
  }
  return binary;
}

/** AWS_REGION is always set: cdkd 0.296.28 falls back to us-east-1 without it. */
export function runCdkd(options: {
  appDir: string;
  args: string[];
  region: string;
  capture: boolean;
}): Promise<CdkdResult> {
  const binary = cdkdBinary(options.appDir);
  console.error(
    `$ (cd ${options.appDir} && AWS_REGION=${options.region} cdkd ${options.args.join(" ")})`,
  );

  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, options.args, {
      cwd: options.appDir,
      env: { ...process.env, AWS_REGION: options.region },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      // A signal means cdkd did not finish; never report that as success.
      resolvePromise({ exitCode: code ?? (signal === null ? 1 : 128), stdout, stderr });
    });
  });
}
