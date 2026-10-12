// What to send, decided without sending it.

import type { MicroVmConfig, RateLimiter } from "./config.ts";

export type ApiRequest = {
  /** The operationId of the specification, for messages and for the check against it. */
  operationId: string;
  method: "GET" | "PUT" | "PATCH";
  path: string;
  body?: Record<string, unknown>;
  /** The status the specification gives for success. */
  expect: 200 | 204;
};

function limiter(input: RateLimiter | undefined): Record<string, unknown> | undefined {
  if (input === undefined) {
    return undefined;
  }
  const bucket = (from: RateLimiter["bandwidth"]) =>
    from === undefined
      ? undefined
      : {
          size: from.size,
          refill_time: from.refillTimeMs,
          ...(from.oneTimeBurst === undefined ? {} : { one_time_burst: from.oneTimeBurst }),
        };
  const bandwidth = bucket(input.bandwidth);
  const ops = bucket(input.ops);
  return { ...(bandwidth && { bandwidth }), ...(ops && { ops }) };
}

export const describeInstance: ApiRequest = {
  operationId: "describeInstance",
  method: "GET",
  path: "/",
  expect: 200,
};

export const getVersion: ApiRequest = {
  operationId: "getFirecrackerVersion",
  method: "GET",
  path: "/version",
  expect: 200,
};

export const instanceStart: ApiRequest = {
  operationId: "createSyncAction",
  method: "PUT",
  path: "/actions",
  body: { action_type: "InstanceStart" },
  expect: 204,
};

// #region configure
/** Everything that must be in place before the guest runs. Each call creates or replaces, so it can be repeated. */
export function configureSequence(config: MicroVmConfig): ApiRequest[] {
  const { rootfs, network } = config;
  const rx = limiter(network?.rxRateLimiter);
  const tx = limiter(network?.txRateLimiter);
  return [
    {
      operationId: "putMachineConfiguration",
      method: "PUT",
      path: "/machine-config",
      body: { vcpu_count: config.vcpuCount, mem_size_mib: config.memSizeMib },
      expect: 204,
    },
    {
      operationId: "putGuestBootSource",
      method: "PUT",
      path: "/boot-source",
      body: { kernel_image_path: config.kernelImagePath, boot_args: config.bootArgs },
      expect: 204,
    },
    {
      operationId: "putGuestDriveByID",
      method: "PUT",
      path: `/drives/${rootfs.driveId}`,
      body: {
        drive_id: rootfs.driveId,
        path_on_host: rootfs.pathOnHost,
        is_root_device: true,
        is_read_only: rootfs.readOnly,
      },
      expect: 204,
    },
    ...(network === undefined
      ? []
      : [
          {
            operationId: "putGuestNetworkInterfaceByID",
            method: "PUT" as const,
            path: `/network-interfaces/${network.ifaceId}`,
            body: {
              iface_id: network.ifaceId,
              host_dev_name: network.hostDevName,
              guest_mac: network.guestMac,
              ...(rx && { rx_rate_limiter: rx }),
              ...(tx && { tx_rate_limiter: tx }),
            },
            expect: 204 as const,
          },
        ]),
  ];
}
// #endregion configure

// #region sequences
/** Configuration first, the start last: after InstanceStart the calls above are refused. */
export function bootSequence(config: MicroVmConfig): ApiRequest[] {
  return [...configureSequence(config), instanceStart];
}

/** A full snapshot of a running microVM. Both paths are files on the host, written by Firecracker. */
export function snapshotSequence(files: {
  snapshotPath: string;
  memFilePath: string;
}): ApiRequest[] {
  const vm = (state: "Paused" | "Resumed"): ApiRequest => ({
    operationId: "patchVm",
    method: "PATCH",
    path: "/vm",
    body: { state },
    expect: 204,
  });
  return [
    vm("Paused"),
    {
      operationId: "createSnapshot",
      method: "PUT",
      path: "/snapshot/create",
      body: {
        snapshot_type: "Full",
        snapshot_path: files.snapshotPath,
        mem_file_path: files.memFilePath,
      },
      expect: 204,
    },
    vm("Resumed"),
  ];
}
// #endregion sequences

/** The same request as a curl command, as the Firecracker documentation writes them. */
export function renderCurl(request: ApiRequest, socketPath: string): string {
  const parts = [
    "curl",
    `--unix-socket ${socketPath}`,
    `-X ${request.method}`,
    `'http://localhost${request.path}'`,
  ];
  if (request.body !== undefined) {
    // A single quote inside single quotes: close, escape, reopen.
    const json = JSON.stringify(request.body).replaceAll("'", String.raw`'\''`);
    parts.push("-H 'Content-Type: application/json'", `-d '${json}'`);
  }
  return parts.join(" ");
}
