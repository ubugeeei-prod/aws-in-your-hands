import { z } from "zod";

import { bucketNameSchema } from "@aih/example-23-ec2/src/remote.ts";

import { NODE_NAMES, type NodeName } from "./config.ts";

// What a backup and a restore consist of, as data. celld has no backup command.
// Its documentation describes one procedure: stop the whole fleet, then copy the
// bucket and every node's data directory, because a node disk can hold
// acknowledged writes that the bucket does not hold yet.

// #region manifest
export const backupIdSchema = z.string().regex(/^[0-9]{8}T[0-9]{6}Z$/, "not a backup ID");
const volumeId = z.string().regex(/^vol-[0-9a-f]{8,17}$/);
const snapshotId = z.string().regex(/^snap-[0-9a-f]{8,17}$/);

export const manifestSchema = z.object({
  id: backupIdSchema,
  createdAt: z.iso.datetime(),
  region: z.string(),
  /** Where the bucket copy came from, so a restore cannot be pointed at another fleet by accident. */
  source: z.object({
    bucket: bucketNameSchema,
    prefix: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/),
  }),
  nodes: z
    .array(
      z.object({
        node: z.enum(NODE_NAMES),
        volumeId,
        snapshotId,
        /** What `current` pointed at on that node. Restore the data under the same binary. */
        celldVersion: z
          .string()
          .regex(/^v\d+\.\d+\.\d+$/)
          .nullable(),
      }),
    )
    .min(1),
});
export type BackupManifest = z.infer<typeof manifestSchema>;

export const backupIdFor = (now: Date): string =>
  backupIdSchema.parse(
    now
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z")
      .replaceAll(/[-:]/g, ""),
  );

export const backupPrefix = (id: string): string => `backups/${backupIdSchema.parse(id)}/`;
export const manifestKey = (id: string): string => `${backupPrefix(id)}manifest.json`;
// #endregion manifest

// #region backup
export type AwsCall = { args: string[]; describe: string; destructive: boolean };

const at = (region: string) => ["--region", region, "--output", "json"];

export const snapshotArgs = (input: {
  volumeId: string;
  node: NodeName;
  id: string;
  region: string;
}): string[] => [
  "ec2",
  "create-snapshot",
  "--volume-id",
  volumeId.parse(input.volumeId),
  "--description",
  `celld node ${input.node}, backup ${backupIdSchema.parse(input.id)}`,
  "--tag-specifications",
  `ResourceType=snapshot,Tags=[{Key=aih:backup,Value=${input.id}},{Key=aih:node,Value=${input.node}}]`,
  ...at(input.region),
];

export const snapshotResultSchema = z.object({ SnapshotId: snapshotId });

export const waitSnapshotsArgs = (input: { snapshotIds: string[]; region: string }): string[] => [
  "ec2",
  "wait",
  "snapshot-completed",
  "--snapshot-ids",
  ...input.snapshotIds.map((id) => snapshotId.parse(id)),
  "--region",
  input.region,
];

/** Everything under the fleet prefix, object by object, into a prefix nothing else writes to. */
export function copyOutCall(input: {
  bucket: string;
  prefix: string;
  backupBucket: string;
  id: string;
  region: string;
}): AwsCall {
  const from = `s3://${bucketNameSchema.parse(input.bucket)}/${input.prefix}/`;
  const to = `s3://${bucketNameSchema.parse(input.backupBucket)}/${backupPrefix(input.id)}${input.prefix}/`;
  return {
    args: ["s3", "sync", from, to, "--region", input.region, "--only-show-errors"],
    describe: `copy ${from} to ${to}`,
    destructive: false,
  };
}
// #endregion backup

// #region restore
export type RestoreStep =
  | { kind: "aws"; call: AwsCall }
  | { kind: "manual"; describe: string; command: string };

/**
 * A restore puts the bucket back to the backup and gives every node the disk it had
 * then. Both halves together, or neither: a restored bucket with newer disks (or the
 * reverse) is a state celld's documentation does not describe.
 */
export function restorePlan(input: {
  manifest: BackupManifest;
  bucket: string;
  backupBucket: string;
  nodes: NodeName[];
  execute: boolean;
}): RestoreStep[] {
  const manifest = manifestSchema.parse(input.manifest);
  if (manifest.source.bucket !== input.bucket) {
    throw new Error(
      `backup ${manifest.id} was taken from ${manifest.source.bucket}, not from ${input.bucket}`,
    );
  }
  const backedUp = manifest.nodes.map((entry) => entry.node).toSorted();
  if (backedUp.join() !== input.nodes.toSorted().join()) {
    throw new Error(
      `backup ${manifest.id} holds node(s) ${backedUp.join(", ")}; the fleet has ${input.nodes.join(", ") || "none"}. Every node needs its own disk back.`,
    );
  }
  const from = `s3://${bucketNameSchema.parse(input.backupBucket)}/${backupPrefix(manifest.id)}${manifest.source.prefix}/`;
  const to = `s3://${manifest.source.bucket}/${manifest.source.prefix}/`;
  const snapshots = manifest.nodes.map((entry) => `${entry.node}:${entry.snapshotId}`).join(",");
  return [
    {
      kind: "aws",
      call: {
        // --delete: objects written after the backup go away. That is what "restore" means here.
        args: [
          "s3",
          "sync",
          from,
          to,
          "--delete",
          "--region",
          manifest.region,
          "--only-show-errors",
          ...(input.execute ? [] : ["--dryrun"]),
        ],
        describe: `make ${to} identical to the backup (writes made after ${manifest.createdAt} are lost)`,
        destructive: true,
      },
    },
    {
      kind: "manual",
      describe:
        "replace every node's data volume with one created from its snapshot. cdkd treats a volume as stateful, so the deploy asks for --force-stateful-recreation",
      command: `vp run celld:infra:deploy -c nodes=${input.nodes.length} -c dataSnapshots=${snapshots}`,
    },
  ];
}
// #endregion restore
