// vp run uploads:user:create <email>   |   vp run uploads:user:delete <email>
//   node scripts/user.ts <create|delete> <email>
//
// Cognito emails the temporary password. This script never sees or prints one.

import { spawnSync } from "node:child_process";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

const [action, emailArg] = process.argv.slice(2);
const email = v.safeParse(v.pipe(v.string(), v.email()), emailArg);
if ((action !== "create" && action !== "delete") || !email.success) {
  console.error("usage: user.ts <create|delete> <email>");
  process.exit(64);
}

try {
  const { target } = await preflight({
    access: "mutate",
    action: `${action} user ${email.output}`,
    stack: "AihUploads",
  });
  const userPoolId = requireOutput(
    await readStackOutputs(process.cwd(), "AihUploads", target.region),
    "UserPoolId",
  );
  const args =
    action === "create"
      ? [
          "cognito-idp",
          "admin-create-user",
          "--region",
          target.region,
          "--user-pool-id",
          userPoolId,
          "--username",
          email.output,
          "--user-attributes",
          `Name=email,Value=${email.output}`,
          "Name=email_verified,Value=true",
          "--desired-delivery-mediums",
          "EMAIL",
        ]
      : [
          "cognito-idp",
          "admin-delete-user",
          "--region",
          target.region,
          "--user-pool-id",
          userPoolId,
          "--username",
          email.output,
        ];
  console.error(`$ aws ${args.join(" ")}`);
  process.exit(
    spawnSync("aws", args, {
      stdio: ["ignore", action === "create" ? "ignore" : "inherit", "inherit"],
    }).status ?? 1,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
