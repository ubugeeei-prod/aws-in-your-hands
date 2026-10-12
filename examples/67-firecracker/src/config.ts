import * as v from "valibot";

// #region schema
// These end up in a URL path. The specification says only "string", so the limit is this example's.
const id = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_]{1,32}$/, "letters, digits and _ only"));
const path = v.pipe(v.string(), v.minLength(1), v.regex(/^[^\0\n]+$/, "one line, no NUL"));
const count = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

/** A TokenBucket of the specification: `size` tokens, refilled over `refillTimeMs`. */
const bucket = v.object({
  size: count,
  refillTimeMs: count,
  oneTimeBurst: v.optional(count),
});
const rateLimiter = v.object({
  // Tokens are bytes.
  bandwidth: v.optional(bucket),
  // Tokens are operations: packets for a network interface.
  ops: v.optional(bucket),
});

export const microVmConfigSchema = v.object({
  // 1..32 is the specification's range. Firecracker starts with 1 vCPU and 128 MiB when nothing is sent.
  vcpuCount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(32)), 1),
  // The specification gives no range for memory. One MiB or more is this example's floor.
  memSizeMib: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1)), 128),
  kernelImagePath: path,
  // The quickstart's arguments: a serial console, and `reboot=k` so that `reboot` in the guest ends the process.
  bootArgs: v.optional(v.pipe(v.string(), v.regex(/^[^\0\n]*$/)), "console=ttyS0 reboot=k panic=1"),
  rootfs: v.object({
    driveId: v.optional(id, "rootfs"),
    pathOnHost: path,
    readOnly: v.optional(v.boolean(), false),
  }),
  network: v.optional(
    v.object({
      ifaceId: v.optional(id, "net1"),
      // The TAP device on the host that carries the guest's packets.
      hostDevName: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_.-]{1,15}$/, "a Linux interface name")),
      guestMac: v.pipe(
        v.string(),
        v.regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, "a MAC address"),
      ),
      rxRateLimiter: v.optional(rateLimiter),
      txRateLimiter: v.optional(rateLimiter),
    }),
  ),
});
export type MicroVmConfig = v.InferOutput<typeof microVmConfigSchema>;
export type RateLimiter = v.InferOutput<typeof rateLimiter>;
// #endregion schema

export function parseMicroVmConfig(input: unknown): MicroVmConfig {
  const result = v.safeParse(microVmConfigSchema, input);
  if (!result.success) {
    const lines = result.issues.map(
      (issue) => `  ${v.getDotPath(issue) ?? "(config)"}: ${issue.message}`,
    );
    throw new Error(`Invalid microVM configuration\n${lines.join("\n")}`);
  }
  return result.output;
}

/** What the quickstart of the Firecracker repository sets up, with the names the walkthrough uses. */
export const WALKTHROUGH_CONFIG = {
  vcpuCount: 1,
  memSizeMib: 256,
  kernelImagePath: "work/vmlinux",
  rootfs: { pathOnHost: "work/rootfs.ext4" },
  network: { hostDevName: "tap0", guestMac: "06:00:AC:10:00:02" },
} as const;
