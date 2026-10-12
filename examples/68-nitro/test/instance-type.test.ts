import { describe, expect, it } from "vite-plus/test";

import { decodeInstanceType, describeInstanceType, unknownParts } from "../src/instance-type.ts";

describe("reading an instance type name", () => {
  it("reads chapter 23's instance as burstable, generation 4, Graviton", () => {
    expect(decodeInstanceType("t4g.micro")).toMatchObject({
      series: { letters: "t", meaning: "Burstable performance" },
      generation: 4,
      processor: { letters: "g", meaning: "AWS Graviton processors" },
      capabilities: [],
      size: "micro",
      bareMetal: false,
      architecture: "arm64",
    });
  });

  it("separates the processor letter from the capability letters", () => {
    const letters = (name: string) => {
      const decoded = decodeInstanceType(name);
      return [decoded.processor?.letters, decoded.capabilities.map((option) => option.letters)];
    };
    expect(letters("c7gn.large")).toEqual(["g", ["n"]]);
    expect(letters("m6id.large")).toEqual(["i", ["d"]]);
    expect(letters("x8aedz.large")).toEqual(["a", ["e", "d", "z"]]);
    expect(letters("m7i-flex.large")).toEqual(["i", ["flex"]]);
    // d, n, b, z are not processors: these names carry no processor letter at all.
    expect(letters("m5dn.large")).toEqual([undefined, ["d", "n"]]);
    expect(letters("r5b.large")).toEqual([undefined, ["b"]]);
  });

  it("does not claim an architecture the name does not state", () => {
    expect(decodeInstanceType("m5.large").architecture).toBeUndefined();
    expect(decodeInstanceType("m5dn.large").architecture).toBeUndefined();
    expect(decodeInstanceType("c6i.xlarge").architecture).toBe("x86_64");
    expect(decodeInstanceType("m6a.large").architecture).toBe("x86_64");
    // Series A is Graviton by itself, without a g.
    expect(decodeInstanceType("a1.medium").architecture).toBe("arm64");
  });

  it("reads multi-letter series and bare metal sizes", () => {
    expect(decodeInstanceType("hpc7g.4xlarge").series.meaning).toBe("High performance computing");
    expect(decodeInstanceType("im4gn.large").series.letters).toBe("im");
    expect(decodeInstanceType("c6g.metal").bareMetal).toBe(true);
    expect(decodeInstanceType("m7i.metal-24xl").bareMetal).toBe(true);
    expect(decodeInstanceType("c6g.large").bareMetal).toBe(false);
  });

  it("reports what the naming page does not list instead of guessing", () => {
    // Both are real families. Neither "Gr" nor "f" was on the page on 2026-10-13.
    expect(unknownParts(decodeInstanceType("gr6f.4xlarge"))).toEqual(['series "gr"', 'option "f"']);
    expect(unknownParts(decodeInstanceType("c6g.large"))).toEqual([]);
    expect(describeInstanceType(decodeInstanceType("dl1.24xlarge")).join("\n")).toContain(
      "not on the naming page",
    );
  });

  it("refuses names of another shape rather than misreading them", () => {
    for (const name of [
      "u-6tb1.metal",
      "u7i-12tb.224xlarge",
      "mac2-m2pro.metal",
      "p6-b200.48xlarge",
      "t4g",
      "",
    ]) {
      expect(() => decodeInstanceType(name), name).toThrow(/not of the form/);
    }
  });
});
