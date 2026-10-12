// vp run sec:secret:versions
// vp run sec:secret:rotate [--version-id <uuid from a failed run>] [--force]
//   node scripts/rotate.ts <versions|rotate> ...
// `rotate` writes a new version of the signing secret (PutSecretValue). The
// new key is generated here and sent straight to Secrets Manager; it is never
// printed, logged, or written to disk.

import { randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { rotate } from "../src/rotation.ts";
import { createRotationApi } from "../src/secrets-manager-source.ts";

// The stack's TOKEN_TTL_SECONDS plus KEY_CACHE_SECONDS: how long a token signed with the old key can still turn up.
const OVERLAP_MS = (300 + 300) * 1000;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "version-id": { type: "string" }, force: { type: "boolean", default: false } },
});
const action = v.safeParse(v.picklist(["versions", "rotate"]), positionals[0]);

// v.uuid() checks only the 8-4-4-4-12 shape. This also checks the version (1 to 8) and variant
// digits, so what becomes the secret's version ID is a UUID some generator could have made.
const versionIdSchema = v.pipe(
  v.string(),
  v.regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "--version-id must be a UUID, as printed by a failed run",
  ),
);

try {
  if (!action.success) {
    throw new Error("usage: rotate.ts <versions|rotate> [--version-id <uuid>] [--force]");
  }
  const rotating = action.output === "rotate";
  const { target } = await preflight({
    access: rotating ? "mutate" : "observe",
    action: rotating ? "rotate the signing secret" : "list the signing secret's versions",
    stack: "AihSecurity",
  });
  const secretArn = requireOutput(
    await readStackOutputs(process.cwd(), "AihSecurity", target.region),
    "SecretArn",
  );
  const api = createRotationApi(new SecretsManagerClient({ region: target.region }), secretArn);

  if (rotating) {
    const versionId = v.parse(versionIdSchema, values["version-id"] ?? randomUUID());
    // Printed before the call: if the call's answer is lost, this is what a retry needs.
    console.log(`version id for this run: ${versionId}`);
    const result = await rotate(api, {
      versionId,
      newKey: randomBytes(48).toString("base64url"),
      now: new Date(),
      overlapMs: OVERLAP_MS,
      force: values.force,
    });
    if (result.status === "too-soon") {
      console.error(
        `not rotated: ${result.current} became current less than ${OVERLAP_MS / 1000} s ago. Tokens signed with ` +
          `the key before it may still be valid. Retry in ${Math.ceil(result.waitMs / 1000)} s, or pass --force if a key leaked.`,
      );
      process.exit(2);
    }
    console.log(
      `${result.status}: AWSCURRENT ${result.current}, AWSPREVIOUS ${result.previous ?? "(none)"}`,
    );
  }

  for (const version of await api.versions()) {
    console.log(
      `${version.versionId}  ${version.createdAt.toISOString()}  ${version.stages.join(", ") || "(no label)"}`,
    );
  }
} catch (error) {
  console.error("FAIL", error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exit(1);
}
