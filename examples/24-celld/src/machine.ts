import { parseEc2Config } from "@aih/example-23-ec2/src/config.ts";
import { machineFor as notesMachine } from "@aih/example-23-ec2/src/machine.ts";
import { renderDataVolumeScript } from "@aih/example-23-ec2/src/user-data.ts";
import { z } from "zod";
import { DOCUMENTED } from "./celld.ts";
import { REGION } from "./config.ts";

// Every value below ends up inside a shell script or a systemd file that runs
// as root. The patterns leave no room for a quote, a space, or a newline.
const name = z.string().regex(/^[a-z][a-z0-9-]{0,30}$/);
const path = z
  .string()
  .regex(/^(\/[A-Za-z0-9._-]+)+$/)
  .refine((value) => !value.split("/").includes(".."), "must not contain ..");
const port = z.number().int().min(1024).max(65535);

// #region spec
export const nodeSpecSchema = z
  .object({
    region: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/),
    service: name,
    user: name,
    /** Releases are unpacked under here; `current` points at the one in use. */
    appDir: path,
    envFile: path,
    dataDevice: path,
    dataMount: path,
    /** The Worker listener. Loopback: this lab has no ingress in front of it. */
    publicPort: port,
    /** Peers and the unauthenticated operator API. Reachable from the other nodes only. */
    internalPort: port,
    /** Key prefix inside the bucket that celld owns. */
    fleetPrefix: name,
    /** Key prefix for the release archives the nodes download. */
    artifactPrefix: name,
    /** systemd's TimeoutStopSec. SIGKILL after this would cut a handoff short. */
    stopTimeoutSeconds: z.number().int().min(5).max(600),
    /** systemd's RestartSec. */
    restartDelaySeconds: z.number().int().min(1).max(600),
  })
  .superRefine((spec, context) => {
    // Both rules are celld's, from "The supervisor" and "Shut down and roll out a node".
    if (spec.stopTimeoutSeconds * 1000 <= DOCUMENTED.shutdownTotalMs) {
      context.addIssue({
        code: "custom",
        path: ["stopTimeoutSeconds"],
        message: `must be longer than CELLD_SHUTDOWN_TOTAL_MS (${DOCUMENTED.shutdownTotalMs} ms)`,
      });
    }
    if (spec.restartDelaySeconds * 1000 < DOCUMENTED.leaseTtlMs) {
      context.addIssue({
        code: "custom",
        path: ["restartDelaySeconds"],
        message: `must be at least one lease lifetime (${DOCUMENTED.leaseTtlMs} ms)`,
      });
    }
  });
export type NodeSpec = z.infer<typeof nodeSpecSchema>;
// #endregion spec

// #region defaults
export function nodeSpec(): NodeSpec {
  return nodeSpecSchema.parse({
    region: REGION,
    service: "celld",
    user: "celld",
    appDir: "/opt/celld",
    envFile: "/etc/celld/celld.env",
    dataDevice: "/dev/sdf",
    dataMount: "/var/lib/celld",
    publicPort: 8080,
    internalPort: 8081,
    fleetPrefix: "fleet",
    artifactPrefix: "artifacts",
    stopTimeoutSeconds: 60,
    restartDelaySeconds: 15,
  } satisfies NodeSpec);
}
// #endregion defaults

export const pathsOf = (spec: NodeSpec) => ({
  releases: `${spec.appDir}/releases`,
  current: `${spec.appDir}/current`,
  binary: `${spec.appDir}/current/celld`,
  /** CELLD_WATCH. Unset, celld works in a temporary directory that a reboot empties. */
  state: `${spec.dataMount}/state`,
  unit: `/etc/systemd/system/${spec.service}.service`,
  volumeScript: `/usr/local/sbin/${spec.service}-data-volume`,
  installScript: `/usr/local/sbin/${spec.service}-install`,
});

export const ARTIFACT_TARGET = "aarch64-unknown-linux-gnu";
export const artifactKey = (spec: NodeSpec, version: string, file: string): string =>
  `${spec.artifactPrefix}/${version}/${file}`;

const HEREDOC = "AIH_EOF";
const ENV_HEREDOC = "CELLD_ENV";

// The spec's patterns already exclude quotes. This is the second lock on the same door.
function quote(value: string): string {
  if (!/^[A-Za-z0-9._:/@=-]+$/.test(value)) {
    throw new Error(`refusing to put ${JSON.stringify(value)} into a shell script`);
  }
  return `'${value}'`;
}

