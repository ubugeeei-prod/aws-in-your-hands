// vp run ecs:watch
//   node scripts/watch.ts [--url http://xxxx.ap-northeast-1.elb.amazonaws.com] [--for 180]
//
// Asks the deployed service for /health once a second and prints which build
// answered. Run it in a second terminal during a deploy: old and new versions
// alternate for a while, and no line should be an error.
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { CONTAINERS_STACK } from "../src/config.ts";
import { summarize, type Sample } from "../src/watch.ts";

const { values } = parseArgs({ options: { url: { type: "string" }, for: { type: "string", default: "180" } } });

try {
  let url = values.url;
  if (url === undefined) {
    const { target } = await preflight({ access: "observe", action: "watch the service", stack: CONTAINERS_STACK });
    url = requireOutput(await readStackOutputs(process.cwd(), CONTAINERS_STACK, target.region), "ServiceUrl");
  }
  const seconds = Number(values.for);
  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new Error("--for takes a whole number of seconds");
  }
  console.log(`watching ${url}/health for ${seconds} s (Ctrl-C to stop)`);

  const samples: Sample[] = [];
  const finish = (): never => {
    console.log(summarize(samples).join("\n"));
    process.exit(samples.some((sample) => sample.status !== 200) ? 1 : 0);
  };
  process.once("SIGINT", finish);

  for (let second = 0; second < seconds; second++) {
    const startedAt = Date.now();
    let sample: Sample;
    try {
      // A fresh connection each time, so every request is balanced on its own.
      const response = await fetch(`${url}/health`, {
        headers: { connection: "close" },
        signal: AbortSignal.timeout(5_000),
      });
      await response.arrayBuffer();
      sample = { status: response.status, version: response.headers.get("x-app-version") ?? "(no header)" };
    } catch (error) {
      sample = { status: 0, version: error instanceof Error ? error.name : "error" };
    }
    samples.push(sample);
    console.log(
      `${new Date(startedAt).toISOString()}  ${sample.status === 0 ? "ERR" : sample.status}  ${sample.version}`,
    );
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1_000 - (Date.now() - startedAt))));
  }
  finish();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
