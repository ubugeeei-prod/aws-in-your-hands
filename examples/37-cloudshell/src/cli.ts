// node aih-cloudshell.mjs <whoami|budget|left|empty> [options]
//
// Built into one file by scripts/build.ts, uploaded to CloudShell, and run there with the
// Node.js and the AWS CLI that are already installed. On a laptop it runs the same way.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { checkTarget, DEFAULT_REGION, type Identity, type Target } from "@aih/tools/aws/target.ts";

import { budgetReport, budgetSchema, callerSchema, identityOf, renderBudget } from "./account.ts";
import { aws, bucketIo, parseOutput } from "./aws-cli.ts";
import {
  budgetArgs,
  identityArgs,
  stateBodyArgs,
  stateBucketOf,
  stateKeysArgs,
} from "./commands.ts";
import { countBucket, emptyBucket, refusal } from "./empty.ts";
import { renderLeft, stateKeysSchema, stateRefs, stateSchema, summarize } from "./stacks.ts";

const USAGE = `usage: node aih-cloudshell.mjs <command> [options]

  whoami                      which identity and account this shell acts as (reads AWS)
  budget [--name aih-monthly] the budget from chapter 01: limit, spend, forecast (reads AWS)
  left                        the stacks cdkd still records, and what is billed while idle (reads AWS)
  empty <bucket>              count every version in a bucket (reads AWS)
  empty <bucket> --yes        delete every version in it (changes AWS; needs --account)

  --account <12 digits>       the only account this may act on (or AIH_AWS_ACCOUNT_ID)
  --region <region>           where the book's stacks are (default ${DEFAULT_REGION}, or AIH_AWS_REGION)`;

// #region guard
// The bundle is built for Node.js 18. CloudShell's version is not documented, so say so here.
const major = Number(process.versions.node.split(".")[0]);
if (major < 18) {
  console.error(`This needs Node.js 18 or later; this shell has ${process.version}.`);
  process.exit(1);
}
// #endregion guard

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    account: { type: "string" },
    region: { type: "string" },
    name: { type: "string", default: "aih-monthly" },
    yes: { type: "boolean", default: false },
  },
});
const [command, argument] = positionals;

// #region target
const accountSchema = v.optional(v.pipe(v.string(), v.regex(/^\d{12}$/, "not an account ID")));
const regionSchema = v.pipe(v.string(), v.regex(/^[a-z]{2}(-[a-z]+)+-\d$/, "not a Region"));

async function identify(access: "observe" | "mutate", action: string) {
  const target: Target = {
    region: v.parse(regionSchema, values.region ?? process.env["AIH_AWS_REGION"] ?? DEFAULT_REGION),
    expectedAccountId: v.parse(accountSchema, values.account ?? process.env["AIH_AWS_ACCOUNT_ID"]),
  };
  const identity: Identity = identityOf(parseOutput(callerSchema, await aws(identityArgs())));
  console.log(
    [
      `action:  ${action} (${access === "mutate" ? "changes AWS" : "reads AWS"})`,
      `account: ${identity.accountId}`,
      `region:  ${target.region}`,
      `caller:  ${identity.arn}`,
    ].join("\n"),
  );
  // The same check as every task on the laptop: the wrong account stops here.
  if (access === "mutate" && target.expectedAccountId === undefined) {
    throw new Error(
      `Name the account this may change: pass --account ${identity.accountId} if that is the one.`,
    );
  }
  const check = checkTarget(target, identity, access);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  return { target, identity };
}
// #endregion target

// #region commands
async function main(): Promise<number> {
  switch (command) {
    case "whoami": {
      await identify("observe", "identify credentials");
      return 0;
    }
    case "budget": {
      const { identity } = await identify("observe", `read budget ${values.name}`);
      const answer = parseOutput(
        budgetSchema,
        await aws(budgetArgs(identity.accountId, values.name)),
      );
      console.log(renderBudget(budgetReport(answer)).join("\n"));
      return 0;
    }
    case "left": {
      const { target, identity } = await identify("observe", "list what cdkd still records");
      const bucket = stateBucketOf(identity.accountId);
      const refs = stateRefs(
        parseOutput(stateKeysSchema, await aws(stateKeysArgs(bucket, target.region))),
      );
      const summaries = [];
      for (const ref of refs) {
        const body = await aws(stateBodyArgs(bucket, ref.key, target.region));
        summaries.push(summarize(ref, parseOutput(stateSchema, body)));
      }
      console.log(renderLeft(bucket, summaries).join("\n"));
      return 0;
    }
    case "empty": {
      if (argument === undefined) {
        throw new Error("empty needs a bucket name.");
      }
      const refused = refusal(argument);
      if (refused !== undefined) {
        throw new Error(refused);
      }
      const access = values.yes ? "mutate" : "observe";
      const { target, identity } = await identify(
        access,
        `${values.yes ? "delete" : "count"} every version in ${argument}`,
      );
      const io = bucketIo(aws, {
        bucket: argument,
        region: target.region,
        accountId: identity.accountId,
      });
      if (!values.yes) {
        const count = await countBucket(io);
        console.log(
          `bucket: ${argument}, versions: ${count.versions}, delete markers: ${count.deleteMarkers}, bytes: ${count.bytes}`,
        );
        console.log("Nothing was deleted. Pass --yes and --account to delete all of it.");
        return 0;
      }
      const emptied = await emptyBucket(io);
      console.log(`deleted: ${emptied.deleted} in ${emptied.rounds} rounds`);
      for (const error of emptied.failed) {
        console.error(
          `not deleted: ${error.Key} ${error.VersionId ?? ""} ${error.Code} ${error.Message}`,
        );
      }
      if (emptied.failed.length > 0) {
        console.error("Fix the cause and run the same command again: it starts from what is left.");
        return 1;
      }
      return 0;
    }
    default: {
      console.error(USAGE);
      return command === undefined || command === "help" ? 0 : 64;
    }
  }
}
// #endregion commands

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
