import { request } from "node:http";

import { describe, expect, it } from "vite-plus/test";

import {
  asyncScope,
  moduleScope,
  type RequestScope,
} from "@aih/example-35-lambda-managed-instances/src/scope.ts";

import { RELEASE_HEADER } from "../src/app.ts";
import { serve } from "../src/serve.ts";
import { as, createNote, harness, storedBy } from "./harness.ts";

// Port 0: the operating system picks a free one.
const ANY_PORT = { host: "127.0.0.1", port: 0 };

// #region overlap
/**
 * One process, one listening socket. Request A stops inside its write, request B arrives
 * and is answered, and only then A goes on: two requests in one execution environment.
 */
async function overlap(scope: RequestScope) {
  const test = harness(scope);
  const running = await serve(test.app, ANY_PORT);
  const origin = `http://127.0.0.1:${running.address.port}`;
  try {
    const a = fetch(`${origin}/notes`, as("req-A", createNote("from A")));
    await test.writing;
    const b = await fetch(`${origin}/health`, as("req-B"));
    test.release();
    const answerA = await a;
    const note = (await answerA.json()) as { id: string };
    return {
      a: answerA.headers.get("x-request-id"),
      b: b.headers.get("x-request-id"),
      storedBy: storedBy(test.lines, note.id),
    };
  } finally {
    await running.stop(0);
  }
}
// #endregion overlap

describe("two requests at once in one execution environment", () => {
  // #region invariant
  it("never shows a request the per-request state of another", async () => {
    expect(await overlap(asyncScope)).toEqual({ a: "req-A", b: "req-B", storedBy: "req-A" });
  });

  it("is broken by one variable in module scope: A's write is recorded as B's", async () => {
    expect(await overlap(moduleScope)).toEqual({ a: "req-A", b: "req-B", storedBy: "req-B" });
  });
  // #endregion invariant
});

describe("the app behind a real socket, with no adapter", () => {
  it("answers under the request ID Lambda put on the request, and says which upload it is", async () => {
    const running = await serve(harness(asyncScope).app, ANY_PORT);
    try {
      const response = await fetch(
        `http://127.0.0.1:${running.address.port}/health`,
        as("US3NHLM77IRXDFLBADYHGIZZNM"),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok", stage: "test" });
      expect(response.headers.get("x-request-id")).toBe("US3NHLM77IRXDFLBADYHGIZZNM");
      expect(response.headers.get(RELEASE_HEADER)).toBe("test-release");
    } finally {
      await running.stop(0);
    }
  });

  it("answers the preflight itself: Lambda adds no CORS headers", async () => {
    const running = await serve(harness(asyncScope).app, ANY_PORT);
    try {
      const response = await fetch(`http://127.0.0.1:${running.address.port}/notes`, {
        method: "OPTIONS",
        headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    } finally {
      await running.stop(0);
    }
  });

  // #region upload
  it("answers an oversized upload only after the whole body has arrived", async () => {
    const running = await serve(harness(asyncScope).app, ANY_PORT);
    const total = 256 * 1024;
    const piece = Buffer.alloc(16 * 1024, "a");
    let sent = 0;
    try {
      const answered = await new Promise<{ status: number | undefined; sentBefore: number }>(
        (resolve, reject) => {
          const upload = request(
            {
              host: "127.0.0.1",
              port: running.address.port,
              path: "/notes",
              method: "POST",
              headers: { "content-length": total },
            },
            (response) => resolve({ status: response.statusCode, sentBefore: sent }),
          );
          upload.on("error", reject);
          // One piece per turn of the event loop: the server sees the header long before the end.
          const next = (): void => {
            if (sent >= total) {
              upload.end();
              return;
            }
            upload.write(piece, () => {
              sent += piece.length;
              setImmediate(next);
            });
          };
          next();
        },
      );
      // 64 KiB is the limit, and the header alone says 256 KiB. The answer still waits for the end.
      expect(answered).toEqual({ status: 413, sentBefore: total });
    } finally {
      await running.stop(0);
    }
  });
  // #endregion upload

  it("refuses to start on an address that is already taken", async () => {
    const first = await serve(harness(asyncScope).app, ANY_PORT);
    try {
      await expect(
        serve(harness(asyncScope).app, { host: "127.0.0.1", port: first.address.port }),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      await first.stop(0);
    }
  });
});
