import { describe, expect, it } from "vite-plus/test";

import { DEFAULTS, parseArgs } from "../src/args.ts";
import { parseMicroVmConfig, WALKTHROUGH_CONFIG } from "../src/config.ts";
import { bootSequence, configureSequence, renderCurl } from "../src/requests.ts";

const minimal = { kernelImagePath: "vmlinux", rootfs: { pathOnHost: "rootfs.ext4" } };

describe("microVM configuration", () => {
  it("fills in Firecracker's own defaults and the quickstart's boot arguments", () => {
    expect(parseMicroVmConfig(minimal)).toEqual({
      vcpuCount: 1,
      memSizeMib: 128,
      kernelImagePath: "vmlinux",
      bootArgs: "console=ttyS0 reboot=k panic=1",
      rootfs: { driveId: "rootfs", pathOnHost: "rootfs.ext4", readOnly: false },
    });
  });

  it.each([
    ["an id that would change the URL path", { rootfs: { pathOnHost: "r", driveId: "a/b" } }],
    ["a path with a line break", { kernelImagePath: "vmlinux\n--evil" }],
    ["boot arguments with a line break", { bootArgs: "console=ttyS0\ninit=/bin/sh" }],
    ["memory that is not a whole number", { memSizeMib: 128.5 }],
    ["a MAC address that is not one", { network: { hostDevName: "tap0", guestMac: "06:00:AC" } }],
    [
      "an interface name longer than Linux allows",
      {
        network: { hostDevName: "tap-with-a-long-name", guestMac: "06:00:AC:10:00:02" },
      },
    ],
    [
      "a negative token bucket",
      {
        network: {
          hostDevName: "tap0",
          guestMac: "06:00:AC:10:00:02",
          txRateLimiter: { bandwidth: { size: -1, refillTimeMs: 1000 } },
        },
      },
    ],
  ])("rejects %s", (_name, override) => {
    expect(() => parseMicroVmConfig({ ...minimal, ...override })).toThrow(
      "Invalid microVM configuration",
    );
  });
});

describe("the request sequence", () => {
  it("configures first and starts last", () => {
    const ids = bootSequence(parseMicroVmConfig(WALKTHROUGH_CONFIG)).map(
      (request) => request.operationId,
    );
    expect(ids).toEqual([
      "putMachineConfiguration",
      "putGuestBootSource",
      "putGuestDriveByID",
      "putGuestNetworkInterfaceByID",
      "createSyncAction",
    ]);
  });

  it("sends no network interface when none is configured", () => {
    expect(configureSequence(parseMicroVmConfig(minimal)).map((request) => request.path)).toEqual([
      "/machine-config",
      "/boot-source",
      "/drives/rootfs",
    ]);
  });

  it("writes a rate limiter in the specification's field names, leaving out what was not set", () => {
    const config = parseMicroVmConfig({
      ...minimal,
      network: {
        hostDevName: "tap0",
        guestMac: "06:00:AC:10:00:02",
        txRateLimiter: { bandwidth: { size: 1024, refillTimeMs: 1000, oneTimeBurst: 4096 } },
      },
    });
    expect(configureSequence(config).at(-1)?.body).toEqual({
      iface_id: "net1",
      host_dev_name: "tap0",
      guest_mac: "06:00:AC:10:00:02",
      tx_rate_limiter: { bandwidth: { size: 1024, refill_time: 1000, one_time_burst: 4096 } },
    });
  });

  it("prints a curl command that survives a quote in a path", () => {
    const [, bootSource] = configureSequence(
      parseMicroVmConfig({ ...minimal, kernelImagePath: "it's/vmlinux" }),
    );
    expect(bootSource && renderCurl(bootSource, "/tmp/fc.sock")).toBe(
      "curl --unix-socket /tmp/fc.sock -X PUT 'http://localhost/boot-source' " +
        "-H 'Content-Type: application/json' " +
        `-d '{"kernel_image_path":"it'\\''s/vmlinux","boot_args":"console=ttyS0 reboot=k panic=1"}'`,
    );
  });
});

describe("command line", () => {
  it("uses the walkthrough's configuration and the quickstart's socket with no arguments", () => {
    const args = parseArgs([]);
    expect(args.config).toEqual(parseMicroVmConfig(WALKTHROUGH_CONFIG));
    expect(args).toMatchObject({ ...DEFAULTS, snapshot: false });
  });

  it("reads a configuration file and validates it", () => {
    const read = () => JSON.stringify({ ...minimal, vcpuCount: 2 });
    expect(parseArgs(["vm.json", "--socket", "/run/fc.sock", "--snapshot"], read)).toMatchObject({
      config: { vcpuCount: 2 },
      socketPath: "/run/fc.sock",
      snapshot: true,
    });
    expect(() => parseArgs(["vm.json"], () => JSON.stringify({ vcpuCount: 64 }))).toThrow(
      "Invalid microVM configuration",
    );
  });

  it("refuses arguments it does not know", () => {
    expect(() => parseArgs(["--socket"])).toThrow("needs a value");
    expect(() => parseArgs(["--force"])).toThrow("unexpected argument");
    expect(() => parseArgs(["--probe", "not a url"])).toThrow();
  });
});
