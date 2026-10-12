import { bucketNameSchema, instanceIdSchema } from "@aih/example-23-ec2/src/remote.ts";

import { assetOf, type CelldVersion, DOCUMENTED, versionSchema } from "./celld.ts";
import { ARTIFACT_TARGET, type NodeSpec, pathsOf } from "./machine.ts";
import { type ProbePlan, renderProbeScript } from "./probe.ts";

// Command lines for the nodes and arguments for the AWS CLI. Nothing here runs
// anything: scripts/fleet.ts does, and tests read what it would run.

// #region commands
/** Shell lines for Run Command. Each one is built from validated pieces only. */
export function nodeCommands(spec: NodeSpec) {
  const paths = pathsOf(spec);
  const unit = `${spec.service}.service`;
  // Run Command is root with an empty environment. celld's settings live in the file systemd reads.
  const withEnv = ["set -a", `. ${spec.envFile}`, "set +a"];
  const health = `http://127.0.0.1:${spec.publicPort}${DOCUMENTED.healthPath}`;
  return {
    status: (): string[] => [
      "cloud-init status --long || true",
      `systemctl is-enabled ${unit} || true`,
      `systemctl is-active ${unit} || true`,
      `findmnt --noheadings --output SOURCE,TARGET,FSTYPE ${spec.dataMount} || echo "${spec.dataMount} is not mounted"`,
      `readlink ${paths.current} || echo "celld is not installed"`,
    ],
    install: (bucket: string, version: CelldVersion): string[] => [
      `${paths.installScript} ${bucketNameSchema.parse(bucket)} ${versionSchema.parse(version)} ${assetOf(version, ARTIFACT_TARGET).sha256}`,
    ],
    start: (): string[] => [
      "set -euo pipefail",
      `systemctl start ${unit}`,
      `systemctl is-active ${unit}`,
    ],
    // SIGTERM: celld hands its cells to a peer before it exits. systemd waits TimeoutStopSec for that.
    drain: (): string[] => [
      "set -euo pipefail",
      `systemctl stop ${unit}`,
      `systemctl is-active ${unit} && exit 1 || echo "${unit} is stopped"`,
    ],
    // One line the caller parses. Exit 0 either way: an unhealthy node is an answer, not a failed command.
    health: (): string[] => [
      `echo "ACTIVE $(systemctl is-active ${unit} || true)"`,
      `echo "HEALTH $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 ${health} || true)"`,
      `echo "VERSION $(basename "$(readlink ${paths.current} || echo none)")"`,
    ],
    // The upstream counter example: each request to a name adds 1 and answers with the new value.
    smoke: (): string[] => [
      "set -euo pipefail",
      `curl -fsS ${health}`,
      "echo",
      `curl -fsS 'http://127.0.0.1:${spec.publicPort}/?name=smoke'`,
      "echo",
      `curl -fsS 'http://127.0.0.1:${spec.publicPort}/?name=smoke'`,
      "echo",
    ],
    // Reads every node lease and probes each live peer. One JSON object per check.
    diagnose: (): string[] => ["set -euo pipefail", ...withEnv, `${paths.binary} diagnose --json`],
    cells: (): string[] => ["set -euo pipefail", ...withEnv, `${paths.binary} cell list --json`],
    logs: (): string[] => [`journalctl --unit ${unit} --no-pager --lines 80`],
    // After the service has stopped: push what the page cache still holds to the volume before a snapshot.
    flush: (): string[] => [
      "set -euo pipefail",
      `systemctl is-active ${unit} && exit 1 || true`,
      "sync",
      `echo "flushed ${spec.dataMount}"`,
    ],
    probe: (plan: ProbePlan): string[] => renderProbeScript(spec, plan).split("\n"),
  };
}
// #endregion commands

// #region cli
const at = (region: string) => ["--region", region, "--output", "json"];

/** Stop without an OS shutdown: celld gets no SIGTERM, so nothing is handed off. The closest a script gets to a lost machine. */
export const killArgs = (input: { instanceId: string; region: string }) => [
  "ec2",
  "stop-instances",
  "--instance-ids",
  instanceIdSchema.parse(input.instanceId),
  "--skip-os-shutdown",
  ...at(input.region),
];

export const startInstanceArgs = (input: { instanceId: string; region: string }) => [
  "ec2",
  "start-instances",
  "--instance-ids",
  instanceIdSchema.parse(input.instanceId),
  ...at(input.region),
];

export const waitInstanceArgs = (input: {
  instanceId: string;
  region: string;
  state: "stopped" | "running";
}) => [
  "ec2",
  "wait",
  input.state === "stopped" ? "instance-stopped" : "instance-running",
  "--instance-ids",
  instanceIdSchema.parse(input.instanceId),
  "--region",
  input.region,
];

export const uploadArtifactArgs = (input: {
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
