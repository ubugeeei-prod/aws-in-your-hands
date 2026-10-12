import { describe, expect, it } from "vite-plus/test";

import { INSTANCE_STATES, instanceInfoSchema, versionSchema } from "../src/client.ts";
import { parseMicroVmConfig } from "../src/config.ts";
import {
  type ApiRequest,
  bootSequence,
  describeInstance,
  getVersion,
  snapshotSequence,
} from "../src/requests.ts";
import {
  bodyDefinition,
  conforms,
  extractSubset,
  findOperation,
  KNOWN_KEYWORDS,
  type SchemaNode,
  SPEC,
  USED_OPERATIONS,
} from "../src/spec.ts";
import { loadSubset } from "../src/subset.ts";

const spec = loadSubset();
const definition = (name: string): SchemaNode => {
  const found = spec.definitions[name];
  if (found === undefined) {
    throw new Error(`${name} is not in the subset`);
  }
  return found;
};

const everything = parseMicroVmConfig({
  vcpuCount: 2,
  memSizeMib: 512,
  kernelImagePath: "/srv/vmlinux",
  rootfs: { pathOnHost: "/srv/rootfs.ext4", readOnly: true },
  network: {
    hostDevName: "tap0",
    guestMac: "06:00:AC:10:00:02",
    rxRateLimiter: { bandwidth: { size: 1_048_576, refillTimeMs: 1000, oneTimeBurst: 4_194_304 } },
    txRateLimiter: { ops: { size: 2000, refillTimeMs: 1000 } },
  },
});
const allRequests: ApiRequest[] = [
  describeInstance,
  getVersion,
  ...bootSequence(everything),
  ...snapshotSequence({ snapshotPath: "/srv/s.state", memFilePath: "/srv/s.mem" }),
];

