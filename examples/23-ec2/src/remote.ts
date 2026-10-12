import { z } from "zod";

import { type MachineSpec, pathsOf } from "./machine.ts";
import { versionSchema } from "./release.ts";

// Arguments for the AWS CLI and command lines for the instance. Nothing here
// runs anything: scripts/remote.ts does, and tests read what it would run.

// #region inputs
export const instanceIdSchema = z.string().regex(/^i-[0-9a-f]{8,17}$/, "not an instance ID");
export const bucketNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "not a bucket name");
/** An Amazon Linux 2023 release, as `dnf check-release-update` prints it. Never "latest". */
export const releaseverSchema = z
  .string()
  .regex(/^2023\.\d{1,2}\.\d{8}$/, "not an AL2023 release version");
// #endregion inputs

// #region commands
/** Shell lines for Run Command. Each one is built from validated pieces only. */
export function remoteCommands(spec: MachineSpec) {
  const paths = pathsOf(spec);
  const unit = `${spec.service}.service`;
  return {
    status: (): string[] => [
      "cloud-init status --long || true",
      `systemctl is-enabled ${unit} || true`,
      `systemctl is-active ${unit} || true`,
      `findmnt --noheadings --output SOURCE,TARGET,FSTYPE ${spec.dataMount} || echo "${spec.dataMount} is not mounted"`,
      `readlink ${paths.current} || echo "no release yet"`,
    ],
    release: (bucket: string, version: string): string[] => [
      `${paths.releaseScript} ${bucketNameSchema.parse(bucket)} ${versionSchema.parse(version)}`,
    ],
    smoke: (): string[] => [
      "set -euo pipefail",
      `curl -fsS http://127.0.0.1:${spec.port}/health`,
      "echo",
      `curl -fsS -X POST http://127.0.0.1:${spec.port}/notes -H 'content-type: application/json' -d '{"title":"smoke"}'`,
      "echo",
      `curl -fsS http://127.0.0.1:${spec.port}/notes`,
      "echo",
    ],
    logs: (): string[] => [`journalctl --unit ${unit} --no-pager --lines 50`],
    // Before the stack is destroyed or the volume is detached: a mounted volume does not detach cleanly.
    unmount: (): string[] => [
      "set -euo pipefail",
      `systemctl stop ${unit}`,
      "sync",
      `umount ${spec.dataMount}`,
    ],
    // The same script as on the first boot: it never formats a volume that holds a file system.
    mount: (): string[] => ["set -euo pipefail", paths.volumeScript, `systemctl start ${unit}`],
    patchCheck: (): string[] => [
      "rpm -q system-release",
      "dnf check-release-update || true",
      "uname -r",
    ],
    patchApply: (releasever: string): string[] => [
      "set -euo pipefail",
      `dnf upgrade -y --releasever=${releaseverSchema.parse(releasever)}`,
      "rpm -q system-release",
      'echo "running kernel: $(uname -r); reboot if a newer kernel was installed"',
    ],
  };
}
// #endregion commands

// #region cli
const at = (region: string) => ["--region", region, "--output", "json"];

/** `aws ssm send-command` with AWS-RunShellScript. The command lines travel as JSON, not through a shell. */
export const sendCommandArgs = (input: {
  instanceId: string;
  region: string;
  commands: string[];
  comment: string;
}) => [
  "ssm",
  "send-command",
  "--instance-ids",
  instanceIdSchema.parse(input.instanceId),
  "--document-name",
  "AWS-RunShellScript",
  "--comment",
  input.comment,
  "--parameters",
  JSON.stringify({ commands: input.commands }),
  ...at(input.region),
];

export const commandResultArgs = (input: {
  commandId: string;
  instanceId: string;
  region: string;
}) => [
  "ssm",
  "get-command-invocation",
  "--command-id",
  input.commandId,
  "--instance-id",
  instanceIdSchema.parse(input.instanceId),
  ...at(input.region),
];

/** An interactive shell. Needs the Session Manager plugin on your machine. */
export const sessionArgs = (input: { instanceId: string; region: string }) => [
  "ssm",
  "start-session",
  "--target",
  instanceIdSchema.parse(input.instanceId),
  "--region",
  input.region,
];

/** localhost:<port> on your machine becomes 127.0.0.1:<port> on the instance. */
export const forwardArgs = (input: { instanceId: string; region: string; port: number }) => [
  ...sessionArgs(input),
  "--document-name",
  "AWS-StartPortForwardingSession",
  "--parameters",
  JSON.stringify({ portNumber: [String(input.port)], localPortNumber: [String(input.port)] }),
];

export const uploadArgs = (input: {
  file: string;
  bucket: string;
  key: string;
  region: string;
}) => [
  "s3",
  "cp",
  input.file,
  `s3://${bucketNameSchema.parse(input.bucket)}/${input.key}`,
  "--region",
  input.region,
  "--only-show-errors",
];
// #endregion cli

// #region results
export const sentCommandSchema = z.object({ Command: z.object({ CommandId: z.string().min(1) }) });

export const invocationSchema = z.object({
  Status: z.string(),
  ResponseCode: z.number().optional(),
  StandardOutputContent: z.string().default(""),
  StandardErrorContent: z.string().default(""),
});
export type Invocation = z.infer<typeof invocationSchema>;

const RUNNING = new Set(["Pending", "InProgress", "Delayed", "Cancelling"]);
export const isFinished = (invocation: Invocation): boolean => !RUNNING.has(invocation.Status);
export const succeeded = (invocation: Invocation): boolean =>
  invocation.Status === "Success" && invocation.ResponseCode === 0;

export const instanceInformationSchema = z.object({
  InstanceInformationList: z.array(
    z.object({
      InstanceId: z.string(),
      PingStatus: z.string(),
      AgentVersion: z.string().optional(),
      PlatformName: z.string().optional(),
      PlatformVersion: z.string().optional(),
    }),
  ),
});
// #endregion results
