import { z } from "zod";

import { type Ec2Config, REGION } from "./config.ts";

// Every value below ends up inside a shell script or a systemd file that runs
// as root. The patterns leave no room for a quote, a space, or a newline.
const name = z.string().regex(/^[a-z][a-z0-9-]{0,30}$/);
const path = z
  .string()
  .regex(/^(\/[A-Za-z0-9._-]+)+$/)
  .refine((value) => !value.split("/").includes(".."), "must not contain ..");

// #region spec
export const machineSpecSchema = z.object({
  region: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/),
  /** Also the systemd unit name: <service>.service. */
  service: name,
  /** A system account with no shell. The process never runs as root. */
  user: name,
  /** Releases are unpacked under here; `current` points at the one in use. */
  appDir: path,
  envFile: path,
  /** The name given to AttachVolume. Amazon Linux links it to the NVMe device. */
  dataDevice: path,
  dataMount: path,
  fstab: path,
  port: z.number().int().min(1024).max(65535),
  nodePackage: z.string().regex(/^nodejs\d{2}$/),
  nodeBin: path,
  allowedOrigin: z.string().regex(/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/),
  stage: name,
  /** How long systemd waits after SIGTERM before SIGKILL. */
  stopTimeoutSeconds: z.number().int().min(5).max(300),
});
export type MachineSpec = z.infer<typeof machineSpecSchema>;
// #endregion spec

/** How long the process itself waits for requests in flight. Must end before systemd gives up. */
export const SHUTDOWN_GRACE_MS = 20_000;

// #region defaults
export function machineFor(config: Pick<Ec2Config, "allowedOrigin">): MachineSpec {
  return machineSpecSchema.parse({
    region: REGION,
    service: "notes",
    user: "notes",
    appDir: "/opt/notes",
    envFile: "/etc/notes/notes.env",
    dataDevice: "/dev/sdf",
    dataMount: "/var/lib/notes",
    fstab: "/etc/fstab",
    port: 8787,
    nodePackage: "nodejs24",
    // The versioned name. /usr/bin/node is an alternatives link that can move.
    nodeBin: "/usr/bin/node-24",
    allowedOrigin: config.allowedOrigin,
    stage: "ec2",
    stopTimeoutSeconds: 30,
  } satisfies MachineSpec);
}
// #endregion defaults

export const pathsOf = (spec: MachineSpec) => ({
  releases: `${spec.appDir}/releases`,
  current: `${spec.appDir}/current`,
  entry: `${spec.appDir}/current/server.mjs`,
  notesFile: `${spec.dataMount}/notes.json`,
  unit: `/etc/systemd/system/${spec.service}.service`,
  volumeScript: `/usr/local/sbin/${spec.service}-data-volume`,
  releaseScript: `/usr/local/sbin/${spec.service}-release`,
});