function writeFile(target: string, content: string): string[] {
  const lines = content.replace(/\n$/, "").split("\n");
  if (lines.includes(HEREDOC)) {
    throw new Error(`${target} contains the here-document delimiter`);
  }
  return [`cat > ${quote(target)} <<'${HEREDOC}'`, ...lines, HEREDOC];
}

// #region unit
export function renderUnit(input: NodeSpec): string {
  const spec = nodeSpecSchema.parse(input);
  const paths = pathsOf(spec);
  return [
    "[Unit]",
    "Description=celld node (AWS in Your Hands, chapter 24)",
    "After=network-online.target",
    "Wants=network-online.target",
    // Without the data volume, the node's log of acknowledged writes would sit on the root volume.
    `RequiresMountsFor=${spec.dataMount}`,
    `AssertPathIsMountPoint=${spec.dataMount}`,
    // Not installed yet: skip quietly instead of failing at every boot.
    `ConditionPathExists=${paths.binary}`,
    `ConditionPathExists=${spec.envFile}`,
    // celld asks for a supervisor that restarts without an attempt limit. 0 turns the limit off.
    "StartLimitIntervalSec=0",
    "",
    "[Service]",
    "Type=simple",
    `User=${spec.user}`,
    `Group=${spec.user}`,
    `EnvironmentFile=${spec.envFile}`,
    // No arguments: celld reads everything from the environment file.
    `ExecStart=${paths.binary}`,
    // A fenced node exits with code 3 and comes back only through a restart.
    "Restart=always",
    // At least one lease lifetime, so the old lease is dead before the new process claims anything.
    `RestartSec=${spec.restartDelaySeconds}`,
    // SIGTERM starts the graceful handoff. It needs longer than CELLD_SHUTDOWN_TOTAL_MS.
    "KillSignal=SIGTERM",
    `TimeoutStopSec=${spec.stopTimeoutSeconds}`,
    "NoNewPrivileges=true",
    "ProtectSystem=strict",
    "ProtectHome=true",
    "PrivateTmp=true",
    `ReadWritePaths=${spec.dataMount}`,
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
}
// #endregion unit

// #region install-script
/**
 * `<service>-install <bucket> <version> <sha256>`: fetch one release archive from the
 * bucket, check it, unpack it, write the environment file, and point `current` at it.
 * It never starts or restarts the service: when a node goes down is the caller's decision.
 */
export function renderInstallScript(input: NodeSpec): string {
  const spec = nodeSpecSchema.parse(input);
  const paths = pathsOf(spec);
  const imds = "http://169.254.169.254/latest";
  return [
    "#!/bin/bash",
    "set -euo pipefail",
    "",
    'bucket="${1:-}"',
    'version="${2:-}"',
    'digest="${3:-}"',
    "# All three arrive from outside the machine. Nothing else is accepted.",
    'if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then',
    '  echo "not a bucket name" >&2; exit 64',
    "fi",
    'if [[ ! "$version" =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+$ ]]; then',
    '  echo "not a release tag" >&2; exit 64',
    "fi",
    'if [[ ! "$digest" =~ ^[0-9a-f]{64}$ ]]; then',
    '  echo "not a SHA-256" >&2; exit 64',
    "fi",
    "",
    `target=${quote(paths.releases)}/"$version"`,
    'install -d -m 0755 "$target"',
    `aws s3 cp --region ${quote(spec.region)} --only-show-errors \\`,
    `  "s3://$bucket/${spec.artifactPrefix}/$version/celld-${ARTIFACT_TARGET}.gz" "$target/celld.gz.download"`,
    "",
    "# The digest is pinned in the repository, not read from the bucket.",
    'actual="$(sha256sum "$target/celld.gz.download" | cut -d" " -f1)"',
    'if [ "$actual" != "$digest" ]; then',
    '  echo "checksum mismatch: got $actual" >&2',
    '  rm -f "$target/celld.gz.download"',
    "  exit 1",
    "fi",
    'gzip -dc "$target/celld.gz.download" > "$target/celld.new"',
    'chmod 0755 "$target/celld.new"',
    'mv "$target/celld.new" "$target/celld"',
    'rm -f "$target/celld.gz.download"',
    "",
    "# IMDSv2: a session token first, then the address this instance has inside the VPC.",
    `token="$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' ${quote(`${imds}/api/token`)})"`,
    `address="$(curl -fsS -H "X-aws-ec2-metadata-token: $token" ${quote(`${imds}/meta-data/local-ipv4`)})"`,
    'if [[ ! "$address" =~ ^[0-9]{1,3}(\\.[0-9]{1,3}){3}$ ]]; then',
    '  echo "could not read the private address from instance metadata" >&2; exit 1',
    "fi",
    "",
    `install -d -m 0750 -o ${quote(spec.user)} -g ${quote(spec.user)} ${quote(paths.state)}`,
    // Unquoted delimiter: $bucket and $address expand. Both passed a pattern above.
    `cat > ${quote(`${spec.envFile}.next`)} <<${ENV_HEREDOC}`,
    `CELLD_BUCKET=s3://$bucket/${spec.fleetPrefix}`,
    `AWS_REGION=${spec.region}`,
    `CELLD_ADDR=127.0.0.1:${spec.publicPort}`,
    `CELLD_INTERNAL_ADDR=$address:${spec.internalPort}`,
    `CELLD_ADVERTISE=$address:${spec.internalPort}`,
    `CELLD_WATCH=${paths.state}`,
    ENV_HEREDOC,
    `mv ${quote(`${spec.envFile}.next`)} ${quote(spec.envFile)}`,
    "",
    "# rename(2) swaps the link in one step: `current` is never missing.",
    `ln -sfn "$target" ${quote(`${paths.current}.next`)}`,
    `mv -T ${quote(`${paths.current}.next`)} ${quote(paths.current)}`,
    `echo "installed $version at $address; ${spec.service}.service was not restarted"`,
    "",
  ].join("\n");
}
// #endregion install-script

// #region user-data
/** User data is limited to 16 KB before base64 encoding. */
export const USER_DATA_LIMIT_BYTES = 16 * 1024;

/** The data volume script is chapter 23's, with this chapter's device, mount point, and owner. */
export function renderVolumeScript(input: NodeSpec): string {
  const spec = nodeSpecSchema.parse(input);
  return renderDataVolumeScript({
    ...notesMachine(parseEc2Config({})),
    service: spec.service,
    user: spec.user,
    dataDevice: spec.dataDevice,
    dataMount: spec.dataMount,
  });
}

/** The first boot: an account, directories, the unit, two scripts, the volume. No celld, no bucket name. */
export function renderUserData(input: NodeSpec): string {
  const spec = nodeSpecSchema.parse(input);
  const paths = pathsOf(spec);
  const envDir = spec.envFile.slice(0, spec.envFile.lastIndexOf("/"));
  const script = [
    "#!/bin/bash",
    "# Runs once, as root, on the first boot. Output: /var/log/cloud-init-output.log",
    "set -euo pipefail",
    "",
    "dnf install -y xfsprogs",
    "",
    `if ! id -u ${quote(spec.user)} >/dev/null 2>&1; then`,
    `  useradd --system --no-create-home --home-dir ${quote(spec.dataMount)} --shell /sbin/nologin ${quote(spec.user)}`,
    "fi",
    `install -d -m 0755 ${quote(spec.appDir)} ${quote(paths.releases)} ${quote(envDir)}`,
    "",
    ...writeFile(paths.unit, renderUnit(spec)),
    ...writeFile(paths.volumeScript, renderVolumeScript(spec)),
    ...writeFile(paths.installScript, renderInstallScript(spec)),
    `chmod 0755 ${quote(paths.volumeScript)} ${quote(paths.installScript)}`,
    "",
    "systemctl daemon-reload",
    `systemctl enable ${quote(`${spec.service}.service`)}`,
    "# Last, because it waits for the volume attachment.",
    quote(paths.volumeScript),
    'echo "user data finished"',
    "",
  ].join("\n");
  if (Buffer.byteLength(script) > USER_DATA_LIMIT_BYTES) {
    throw new Error(`user data is ${Buffer.byteLength(script)} bytes; the limit is ${USER_DATA_LIMIT_BYTES}`);
  }
  return script;
}
// #endregion user-data

/** The files under deploy/, by name, as the default settings render them. */
export function renderedFiles(): Record<string, string> {
  const spec = nodeSpec();
  return {
    "celld.service": renderUnit(spec),
    "celld-install.sh": renderInstallScript(spec),
    "celld-data-volume.sh": renderVolumeScript(spec),
    "user-data.sh": renderUserData(spec),
  };
}
