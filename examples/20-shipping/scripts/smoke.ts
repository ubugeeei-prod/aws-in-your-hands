// vp run ship:smoke [-c stage=prod]
//   node examples/20-shipping/scripts/smoke.ts ...
//
// Calls the deployed API through API Gateway and the `live` alias with chapter 04's
// typed client. Creates one note in the function's memory; nothing is stored.
import { parseArgs } from "node:util";
import { ApiError, createNotesClient } from "@aih/example-04-http-api/src/client.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { apiStackName } from "../infra/lib/config.ts";
import { stageFrom } from "../src/cdk-args.ts";
import { describeStack, requireOutput } from "../src/stack-info.ts";

try {
  const { values } = parseArgs({ options: { context: { type: "string", short: "c", multiple: true, default: [] } } });
  const stage = stageFrom(values.context.flatMap((entry) => ["-c", entry]));
  const name = apiStackName(stage);
  const { target } = await preflight({ access: "mutate", action: "smoke test the deployed API", stack: name });

  const stack = await describeStack(new CloudFormationClient({ region: target.region }), name);
  if (stack === null) {
    throw new Error(`${name} is not deployed in ${target.region}.`);
  }
  const client = createNotesClient(requireOutput(stack, "ApiUrl"));
  console.log(`stack ${name} is ${stack.StackStatus}, live version ${requireOutput(stack, "LiveVersion")}`);

  const health = await client.health();
  if (health.stage !== stage) {
    throw new Error(`/health answered for stage "${health.stage}", expected "${stage}"`);
  }
  console.log(`ok   health (stage ${health.stage})`);

  const note = await client.create({ title: `smoke ${new Date().toISOString()}`, body: "created by ship:smoke" });
  console.log(`ok   created ${note.id} through the route, the integration, and the alias`);

  const missing = await client.get("aih-smoke-missing").catch((error: unknown) => error);
  if (!(missing instanceof ApiError) || missing.status !== 404) {
    throw new Error("an unknown note did not answer 404 with the error contract");
  }
  console.log(`ok   unknown note is a 404 (request ${missing.requestId})`);
} catch (error) {
  console.error(
    "FAIL",
    error instanceof ApiError ? `${error.status} ${error.code} (request ${error.requestId})` : error,
  );
  process.exit(1);
}
