import {
  type AppConfigClient,
  CreateHostedConfigurationVersionCommand,
  DeleteHostedConfigurationVersionCommand,
  DeploymentState,
  ListDeploymentsCommand,
  ListHostedConfigurationVersionsCommand,
  StartDeploymentCommand,
  StopDeploymentCommand,
} from "@aws-sdk/client-appconfig";
import * as v from "valibot";

import type { FlagDocument } from "./document.ts";

type Sender = Pick<AppConfigClient, "send">;

/** The four things a flag deployment names. All come from the stack's outputs. */
export type FlagTarget = {
  applicationId: string;
  environmentId: string;
  profileId: string;
  strategyId: string;
};

const deploymentSchema = v.object({
  DeploymentNumber: v.pipe(v.number(), v.integer()),
  ConfigurationVersion: v.optional(v.string()),
  State: v.picklist(Object.values(DeploymentState)),
  PercentageComplete: v.optional(v.number()),
});
export type FlagDeployment = v.InferOutput<typeof deploymentSchema>;

// #region deploy
/**
 * Stores the document as a new version, then starts rolling that version out.
 * Two calls: a stored version changes nothing for anyone until a deployment carries it.
 */
export async function deployFlags(
  client: Sender,
  target: FlagTarget,
  document: FlagDocument,
  description: string,
): Promise<FlagDeployment> {
  const stored = await client.send(
    new CreateHostedConfigurationVersionCommand({
      ApplicationId: target.applicationId,
      ConfigurationProfileId: target.profileId,
      Content: new TextEncoder().encode(JSON.stringify(document)),
      ContentType: "application/json",
      Description: description,
    }),
  );
  const version = v.parse(v.pipe(v.number(), v.integer()), stored.VersionNumber);
  const started = await client.send(
    new StartDeploymentCommand({
      ApplicationId: target.applicationId,
      EnvironmentId: target.environmentId,
      ConfigurationProfileId: target.profileId,
      DeploymentStrategyId: target.strategyId,
      ConfigurationVersion: String(version),
      Description: description,
    }),
  );
  return v.parse(deploymentSchema, started);
}
// #endregion deploy

/** Every deployment the environment has had, newest first. */
export async function listDeployments(client: Sender, target: FlagTarget) {
  const deployments: FlagDeployment[] = [];
  let nextToken: string | undefined;
  do {
    const page = await client.send(
      new ListDeploymentsCommand({
        ApplicationId: target.applicationId,
        EnvironmentId: target.environmentId,
        NextToken: nextToken,
      }),
    );
    deployments.push(...v.parse(v.array(deploymentSchema), page.Items ?? []));
    nextToken = page.NextToken;
  } while (nextToken !== undefined);
  return deployments.toSorted((a, b) => b.DeploymentNumber - a.DeploymentNumber);
}

// #region stop
const IN_FLIGHT: string[] = [
  DeploymentState.VALIDATING,
  DeploymentState.DEPLOYING,
  DeploymentState.BAKING,
];

/** What stopping would mean for the newest deployment. A pure reading of its state. */
export function stopPlan(
  latest: FlagDeployment | undefined,
): { action: "stop" | "revert"; deployment: number } | { action: "nothing"; reason: string } {
  if (latest === undefined) {
    return { action: "nothing", reason: "no deployment has been started" };
  }
  if (IN_FLIGHT.includes(latest.State)) {
    return { action: "stop", deployment: latest.DeploymentNumber };
  }
  if (latest.State === DeploymentState.COMPLETE) {
    // Finished, so there is nothing to stop. AppConfig can still put the previous version back.
    return { action: "revert", deployment: latest.DeploymentNumber };
  }
  return { action: "nothing", reason: `deployment ${latest.DeploymentNumber} is ${latest.State}` };
}

export async function stopDeployment(
  client: Sender,
  target: FlagTarget,
  plan: { deployment: number },
): Promise<void> {
  await client.send(
    new StopDeploymentCommand({
      ApplicationId: target.applicationId,
      EnvironmentId: target.environmentId,
      DeploymentNumber: plan.deployment,
      // Without this the call only works while the state is DEPLOYING.
      AllowRevert: true,
    }),
  );
}
// #endregion stop

/** Deletes every stored version of the profile, so that nothing of this chapter is left under it. */
export async function clearVersions(client: Sender, target: FlagTarget): Promise<number[]> {
  const versions: number[] = [];
  let nextToken: string | undefined;
  do {
    const page = await client.send(
      new ListHostedConfigurationVersionsCommand({
        ApplicationId: target.applicationId,
        ConfigurationProfileId: target.profileId,
        NextToken: nextToken,
      }),
    );
    versions.push(
      ...v
        .parse(v.array(v.object({ VersionNumber: v.number() })), page.Items ?? [])
        .map((item) => item.VersionNumber),
    );
    nextToken = page.NextToken;
  } while (nextToken !== undefined);
  for (const VersionNumber of versions) {
    await client.send(
      new DeleteHostedConfigurationVersionCommand({
        ApplicationId: target.applicationId,
        ConfigurationProfileId: target.profileId,
        VersionNumber,
      }),
    );
  }
  return versions;
}
