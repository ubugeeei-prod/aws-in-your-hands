// Reads an instance type name the way the EC2 "naming conventions" page describes it.
// The tables below are that page as read on 2026-10-13. What the page does not list is
// reported as unknown, never guessed.

// #region tables
export const SERIES: Record<string, string> = {
  a: "Powered by Arm-based AWS Graviton processors",
  c: "Compute optimized",
  d: "Dense storage",
  f: "FPGA",
  g: "Graphics intensive",
  hpc: "High performance computing",
  i: "Storage optimized",
  im: "Storage optimized (1 to 4 ratio of vCPU to memory)",
  is: "Storage optimized (1 to 6 ratio of vCPU to memory)",
  inf: "AWS Inferentia",
  m: "General purpose",
  mac: "macOS",
  p: "GPU accelerated",
  r: "Memory optimized",
  t: "Burstable performance",
  trn: "AWS Trainium",
  u: "High memory",
  vt: "Video transcoding",
  x: "Memory intensive",
  z: "High memory",
};

export const PROCESSORS: Record<string, string> = {
  a: "AMD processors",
  g: "AWS Graviton processors",
  i: "Intel processors",
};

export const CAPABILITIES: Record<string, string> = {
  b: "Block storage optimization",
  d: "Instance store volumes",
  e: "Extra instance storage, extra memory, or extra GPU memory",
  n: "Network and EBS optimized",
  q: "Qualcomm inference accelerators",
  z: "High CPU frequency",
};
// #endregion tables

// #region decode
export type Option = { letters: string; meaning: string | undefined };

export type DecodedType = {
  name: string;
  series: { letters: string; meaning: string | undefined };
  generation: number;
  /** undefined: the name carries no processor letter. The page does not say what that means. */
  processor: Option | undefined;
  capabilities: Option[];
  size: string;
  bareMetal: boolean;
  /** Graviton is arm64; the Intel and AMD processors of EC2 are x86_64. undefined without a letter. */
  architecture: "arm64" | "x86_64" | undefined;
};

// Names this does not read: the high-memory `u-6tb1` and `u7i-12tb`, the Mac `mac2-m2pro`,
// and the Blackwell `p6-b200`. The page lists their options with wildcards.
const SHAPE = /^([a-z]+)(\d+)([a-z]*)(-flex)?\.([a-z0-9-]+)$/;

export function decodeInstanceType(name: string): DecodedType {
  const match = SHAPE.exec(name);
  if (match === null) {
    throw new Error(`"${name}" is not of the form <series><generation><options>.<size>`);
  }
  const [, series = "", generation = "", letters = "", flex, size = ""] = match;

  const options = [...letters];
  const first = options[0];
  // The page gives no order. In every name the EC2 guides list, a processor letter comes first.
  const processor =
    first !== undefined && first in PROCESSORS
      ? { letters: first, meaning: PROCESSORS[first] }
      : undefined;
  const capabilities: Option[] = options
    .slice(processor === undefined ? 0 : 1)
    .map((letter) => ({ letters: letter, meaning: CAPABILITIES[letter] }));
  if (flex !== undefined) {
    capabilities.push({ letters: "flex", meaning: "Flex instance" });
  }

  return {
    name,
    series: { letters: series, meaning: SERIES[series] },
    generation: Number(generation),
    processor,
    capabilities,
    size,
    bareMetal: size === "metal" || size.startsWith("metal-"),
    architecture:
      series === "a" || processor?.letters === "g"
        ? "arm64"
        : processor === undefined
          ? undefined
          : "x86_64",
  };
}

/** The parts of a name the naming page has no entry for. Empty: every part was found. */
export const unknownParts = (decoded: DecodedType): string[] => [
  ...(decoded.series.meaning === undefined ? [`series "${decoded.series.letters}"`] : []),
  ...decoded.capabilities
    .filter((option) => option.meaning === undefined)
    .map((option) => `option "${option.letters}"`),
];
// #endregion decode

// #region describe
/** One line per part, for `vp run nitro:names`. */
export function describeInstanceType(decoded: DecodedType): string[] {
  const or = (meaning: string | undefined) => meaning ?? "not on the naming page";
  return [
    decoded.name,
    `  series      ${decoded.series.letters}: ${or(decoded.series.meaning)}`,
    `  generation  ${decoded.generation}`,
    `  processor   ${
      decoded.processor === undefined
        ? "no letter in the name"
        : `${decoded.processor.letters}: ${or(decoded.processor.meaning)}`
    }`,
    ...decoded.capabilities.map(
      (option) => `  option      ${option.letters}: ${or(option.meaning)}`,
    ),
    `  size        ${decoded.size}${decoded.bareMetal ? " (bare metal: no hypervisor)" : ""}`,
    `  arch        ${decoded.architecture ?? "not in the name"}`,
  ];
}
// #endregion describe
