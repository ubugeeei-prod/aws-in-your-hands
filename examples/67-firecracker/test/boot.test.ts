import { describe, expect, it } from "vite-plus/test";

import { bootAndMeasure, describeTiming } from "../src/boot.ts";
import { parseMicroVmConfig, WALKTHROUGH_CONFIG } from "../src/config.ts";
import type { ApiRequest } from "../src/requests.ts";

const config = parseMicroVmConfig(WALKTHROUGH_CONFIG);

/** A clock that moves only when something is said to take time. */
function world(options: { answersOnProbe: number; start?: "started" | "was-running" }) {
  let time = 1000;
  let probes = 0;
  const log: string[] = [];
  return {
    log,
    deps: {
      client: {
        run: async (sequence: readonly ApiRequest[]) => {
          log.push(...sequence.map((request) => request.operationId));
          time += 4 * sequence.length;
        },
        startOnce: async () => {
          log.push("InstanceStart");
          time += 2;
          return options.start ?? ("started" as const);
        },
      },
      probe: async () => {
        probes += 1;
        time += 1;
        return probes >= options.answersOnProbe;
      },
      now: () => time,
      sleep: async (ms: number) => {
        time += ms;
      },
    },
  };
}

describe("bootAndMeasure", () => {
  it("measures from the start call to the first answer, apart from the configuration", async () => {
    const { deps, log } = world({ answersOnProbe: 3 });
    const timing = await bootAndMeasure(config, deps, { probeEveryMs: 10, giveUpAfterMs: 1000 });

    expect(log.at(-1)).toBe("InstanceStart");
    expect(timing).toEqual({
      configureMs: 16,
      startCallMs: 2,
      // 2 for the call, three probes of 1, two waits of 10.
      firstAnswerMs: 25,
      probes: 3,
      start: "started",
    });
  });

  it("gives up, saying how long it waited, when the guest never answers", async () => {
    const { deps } = world({ answersOnProbe: Number.POSITIVE_INFINITY });
    await expect(
      bootAndMeasure(config, deps, { probeEveryMs: 10, giveUpAfterMs: 100 }),
    ).rejects.toThrow("did not answer within 100 ms");
  });

  it("says what the figure contains whenever it prints it", async () => {
    const { deps } = world({ answersOnProbe: 1, start: "was-running" });
    const lines = describeTiming(await bootAndMeasure(config, deps));
    expect(lines[1]).toContain("answer lost");
    expect(lines.join("\n")).toContain("not the figure of Firecracker's specification");
  });
});
