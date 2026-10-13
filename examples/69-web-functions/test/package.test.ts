import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { packageZip } from "../scripts/build.ts";
import { zip, type ZipEntry } from "../src/zip.ts";

/** Reads an archive back from its directory at the end, the way an unzip tool does. */
function unzip(archive: Buffer): ZipEntry[] {
  const end = archive.length - 22;
  expect(archive.toString("latin1", end, end + 4)).toBe("PK\u0005\u0006");
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    expect(archive.toString("latin1", at, at + 4)).toBe("PK\u0001\u0002");
    const packedSize = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.toString("utf8", at + 46, at + 46 + nameLength);
    expect(archive.toString("latin1", local, local + 4)).toBe("PK\u0003\u0004");
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = inflateRawSync(archive.subarray(start, start + packedSize));
    expect(crc32(data), name).toBe(archive.readUInt32LE(at + 16));
    expect(data.length, name).toBe(archive.readUInt32LE(at + 24));
    entries.push({ name, data });
    at += 46 + nameLength;
  }
  return entries;
}

describe("the zip writer", () => {
  it("gives back the files it was given, names in UTF-8 included", () => {
    const files = [
      { name: "index.js", data: Buffer.from("export {};\n".repeat(500)) },
      { name: "静的/empty.txt", data: Buffer.alloc(0) },
    ];
    const back = unzip(zip(files));
    expect(back.map((entry) => entry.name)).toEqual(["index.js", "静的/empty.txt"]);
    expect(back.map((entry) => Buffer.from(entry.data).toString())).toEqual(
      files.map((file) => file.data.toString()),
    );
  });

  it("writes the same bytes for the same files, so a checksum names a build", () => {
    const files = [{ name: "index.js", data: Buffer.from("1") }];
    expect(zip(files).equals(zip(files))).toBe(true);
  });
});

// #region package
describe("the archive a revision is made from", () => {
  let directory = "";
  let entries: ZipEntry[] = [];

  beforeAll(async () => {
    entries = unzip(await packageZip());
    // A clean directory: no node_modules, no source files. Only what the archive holds.
    directory = mkdtempSync(join(tmpdir(), "aih-webfn-"));
    for (const entry of entries) {
      writeFileSync(join(directory, entry.name), entry.data);
    }
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it("has the entry file at its root, where the runtime looks, marked as an ES module", () => {
    expect(entries.map((entry) => entry.name)).toEqual(["index.js", "package.json"]);
    expect(JSON.parse(Buffer.from(entries[1]?.data ?? []).toString())).toEqual({ type: "module" });
  });

  it("starts from the archive alone, listens where it is told, and stops on SIGTERM within a second", async () => {
    const probe = createServer().listen(0, "127.0.0.1");
    await once(probe, "listening");
    const { port } = probe.address() as { port: number };
    probe.close();
    await once(probe, "close");

    const server = spawn(process.execPath, ["index.js"], {
      cwd: directory,
      env: {
        PATH: process.env["PATH"],
        AWS_LAMBDA_HTTP_ENDPOINT: `127.0.0.1:${port}`,
        ALLOWED_ORIGIN: "http://localhost:5173",
        RELEASE: "from-the-archive",
      },
      stdio: "ignore",
    });
    const exited = once(server, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
    try {
      let response: Response | undefined;
      const startedAt = Date.now();
      // Lambda waits 10 seconds for the socket to accept a connection.
      while (response === undefined && Date.now() - startedAt < 10_000) {
        response = await fetch(`http://127.0.0.1:${port}/health`).catch(() => undefined);
      }
      expect(response?.status).toBe(200);
      expect(response?.headers.get("x-aih-release")).toBe("from-the-archive");

      const signalledAt = Date.now();
      server.kill("SIGTERM");
      expect(await exited).toEqual([0, null]);
      expect(Date.now() - signalledAt).toBeLessThan(1000);
    } finally {
      server.kill("SIGKILL");
    }
  }, 20_000);
});
// #endregion package
