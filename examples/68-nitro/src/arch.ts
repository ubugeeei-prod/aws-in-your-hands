// #region pairs
/**
 * The same unit on the two architectures, as IDs in data/pricing/unit-prices.json.
 * Each pair has the same vCPU count and memory; only the processor differs.
 */
export const ARCH_PAIRS = [
  {
    what: "EC2 t4g.micro and t3.micro, per hour",
    usedBy: "chapter 23",
    arm64: "ec2.t4g-micro.linux.hour",
    x86: "ec2.t3-micro.linux.hour",
  },
  {
    what: "EC2 c6g.large and c6i.large, per hour",
    usedBy: "this chapter",
    arm64: "ec2.c6g-large.linux.hour",
    x86: "ec2.c6i-large.linux.hour",
  },
  {
    what: "Fargate, per vCPU-hour",
    usedBy: "chapters 12 and 41",
    arm64: "fargate.arm.vcpu.hour",
    x86: "fargate.x86.vcpu.hour",
  },
  {
    what: "Fargate, per GB-hour of memory",
    usedBy: "chapters 12 and 41",
    arm64: "fargate.arm.memory.gb-hour",
    x86: "fargate.x86.memory.gb-hour",
  },
  {
    what: "Lambda, per GB-second (first tier)",
    usedBy: "chapter 04 onward",
    arm64: "lambda.duration.arm",
    x86: "lambda.duration.x86",
  },
] as const;
// #endregion pairs

// #region compare
export type PriceLookup = (priceId: string) => string;

export type ArchComparison = {
  what: string;
  usedBy: string;
  arm64Usd: string;
  x86Usd: string;
  /** How much less the arm64 unit costs, in percent of the x86 price, to one decimal. */
  savingPercent: number;
};

/** Unit prices only. It says nothing about how much work one unit does on either processor. */
export function compareArchitectures(usdOf: PriceLookup): ArchComparison[] {
  return ARCH_PAIRS.map(({ what, usedBy, arm64, x86 }) => {
    const arm64Usd = usdOf(arm64);
    const x86Usd = usdOf(x86);
    const saving = (1 - Number(arm64Usd) / Number(x86Usd)) * 100;
    return { what, usedBy, arm64Usd, x86Usd, savingPercent: Math.round(saving * 10) / 10 };
  });
}
// #endregion compare
