// What the Elastic Disaster Recovery guide says a source server has to be, as read on
// 2026-10-13. A model of the documentation: the installer is the authority, and it was not run.

// #region source
export type SourceFacts = {
  os: "amazon-linux-2023" | "other";
  /** `uname -r`, or just its first two numbers: "6.12". */
  kernel: string;
  /** `uname -m`. */
  architecture: "aarch64" | "x86_64";
  /** Where the server runs. arm64 is supported only for EC2 recovering to AWS. */
  origin: "ec2" | "elsewhere";
  /** Disks that are attached, formatted, and mounted. Others are not replicated. */
  mountedDisks: number;
};

export type SourceFinding = { level: "blocker" | "note"; message: string };

/** "Amazon Linux 2023 is supported up to kernel version 6.12." */
export const MAX_AL2023_KERNEL = { major: 6, minor: 12 } as const;

export function kernelVersion(kernel: string): { major: number; minor: number } | null {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(kernel);
  return match === null ? null : { major: Number(match[1]), minor: Number(match[2]) };
}

export function checkSource(facts: SourceFacts): SourceFinding[] {
  const findings: SourceFinding[] = [];
  if (facts.os !== "amazon-linux-2023") {
    findings.push({
      level: "note",
      message: "This check knows Amazon Linux 2023 only. Read the supported Linux list.",
    });
  }
  const version = kernelVersion(facts.kernel);
  if (version === null) {
    findings.push({ level: "blocker", message: `"${facts.kernel}" is not a kernel release.` });
  } else if (
    facts.os === "amazon-linux-2023" &&
    (version.major > MAX_AL2023_KERNEL.major ||
      (version.major === MAX_AL2023_KERNEL.major && version.minor > MAX_AL2023_KERNEL.minor))
  ) {
    findings.push({
      level: "blocker",
      message: `Kernel ${version.major}.${version.minor} is newer than ${MAX_AL2023_KERNEL.major}.${MAX_AL2023_KERNEL.minor}, the newest the guide lists for Amazon Linux 2023. Pin an AMI with an older kernel.`,
    });
  }
  if (facts.architecture === "aarch64" && facts.origin !== "ec2") {
    findings.push({
      level: "blocker",
      message: "arm64 is supported only for Graviton EC2 instances that recover to AWS.",
    });
  }
  if (facts.architecture === "aarch64") {
    findings.push({
      level: "note",
      message:
        "Download the linux_arm64 installer, and launch into a Graviton instance type: the launch fails on an architecture mismatch.",
    });
  }
  if (facts.mountedDisks < 1) {
    findings.push({ level: "blocker", message: "No mounted disk: nothing would be replicated." });
  }
  return findings;
}

export const blockers = (findings: SourceFinding[]): SourceFinding[] =>
  findings.filter((finding) => finding.level === "blocker");
// #endregion source
