import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { connect, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { timing, timingProblems } from "@aih/example-12-containers/src/timing.ts";

import { SPOT_NOTICE, spotProblems } from "../src/spot.ts";

// Chapter 12's server, through the workspace dependency: the file the image runs.
const serverEntry = fileURLToPath(import.meta.resolve("@aih/example-12-containers/src/server.ts"));

describe("the deployed durations against a Spot interruption", () => {
  it("fit inside the two-minute notice", () => {
    expect(spotProblems(timing)).toEqual([]);
    expect(timingProblems(timing)).toEqual([]);
    expect(timing.stopTimeout).toBeLessThanOrEqual(SPOT_NOTICE);
  });

  it("would not with a stop timeout Fargate refuses anyway", () => {
    expect(spotProblems({ ...timing, stopTimeout: 300 })).toEqual([
      "the stop timeout is longer than the two-minute notice, so the task ends before the timeout does",
    ]);
  });

  it("would lose the report of what was dropped if the server waited as long as ECS does", () => {
    expect(spotProblems({ ...timing, shutdownDeadline: timing.stopTimeout })).toHaveLength(1);
  });
});

function readUntil(socket: Socket, marker: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = "";
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString("utf8");
      if (received.includes(marker)) {
        resolve(received);
      }
    });
    socket.once("error", reject);
    socket.once("close", () => reject(new Error(`closed before "${marker}"; got: ${received}`)));
  });
}

// #region interruption
describe("a Spot interruption, as the task sees it", () => {
  let child: ChildProcess | undefined;
  afterEach(() => void child?.kill("SIGKILL"));

  it("is a SIGTERM: the request in flight is answered, new ones are refused, the exit is 0", async () => {
    child = spawn(process.execPath, [serverEntry], {
      env: {
        PATH: process.env["PATH"],
        PORT: "0",
        ALLOWED_ORIGIN: "http://localhost:5173",
        APP_VERSION: "spot",
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const exited = once(child, "exit");
    const lines = createInterface({ input: child.stdout ?? process.stdin })[Symbol.asyncIterator]();
    const nextLog = async (message: string): Promise<Record<string, unknown>> => {
      for (;;) {
        const { value, done } = await lines.next();
        if (done === true) {
          throw new Error(`the server exited before logging "${message}"`);
        }
        const entry = JSON.parse(value) as Record<string, unknown>;
        if (entry["message"] === message) {
          return entry;
        }
      }
    };
    const port = Number((await nextLog("listening"))["port"]);

    // 1. A request whose headers have arrived and whose body has not: it is in flight.
    const body = JSON.stringify({ title: "written while Spot took the task back" });
    const socket = connect(port, "127.0.0.1");
    await once(socket, "connect");
    socket.write(
      `POST /notes HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\nExpect: 100-continue\r\n\r\n`,
    );
    await readUntil(socket, "100 Continue");

    // 2. The interruption notice. Nothing tells the process that it came from Spot.
    const noticedAt = Date.now();
    child.kill("SIGTERM");
    expect(await nextLog("draining")).toMatchObject({ signal: "SIGTERM" });

    // 3. The load balancer may still be routing here. A new connection gets nowhere.
    const late = connect(port, "127.0.0.1");
    const [turnedAway] = (await once(late, "error")) as [NodeJS.ErrnoException];
    expect(["ECONNREFUSED", "ECONNRESET"]).toContain(turnedAway.code);

    // 4. The request in flight still gets its whole answer.
    socket.write(body);
    expect(await readUntil(socket, "\r\n0\r\n\r\n")).toContain("HTTP/1.1 201 Created");

    // 5. The process is gone long before the two minutes are up, having lost nothing.
    expect(await nextLog("stopped")).toMatchObject({ result: "drained" });
    const [code, signal] = (await exited) as [number | null, NodeJS.Signals | null];
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(Date.now() - noticedAt).toBeLessThan(SPOT_NOTICE * 1000);
  });
});
// #endregion interruption
