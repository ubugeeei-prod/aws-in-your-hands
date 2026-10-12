import { parseEc2Config } from "@aih/example-23-ec2/src/config.ts";
import { machineFor as notesMachine } from "@aih/example-23-ec2/src/machine.ts";
import {
  renderDataVolumeScript,
  USER_DATA_LIMIT_BYTES,
} from "@aih/example-23-ec2/src/user-data.ts";

import { REGION } from "./config.ts";
import { ec2Cluster, masterFlags, NODE_NAMES, tserverFlags } from "./topology.ts";
import { assetOf, RELEASE } from "./yugabyte.ts";

// Every value below ends up inside a shell script or a systemd file that runs
// as root. They are constants of this file: nothing from outside reaches them.

// #region spec
export const NODE = {
  region: REGION,
  user: "yugabyte",
  dataDevice: "/dev/sdf",
  /** The data volume. Releases live on it too: the root volume of the image is 8 GiB. */
  mount: "/var/lib/yugabyte",
  dataDir: "/var/lib/yugabyte/data",
  releases: "/var/lib/yugabyte/releases",
  current: "/var/lib/yugabyte/current",
  confDir: "/etc/yugabyte",
  certsDir: "/etc/yugabyte/certs",
  artifactPrefix: "artifacts",
  backupPrefix: "backups",
  scripts: {
    volume: "/usr/local/sbin/yb-data-volume",
    install: "/usr/local/sbin/yb-install",
    configure: "/usr/local/sbin/yb-configure",
    csr: "/usr/local/sbin/yb-csr",
    certificate: "/usr/local/sbin/yb-certificate",
  },
} as const;

export const ARTIFACT_TARGET = "el8-aarch64";
export const artifactKey = (): string =>
  `${NODE.artifactPrefix}/${RELEASE.version}/${assetOf(ARTIFACT_TARGET).file}`;
// #endregion spec

const HEREDOC = "AIH_EOF";

function writeFile(target: string, content: string): string[] {
  const lines = content.replace(/\n$/, "").split("\n");
  if (lines.includes(HEREDOC)) {
    throw new Error(`${target} contains the here-document delimiter`);
  }
  return [`cat > '${target}' <<'${HEREDOC}'`, ...lines, HEREDOC];
}

