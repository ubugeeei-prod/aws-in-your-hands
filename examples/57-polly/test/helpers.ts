import type { Synthesizer } from "../src/synthesizer.ts";

export const NOTE = { title: "買い物", body: "牛乳を買う。卵も買う。" };

/** A clock that moves only when the code under test sleeps. */
export function fakeClock(start = 1_000_000) {
  let time = start;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
    // Like a real timer: everyone asleep at the same moment wakes at the same later moment.
    sleep: async (ms: number) => {
      const wake = time + ms;
      await new Promise<void>((resolve) => setImmediate(resolve));
      time = Math.max(time, wake);
    },
  };
}

/** A synthesizer that records every call and finishes one only when the test says so. */
export function gatedSynthesizer() {
  const calls: string[] = [];
  const waiting: (() => void)[] = [];
  let failures = 0;
  const synthesize: Synthesizer = async ({ ssml, voice }) => {
    calls.push(`${voice}:${ssml}`);
    await new Promise<void>((resolve) => waiting.push(resolve));
    if (failures > 0) {
      failures -= 1;
      throw new Error("synthesis failed");
    }
    return {
      audio: new TextEncoder().encode(`audio of ${ssml}`),
      contentType: "audio/mpeg",
      characters: [...ssml.replaceAll(/<[^>]*>/g, "")].length,
    };
  };
  return {
    synthesize,
    calls,
    /** Lets every call that is waiting finish. */
    release: () => {
      for (const resolve of waiting.splice(0)) {
        resolve();
      }
    },
    failNext: (count = 1) => {
      failures = count;
    },
  };
}

/** Lets everything that can run without a timer run. */
export const settle = async (turns = 20): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};
