import { describe, expect, it } from "vite-plus/test";

import { parseNitroConfig } from "../src/config.ts";
import { DEBUG_PCR, isMeasurement, pcrOfText } from "../src/measurement.ts";

const PCR0 =
  "7fb5c55bc2ecbb68ed99a13d7122abfc0666b926a79d5379bc58b9445c84217f59cfdd36c08b2c79552928702efe23e4";

describe("measurements", () => {
  // Both expected values are the example output printed in the Nitro Enclaves user guide.
  it("computes PCR3 from a role ARN as the guide does", () => {
    expect(pcrOfText("arn:aws:iam::123456789012:role/Webserver")).toBe(
      "78fce75db17cd4e0a3fb8dad3ad128ca5e77edbb2b2c7f75329dccd99aa5f6ef4fc1f1a452e315b9e98f9e312e6921e6",
    );
  });

  it("computes PCR4 from an instance ID as the guide does", () => {
    expect(pcrOfText("i-1234567890abcdef0")).toBe(
      "08f996b5d43e047a9eb51e7f548bfee7e164fd7dc8f65541f2ac09d6545ac812719327281c401a67a10fcba87ae79ce0",
    );
  });

  it("never accepts the all-zero value of a debug enclave as a measurement", () => {
    expect(isMeasurement(PCR0)).toBe(true);
    expect(isMeasurement(DEBUG_PCR)).toBe(false);
    expect(() => parseNitroConfig({ measurement: DEBUG_PCR })).toThrow(/measurement/);
  });

  it("accepts a measurement in either case and refuses anything of another length", () => {
    expect(parseNitroConfig({ measurement: PCR0.toUpperCase() }).measurement).toBe(PCR0);
    expect(() => parseNitroConfig({ measurement: PCR0.slice(2) })).toThrow(/measurement/);
    expect(() => parseNitroConfig({ measurement: "latest" })).toThrow(/measurement/);
  });

  it("has no default measurement, and offers no burstable instance type", () => {
    expect(parseNitroConfig({})).toEqual({ instanceType: "c6g.large" });
    expect(() => parseNitroConfig({ instanceType: "t4g.micro" })).toThrow(/instanceType/);
  });
});
