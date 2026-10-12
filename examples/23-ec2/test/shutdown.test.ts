import { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";

import { parseEc2Config } from "../src/config.ts";
import { machineFor, SHUTDOWN_GRACE_MS } from "../src/machine.ts";
import { type Closable, createShutdown } from "../src/shutdown.ts";

/** A promise with its resolver on the outside, to hold a request open for exactly as long as a test wants. */
function gate() {
  let open = (): void => undefined;
  const closed = new Promise<void>((resolve) => (open = resolve));
  return { open, closed };
}

describe("shutdown on SIGTERM", () => {
  it("finishes the request in flight, refuses new ones, flushes, then exits 0", async () => {
    const slow = gate();
    const arrived = gate();
    const events: string[] = [];
    const app = new Hono().post("/notes", async (c) => {
      arrived.open();
      await slow.closed;
      events.push("response sent");
      return c.json({ saved: true }, 201);
    });
    // A real socket on loopback: this is about what the operating system does with connections.
    const listening = gate();
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, () =>
      listening.open(),
    );
    await listening.closed;
    if (!(server instanceof Server)) {
      throw new Error("expected an HTTP/1.1 server");
    }
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/notes`;

    const shutdown = createShutdown({
      server,
      flush: async () => void events.push("flushed"),
      graceMs: 5000,
      log: () => undefined,
      exit: (code) => void events.push(`exit ${code}`),
    });

    const inFlight = fetch(url, { method: "POST" });
    await arrived.closed;
    const stopping = shutdown("SIGTERM");

    // The listening socket is closed at once, while the first request is still being served.
    await expect(fetch(url, { method: "POST" })).rejects.toThrow();
    expect(events).toEqual([]);

    slow.open();
    const response = await inFlight;
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ saved: true });
    await stopping;
    expect(events).toEqual(["response sent", "flushed", "exit 0"]);
  });

  function stuckServer() {
    const calls: string[] = [];
    const server: Closable = {
      // Never calls back: a request that will not finish.
      close: () => void calls.push("close"),
      closeAllConnections: () => void calls.push("closeAllConnections"),
    };
    return { server, calls };
  }

  it("cuts the remaining connections when the grace period ends, and says so with exit 1", async () => {
    const { server, calls } = stuckServer();
    const exits: number[] = [];
    let expire = (): void => undefined;
    const shutdown = createShutdown({
      server,
      flush: async () => void calls.push("flush"),
      graceMs: 20_000,
      log: () => undefined,
      exit: (code) => void exits.push(code),
      schedule: (run) => {
        expire = run;
        return { cancel: () => undefined };
      },
    });

    const stopping = shutdown("SIGTERM");
    expire();
    await stopping;

    expect(calls).toEqual(["close", "closeAllConnections", "flush"]);
    expect(exits).toEqual([1]);
  });

  it("treats a second signal as the same shutdown", async () => {
    const { server, calls } = stuckServer();
    const shutdown = createShutdown({
      server,
      flush: async () => undefined,
      graceMs: 1,
      log: () => undefined,
      exit: () => undefined,
    });

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGTERM"), shutdown("SIGINT")]);
    expect(calls.filter((call) => call === "close")).toHaveLength(1);
  });

  it("gives up before systemd does", () => {
    // systemd sends SIGKILL after TimeoutStopSec. The process must have decided by then.
    expect(SHUTDOWN_GRACE_MS).toBeLessThan(
      machineFor(parseEc2Config({})).stopTimeoutSeconds * 1000,
    );
  });
});
