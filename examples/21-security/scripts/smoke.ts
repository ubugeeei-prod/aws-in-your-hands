// vp run sec:smoke
//   node scripts/smoke.ts [--url https://dxxxxxxxxxxxx.cloudfront.net]
// Goes through CloudFront, the signed function URL, Lambda, IAM, and Secrets
// Manager. Reads the secret (a billed API call); writes nothing.

import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import {
  errorSchema,
  healthSchema,
  issuedSchema,
  TOKEN_HEADER,
  verifiedSchema,
} from "../src/contract.ts";
import { untilAllowed } from "../src/propagation.ts";

const { values } = parseArgs({ options: { url: { type: "string" } } });

class KeyUnavailable extends Error {}

try {
  let url = values.url;
  if (url === undefined) {
    const { target } = await preflight({
      access: "mutate",
      action: "smoke test the token API",
      stack: "AihSecurity",
    });
    url = requireOutput(await readStackOutputs(process.cwd(), "AihSecurity", target.region), "Url");
  }
  console.log(`api: ${url}`);

  const health = await fetch(`${url}/health`);
  if (health.status !== 200) {
    throw new Error(`health: expected 200, got ${health.status}: ${await health.text()}`);
  }
  console.log(`ok   health (stage ${healthSchema.parse(await health.json()).stage})`);

  // #region wait-for-iam
  // Right after a deploy, the role's permission to read the secret may not have reached
  // every IAM endpoint. The function answers 503 until it has; anything else is a real failure.
  const { value: issued, denials } = await untilAllowed(
    async () => {
      const response = await fetch(`${url}/token?sub=smoke`);
      if (response.status === 503) {
        throw new KeyUnavailable(errorSchema.parse(await response.json()).message);
      }
      if (response.status !== 200) {
        throw new Error(`token: expected 200, got ${response.status}: ${await response.text()}`);
      }
      return issuedSchema.parse(await response.json());
    },
    (error) => error instanceof KeyUnavailable,
    { attempts: 10, delayMs: 3_000, sleep },
  );
  // #endregion wait-for-iam
  console.log(`ok   token issued with key version ${issued.keyVersion} after ${denials} refusals`);

  const verified = await fetch(`${url}/verify`, { headers: { [TOKEN_HEADER]: issued.token } });
  if (verified.status !== 200) {
    throw new Error(`verify: expected 200, got ${verified.status}: ${await verified.text()}`);
  }
  console.log(`ok   verified for subject ${verifiedSchema.parse(await verified.json()).subject}`);

  const forged = await fetch(`${url}/verify`, {
    headers: { [TOKEN_HEADER]: `${issued.token.slice(0, -4)}AAAA` },
  });
  if (forged.status !== 401) {
    throw new Error(`a token with an edited signature answered ${forged.status}, expected 401`);
  }
  console.log("ok   an edited token is refused");

  const post = await fetch(`${url}/token?sub=smoke`, { method: "POST" });
  if (post.status !== 403) {
    throw new Error(
      `POST answered ${post.status}; CloudFront should refuse methods the behavior does not allow`,
    );
  }
  console.log("ok   POST is refused at CloudFront");
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
