import { describe, expect, it } from "vite-plus/test";

import { renderConfig, text } from "../src/capnp.ts";
import { type DeploymentInput, parseDeployment } from "../src/definition.ts";
import { imageDeployment, localDeployment } from "../src/deployments.ts";
import { checkArchive, WORKERD } from "../src/release.ts";

const worker = (name = "notes") => ({
  name,
  module: "notes.mjs",
  compatibilityDate: "2026-10-12",
});
const socket = (name = "http", service = "notes", address = "*:8080") => ({
  name,
  address,
  service,
});
const refused = (input: unknown): string => {
  try {
    parseDeployment(input);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "accepted";
};

describe("a workerd deployment", () => {
  it("accepts what the chapter deploys and what it runs locally", () => {
    expect(imageDeployment.workers.map((item) => item.name)).toEqual(["notes"]);
    expect(localDeployment(8787).sockets[0]?.address).toBe("127.0.0.1:8787");
  });

  it("refuses a socket that points at no worker", () => {
    expect(refused({ workers: [worker()], sockets: [socket("http", "missing")] })).toContain(
      "a socket points at a worker that is not defined",
    );
  });

  it("refuses two workers under one name, and two sockets on one address", () => {
    expect(refused({ workers: [worker(), worker()], sockets: [socket()] })).toContain(
      "two workers share a name",
    );
    expect(refused({ workers: [worker()], sockets: [socket("a"), socket("b")] })).toContain(
      "two sockets share a name or an address",
    );
  });

  it("refuses a compatibility date the pinned workerd does not know, or the calendar does not have", () => {
    const dated = (compatibilityDate: string): DeploymentInput => ({
      workers: [{ ...worker(), compatibilityDate }],
      sockets: [socket()],
    });
    expect(refused(dated(WORKERD.compatibilityDate))).toBe("accepted");
    expect(refused(dated("2026-10-13"))).toContain("knows no date after 2026-10-12");
    expect(refused(dated("2026-02-31"))).toContain("not a date on the calendar");
  });

  it("embeds only a file next to the configuration", () => {
    for (const module of ["../notes.mjs", "/etc/passwd", "a/b.mjs", "notes.js"]) {
      expect(
        refused({ workers: [{ ...worker(), module }], sockets: [socket()] }),
        module,
      ).toContain("a file name like notes.mjs");
    }
  });

  it("refuses two bindings under one name, and text that would need more than two escapes", () => {
    const bound = (bindings: unknown): unknown => ({
      workers: [{ ...worker(), bindings }],
      sockets: [socket()],
    });
    const origin = { from: "text", name: "ALLOWED_ORIGIN", value: "http://localhost:5173" };
    expect(refused(bound([origin, { ...origin, value: "https://other.example" }]))).toContain(
      "a worker has two bindings with one name",
    );
    expect(refused(bound([{ ...origin, value: "line one\nline two" }]))).toContain(
      "printable ASCII only",
    );
    expect(refused(bound([{ from: "secret", name: "TOKEN", value: "x" }]))).not.toBe("accepted");
  });

  it("refuses a port that does not exist", () => {
    expect(
      refused({ workers: [worker()], sockets: [socket("http", "notes", "*:70000")] }),
    ).toContain("the port is out of range");
  });
});

describe("the configuration file", () => {
  it("escapes the two characters that could end a string early", () => {
    expect(text('say "hi"')).toBe('"say \\"hi\\""');
    expect(text("C:\\temp")).toBe('"C:\\\\temp"');
  });

  // #region rendered
  it("is exactly this for the image", () => {
    expect(renderConfig(imageDeployment)).toBe(`using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "notes", worker = (
      modules = [(name = "notes.mjs", esModule = embed "notes.mjs")],
      compatibilityDate = "2026-10-12",
      bindings = [
        (name = "ALLOWED_ORIGIN", fromEnvironment = "ALLOWED_ORIGIN"),
        (name = "LOG_LEVEL", fromEnvironment = "LOG_LEVEL"),
        (name = "STAGE", fromEnvironment = "STAGE"),
      ],
    )),
  ],
  sockets = [
    (name = "http", address = "*:8080", http = (forwardedProtoHeader = "x-forwarded-proto"), service = "notes"),
  ],
);
`);
  });
  // #endregion rendered

  it("leaves out the bindings of a worker that has none", () => {
    const config = renderConfig(parseDeployment({ workers: [worker()], sockets: [socket()] }));
    expect(config).not.toContain("bindings");
    expect(config).toContain("http = (), service");
  });
});

describe("the pinned archive", () => {
  it("is refused when a single byte differs, or when it is empty", () => {
    expect(() => checkArchive(new Uint8Array(WORKERD.linuxArm64.bytes))).toThrow(
      "is not workerd 1.20261012.1 for linux-arm64",
    );
    expect(() => checkArchive(new Uint8Array())).toThrow("0 bytes");
  });
});
