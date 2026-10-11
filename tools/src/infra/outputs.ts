import { z } from "zod";
import { runCdkd } from "./run-cdkd.ts";

// `cdkd state show <stack> --json` prints { state, lock }. Only the outputs
// map is read here; everything else in the state file is cdkd's business.
const stateShowSchema = z.object({
  state: z.object({
    stackName: z.string(),
    outputs: z.record(z.string(), z.string()),
  }),
});

export function parseOutputs(stdout: string): Record<string, string> {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch (error) {
    throw new Error("`cdkd state show --json` did not print JSON", { cause: error });
  }
  return stateShowSchema.parse(json).state.outputs;
}

export function requireOutput(outputs: Record<string, string>, name: string): string {
  // Accept both "Name" and "<Stack>.Name" so that a change in how cdkd keys
  // outputs is reported as a clear error rather than as a missing bucket.
  const matches = Object.entries(outputs).filter(([key]) => key === name || key.endsWith(`.${name}`));
  const first = matches[0];
  if (first === undefined || matches.length > 1) {
    throw new Error(
      `Expected exactly one stack output named "${name}", found ${matches.length} among: ${Object.keys(outputs).join(", ") || "(none)"}`,
    );
  }
  return first[1];
}

export async function readStackOutputs(appDir: string, stack: string, region: string): Promise<Record<string, string>> {
  const result = await runCdkd({ appDir, args: ["state", "show", stack, "--json"], region, capture: true });
  if (result.exitCode !== 0) {
    throw new Error(`cdkd state show ${stack} exited with ${result.exitCode}. Has the stack been deployed with cdkd?`);
  }
  return parseOutputs(result.stdout);
}
