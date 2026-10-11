// vp run async:user:create <email>   |   vp run async:user:delete <email>
//   node scripts/user.ts <create|delete> <email>
//
// Chapter 07's script, pointed at this chapter's stack: the two stacks have
// separate user pools. Cognito emails the temporary password; this never sees one.
import { spawnSync } from "node:child_process";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { z } from "zod";

const STACK = "AihAsync";
const [action, emailArg] = process.argv.slice(2);
const email = z.email().safeParse(emailArg);
if ((action !== "create" && action !== "delete") || !email.success) {
  console.error("usage: user.ts <create|delete> <email>");
  process.exit(64);
}

try {
  const { target } = await preflight({ access: "mutate", action: `${action} user ${email.data}`, stack: STACK });
  const userPoolId = requireOutput(await readStackOutputs(process.cwd(), STACK, target.region), "UserPoolId");
  const common = ["--region", target.region, "--user-pool-id", userPoolId, "--username", email.data];
  const args =
    action === "create"
      ? [
          "cognito-idp",
          "admin-create-user",
          ...common,
          "--user-attributes",
          `Name=email,Value=${email.data}`,
          "Name=email_verified,Value=true",
          "--desired-delivery-mediums",
          "EMAIL",
        ]
      : ["cognito-idp", "admin-delete-user", ...common];
  console.error(`$ aws ${args.join(" ")}`);
  process.exit(
    spawnSync("aws", args, { stdio: ["ignore", action === "create" ? "ignore" : "inherit", "inherit"] }).status ?? 1,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
