import { describe, expect, it } from "vite-plus/test";

import { formatTally, tally } from "../src/probe.ts";

describe("tally", () => {
  it("counts answers and 5xx per version, and where the flags came from", () => {
    const result = tally([
      { status: 200, version: "3", flagsOrigin: "live" },
      { status: 200, version: "3", flagsOrigin: "live" },
      { status: 500, version: "4", flagsOrigin: "live" },
      { status: 200, version: "4", flagsOrigin: "defaults" },
    ]);
    expect(result.versions).toEqual({
      "3": { answers: 2, serverErrors: 0 },
      "4": { answers: 2, serverErrors: 1 },
    });
    expect(formatTally(result)).toEqual([
      "version 3: 2 of 4 (50.0%), 0 with 5xx",
      "version 4: 2 of 4 (50.0%), 1 with 5xx",
      "flags: live 3, defaults 1",
    ]);
  });

  it("sorts version 10 after version 9", () => {
    const result = tally([
      { status: 200, version: "10", flagsOrigin: "live" },
      { status: 200, version: "9", flagsOrigin: "live" },
    ]);
    expect(
      formatTally(result)
        .slice(0, 2)
        .map((line) => line.split(":")[0]),
    ).toEqual(["version 9", "version 10"]);
  });
});