describe("the committed part of the specification", () => {
  it("is the pinned release, cut from the file with the pinned checksum", () => {
    expect(spec.info.version).toBe(SPEC.version);
    expect(spec.source).toEqual({
      url: SPEC.url,
      sha256: SPEC.sha256,
      license: { name: "Apache 2.0", url: "http://www.apache.org/licenses/LICENSE-2.0.html" },
    });
  });

  it("holds the used operations and no others", () => {
    const held = Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method} ${path}`),
    );
    expect(held.toSorted()).toEqual(
      USED_OPERATIONS.map(({ method, path }) => `${method} ${path}`).toSorted(),
    );
  });

  it("uses only schema keywords this example knows about", () => {
    const seen = new Set<string>();
    const walk = (node: SchemaNode) => {
      for (const [keyword, value] of Object.entries(node)) {
        if (keyword === "properties") {
          Object.values(value as Record<string, SchemaNode>).forEach(walk);
        } else {
          seen.add(keyword);
        }
      }
    };
    Object.values(spec.definitions).forEach(walk);
    expect(
      [...seen].filter((keyword) => !KNOWN_KEYWORDS.some((known) => known === keyword)),
    ).toEqual([]);
  });
});

describe("every request this example can send", () => {
  it.each(allRequests.map((request) => [request.operationId, request.path, request] as const))(
    "%s %s is an operation of the specification, with that name, success status and body",
    (_id, _path, request) => {
      const found = findOperation(spec, request.method, request.path);
      expect(found?.operation.operationId).toBe(request.operationId);
      expect(Object.keys(found?.operation.responses ?? {})).toContain(String(request.expect));

      const name = found === undefined ? undefined : bodyDefinition(found.operation);
      if (name === undefined) {
        expect(request.body).toBeUndefined();
      } else {
        expect(conforms(spec, definition(name), request.body)).toEqual([]);
      }
    },
  );

  it("covers each used operation at least once", () => {
    const sent = new Set(
      allRequests.map((request) => {
        const found = findOperation(spec, request.method, request.path);
        return `${request.method.toLowerCase()} ${found?.template}`;
      }),
    );
    expect([...sent].toSorted()).toEqual(
      USED_OPERATIONS.map(({ method, path }) => `${method} ${path}`).toSorted(),
    );
  });
});

describe("this example's own schemas against the specification", () => {
  it("accepts exactly the vCPU range the specification gives", () => {
    const { minimum, maximum } =
      definition("MachineConfiguration").properties?.["vcpu_count"] ?? {};
    expect([minimum, maximum]).toEqual([1, 32]);
    const base = { kernelImagePath: "k", rootfs: { pathOnHost: "r" } };
    expect(parseMicroVmConfig({ ...base, vcpuCount: 1 }).vcpuCount).toBe(1);
    expect(parseMicroVmConfig({ ...base, vcpuCount: 32 }).vcpuCount).toBe(32);
    for (const vcpuCount of [0, 33, 1.5]) {
      expect(() => parseMicroVmConfig({ ...base, vcpuCount })).toThrow("vcpuCount");
    }
  });

  it("reads the instance states and fields the specification lists", () => {
    const info = definition("InstanceInfo");
    expect(info.properties?.["state"]?.enum).toEqual([...INSTANCE_STATES]);
    expect(info.required?.toSorted()).toEqual(Object.keys(instanceInfoSchema.entries).toSorted());
    expect(definition("FirecrackerVersion").required).toEqual(Object.keys(versionSchema.entries));
    expect(Object.keys(definition("Error").properties ?? {})).toEqual(["fault_message"]);
  });

  it("sends only values the enumerations contain", () => {
    expect(definition("InstanceActionInfo").properties?.["action_type"]?.enum).toContain(
      "InstanceStart",
    );
    expect(definition("Vm").properties?.["state"]?.enum).toEqual(["Paused", "Resumed"]);
    expect(definition("SnapshotCreateParams").properties?.["snapshot_type"]?.enum).toContain(
      "Full",
    );
  });
});

describe("conforms", () => {
  const drive = definition("Drive");

  it("reports a missing required field, a misspelt one, and a wrong type", () => {
    expect(conforms(spec, drive, { drive_id: "rootfs" })).toEqual([
      "body.is_root_device: required",
    ]);
    expect(
      conforms(spec, drive, { drive_id: "rootfs", is_root_device: true, path_on_hots: "/x" }),
    ).toEqual(["body.path_on_hots: not in the definition"]);
    expect(conforms(spec, drive, { drive_id: 1, is_root_device: "yes" })).toEqual([
      "body.drive_id: expected a string",
      "body.is_root_device: expected a boolean",
    ]);
  });

  it("follows references and checks ranges and enumerations", () => {
    expect(
      conforms(spec, definition("MachineConfiguration"), { vcpu_count: 64, mem_size_mib: 128 }),
    ).toEqual(["body.vcpu_count: 64 is outside 1..32"]);
    expect(
      conforms(spec, definition("NetworkInterface"), {
        iface_id: "net1",
        host_dev_name: "tap0",
        rx_rate_limiter: { bandwidth: { size: -1, refill_time: 1000 } },
      }),
    ).toEqual(["body.rx_rate_limiter.bandwidth.size: -1 is outside 0..undefined"]);
    expect(conforms(spec, definition("Vm"), { state: "Stopped" })).toEqual([
      'body.state: "Stopped" is not one of Paused, Resumed',
    ]);
  });
});

describe("extractSubset", () => {
  const license = { name: "Apache 2.0", url: "http://www.apache.org/licenses/LICENSE-2.0.html" };
  const operation = (ref?: string) => ({
    operationId: "x",
    ...(ref === undefined
      ? {}
      : { parameters: [{ name: "body", in: "body", schema: { $ref: `#/definitions/${ref}` } }] }),
    responses: { 204: {} },
  });
  const paths: Record<string, unknown> = Object.fromEntries(
    USED_OPERATIONS.map(({ path }) => [
      path,
      Object.fromEntries(
        USED_OPERATIONS.filter((used) => used.path === path).map(({ method }) => [
          method,
          operation(path === "/vm" ? "A" : undefined),
        ]),
      ),
    ]),
  );
  const document = {
    info: { title: "t", version: "0", license },
    paths: { ...paths, "/unused": { get: operation("Unused") } } as Record<string, unknown>,
    definitions: {
      A: { type: "object", properties: { b: { $ref: "#/definitions/B" } } },
      B: { type: "string" },
      Unused: { type: "string" },
    },
  };

  it("keeps the definitions the used operations reach, through references, and drops the rest", () => {
    const subset = extractSubset(document);
    expect(Object.keys(subset.definitions)).toEqual(["A", "B"]);
    expect(Object.keys(subset.paths)).not.toContain("/unused");
  });

  it("fails when a used operation is gone from the specification", () => {
    const { "/vm": _gone, ...rest } = document.paths;
    expect(() => extractSubset({ ...document, paths: rest })).toThrow("no PATCH /vm");
  });
});
