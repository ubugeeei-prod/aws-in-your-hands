import { type MachineSpec, machineSpecSchema, pathsOf } from "./machine.ts";

// #region env-file
/** Configuration only. Nothing secret belongs in a file baked into user data. */
export function renderEnvFile(input: MachineSpec): string {
  const spec = machineSpecSchema.parse(input);
  return [
    `ALLOWED_ORIGIN=${spec.allowedOrigin}`,
    "LOG_LEVEL=info",
    `STAGE=${spec.stage}`,
    // Loopback only: nothing outside the instance can connect, whatever the security group says.
    "HOST=127.0.0.1",
    `PORT=${spec.port}`,
    `NOTES_FILE=${pathsOf(spec).notesFile}`,
    "",
  ].join("\n");
}
// #endregion env-file

// #region unit
export function renderUnit(input: MachineSpec): string {
  const spec = machineSpecSchema.parse(input);
  const paths = pathsOf(spec);
  return [
    "[Unit]",
    "Description=Notes API (AWS in Your Hands, chapter 23)",
    "After=network-online.target",
    "Wants=network-online.target",
    // Without the data volume the notes would land on the root volume and vanish with the instance.
    `RequiresMountsFor=${spec.dataMount}`,
    `AssertPathIsMountPoint=${spec.dataMount}`,
    // No release yet: skip quietly instead of failing at every boot.
    `ConditionPathExists=${paths.entry}`,
    // Five crashes in a minute and systemd stops trying, so a broken release is visible as "failed".
    "StartLimitIntervalSec=60",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "Type=simple",
    `User=${spec.user}`,
    `Group=${spec.user}`,
    `EnvironmentFile=${spec.envFile}`,
    `ExecStart=${spec.nodeBin} ${paths.entry}`,
    "Restart=on-failure",
    "RestartSec=2",
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
