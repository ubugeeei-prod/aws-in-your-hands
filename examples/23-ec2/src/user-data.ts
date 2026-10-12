import * as v from "valibot";

import { type MachineSpec, machineSpecSchema, pathsOf } from "./machine.ts";
import { RELEASE_FILE, RELEASE_PREFIX, VERSION_SHELL_PATTERN } from "./release.ts";
import { renderEnvFile, renderUnit } from "./unit.ts";

/** User data is limited to 16 KB before base64 encoding. */
export const USER_DATA_LIMIT_BYTES = 16 * 1024;

const HEREDOC = "AIH_EOF";

// The spec's patterns already exclude quotes. This is the second lock on the same door.
function quote(value: string): string {
  if (!/^[A-Za-z0-9._:/@=-]+$/.test(value)) {
    throw new Error(`refusing to put ${JSON.stringify(value)} into a shell script`);
  }
  return `'${value}'`;
}

/** `cat > path <<'EOF'`: the quoted delimiter stops the shell from expanding anything inside. */
function writeFile(path: string, content: string): string[] {
  const lines = content.replace(/\n$/, "").split("\n");
  if (lines.includes(HEREDOC)) {
    throw new Error(`${path} contains the here-document delimiter`);
  }
  return [`cat > ${quote(path)} <<'${HEREDOC}'`, ...lines, HEREDOC];
}

// #region data-volume
/** Formats the data volume if, and only if, it is empty; then mounts it. Safe to run again. */
export function renderDataVolumeScript(input: MachineSpec): string {
  const spec = v.parse(machineSpecSchema, input);
  return [
    "#!/bin/bash",
    "set -euo pipefail",
    "",
    `DEVICE=${quote(spec.dataDevice)}`,
    `MOUNT=${quote(spec.dataMount)}`,
    `FSTAB=${quote(spec.fstab)}`,
    `OWNER=${quote(spec.user)}`,
    "",
    "# The volume is attached after the instance has started. Wait up to five minutes for it.",
    "for _ in $(seq 1 60); do",
    '  if [ -e "$DEVICE" ]; then break; fi',
    "  sleep 5",
    "done",
    'if [ ! -e "$DEVICE" ]; then',
    '  echo "$DEVICE did not appear. Is the volume attached?" >&2',
    "  exit 1",
    "fi",
    "",
    "# blkid exits 0 when it finds a file system and 2 when it finds none.",
    "# Anything else is unknown, and an unknown volume is never formatted.",
    "status=0",
    'blkid "$DEVICE" >/dev/null 2>&1 || status=$?',
    'case "$status" in',
    '  0) echo "$DEVICE already holds a file system; keeping it" ;;',
    '  2) mkfs.xfs "$DEVICE" ;;',
    '  *) echo "blkid exited with $status; refusing to format $DEVICE" >&2; exit 1 ;;',
    "esac",
    "",
    "# By UUID: NVMe device names can change between boots.",
    'uuid="$(blkid -o value -s UUID "$DEVICE")"',
    'mkdir -p "$MOUNT"',
    'if ! grep -q "^UUID=$uuid " "$FSTAB"; then',
    "  # nofail: a missing data volume must not keep the instance from booting.",
    '  echo "UUID=$uuid $MOUNT xfs defaults,nofail 0 2" >> "$FSTAB"',
    "fi",
    'if ! mountpoint -q "$MOUNT"; then',
    '  mount "$MOUNT"',
    "fi",
    'chown "$OWNER:$OWNER" "$MOUNT"',
    'chmod 0750 "$MOUNT"',
    "",
  ].join("\n");
}
// #endregion data-volume

