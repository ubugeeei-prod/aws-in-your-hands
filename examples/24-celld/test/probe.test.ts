import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { judge } from "../src/ledger.ts";
import {
  defaultProbePlan,
  lastSeqBefore,
  parseProbeOutput,
  probeOutputBound,
  probePlanSchema,
  renderProbeScript,
  RUN_COMMAND_STDOUT_LIMIT,
} from "../src/probe.ts";

// The real script, run by bash with the real curl, against a stand-in for the
// upstream counter example: `?name=` picks a counter, every request adds 1.

type Behaviour = "ok" | "busy" | "garbage" | "hang";
let server: Server | undefined;
afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
});

async function counter(
  behaviourFor: (request: number) => Behaviour,
): Promise<{ port: number; names: Set<string> }> {
  const counters = new Map<string, number>();
  const names = new Set<string>();
  let requests = 0;
  server = createServer((request, response) => {
    requests += 1;
    const name =
      new URL(request.url ?? "/", "http://localhost").searchParams.get("name") ?? "default";
    names.add(name);
    const behaviour = behaviourFor(requests);
    if (behaviour === "hang") {
      // Applied, never answered: the client cannot tell this from a write that did not happen.
      counters.set(name, (counters.get(name) ?? 0) + 1);
      return;
    }
    if (behaviour === "busy") {
      response.writeHead(503, { "retry-after": "1" }).end('{"error":"cell admission refused"}');
      return;
    }
    const n = (counters.get(name) ?? 0) + 1;
    counters.set(name, n);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      behaviour === "garbage"
        ? "<html>proxy error</html>"
        : JSON.stringify({ n, url: request.url }),
    );
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as AddressInfo).port, names };
}

function runProbe(port: number, plan: Parameters<typeof renderProbeScript>[1]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-s"], { stdio: ["pipe", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", () => resolve(stdout));
    child.stdin.end(renderProbeScript({ publicPort: port }, plan));
  });
}

const plan = (overrides: object = {}) =>
  probePlanSchema.parse({
    runId: "test1",
    cells: 2,
    rounds: 3,
    pauseSeconds: 0,
    requestTimeoutSeconds: 1,
    ...overrides,
  });

describe("the probe script", () => {
  it("writes to each cell in turn and prints one line per request, then DONE", async () => {
    const { port, names } = await counter(() => "ok");
    const stdout = await runProbe(port, plan());
    expect(stdout).toBe(
      "P 1 1 200 1\nP 2 2 200 1\nP 3 1 200 2\nP 4 2 200 2\nP 5 1 200 3\nP 6 2 200 3\nDONE 6\n",
    );
    expect([...names]).toEqual(["test1-1", "test1-2"]);
    const output = parseProbeOutput(stdout);
    expect(output.complete).toBe(true);
    expect(judge(output, { cells: 2 }).verdict).toBe("held");
  });

  it("records a refusal, a broken body, and a timeout as unanswered, and keeps going", async () => {
    const behaviours: Record<number, Behaviour> = { 2: "busy", 3: "garbage", 4: "hang" };
    const { port } = await counter((request) => behaviours[request] ?? "ok");
    const output = parseProbeOutput(await runProbe(port, plan()));
    expect(output.attempts.map((attempt) => [attempt.status, attempt.n])).toEqual([
      [200, 1],
      [503, null],
      [200, null],
      [0, null],
      [200, 3],
      [200, 2],
    ]);
    expect(output.complete).toBe(true);
    // Cell 1 jumped from 1 to 3 across one unanswered request (the broken body was applied). Explained.
    // Cell 2 went 0 to 2 across two unanswered requests (the timeout was applied). Explained.
    expect(judge(output, { cells: 2 }).verdict).toBe("held");
  });

  it("keeps printing when nothing is listening", async () => {
    const { port } = await counter(() => "ok");
    server?.close();
    const output = parseProbeOutput(await runProbe(port, plan({ rounds: 1 })));
    expect(output.attempts.map((attempt) => attempt.status)).toEqual([0, 0]);
    expect(judge(output, { cells: 2 }).verdict).toBe("inconclusive");
  });
});

describe("the probe plan", () => {
  it("fits in what Run Command returns, by construction", () => {
    const standard = defaultProbePlan("abcd1234");
    expect(probeOutputBound(standard)).toBeLessThan(RUN_COMMAND_STDOUT_LIMIT);
    expect(() => probePlanSchema.parse({ ...standard, cells: 32, rounds: 600 })).toThrow(
      "Run Command keeps 24000",
    );
  });

  it("accepts nothing in the run ID that could leave the URL or the script", () => {
    for (const runId of ["a b", "x'y", "../etc", "ABC", ""]) {
      expect(() => probePlanSchema.parse({ ...defaultProbePlan("abcd"), runId }), runId).toThrow();
    }
  });

  it("bounds how far the probe can have got when the fault lands", () => {
    const standard = defaultProbePlan("abcd1234");
    // 30 s in, with a 1 s pause: at most 31 rounds of 8 have been sent.
    expect(lastSeqBefore(standard, 30)).toBe(248);
    expect(lastSeqBefore(standard, 10_000)).toBe(standard.cells * standard.rounds);
  });
});

describe("reading the probe's output", () => {
  it("notices a missing tail", () => {
    expect(parseProbeOutput("P 1 1 200 1\nP 2 2 200 1\n").complete).toBe(false);
    expect(parseProbeOutput("P 1 1 200 1\nDONE 2\n").complete).toBe(false);
  });

  it("keeps a line it does not understand instead of dropping it", () => {
    const output = parseProbeOutput("P 1 1 200 1\ncurl: (28) timed out\nP 2 1 2000 1\nDONE 1\n");
    expect(output.malformed).toEqual(["curl: (28) timed out", "P 2 1 2000 1"]);
  });
});
