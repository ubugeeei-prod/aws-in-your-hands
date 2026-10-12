import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import {
  createHypervisor,
  type Hypervisor,
  measure,
  verifyAttestation,
} from "../src/enclave/attestation.ts";
import { AccessDenied, createKmsModel, InvalidAttestation } from "../src/enclave/kms-model.ts";
import {
  type BootableImage,
  bootEnclave,
  createParent,
  type Parent,
  parentHolds,
  VAULT_IMAGE,
} from "../src/enclave/model.ts";
import type { EnclaveResponse } from "../src/enclave/protocol.ts";
import { keyPolicy, type KeyPolicy } from "../src/policy.ts";

const ROOT = "arn:aws:iam::111122223333:root";
const ROLE = "arn:aws:iam::111122223333:role/parent";

/** A build that answers with the data key itself. Measured like any other image. */
const LEAKY_IMAGE: BootableImage = {
  name: "notes-vault",
  version: "2-with-a-bug",
  program:
    ({ keys }) =>
    async () => {
      try {
        const { plaintext } = await keys.newDataKey(ROLE);
        return { ok: true, body: Buffer.from(plaintext).toString("base64") };
      } catch {
        return { ok: false, error: "key-refused" };
      }
    },
};

function world(
  options: { policy?: KeyPolicy<string>; image?: BootableImage; debug?: boolean } = {},
) {
  const image = options.image ?? VAULT_IMAGE;
  const hypervisor = createHypervisor(() => 1_800_000_000_000);
  /** Every data key KMS ever made, copied as it is made. The first 32 bytes are the KMS key. */
  const issued: Uint8Array[] = [];
  const kms = createKmsModel({
    policy:
      options.policy ??
      keyPolicy({ accountRoot: ROOT, enclaveRole: ROLE, measurement: measure(image) }),
    trusted: hypervisor.rootPublicKey,
    randomBytes: (size) => {
      const bytes = randomBytes(size);
      if (size === 32) {
        issued.push(Buffer.from(bytes));
      }
      return bytes;
    },
  });
  const parent = createParent({ roleArn: ROLE, kms });
  parent.attach(
    bootEnclave({
      hypervisor,
      image,
      debug: options.debug === true,
      kms: parent.proxy,
      randomBytes,
    }),
  );
  const dataKeys = () => issued.slice(1);
  const holdsAKey = () => dataKeys().some((key) => parentHolds(parent, key));
  return { hypervisor, kms, parent, dataKeys, holdsAKey };
}

const wrappedKeyOf = (parent: Parent, note: string): Uint8Array =>
  Buffer.from(parent.stored.get(note)?.wrappedKey ?? "", "base64");
const bodyOf = (response: EnclaveResponse): string | undefined =>
  response.ok && "body" in response ? response.body : undefined;

describe("a note sealed inside the enclave", () => {
  it("comes back as it went in, and the parent never held its key", async () => {
    const { parent, dataKeys, holdsAKey } = world();
    expect((await parent.saveNote("alice", "n1", "買うもの: 牛乳")).ok).toBe(true);
    expect(bodyOf(await parent.readNote("alice", "n1"))).toBe("買うもの: 牛乳");

    expect(dataKeys()).toHaveLength(1);
    expect(holdsAKey()).toBe(false);
    // What the parent does hold: the note's text, on its way in and out.
    expect(parentHolds(parent, Buffer.from("買うもの: 牛乳"))).toBe(true);
  });

  it("uses a new data key for every note", async () => {
    const { parent, dataKeys } = world();
    await parent.saveNote("alice", "n1", "one");
    await parent.saveNote("alice", "n2", "two");
    const [first, second] = dataKeys();
    expect(dataKeys()).toHaveLength(2);
    expect(Buffer.from(first ?? []).equals(Buffer.from(second ?? []))).toBe(false);
  });

  it("does not open a ciphertext moved to another owner or another note", async () => {
    const { parent } = world();
    await parent.saveNote("alice", "n1", "alice's");
    const stolen = parent.stored.get("alice/n1");
    if (stolen === undefined) {
      throw new Error("nothing was stored");
    }
    parent.stored.set("mallory/n1", stolen);
    parent.stored.set("alice/n9", stolen);
    expect(await parent.readNote("mallory", "n1")).toEqual({ ok: false, error: "not-authentic" });
    expect(await parent.readNote("alice", "n9")).toEqual({ ok: false, error: "not-authentic" });
  });

  it("does not open a note whose bytes were changed in storage", async () => {
    const { parent } = world();
    await parent.saveNote("alice", "n1", "original");
    const sealed = parent.stored.get("alice/n1");
    if (sealed === undefined) {
      throw new Error("nothing was stored");
    }
    const flipped = Buffer.from(sealed.ciphertext, "base64");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    parent.stored.set("alice/n1", { ...sealed, ciphertext: flipped.toString("base64") });
    expect(await parent.readNote("alice", "n1")).toEqual({ ok: false, error: "not-authentic" });
  });

  it("answers a malformed message with an error, not an exception", async () => {
    const { hypervisor, kms } = world();
    const enclave = bootEnclave({ hypervisor, image: VAULT_IMAGE, kms, randomBytes });
    const reply = async (message: string) =>
      JSON.parse(Buffer.from(await enclave.send(Buffer.from(message))).toString("utf8")) as unknown;
    expect(await reply("not json")).toEqual({ ok: false, error: "bad-request" });
    expect(await reply(JSON.stringify({ op: "dump-keys" }))).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(
      await reply(
        JSON.stringify({
          op: "seal",
          credentials: { roleArn: ROLE },
          owner: "../alice",
          noteId: "n1",
          body: "x",
        }),
      ),
    ).toEqual({ ok: false, error: "bad-request" });
  });
});

