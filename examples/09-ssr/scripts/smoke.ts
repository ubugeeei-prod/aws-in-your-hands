// vp run ssr:smoke
//   node scripts/smoke.ts
//
// Asks the deployed distribution the questions this chapter is about. It only
// sends GET and POST requests to your own site; nothing in AWS is changed.

import { setTimeout as sleep } from "node:timers/promises";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { SESSION_COOKIE } from "../core/session.ts";
import {
  directUrlProblem,
  firstAssetPath,
  type Observed,
  personalPageProblem,
  publicPageProblem,
  refusedProblem,
} from "./smoke-spec.ts";

async function observe(url: string, init: RequestInit = {}): Promise<Observed> {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    ...init,
  });
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  };
}

const failures: string[] = [];
const report = (name: string, problem: string | null): void => {
  console.log(
    `${problem === null ? "ok  " : "FAIL"} ${name}${problem === null ? "" : `: ${problem}`}`,
  );
  if (problem !== null) {
    failures.push(name);
  }
};

try {
  const { target } = await preflight({
    access: "observe",
    action: "smoke test the deployed SSR site",
    stack: "AihSsr",
  });
  const outputs = await readStackOutputs(process.cwd(), "AihSsr", target.region);
  const site = `https://${requireOutput(outputs, "DistributionDomainName")}`;
  const functionUrl = requireOutput(outputs, "ServerFunctionUrl");
  console.log(`site: ${site}`);

  // A public page, asked for a few times: the later answers should come from CloudFront's cache.
  const first = await observe(`${site}/`);
  const later: Observed[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(1000);
    later.push(await observe(`${site}/`));
  }
  report("a public page is shared by CloudFront", publicPageProblem(first, later));

  // A made-up session cookie: the server finds no session, but must still treat the request as personal.
  const cookie = `${SESSION_COOKIE}=${"smoke".padEnd(43, "0")}`;
  const personal: Observed[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    personal.push(await observe(`${site}/me`, { headers: { cookie } }));
    personal.push(await observe(`${site}/me`));
    personal.push(await observe(`${site}/me/api/viewer`, { headers: { cookie } }));
  }
  report("nothing under /me is ever served from the cache", personalPageProblem(personal));

  const assetPath = firstAssetPath(first.body);
  if (assetPath === undefined) {
    report("the page links to a built asset", "no /_nuxt/ link in the page");
  } else {
    const asset = await observe(`${site}${assetPath}`);
    report(
      "a built asset comes from the bucket as immutable",
      asset.status === 200 && (asset.headers["cache-control"] ?? "").includes("immutable")
        ? null
        : `${asset.status} ${asset.headers["cache-control"] ?? "(no cache-control)"}. Did ssr:assets:publish run?`,
    );
  }

  report(
    "the function URL refuses a request that CloudFront did not sign",
    directUrlProblem(await observe(functionUrl)),
  );
  report(
    "CloudFront refuses POST",
    refusedProblem(await observe(`${site}/me/sign-in`, { method: "POST", body: "name=x" })),
  );
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  failures.push("the smoke test itself failed");
}
process.exit(failures.length === 0 ? 0 : 1);
