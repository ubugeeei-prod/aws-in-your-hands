import { describe, expect, it } from "vite-plus/test";

import {
  containsCidr,
  formatCidr,
  formatIpv4,
  lastAddress,
  overlaps,
  parseCidr,
  parseIpv4,
  sizeOf,
  subnetAt,
  usableAddresses,
} from "../src/cidr.ts";

describe("CIDR arithmetic", () => {
  it("round-trips blocks above 128.0.0.0, where signed 32-bit math goes negative", () => {
    for (const text of [
      "10.20.0.0/16",
      "172.16.0.0/12",
      "192.168.255.0/24",
      "255.255.255.255/32",
      "0.0.0.0/0",
    ]) {
      expect(formatCidr(parseCidr(text))).toBe(text);
    }
    expect(parseIpv4("192.168.0.1")).toBe(3_232_235_521);
    expect(formatIpv4(lastAddress(parseCidr("192.168.0.0/16")))).toBe("192.168.255.255");
  });

  it("rejects what EC2 would reject", () => {
    expect(() => parseCidr("10.20.1.0/16")).toThrow(/host bits set; did you mean 10\.20\.0\.0\/16/);
    expect(() => parseCidr("10.20.0.0/33")).toThrow(/longer than \/32/);
    expect(() => parseCidr("10.20.0.0")).toThrow(/not a CIDR block/);
    expect(() => parseCidr("10.20.0.256/24")).toThrow(/not an IPv4 address/);
    expect(() => parseCidr("10.020.0.0/16")).toThrow(/not an IPv4 address/);
    expect(() => parseCidr("10.20.0/16")).toThrow(/not an IPv4 address/);
  });

  it("sees an overlap only when one block contains the other", () => {
    const vpc = parseCidr("10.20.0.0/16");
    const first = parseCidr("10.20.0.0/20");
    const second = parseCidr("10.20.16.0/20");

    expect(overlaps(first, second)).toBe(false);
    expect(overlaps(vpc, second)).toBe(true);
    expect(overlaps(second, vpc)).toBe(true);
    expect(overlaps(first, parseCidr("10.20.15.0/24"))).toBe(true);
    expect(containsCidr(first, vpc)).toBe(false);
    // Adjacent blocks touch but share no address.
    expect(lastAddress(first) + 1).toBe(second.network);
  });

  it("carves blocks in address order and refuses to run past the parent", () => {
    const vpc = parseCidr("10.20.0.0/16");
    expect([0, 1, 15].map((index) => formatCidr(subnetAt(vpc, 20, index)))).toEqual([
      "10.20.0.0/20",
      "10.20.16.0/20",
      "10.20.240.0/20",
    ]);
    expect(() => subnetAt(vpc, 20, 16)).toThrow(/holds 16 blocks of \/20/);
    expect(() => subnetAt(vpc, 12, 0)).toThrow(/does not fit/);
  });

  it("counts the five addresses a VPC subnet keeps for itself", () => {
    expect(sizeOf(parseCidr("10.20.0.0/20"))).toBe(4096);
    expect(usableAddresses(parseCidr("10.20.0.0/20"))).toBe(4091);
    // The smallest subnet a VPC allows.
    expect(usableAddresses(parseCidr("10.20.0.0/28"))).toBe(11);
  });
});
