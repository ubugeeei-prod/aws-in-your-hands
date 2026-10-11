// vp run account:budget:create / account:budget:delete
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { preflight } from "./preflight.ts";

const [action, directory] = process.argv.slice(2);
if ((action !== "create" && action !== "delete") || directory === undefined) {
  console.error("usage: budget.ts <create|delete> <directory>");
  process.exit(64);
}

const budgetSchema = z.looseObject({
  BudgetName: z.string().min(1),
  BudgetLimit: z.object({ Amount: z.string().regex(/^\d+(\.\d+)?$/), Unit: z.literal("USD") }),
});

try {
  const budgetPath = resolve(directory, "budget.json");
  const budget = budgetSchema.parse(JSON.parse(readFileSync(budgetPath, "utf8")));
  const { identity } = await preflight({ access: "mutate", action: `${action} budget ${budget.BudgetName}` });

  // Budgets is account-wide; its API endpoint is in us-east-1.
  const base = ["budgets", `${action}-budget`, "--region", "us-east-1", "--account-id", identity.accountId];
  let args: string[];
  if (action === "create") {
    const notificationsPath = resolve(directory, "notifications.json");
    if (!existsSync(notificationsPath)) {
      throw new Error(`${notificationsPath} does not exist. Copy notifications.example.json and set your address.`);
    }
    if (readFileSync(notificationsPath, "utf8").includes("you@example.com")) {
      throw new Error(
        "notifications.json still contains you@example.com. A budget that notifies nobody is not a guard.",
      );
    }
    args = [
      ...base,
      "--budget",
      `file://${budgetPath}`,
      "--notifications-with-subscribers",
      `file://${notificationsPath}`,
    ];
  } else {
    args = [...base, "--budget-name", budget.BudgetName];
  }
  console.error(`$ aws ${args.join(" ")}`);
  process.exit(spawnSync("aws", args, { stdio: "inherit" }).status ?? 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
