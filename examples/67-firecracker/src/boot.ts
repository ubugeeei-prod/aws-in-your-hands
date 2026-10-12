// Boot a microVM and time it from outside: from the start call to the guest's first HTTP answer.

import type { FirecrackerClient } from "./client.ts";
import type { MicroVmConfig } from "./config.ts";
import { configureSequence } from "./requests.ts";

export type BootTiming = {
  /** The pre-boot calls, first sent to last answered. */
  configureMs: number;
  /** The InstanceStart call alone. */
  startCallMs: number;
  /** From sending InstanceStart to the first answer of the server in the guest. */
  firstAnswerMs: number;
  probes: number;
  start: "started" | "was-running";
};

export type BootDeps = {
  client: Pick<FirecrackerClient, "run" | "startOnce">;
  /** True once the server inside the guest answers. */
  probe: () => Promise<boolean>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

// #region boot
export async function bootAndMeasure(
  config: MicroVmConfig,
  deps: BootDeps,
  limits = { probeEveryMs: 5, giveUpAfterMs: 30_000 },
): Promise<BootTiming> {
  const { client, probe, now, sleep } = deps;

  const configureFrom = now();
  await client.run(configureSequence(config));
  const startFrom = now();
  const start = await client.startOnce();
  const started = now();

  let probes = 0;
  for (;;) {
    probes += 1;
    if (await probe()) {
      break;
    }
    if (now() - startFrom >= limits.giveUpAfterMs) {
      throw new Error(
        `the guest did not answer within ${limits.giveUpAfterMs} ms of InstanceStart (${probes} probes)`,
      );
    }
    await sleep(limits.probeEveryMs);
  }

  return {
    configureMs: startFrom - configureFrom,
    startCallMs: started - startFrom,
    firstAnswerMs: now() - startFrom,
    probes,
    start,
  };
}
// #endregion boot

/** What the figure is, said next to it every time it is printed. */
export function describeTiming(timing: BootTiming): string[] {
  return [
    `configure calls        ${timing.configureMs.toFixed(1)} ms`,
    `InstanceStart call     ${timing.startCallMs.toFixed(1)} ms${timing.start === "was-running" ? " (answer lost; state read back as Running)" : ""}`,
    `start to first answer  ${timing.firstAnswerMs.toFixed(1)} ms (${timing.probes} probes)`,
    "The last line includes the guest kernel, init, Node.js starting, and the probe interval.",
    "It is not the figure of Firecracker's specification, which ends when /sbin/init starts.",
  ];
}
