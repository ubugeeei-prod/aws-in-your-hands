import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { defaultFlags } from "../src/flags/evaluate.ts";
import {
  createFlagReader,
  extensionSource,
  fileSource,
  type FlagOrigin,
} from "../src/flags/reader.ts";

/** A source that answers, in order, with each of `answers`. An Error is thrown. */
function scripted(answers: unknown[]) {
  const reports: FlagOrigin[] = [];
  let call = 0;
  const read = createFlagReader(
    async () => {
      const answer = answers[Math.min(call, answers.length - 1)];
      call += 1;
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
    (origin) => reports.push(origin),
  );
  return { read, reports };
}

const readOnly = { readOnly: { enabled: true } };
const down = new Error("connect ECONNREFUSED 127.0.0.1:2772");

describe("createFlagReader", () => {
  it("uses the code's defaults when AppConfig has never been reached", async () => {
    const { read, reports } = scripted([down]);
    expect(await read()).toEqual({ flags: defaultFlags, origin: "defaults" });
    expect(reports).toEqual(["defaults"]);
  });

  it("keeps the last flags it read when AppConfig stops answering", async () => {
    const { read } = scripted([readOnly, down, down]);
    expect((await read()).origin).toBe("live");
    const during = await read();
    expect(during.origin).toBe("last-known");
    // The switch someone turned on stays on. An outage does not quietly reopen writes.
    expect(during.flags.readOnly.enabled).toBe(true);
    expect((await read()).flags.readOnly.enabled).toBe(true);
  });

  it("treats an answer it cannot read like no answer", async () => {
    const { read } = scripted([readOnly, [], { readOnly: "yes" }, "<html>"]);
    await read();
    for (let call = 0; call < 3; call += 1) {
      expect(await read()).toMatchObject({
        origin: "last-known",
        flags: { readOnly: { enabled: true } },
      });
    }
  });

  it("goes back to live flags as soon as they can be read again", async () => {
    const { read } = scripted([down, { readOnly: { enabled: false } }]);
    expect((await read()).origin).toBe("defaults");
    expect((await read()).origin).toBe("live");
  });

  it("reports a change of origin once, not once per request", async () => {
    const { read, reports } = scripted([readOnly, down, down, down, readOnly, readOnly]);
    for (let call = 0; call < 6; call += 1) {
      await read();
    }
    expect(reports).toEqual(["last-known", "live"]);
  });
});

describe("extensionSource", () => {
  const settings = {
    port: 2772,
    application: "abc1234",
    environment: "dev",
    profile: "flags",
    timeoutMs: 500,
  };

  it("asks the extension on localhost for the one configuration", async () => {
    const calls: { url: string; signal: unknown }[] = [];
    const source = extensionSource(settings, async (url, init) => {
      calls.push({ url: String(url), signal: init?.signal });
      return Response.json(readOnly);
    });
    expect(await source()).toEqual(readOnly);
    expect(calls[0]?.url).toBe(
      "http://localhost:2772/applications/abc1234/environments/dev/configurations/flags",
    );
    // Bounded: a hung extension must not hang the request.
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails on any answer that is not a success", async () => {
    const source = extensionSource(settings, async () => new Response("no", { status: 500 }));
    await expect(source()).rejects.toThrow("answered 500");
  });
});

describe("fileSource", () => {
  it("reads the committed file as the application would receive it from AppConfig", async () => {
    const source = fileSource(fileURLToPath(new URL("../flags/flags.json", import.meta.url)));
    expect(await source()).toEqual({ readOnly: { enabled: false }, noteStats: { enabled: false } });
  });

  it("fails on a file that is missing, and the reader falls back", async () => {
    const read = createFlagReader(fileSource("/nonexistent/flags.json"), () => {});
    expect((await read()).origin).toBe("defaults");
  });
});
