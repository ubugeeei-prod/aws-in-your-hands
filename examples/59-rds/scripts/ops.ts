// vp run rds:db:bootstrap | rds:db:migrate | rds:db:status
//   node scripts/ops.ts <bootstrap|migrate|status>
// The database has no address outside the VPC, so this invokes the operations
// function inside it, with your own AWS credentials. Changes the database. Billed.

import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { RDS_STACK } from "../src/config.ts";
import { chapter13Migrations } from "../src/migrations.ts";
import type { Command } from "../src/ops.ts";

// The two members every database secret has, whoever created it.
const masterSecretSchema = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({
    username: v.pipe(v.string(), v.minLength(1)),
    password: v.pipe(v.string(), v.minLength(1)),
  }),
);

const action = process.argv[2];

try {
  if (action !== "bootstrap" && action !== "migrate" && action !== "status") {
    console.error("usage: ops.ts <bootstrap|migrate|status>");
    process.exit(64);
  }
  const { target } = await preflight({
    access: action === "status" ? "observe" : "mutate",
    action: `${action} the notes database on RDS`,
    stack: RDS_STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), RDS_STACK, target.region);

  let command: Command;
  switch (action) {
    case "bootstrap": {
      // The one moment the master password is used. It goes from Secrets Manager,
      // through this process, into one invocation, and is stored nowhere on the way.
      const secret = await new SecretsManagerClient({ region: target.region }).send(
        new GetSecretValueCommand({ SecretId: requireOutput(outputs, "MasterSecretArn") }),
      );
      command = { action, master: v.parse(masterSecretSchema, secret.SecretString) };
      break;
    }
    case "migrate":
      command = { action, migrations: chapter13Migrations() };
      break;
    case "status":
      command = { action };
      break;
  }

  const response = await new LambdaClient({ region: target.region }).send(
    new InvokeCommand({
      FunctionName: requireOutput(outputs, "OpsFunctionName"),
      Payload: new TextEncoder().encode(JSON.stringify(command)),
    }),
  );
  const answer = new TextDecoder().decode(response.Payload);
  if (response.FunctionError !== undefined) {
    throw new Error(`The operations function failed: ${answer}`);
  }
  console.log(answer);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
