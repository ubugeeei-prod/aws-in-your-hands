import { parseEc2Config } from "./config.ts";
import { machineFor } from "./machine.ts";
import { renderEnvFile, renderUnit } from "./unit.ts";
import { renderDataVolumeScript, renderReleaseScript, renderUserData } from "./user-data.ts";

/** The files under deploy/, by name, as the default settings render them. */
export function renderedFiles(): Record<string, string> {
  const machine = machineFor(parseEc2Config({}));
  return {
    "notes.service": renderUnit(machine),
    "notes.env": renderEnvFile(machine),
    "notes-data-volume.sh": renderDataVolumeScript(machine),
    "notes-release.sh": renderReleaseScript(machine),
    "user-data.sh": renderUserData(machine),
  };
}
