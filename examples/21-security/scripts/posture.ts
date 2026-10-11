// vp run sec:posture
//   node scripts/posture.ts
// Reads which account-level protections are on. Changes nothing. Exits 1 when
// a control that costs nothing (the root user's MFA and access keys) is off or
// could not be read.
import { preflight } from "@aih/tools/aws/preflight.ts";
import { CloudTrailClient, DescribeTrailsCommand, GetTrailStatusCommand } from "@aws-sdk/client-cloudtrail";
import { ConfigServiceClient, DescribeConfigurationRecorderStatusCommand } from "@aws-sdk/client-config-service";
import { GetDetectorCommand, GuardDutyClient, ListDetectorsCommand } from "@aws-sdk/client-guardduty";
import { GetAccountSummaryCommand, IAMClient } from "@aws-sdk/client-iam";
import { BatchGetAccountStatusCommand, Inspector2Client } from "@aws-sdk/client-inspector2";
import { DescribeOrganizationCommand, OrganizationsClient } from "@aws-sdk/client-organizations";
import { z } from "zod";
import { assess, failing, type Snapshot, snapshotSchema, type Tier } from "../src/posture.ts";

/** One failed read must not hide the others, and must not be reported as "off". */
async function probe<T>(read: () => Promise<T>): Promise<{ read: true; value: T } | { read: false; reason: string }> {
  try {
    return { read: true, value: await read() };
  } catch (error) {
    return { read: false, reason: error instanceof Error ? error.name : "unknown error" };
  }
}

try {
  const { target } = await preflight({ access: "observe", action: "read account-level security settings" });
  const region = target.region;

  // #region collect
  const snapshot: Snapshot = snapshotSchema.parse({
    root: await probe(async () => {
      const summary = z
        .object({ AccountMFAEnabled: z.number(), AccountAccessKeysPresent: z.number() })
        .parse((await new IAMClient({ region }).send(new GetAccountSummaryCommand({}))).SummaryMap);
      return { mfaEnabled: summary.AccountMFAEnabled === 1, accessKeysPresent: summary.AccountAccessKeysPresent > 0 };
    }),
    trails: await probe(async () => {
      const cloudtrail = new CloudTrailClient({ region });
      const { trailList } = await cloudtrail.send(new DescribeTrailsCommand({ includeShadowTrails: true }));
      const trails = z
        .array(z.object({ Name: z.string(), TrailARN: z.string(), IsMultiRegionTrail: z.boolean().default(false) }))
        .parse(trailList ?? []);
      return Promise.all(
        trails.map(async (trail) => ({
          name: trail.Name,
          multiRegion: trail.IsMultiRegionTrail,
          logging: (await cloudtrail.send(new GetTrailStatusCommand({ Name: trail.TrailARN }))).IsLogging === true,
        })),
      );
    }),
    guardDuty: await probe(async () => {
      const guardduty = new GuardDutyClient({ region });
      const ids = z.array(z.string()).parse((await guardduty.send(new ListDetectorsCommand({}))).DetectorIds ?? []);
      return Promise.all(
        ids.map(async (id) => ({
          id,
          status: z.string().parse((await guardduty.send(new GetDetectorCommand({ DetectorId: id }))).Status),
        })),
      );
    }),
    inspector: await probe(async () => {
      const response = await new Inspector2Client({ region }).send(new BatchGetAccountStatusCommand({}));
      const status = z.object({ status: z.string() });
      const state = z
        .object({ ec2: status, ecr: status, lambda: status.default({ status: "DISABLED" }) })
        .parse(response.accounts?.[0]?.resourceState);
      return { lambda: state.lambda.status, ecr: state.ecr.status, ec2: state.ec2.status };
    }),
    config: await probe(async () => {
      const response = await new ConfigServiceClient({ region }).send(
        new DescribeConfigurationRecorderStatusCommand({}),
      );
      return z
        .array(z.object({ name: z.string(), recording: z.boolean() }))
        .parse(response.ConfigurationRecordersStatus ?? []);
    }),
    organization: await probe(async () => {
      try {
        // Organizations is a global service with its endpoint in us-east-1.
        const response = await new OrganizationsClient({ region: "us-east-1" }).send(
          new DescribeOrganizationCommand({}),
        );
        return { member: true, allFeatures: response.Organization?.FeatureSet === "ALL" };
      } catch (error) {
        if (error instanceof Error && error.name === "AWSOrganizationsNotInUseException") {
          return { member: false, allFeatures: false };
        }
        throw error;
      }
    }),
  });
  // #endregion collect

  const items = assess(snapshot);
  const titles: Record<Tier, string> = {
    everyone: "Everyone, from day one (free)",
    "with-data": "Once the account holds something worth stealing (billed by usage)",
    organization: "Once more than one person or account is involved",
  };
  for (const [tier, title] of Object.entries(titles)) {
    console.log(`\n${title}`);
    for (const entry of items.filter((candidate) => candidate.tier === tier)) {
      console.log(`  ${entry.state.padEnd(7)} ${entry.id.padEnd(26)} ${entry.note} [${entry.charge}]`);
    }
  }
  console.log(`\nregion ${region}; GuardDuty, Inspector, and AWS Config are switched on per Region`);

  const problems = failing(items);
  if (problems.length > 0) {
    console.error(`\nFAIL ${problems.map((entry) => `${entry.id} is ${entry.state}`).join("; ")}`);
    process.exit(1);
  }
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
