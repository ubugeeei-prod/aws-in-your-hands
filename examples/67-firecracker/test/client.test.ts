import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  createClient,
  FirecrackerApiError,
  NoAnswerError,
  type Transport,
  unixSocketTransport,
} from "../src/client.ts";
import { parseMicroVmConfig, WALKTHROUGH_CONFIG } from "../src/config.ts";
import {
  bootSequence,
  configureSequence,
  instanceStart,
  snapshotSequence,
} from "../src/requests.ts";
import { loadSubset } from "../src/subset.ts";
import { startFakeFirecracker } from "./support/fake-firecracker.ts";

const spec = loadSubset();
const config = parseMicroVmConfig(WALKTHROUGH_CONFIG);
const files = { snapshotPath: "work/snapshot.state", memFilePath: "work/snapshot.mem" };

let fake: Awaited<ReturnType<typeof startFakeFirecracker>>;
let client: ReturnType<typeof createClient>;

beforeEach(async () => {
  fake = await startFakeFirecracker(spec);
  client = createClient(unixSocketTransport(fake.socketPath, 500));
});
afterEach(() => fake.close());

const sent = () => fake.requests.map((request) => `${request.method} ${request.path}`);

describe("booting through the socket", () => {
  it("configures the machine, the kernel, the root drive and the network, then starts once", async () => {
    expect((await client.instance()).state).toBe("Not started");
    await client.run(bootSequence(config));

    expect(sent().slice(1)).toEqual([
      "PUT /machine-config",
      "PUT /boot-source",
      "PUT /drives/rootfs",
      "PUT /network-interfaces/net1",
      "PUT /actions",
    ]);
    expect([...fake.configured.keys()]).toEqual([
      "/machine-config",
      "/boot-source",
      "/drives/rootfs",
      "/network-interfaces/net1",
    ]);
    expect((await client.instance()).state).toBe("Running");
    expect(await client.version()).toBe(spec.info.version);
  });

  it("never starts a microVM whose configuration was refused part-way", async () => {
    fake.refuseOnce("putGuestDriveByID", "No such file or directory: work/rootfs.ext4");

    const failure = await client.run(bootSequence(config)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FirecrackerApiError);
    expect(failure).toMatchObject({
      operationId: "putGuestDriveByID",
      status: 400,
      faultMessage: "No such file or directory: work/rootfs.ext4",
    });
    expect(sent()).toEqual(["PUT /machine-config", "PUT /boot-source", "PUT /drives/rootfs"]);
    expect(fake.state()).toBe("Not started");
  });

  it("can send the configuration again after a failure: each call replaces what was there", async () => {
    fake.refuseOnce("putGuestNetworkInterfaceByID", "tap0 is busy");
    await expect(client.run(configureSequence(config))).rejects.toThrow("tap0 is busy");

    await client.run(bootSequence(config));
    expect(fake.configured.size).toBe(4);
    expect(fake.state()).toBe("Running");
  });

  it("is refused when it starts with no kernel or root drive", async () => {
    await expect(client.send(instanceStart)).rejects.toThrow("needs a boot source");
    expect(fake.state()).toBe("Not started");
  });

  it("cannot change the machine once the guest runs", async () => {
    await client.run(bootSequence(config));
    const [machine] = configureSequence({ ...config, memSizeMib: 4096 });
    await expect(machine && client.send(machine)).rejects.toThrow("pre-boot only");
    expect(fake.configured.get("/machine-config")).toEqual({ vcpu_count: 1, mem_size_mib: 256 });
  });
});

describe("a lost answer to InstanceStart", () => {
  it("is not answered by sending the start again: that is refused although the guest runs", async () => {
    await client.run(configureSequence(config));
    fake.dropAnswerOnce("createSyncAction");

    await expect(client.send(instanceStart)).rejects.toBeInstanceOf(NoAnswerError);
    expect(fake.state()).toBe("Running");
    await expect(client.send(instanceStart)).rejects.toThrow("can only be called once");
  });

  it("is settled by reading the state, and the start is sent exactly once", async () => {
    await client.run(configureSequence(config));
    fake.dropAnswerOnce("createSyncAction");

    await expect(client.startOnce()).resolves.toBe("was-running");
    expect(sent().filter((line) => line === "PUT /actions")).toHaveLength(1);
    expect(sent().at(-1)).toBe("GET /");
  });

  it("stays an error when nothing answers at all", async () => {
    const nobody = createClient(unixSocketTransport(`${fake.socketPath}.missing`, 200));
    await expect(nobody.startOnce()).rejects.toBeInstanceOf(NoAnswerError);
  });

  it("stays an error when the state read back is not Running", async () => {
    let calls = 0;
    const transport: Transport = async ({ path }) => {
      calls += 1;
      if (path === "/actions") {
        throw new Error("socket hang up");
      }
      return {
        status: 200,
        body: JSON.stringify({
          app_name: "Firecracker",
          id: "x",
          state: "Not started",
          vmm_version: "1.17.0",
        }),
      };
    };
    await expect(createClient(transport).startOnce()).rejects.toBeInstanceOf(NoAnswerError);
    expect(calls).toBe(2);
  });
});

describe("a snapshot", () => {
  it("is refused while the guest runs", async () => {
    await client.run(bootSequence(config));
    const [, create] = snapshotSequence(files);
    await expect(create && client.send(create)).rejects.toThrow("needs a Paused microVM");
    expect(fake.snapshots).toEqual([]);
  });

  it("pauses, writes a full snapshot, and resumes", async () => {
    await client.run(bootSequence(config));
    await client.run(snapshotSequence(files));
    expect(fake.snapshots).toEqual([
      {
        snapshot_type: "Full",
        snapshot_path: files.snapshotPath,
        mem_file_path: files.memFilePath,
      },
    ]);
    expect(fake.state()).toBe("Running");
  });

  it("cannot pause a microVM that never booted", async () => {
    await expect(client.run(snapshotSequence(files))).rejects.toThrow("not booted");
  });
});

describe("answers that are not what the specification describes", () => {
  it("rejects an instance state outside the enumeration", async () => {
    const transport: Transport = async () => ({
      status: 200,
      body: JSON.stringify({
        app_name: "Firecracker",
        id: "x",
        state: "Booting",
        vmm_version: "1",
      }),
    });
    await expect(createClient(transport).instance()).rejects.toThrow();
  });

  it("reports the status when an error body is not JSON", async () => {
    const transport: Transport = async () => ({ status: 500, body: "<html>" });
    await expect(createClient(transport).send(instanceStart)).rejects.toMatchObject({
      status: 500,
      faultMessage: undefined,
    });
  });
});
