import { describe, expect, it } from "vite-plus/test";

import { findDevice, LSBLK, nvmeSerial } from "../src/volume.ts";
import { dataFirst, rootFirst, withStranger } from "./fixtures/lsblk.ts";

const ROOT = "vol-0aaaaaaaaaaaaaaaa";
const DATA = "vol-0bbbbbbbbbbbbbbbb";

describe("finding an EBS volume on a Nitro instance", () => {
  it("writes the serial as the volume ID without its hyphen", () => {
    expect(nvmeSerial("vol-01234567890abcdef")).toBe("vol01234567890abcdef");
    expect(() => nvmeSerial("/dev/sdf")).toThrow(/not an EBS volume ID/);
  });

  it("finds the same volume when the device names swap between boots", () => {
    expect(findDevice(rootFirst, DATA)).toEqual({ found: true, device: "/dev/nvme1n1" });
    expect(findDevice(dataFirst, DATA)).toEqual({ found: true, device: "/dev/nvme0n1" });
    // A script that formats "/dev/nvme1n1" would have formatted the root volume on the second boot.
    expect(findDevice(dataFirst, ROOT)).toEqual({ found: true, device: "/dev/nvme1n1" });
  });

  it("says so when the volume is not attached, and picks nothing", () => {
    expect(findDevice(withStranger, DATA)).toEqual({ found: false, reason: "not-attached" });
  });

  it("picks nothing when two devices report the same serial", () => {
    const twice = {
      blockdevices: [
        ...rootFirst.blockdevices,
        { name: "nvme2n1", serial: "vol0bbbbbbbbbbbbbbbb" },
      ],
    };
    expect(findDevice(twice, DATA)).toEqual({ found: false, reason: "ambiguous" });
  });

  it("refuses output that is not lsblk's JSON, and device names that are not names", () => {
    expect(() => findDevice({ devices: [] }, DATA)).toThrow();
    expect(() =>
      findDevice({ blockdevices: [{ name: "../sda; rm", serial: "x" }] }, DATA),
    ).toThrow();
  });

  it("asks lsblk for whole disks and the two columns it reads", () => {
    expect(LSBLK.join(" ")).toBe("lsblk --json --nodeps --output NAME,SERIAL");
  });
});
