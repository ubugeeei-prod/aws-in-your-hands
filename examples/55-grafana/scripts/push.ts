// vp run grafana:push
//   node scripts/push.ts
//
// Publishes the dashboard to the workspace of the AihGrafana stack. It reads chapter 19's
// deployed CloudWatch dashboard first and stops if the two would not show the same thing.
// CHANGES AWS: creates a service account once, and a token that it deletes again.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { agreeingDashboard } from "../src/cloudwatch.ts";
import { grafanaDashboard } from "../src/grafana.ts";
import { ensureCloudWatchDataSource, saveDashboard, tokenRequest } from "../src/provision.ts";
import { dashboardSchema } from "../src/schema.ts";
import { rows } from "../src/signals.ts";

const STACK = "AihGrafana";
const OBSERVED_STACK = "AihObservability";
const SERVICE_ACCOUNT = "aih-dashboards";

function aws(region: string, args: string[]): unknown {
  const result = spawnSync("aws", [...args, "--region", region, "--output", "json"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    // stderr only: stdout of a token call would hold the key.
    throw new Error(`aws ${args.slice(0, 2).join(" ")} failed:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

const dashboardBodySchema = v.object({ DashboardBody: v.string() });
const accountsSchema = v.object({
  serviceAccounts: v.array(v.object({ id: v.string(), name: v.string() })),
});
const accountSchema = v.object({ id: v.string() });
const tokenSchema = v.object({
  serviceAccountToken: v.object({ id: v.string(), key: v.pipe(v.string(), v.minLength(1)) }),
});

try {
  const { target } = await preflight({
    access: "mutate",
    action: "publish the dashboard to the Grafana workspace",
    stack: STACK,
  });
  const region = target.region;

  const observed = await readStackOutputs(resolve("../19-observability"), OBSERVED_STACK, region);
  const live = v.parse(
    dashboardBodySchema,
    aws(region, [
      "cloudwatch",
      "get-dashboard",
      "--dashboard-name",
      requireOutput(observed, "DashboardName"),
    ]),
  );
  // Throws when chapter 19's dashboard is not what src/signals.ts describes.
  const deployed = agreeingDashboard(rows, JSON.parse(live.DashboardBody));

  const outputs = await readStackOutputs(process.cwd(), STACK, region);
  const workspaceId = requireOutput(outputs, "WorkspaceId");
  const endpoint = requireOutput(outputs, "WorkspaceEndpoint");

  const workspace = ["--workspace-id", workspaceId];
  const accounts = v.parse(
    accountsSchema,
    aws(region, ["grafana", "list-workspace-service-accounts", ...workspace]),
  );
  const serviceAccountId =
    accounts.serviceAccounts.find((account) => account.name === SERVICE_ACCOUNT)?.id ??
    v.parse(
      accountSchema,
      aws(region, [
        "grafana",
        "create-workspace-service-account",
        ...workspace,
        "--name",
        SERVICE_ACCOUNT,
        // Admin: adding a data source needs it. The token below is what keeps the reach short.
        "--grafana-role",
        "ADMIN",
      ]),
    ).id;

  const request = tokenRequest(new Date());
  const account = [...workspace, "--service-account-id", serviceAccountId];
  const { serviceAccountToken } = v.parse(
    tokenSchema,
    aws(region, [
      "grafana",
      "create-workspace-service-account-token",
      ...account,
      "--name",
      request.name,
      "--seconds-to-live",
      String(request.secondsToLive),
    ]),
  );
  try {
    const api = { endpoint, token: serviceAccountToken.key, fetch };
    const datasourceUid = await ensureCloudWatchDataSource(api, deployed.region);
    const dashboard = v.parse(
      dashboardSchema,
      grafanaDashboard(rows, { ...deployed, datasourceUid }),
    );
    const saved = await saveDashboard(api, dashboard, "vp run grafana:push");
    console.log(`saved version ${String(saved.version)}: ${saved.url}`);
  } finally {
    // An expired token still counts toward the 100 a workspace may hold.
    aws(region, [
      "grafana",
      "delete-workspace-service-account-token",
      ...account,
      "--token-id",
      serviceAccountToken.id,
    ]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
