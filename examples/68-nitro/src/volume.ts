import * as v from "valibot";

// #region serial
const VOLUME_ID = /^vol-[0-9a-f]{8,17}$/;

/** The NVMe serial number of an EBS volume is its volume ID without the hyphen. */
export function nvmeSerial(volumeId: string): string {
  if (!VOLUME_ID.test(volumeId)) {
    throw new Error(`"${volumeId}" is not an EBS volume ID`);
  }
  return volumeId.replace("-", "");
}

/** What to run on the instance. The names it prints change between boots; the serials do not. */
export const LSBLK = ["lsblk", "--json", "--nodeps", "--output", "NAME,SERIAL"] as const;
// #endregion serial

// #region find
// The JSON of `lsblk --json`. Only the two columns asked for are read.
const lsblkSchema = v.object({
  blockdevices: v.array(
    v.object({
      name: v.pipe(v.string(), v.regex(/^[a-z0-9]+$/)),
      serial: v.nullish(v.string()),
    }),
  ),
});

export type Found =
  | { found: true; device: string }
  | { found: false; reason: "not-attached" | "ambiguous" };

/** The block device that holds this volume right now, whatever name it got at this boot. */
export function findDevice(lsblkOutput: unknown, volumeId: string): Found {
  const serial = nvmeSerial(volumeId);
  const matches = v
    .parse(lsblkSchema, lsblkOutput)
    .blockdevices.filter((device) => device.serial === serial);
  const [only, ...rest] = matches;
  if (only === undefined) {
    return { found: false, reason: "not-attached" };
  }
  // Two devices with one serial is not a state to pick from. Formatting the wrong one loses data.
  return rest.length > 0
    ? { found: false, reason: "ambiguous" }
    : { found: true, device: `/dev/${only.name}` };
}
// #endregion find