describe("a parent that tries to get the key", () => {
  it("is refused when it calls Decrypt itself, with the very role the enclave uses", async () => {
    const { parent, holdsAKey } = world();
    await parent.saveNote("alice", "n1", "secret");
    expect(() =>
      parent.proxy.decrypt({ principal: ROLE, ciphertextBlob: wrappedKeyOf(parent, "alice/n1") }),
    ).toThrow(AccessDenied);
    expect(() => parent.proxy.generateDataKey({ principal: ROLE })).toThrow(AccessDenied);
    expect(holdsAKey()).toBe(false);
  });

  it("gets only ciphertext when it replays the enclave's attestation document", async () => {
    const { parent, holdsAKey } = world();
    await parent.saveNote("alice", "n1", "secret");
    const recipient = parent.lastAttestation();
    if (recipient === undefined) {
      throw new Error("no attestation document crossed the proxy");
    }
    const response = parent.proxy.decrypt({
      principal: ROLE,
      ciphertextBlob: wrappedKeyOf(parent, "alice/n1"),
      recipient,
    });
    // KMS answered, and answered to the enclave's key. The parent has no private key for it.
    expect(response.Plaintext).toBeUndefined();
    expect(response.CiphertextForRecipient).toBeDefined();
    expect(holdsAKey()).toBe(false);
  });

  it("cannot pass off a document it signed itself", async () => {
    const { parent, kms, holdsAKey } = world();
    await parent.saveNote("alice", "n1", "secret");
    const own = generateKeyPairSync("ec", { namedCurve: "P-384" });
    const reader = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const document = JSON.stringify({
      module_id: "forged",
      timestamp: 1_800_000_000_000,
      digest: "SHA384",
      pcrs: { "0": measure(VAULT_IMAGE) },
      public_key: reader.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    });
    const forged = Buffer.from(
      JSON.stringify({
        document,
        signature: sign("sha384", Buffer.from(document), own.privateKey).toString("base64"),
      }),
    );
    expect(() =>
      kms.decrypt({
        principal: ROLE,
        ciphertextBlob: wrappedKeyOf(parent, "alice/n1"),
        recipient: forged,
      }),
    ).toThrow(InvalidAttestation);
    expect(holdsAKey()).toBe(false);
  });

  it("cannot change the measurements in a genuine document", async () => {
    const { hypervisor } = world();
    const reader = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const other: BootableImage = { ...VAULT_IMAGE, version: "mine" };
    const genuine = JSON.parse(
      Buffer.from(hypervisor.launch(other).attest(reader.publicKey)).toString("utf8"),
    ) as { document: string; signature: string };
    const edited = genuine.document.replace(measure(other), measure(VAULT_IMAGE));
    expect(edited).not.toBe(genuine.document);
    expect(
      verifyAttestation(
        Buffer.from(JSON.stringify({ ...genuine, document: edited })),
        hypervisor.rootPublicKey,
      ),
    ).toBeUndefined();
  });

  it("gets no key from an enclave it builds from a changed image", async () => {
    const { hypervisor, parent, holdsAKey } = world();
    await parent.saveNote("alice", "n1", "secret");
    const mine = bootEnclave({ hypervisor, image: LEAKY_IMAGE, kms: parent.proxy, randomBytes });
    const answer = JSON.parse(
      Buffer.from(await mine.send(Buffer.from("{}"))).toString("utf8"),
    ) as unknown;
    expect(answer).toEqual({ ok: false, error: "key-refused" });
    expect(holdsAKey()).toBe(false);
  });

  it("gets no key from the right image started in debug mode", async () => {
    const { parent, dataKeys } = world({ debug: true });
    expect(await parent.saveNote("alice", "n1", "secret")).toEqual({
      ok: false,
      error: "key-refused",
    });
    expect(dataKeys()).toHaveLength(0);
  });

  it("cannot unwrap a key that another KMS key wrapped", async () => {
    const first = world();
    await first.parent.saveNote("alice", "n1", "secret");
    const second = world();
    const [foreign] = [first.parent.stored.get("alice/n1")];
    if (foreign === undefined) {
      throw new Error("nothing was stored");
    }
    second.parent.stored.set("alice/n1", foreign);
    expect(await second.parent.readNote("alice", "n1")).toEqual({
      ok: false,
      error: "key-refused",
    });
    expect(() =>
      second.kms.decrypt({
        principal: ROLE,
        ciphertextBlob: wrappedKeyOf(first.parent, "alice/n1"),
      }),
    ).toThrow(AccessDenied);
  });
});

