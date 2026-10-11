// vp run book:smoke / spa:smoke
//   node tools/src/site/smoke.ts <book|spa> <appDir> <stack> [--url https://...] [--expect-revision REV] [--timeout-seconds N]
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { preflight } from "../aws/preflight.ts";
import { readStackOutputs, requireOutput } from "../infra/outputs.ts";
import { sourceRevision } from "./revision.ts";
import {
  assetCheckFrom,
  type Check,
  checksFor,
  httpsRedirectCheck,
  type Observed,
  type Profile,
  PROFILES,
  revisionCheck,
} from "./smoke-spec.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string" },
    "expect-revision": { type: "string" },
    "timeout-seconds": { type: "string", default: "600" },
  },
});
const [profile, appDir, stack] = positionals;
if (!(PROFILES as readonly string[]).includes(profile ?? "") || appDir === undefined || stack === undefined) {
  console.error(
    "usage: smoke.ts <book|spa> <appDir> <stack> [--url URL] [--expect-revision REV] [--timeout-seconds N]",
  );
  process.exit(64);
}

async function observe(url: string): Promise<Observed> {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  };
}

async function runCheck(base: URL, check: Check): Promise<string | null> {
  try {
    return check.verify(await observe(new URL(check.path, base).toString()));
  } catch (error) {
    return `request failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runAll(base: URL, expectedRevision: string): Promise<{ name: string; problem: string | null }[]> {
  const spec = checksFor(profile as Profile);
  const checks = [...spec.checks, revisionCheck(expectedRevision), httpsRedirectCheck(base.host)];
  const results: { name: string; problem: string | null }[] = [];
  for (const check of checks) {
    results.push({ name: check.name, problem: await runCheck(base, check) });
  }
  try {
    const asset = assetCheckFrom((await observe(new URL(spec.assetSourcePath, base).toString())).body);
    results.push(
      typeof asset === "string"
        ? { name: "serves a hashed asset as immutable", problem: asset }
        : { name: asset.name, problem: await runCheck(base, asset) },
    );
  } catch (error) {
    results.push({ name: "serves a hashed asset as immutable", problem: String(error) });
  }
  return results;
}

try {
  let base: URL;
  if (values.url === undefined) {
    const { target } = await preflight({ access: "observe", action: "smoke test the deployed site", stack });
    const domain = requireOutput(
      await readStackOutputs(resolve(appDir), stack, target.region),
      "DistributionDomainName",
    );
    base = new URL(`https://${domain}/`);
  } else {
    base = new URL(values.url);
  }
  const expectedRevision = values["expect-revision"] ?? sourceRevision(process.cwd());
  const deadline = Date.now() + Number(values["timeout-seconds"]) * 1000;
  console.log(`site: ${base.toString()}\nexpecting revision: ${expectedRevision}`);

  // CloudFront applies a change edge by edge. Retrying until a deadline is how
  // "the deploy command returned" is kept apart from "readers receive it".
  for (let attempt = 1; ; attempt++) {
    const results = await runAll(base, expectedRevision);
    const failures = results.filter((result) => result.problem !== null);
    if (failures.length === 0 || Date.now() >= deadline) {
      for (const result of results) {
        console.log(
          `${result.problem === null ? "ok  " : "FAIL"} ${result.name}${result.problem === null ? "" : `: ${result.problem}`}`,
        );
      }
      console.log(`checked at ${new Date().toISOString()} after ${attempt} attempt(s)`);
      process.exit(failures.length === 0 ? 0 : 1);
    }
    console.log(
      `attempt ${attempt}: ${failures.length} check(s) not passing yet (${failures[0]?.name}); retrying in 15s`,
    );
    await sleep(15_000);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
