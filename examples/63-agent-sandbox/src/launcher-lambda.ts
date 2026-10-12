import { awsPorts } from "./aws.ts";
import { readFunctionEnv } from "./env.ts";
import { launch, type LaunchResult } from "./launcher.ts";

const env = readFunctionEnv(process.env);
const ports = awsPorts(env);

/** Invoked directly, by someone whose IAM policy allows lambda:InvokeFunction on it. No HTTP door. */
export async function handler(event: unknown): Promise<LaunchResult> {
  const result = await launch(event, ports, {
    allowedRepositories: env.ALLOWED_REPOSITORIES,
    model: env.MODEL,
  });
  // The request's text is not logged: only what was decided.
  console.log(JSON.stringify({ event: "launch", ...result }));
  return result;
}