// #region release-script
/** `<service>-release <bucket> <version>`: fetch one release, switch to it, restart, check /health. */
export function renderReleaseScript(input: MachineSpec): string {
  const spec = v.parse(machineSpecSchema, input);
  const paths = pathsOf(spec);
  return [
    "#!/bin/bash",
    "set -euo pipefail",
    "",
    'bucket="${1:-}"',
    'version="${2:-}"',
    "# Both arrive from outside the machine. Nothing else is accepted.",
    'if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then',
    '  echo "not a bucket name" >&2; exit 64',
    "fi",
    `if [[ ! "$version" =~ ${VERSION_SHELL_PATTERN} ]]; then`,
    '  echo "not a release version" >&2; exit 64',
    "fi",
    "",
    `target=${quote(paths.releases)}/"$version"`,
    'install -d -m 0755 "$target"',
    `aws s3 cp --region ${quote(spec.region)} --only-show-errors \\`,
    `  "s3://$bucket/${RELEASE_PREFIX}$version/${RELEASE_FILE}" "$target/${RELEASE_FILE}.download"`,
    "",
    "# The version ends with the first 16 hex digits of the file's SHA-256.",
    `actual="$(sha256sum "$target/${RELEASE_FILE}.download" | cut -c1-16)"`,
    'if [ "$actual" != "${version##*-}" ]; then',
    '  echo "checksum mismatch: got $actual" >&2',
    `  rm -f "$target/${RELEASE_FILE}.download"`,
    "  exit 1",
    "fi",
    `mv "$target/${RELEASE_FILE}.download" "$target/${RELEASE_FILE}"`,
    "",
    "# rename(2) swaps the link in one step: `current` is never missing.",
    `ln -sfn "$target" ${quote(`${paths.current}.next`)}`,
    `mv -T ${quote(`${paths.current}.next`)} ${quote(paths.current)}`,
    `systemctl restart ${quote(`${spec.service}.service`)}`,
    "",
    "for _ in $(seq 1 20); do",
    `  if curl -fsS ${quote(`http://127.0.0.1:${spec.port}/health`)} >/dev/null 2>&1; then`,
    '    echo "released $version"',
    "    exit 0",
    "  fi",
    "  sleep 1",
    "done",
    'echo "the service did not answer /health after the release" >&2',
    `systemctl --no-pager --lines=20 status ${quote(`${spec.service}.service`)} >&2 || true`,
    "exit 1",
    "",
  ].join("\n");
}
// #endregion release-script

// #region user-data
/** The whole first boot. Depends on the spec alone, so the same settings always give the same script. */
export function renderUserData(input: MachineSpec): string {
  const spec = v.parse(machineSpecSchema, input);
  const paths = pathsOf(spec);
  const envDir = spec.envFile.slice(0, spec.envFile.lastIndexOf("/"));
  const script = [
    "#!/bin/bash",
    "# Runs once, as root, on the first boot. Output: /var/log/cloud-init-output.log",
    "set -euo pipefail",
    "",
    `dnf install -y ${quote(spec.nodePackage)} xfsprogs`,
    "",
    `if ! id -u ${quote(spec.user)} >/dev/null 2>&1; then`,
    `  useradd --system --no-create-home --home-dir ${quote(spec.dataMount)} --shell /sbin/nologin ${quote(spec.user)}`,
    "fi",
    `install -d -m 0755 ${quote(spec.appDir)} ${quote(paths.releases)} ${quote(envDir)}`,
    "",
    ...writeFile(spec.envFile, renderEnvFile(spec)),
    ...writeFile(paths.unit, renderUnit(spec)),
    ...writeFile(paths.volumeScript, renderDataVolumeScript(spec)),
    ...writeFile(paths.releaseScript, renderReleaseScript(spec)),
    `chmod 0755 ${quote(paths.volumeScript)} ${quote(paths.releaseScript)}`,
    "",
    "systemctl daemon-reload",
    `systemctl enable ${quote(`${spec.service}.service`)}`,
    "# Last, because it waits for the volume attachment.",
    quote(paths.volumeScript),
    'echo "user data finished"',
    "",
  ].join("\n");
  if (Buffer.byteLength(script) > USER_DATA_LIMIT_BYTES) {
    throw new Error(
      `user data is ${Buffer.byteLength(script)} bytes; the limit is ${USER_DATA_LIMIT_BYTES}`,
    );
  }
  return script;
}
// #endregion user-data