// #region unit
export function renderUnit(process: "master" | "tserver"): string {
  return [
    "[Unit]",
    `Description=YugabyteDB yb-${process} (AWS in Your Hands, chapter 66)`,
    "After=network-online.target chronyd.service",
    "Wants=network-online.target",
    // Without the data volume the database would start empty on the root volume.
    `RequiresMountsFor=${NODE.mount}`,
    `AssertPathIsMountPoint=${NODE.mount}`,
    // Not installed or not configured yet: skip quietly instead of failing at every boot.
    `ConditionPathExists=${NODE.current}/bin/yb-${process}`,
    `ConditionPathExists=${NODE.confDir}/${process}.conf`,
    "StartLimitIntervalSec=0",
    "",
    "[Service]",
    "Type=simple",
    `User=${NODE.user}`,
    `Group=${NODE.user}`,
    // "+" runs this one line as root. The documentation asks for transparent hugepages to be on.
    "ExecStartPre=+/bin/sh -c 'echo always > /sys/kernel/mm/transparent_hugepage/enabled'",
    `ExecStart=${NODE.current}/bin/yb-${process} --flagfile ${NODE.confDir}/${process}.conf`,
    // The documentation asks for something that restarts the process when it goes down.
    "Restart=always",
    "RestartSec=5",
    "KillSignal=SIGTERM",
    "TimeoutStopSec=60",
    // The limits the documentation lists for a node, in systemd's spelling.
    "LimitNOFILE=1048576",
    "LimitNPROC=12000",
    "LimitCORE=infinity",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
}
// #endregion unit

/** The data volume script is chapter 23's, with this chapter's device, mount point, and owner. */
export function renderVolumeScript(): string {
  return renderDataVolumeScript({
    ...notesMachine(parseEc2Config({})),
    service: "yugabyte",
    user: NODE.user,
    dataDevice: NODE.dataDevice,
    dataMount: NODE.mount,
  });
}

// #region install
/**
 * Fetches an archive from the bucket, checks it, unpacks it, and points
 * `current` at it. The version and the digest are arguments, so that a new
 * release changes no user data and replaces no instance.
 */
export function renderInstallScript(): string {
  const target = `${NODE.releases}/"$version"`;
  const download = `'${NODE.releases}/download.tar.gz'`;
  return [
    "#!/bin/bash",
    "set -euo pipefail",
    "",
    'bucket="${1:-}"; version="${2:-}"; build="${3:-}"; digest="${4:-}"',
    "# All four arrive from outside the machine. Nothing else is accepted.",
    'if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then',
    '  echo "not a bucket name" >&2; exit 64',
    "fi",
    'if [[ ! "$version" =~ ^[0-9]{4}(\\.[0-9]+){3}$ || ! "$build" =~ ^b[0-9]+$ ]]; then',
    '  echo "not a release" >&2; exit 64',
    "fi",
    'if [[ ! "$digest" =~ ^[0-9a-f]{64}$ ]]; then',
    '  echo "not a SHA-256" >&2; exit 64',
    "fi",
    "",
    `install -d -m 0755 -o '${NODE.user}' -g '${NODE.user}' '${NODE.releases}' '${NODE.dataDir}'`,
    `aws s3 cp --region '${NODE.region}' --only-show-errors \\`,
    `  "s3://$bucket/${NODE.artifactPrefix}/$version/yugabyte-$version-$build-${ARTIFACT_TARGET}.tar.gz" ${download}`,
    "",
    "# The digest comes from the repository, by way of the caller. It is not read from the bucket.",
    `actual="$(sha256sum ${download} | cut -d" " -f1)"`,
    'if [ "$actual" != "$digest" ]; then',
    '  echo "checksum mismatch: got $actual" >&2',
    `  rm -f ${download}`,
    "  exit 1",
    "fi",
    `rm -rf ${target}.new`,
    `mkdir ${target}.new`,
    `tar -xzf ${download} -C ${target}.new --strip-components=1`,
    `rm -f ${download}`,
    "# The documentation has this run once after the archive is extracted on Linux.",
    `${target}.new/bin/post_install.sh`,
    `chown -R '${NODE.user}:${NODE.user}' ${target}.new`,
    `rm -rf ${target}`,
    `mv ${target}.new ${target}`,
    "",
    "# rename(2) swaps the link in one step: `current` is never missing.",
    `ln -sfn ${target} '${NODE.current}.next'`,
    `mv -T '${NODE.current}.next' '${NODE.current}'`,
    'echo "installed yugabyte-$version; no service was restarted"',
    "",
  ].join("\n");
}
// #endregion install

const IMDS = [
  "# IMDSv2: a session token first, then what this instance is.",
  "token=\"$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 'http://169.254.169.254/latest/api/token')\"",
  'imds() { curl -fsS -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/meta-data/$1"; }',
];
const IPV4 = "^[0-9]{1,3}(\\.[0-9]{1,3}){3}$";

// #region configure
/** Writes the two flag files of this node from the three addresses of the cluster. */
export function renderConfigureScript(): string {
  const cluster = ec2Cluster({
    region: NODE.region,
    dataDir: NODE.dataDir,
    certsDir: NODE.certsDir,
  });
  const flagFile = (process: "master" | "tserver", lines: string[]): string[] => [
    // Unquoted delimiter: the shell fills in ${ADDR_A}, ${ADDR_B}, ${ADDR_C} and ${ZONE}.
    `    cat > '${NODE.confDir}/${process}.conf' <<FLAGS`,
    ...lines,
    "FLAGS",
  ];
  return [
    "#!/bin/bash",
    "set -euo pipefail",
    "",
    'NODE="${1:-}"; ADDR_A="${2:-}"; ADDR_B="${3:-}"; ADDR_C="${4:-}"',
    'for address in "$ADDR_A" "$ADDR_B" "$ADDR_C"; do',
    `  if [[ ! "$address" =~ ${IPV4} ]]; then`,
    '    echo "not an IPv4 address: $address" >&2; exit 64',
    "  fi",
    "done",
    ...IMDS,
    'ZONE="$(imds placement/availability-zone)"',
    'if [[ ! "$ZONE" =~ ^[a-z0-9-]+$ ]]; then',
    '  echo "could not read the zone from instance metadata" >&2; exit 1',
    "fi",
    "",
    'case "$NODE" in',
    ...NODE_NAMES.flatMap((name) => [
      `  ${name})`,
      ...flagFile("master", masterFlags(cluster, name)),
      ...flagFile("tserver", tserverFlags(cluster, name)),
      "    ;;",
    ]),
    '  *) echo "not a node name: $NODE" >&2; exit 64 ;;',
    "esac",
    `chown '${NODE.user}:${NODE.user}' '${NODE.confDir}/master.conf' '${NODE.confDir}/tserver.conf'`,
    'echo "configured node $NODE in $ZONE; no service was restarted"',
    "",
  ].join("\n");
}
// #endregion configure

// #region certificates
/** Makes this node's private key here, where it stays, and prints the signing request. */
export function renderCsrScript(): string {
  return [
    "#!/bin/bash",
    "set -euo pipefail",
    "",
    ...IMDS,
    'address="$(imds local-ipv4)"',
    `if [[ ! "$address" =~ ${IPV4} ]]; then`,
    '  echo "could not read the private address from instance metadata" >&2; exit 1',
    "fi",
    `install -d -m 0700 -o '${NODE.user}' -g '${NODE.user}' '${NODE.certsDir}'`,
    "umask 077",
    `openssl req -new -newkey rsa:2048 -nodes -sha256 -subj "/O=AWS in Your Hands/CN=$address" \\`,
    `  -keyout '${NODE.certsDir}/node.'"$address"'.key' -out '${NODE.certsDir}/node.csr' 2>/dev/null`,
    `chown '${NODE.user}:${NODE.user}' '${NODE.certsDir}/node.'"$address"'.key'`,
    `cat '${NODE.certsDir}/node.csr'`,
    "",
  ].join("\n");
}

/** Stores the signed certificate and the CA's. Both are public; they arrive as base64 on the command line. */
export function renderCertificateScript(): string {
  return [
    "#!/bin/bash",
    "set -euo pipefail",
    "",
    'certificate="${1:-}"; ca="${2:-}"',
    'for value in "$certificate" "$ca"; do',
    '  if [[ ! "$value" =~ ^[A-Za-z0-9+/=]+$ ]]; then',
    '    echo "not base64" >&2; exit 64',
    "  fi",
    "done",
    ...IMDS,
    'address="$(imds local-ipv4)"',
    `key='${NODE.certsDir}/node.'"$address"'.key'`,
    `crt='${NODE.certsDir}/node.'"$address"'.crt'`,
    'echo "$certificate" | base64 -d > "$crt.new"',
    `echo "$ca" | base64 -d > '${NODE.certsDir}/ca.crt.new'`,
    "# A certificate for another key, or from another CA, must not replace a working one.",
    `openssl verify -CAfile '${NODE.certsDir}/ca.crt.new' "$crt.new" >/dev/null`,
    'if [ "$(openssl x509 -in "$crt.new" -noout -pubkey | sha256sum)" != "$(openssl pkey -in "$key" -pubout | sha256sum)" ]; then',
    '  echo "the certificate does not belong to this node\'s key" >&2; exit 1',
    "fi",
    'mv "$crt.new" "$crt"',
    `mv '${NODE.certsDir}/ca.crt.new' '${NODE.certsDir}/ca.crt'`,
    `chown '${NODE.user}:${NODE.user}' "$crt" '${NODE.certsDir}/ca.crt'`,
    'echo "certificate for $address installed; expires $(openssl x509 -in "$crt" -noout -enddate | cut -d= -f2)"',
    "",
  ].join("\n");
}
// #endregion certificates

// #region user-data
/** The first boot: an account, kernel settings, the units, the scripts, the volume. No database yet. */
export function renderUserData(): string {
  const script = [
    "#!/bin/bash",
    "# Runs once, as root, on the first boot. Output: /var/log/cloud-init-output.log",
    "set -euo pipefail",
    "",
    "dnf install -y xfsprogs openssl tar gzip",
    "",
    `if ! id -u '${NODE.user}' >/dev/null 2>&1; then`,
    `  useradd --system --no-create-home --home-dir '${NODE.mount}' --shell /sbin/nologin '${NODE.user}'`,
    "fi",
    `install -d -m 0755 '${NODE.confDir}'`,
    "",
    "# The kernel settings the documentation lists for a node on a virtual machine.",
    ...writeFile(
      "/etc/sysctl.d/90-yugabyte.conf",
      ["vm.swappiness=0", "vm.max_map_count=262144"].join("\n"),
    ),
    "sysctl --system >/dev/null",
    "",
    ...writeFile("/etc/systemd/system/yb-master.service", renderUnit("master")),
    ...writeFile("/etc/systemd/system/yb-tserver.service", renderUnit("tserver")),
    ...writeFile(NODE.scripts.volume, renderVolumeScript()),
    ...writeFile(NODE.scripts.install, renderInstallScript()),
    ...writeFile(NODE.scripts.configure, renderConfigureScript()),
    ...writeFile(NODE.scripts.csr, renderCsrScript()),
    ...writeFile(NODE.scripts.certificate, renderCertificateScript()),
    `chmod 0755 ${Object.values(NODE.scripts)
      .map((path) => `'${path}'`)
      .join(" ")}`,
    "",
    "systemctl daemon-reload",
    "systemctl enable yb-master.service yb-tserver.service",
    "# Last, because it waits for the volume attachment.",
    `'${NODE.scripts.volume}'`,
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

/** The files under deploy/, by name, as they are rendered. */
export function renderedFiles(): Record<string, string> {
  return {
    "yb-master.service": renderUnit("master"),
    "yb-tserver.service": renderUnit("tserver"),
    "yb-data-volume.sh": renderVolumeScript(),
    "yb-install.sh": renderInstallScript(),
    "yb-configure.sh": renderConfigureScript(),
    "yb-csr.sh": renderCsrScript(),
    "yb-certificate.sh": renderCertificateScript(),
    "user-data.sh": renderUserData(),
  };
}
