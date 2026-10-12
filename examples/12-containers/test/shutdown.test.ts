import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { Agent, request } from "node:http";
import { connect, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import * as v from "valibot";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { noteSchema } from "@aih/example-04-http-api/src/contract.ts";

import { type RunningServer, startServer } from "../src/serve.ts";

const serverEntry = fileURLToPath(new URL("../src/server.ts", import.meta.url));

/** Reads from a socket until `marker` has arrived, and returns everything read so far. */
function readUntil(socket: Socket, marker: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = "";
    const onData = (chunk: Buffer): void => {
      received += chunk.toString("utf8");
      if (received.includes(marker)) {
        socket.off("data", onData);
        resolve(received);
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.once("close", () =>
      reject(new Error(`connection closed before "${marker}"; got: ${received}`)),
    );
  });
}

// #region sigterm
describe("the server as a process", () => {
  let child: ChildProcess | undefined;
  afterEach(() => void child?.kill("SIGKILL"));

  it("finishes the request it was handling when SIGTERM arrived, then exits with 0", async () => {
    child = spawn(process.execPath, [serverEntry], {
      env: {
        PATH: process.env["PATH"],
        PORT: "0",
        ALLOWED_ORIGIN: "http://localhost:5173",
        APP_VERSION: "test",
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

    // 1. Headers only. "100 Continue" proves the server has the request and waits for its body.
    const body = JSON.stringify({ title: "written while the task was stopping" });
    const socket = connect(port, "127.0.0.1");
    await once(socket, "connect");
    socket.write(
      `POST /notes HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\nExpect: 100-continue\r\n\r\n`,
    );
    await readUntil(socket, "100 Continue");

    // 2. The stop signal arrives in the middle of that request.
    child.kill("SIGTERM");
    expect(await nextLog("draining")).toMatchObject({ signal: "SIGTERM" });

    // 3. New connections get nowhere: the task is no longer listening.
    // Usually a refusal. On a busy machine the kernel has been seen to answer with a reset instead.
    const late = connect(port, "127.0.0.1");
    const [turnedAway] = (await once(late, "error")) as [NodeJS.ErrnoException];
    expect(["ECONNREFUSED", "ECONNRESET"]).toContain(turnedAway.code);

    // 4. The request that was in flight still gets its whole answer.
    // The server streams its body, so the answer is chunked, and the empty chunk is its end.
    socket.write(body);
    const response = await readUntil(socket, "\r\n0\r\n\r\n");
    expect(response).toContain("HTTP/1.1 201 Created");
    expect(response).toContain("x-app-version: test");
    const note = v.parse(
      noteSchema,
      JSON.parse(response.slice(response.indexOf("{"), response.lastIndexOf("}") + 1)),
    );
    expect(note.title).toBe("written while the task was stopping");

    // 5. Only then does the process stop, and it says it lost nothing.
    expect(await nextLog("stopped")).toMatchObject({ result: "drained" });
    const [code, signal] = (await exited) as [number | null, NodeJS.Signals | null];
    expect({ code, signal }).toEqual({ code: 0, signal: null });
  });
});
// #endregion sigterm

describe("startServer", () => {
  let server: RunningServer | undefined;
  afterEach(async () => void (await server?.shutdown()));

  const get = (port: number, agent?: Agent): Promise<number> =>
    new Promise((resolve, reject) => {
      request({ port, host: "127.0.0.1", path: "/", agent }, (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      })
        .once("error", reject)
        .end();
    });

  it("waits for a slow handler instead of cutting it", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started = (): void => {};
    const handling = new Promise<void>((resolve) => (started = resolve));
    server = await startServer({
      fetch: async () => {
        started();
        await gate;
        return new Response("done");
      },
      port: 0,
      keepAliveTimeoutMs: 65_000,
      maxConnections: 16,
      shutdownDeadlineMs: 5_000,
    });

    const answer = get(server.port);
    await handling;
    let result: string | undefined;
    const stopping = server.shutdown().then((value) => (result = value));

    // The handler has not returned, so shutdown has to be still pending.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(result).toBeUndefined();

    release();
    expect(await answer).toBe(200);
    expect(await stopping).toBe("drained");
  });

  it("does not wait for an idle keep-alive connection", async () => {
    server = await startServer({
      fetch: () => new Response("ok"),
      port: 0,
      keepAliveTimeoutMs: 65_000,
      maxConnections: 16,
      shutdownDeadlineMs: 5_000,
    });
    // The load balancer keeps connections open between requests, as this agent does.
    const agent = new Agent({ keepAlive: true });
    expect(await get(server.port, agent)).toBe(200);

    const startedAt = Date.now();
    expect(await server.shutdown()).toBe("drained");
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    agent.destroy();
  });

  it("gives up at the deadline and says so", async () => {
    server = await startServer({
      fetch: () => new Promise<Response>(() => {}),
      port: 0,
      keepAliveTimeoutMs: 65_000,
      maxConnections: 16,
      shutdownDeadlineMs: 150,
    });
    const answer = get(server.port).catch((error: NodeJS.ErrnoException) => error.code);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await server.shutdown()).toBe("forced");
    // The client sees a broken connection, not a response.
    expect(await answer).toBe("ECONNRESET");
  });

  it("closes a connection past the limit unanswered, and still answers the ones it holds", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let handling = 0;
    server = await startServer({
      fetch: async () => {
        handling += 1;
        await gate;
        return new Response("done");
      },
      port: 0,
      keepAliveTimeoutMs: 65_000,
      maxConnections: 2,
      shutdownDeadlineMs: 5_000,
    });

    const held = [get(server.port), get(server.port)];
    while (handling < 2) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // The third socket is accepted by the OS and dropped by the server: no status line, no handler.
    const refused = await get(server.port).catch((error: NodeJS.ErrnoException) => error.code);
    expect(refused).toBe("ECONNRESET");
    expect(handling).toBe(2);

    release();
    expect(await Promise.all(held)).toEqual([200, 200]);
  });

  it("treats a second signal as the same shutdown", async () => {
    server = await startServer({
      fetch: () => new Response("ok"),
      port: 0,
      keepAliveTimeoutMs: 65_000,
      maxConnections: 16,
      shutdownDeadlineMs: 5_000,
    });
    expect(server.shutdown()).toBe(server.shutdown());
  });
});