describe("what the enclave does not solve", () => {
  it("hands the parent the key when the policy lacks the condition", () => {
    const careless: KeyPolicy<string> = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "Use",
          Effect: "Allow",
          Principal: { AWS: ROLE },
          Action: ["kms:Decrypt", "kms:GenerateDataKey"],
          Resource: "*",
        },
      ],
    };
    const { parent, holdsAKey, dataKeys } = world({ policy: careless });
    const response = parent.proxy.generateDataKey({ principal: ROLE });
    expect(response.Plaintext).toBeDefined();
    expect(dataKeys()).toHaveLength(1);
    expect(holdsAKey()).toBe(true);
  });

  it("hands the parent the key when the measured code itself gives it away", async () => {
    // The policy names this image's measurement, so attestation succeeds. It proves which code
    // runs, not that the code is right.
    const { parent, holdsAKey } = world({ image: LEAKY_IMAGE });
    const response = await parent.saveNote("alice", "n1", "secret");
    expect(response.ok).toBe(true);
    expect(holdsAKey()).toBe(true);
  });
});

describe("the model hypervisor", () => {
  const boot = (hypervisor: Hypervisor, image: BootableImage, debug = false) => {
    const reader = generateKeyPairSync("rsa", { modulusLength: 2048 });
    return verifyAttestation(
      hypervisor.launch(image, { debug }).attest(reader.publicKey),
      hypervisor.rootPublicKey,
    );
  };

  it("measures the image, not what the caller says about it", () => {
    const hypervisor = createHypervisor(() => 0);
    expect(boot(hypervisor, VAULT_IMAGE)?.pcrs[0]).toBe(measure(VAULT_IMAGE));
    expect(boot(hypervisor, LEAKY_IMAGE)?.pcrs[0]).toBe(measure(LEAKY_IMAGE));
    expect(measure(LEAKY_IMAGE)).not.toBe(measure(VAULT_IMAGE));
  });

  it("reports zeros for a debug enclave", () => {
    const hypervisor = createHypervisor(() => 0);
    expect(boot(hypervisor, VAULT_IMAGE, true)?.pcrs[0]).toBe("0".repeat(96));
  });

  it("is not trusted by a verifier that trusts another root", () => {
    const here = createHypervisor(() => 0);
    const elsewhere = createHypervisor(() => 0);
    const reader = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const document = here.launch(VAULT_IMAGE).attest(reader.publicKey);
    expect(verifyAttestation(document, elsewhere.rootPublicKey)).toBeUndefined();
    expect(verifyAttestation(Buffer.from("not a document"), here.rootPublicKey)).toBeUndefined();
  });
});
