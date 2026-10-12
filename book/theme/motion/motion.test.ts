import { describe, expect, it } from "vite-plus/test";

import { noiseVolume, tileableCells, tileableNoise, toHalf } from "./noise.ts";
import { budget, canvasSize, gridSize, nextBudget, sceneSize, wantsStill } from "./quality.ts";
import { finishFragment, fluid, vertex, volumeFragment } from "./shaders.ts";

/** Reads a HALF_FLOAT back, the way the GPU will. */
function fromHalf(bits: number): number {
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  const sign = bits & 0x8000 ? -1 : 1;
  return exponent === 0
    ? sign * mantissa * 2 ** -24
    : sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

describe("the noise the cloud is made of", () => {
  it("repeats at its edges, so the texture can wrap without a seam", () => {
    const gradient = tileableNoise(8, 3);
    const cells = tileableCells(4, 3);
    for (const [x, y, z] of [
      [0.3, 1.7, 5.2],
      [7.9, 0.1, 3.3],
    ] as const) {
      expect(gradient(x + 8, y, z)).toBeCloseTo(gradient(x, y, z), 10);
      expect(gradient(x, y - 8, z + 8)).toBeCloseTo(gradient(x, y, z), 10);
      expect(cells(x + 4, y, z - 4)).toBeCloseTo(cells(x, y, z), 10);
    }
  });

  it("draws the same cloud for the same seed, and another for another", () => {
    const a = noiseVolume(8, 4, 17);
    expect(noiseVolume(8, 4, 17)).toEqual(a);
    expect(noiseVolume(8, 4, 18)).not.toEqual(a);
  });

  it("keeps every texel between 0 and 1 once it is a half float", () => {
    const values = [...noiseVolume(8, 4, 17)].map(fromHalf);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    // Not a flat field either.
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.4);
  });

  it("packs floats into 16 bits within a thousandth", () => {
    for (const value of [0, 1, 0.5, 0.123_456, 0.999, 1 / 3, 0.000_02]) {
      expect(fromHalf(toHalf(value))).toBeCloseTo(value, 3);
    }
  });
});

describe("how large the cloud is drawn", () => {
  it("caps the pixel ratio, so a dense display does not quadruple the work", () => {
    expect(canvasSize(1280, 800, 3, 2)).toEqual({ width: 2560, height: 1600 });
    expect(canvasSize(1280, 800, 1, 2)).toEqual({ width: 1280, height: 800 });
  });

  it("keeps the canvas's shape within the pixel budget, and never enlarges", () => {
    const scene = sceneSize({ width: 2560, height: 1600 }, 256_000);
    expect(scene.width * scene.height).toBeLessThanOrEqual(256_000 * 1.01);
    expect(scene.width / scene.height).toBeCloseTo(1.6, 1);
    expect(sceneSize({ width: 200, height: 100 }, 256_000)).toEqual({ width: 200, height: 100 });
  });

  it("gives the fluid square cells, whatever the screen's shape", () => {
    const wide = gridSize({ width: 2560, height: 1600 });
    expect(wide.width / wide.height).toBeCloseTo(1.6, 1);
    expect(gridSize({ width: 390, height: 844 }).height).toBe(wide.height);
  });

  it("shrinks on slow frames, grows on fast ones, and holds in between", () => {
    expect(nextBudget(300_000, 33)).toBeLessThan(300_000);
    expect(nextBudget(300_000, 8)).toBeGreaterThan(300_000);
    expect(nextBudget(300_000, 17)).toBe(300_000);
    expect(nextBudget(budget.min, 60)).toBe(budget.min);
    expect(nextBudget(budget.max, 4)).toBe(budget.max);
  });

  it("holds still for a reader who asked for less motion, unless told otherwise", () => {
    expect(wantsStill("system", true)).toBe(true);
    expect(wantsStill("system", false)).toBe(false);
    expect(wantsStill("no-preference", true)).toBe(false);
    expect(wantsStill("reduce", false)).toBe(true);
  });
});

describe("the shaders", () => {
  const all = { vertex, volumeFragment, finishFragment, ...fluid };

  // WebGL2 rejects a shader whose first line is anything else, comments included.
  it.each(Object.entries(all))("%s starts with the GLSL ES 3.00 version line", (_name, source) => {
    expect(source.startsWith("#version 300 es\n")).toBe(true);
  });

  it("lights the cloud with the brand's colours, exactly", () => {
    // sRGB of #101B2B, #6534DF, #F300DF, #FF70DE and #FF8A00, as the shader writes them.
    for (const colour of [
      "0.0627, 0.1059, 0.1686",
      "0.3961, 0.2039, 0.8745",
      "0.9529, 0.0, 0.8745",
      "1.0, 0.4392, 0.8706",
      "1.0, 0.5412, 0.0",
    ]) {
      expect(volumeFragment).toContain(colour);
    }
  });
});
