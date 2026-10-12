// vp run nitro:demo
//
// One note sealed and opened through the model enclave, then the parent trying to get the
// key on its own. Everything runs in this process: no enclave, no KMS, no AWS.

import { randomBytes } from "node:crypto";

import { createHypervisor, measure } from "../src/enclave/attestation.ts";
import { AccessDenied, createKmsModel } from "../src/enclave/kms-model.ts";
import { bootEnclave, createParent, parentHolds, VAULT_IMAGE } from "../src/enclave/model.ts";
import { keyPolicy } from "../src/policy.ts";

const ROLE = "arn:aws:iam::111122223333:role/parent";

const dataKeys: Uint8Array[] = [];
const hypervisor = createHypervisor(() => Date.now());
const kms = createKmsModel({
  policy: keyPolicy({
    accountRoot: "arn:aws:iam::111122223333:root",
    enclaveRole: ROLE,
    measurement: measure(VAULT_IMAGE),
  }),
  trusted: hypervisor.rootPublicKey,
  // The first 32 bytes asked for are the KMS key. Every later 32 are a data key.
  randomBytes: (size) => {
    const bytes = randomBytes(size);
    if (size === 32) {
      dataKeys.push(Buffer.from(bytes));
    }
    return bytes;
  },
});
const parent = createParent({ roleArn: ROLE, kms });
parent.attach(bootEnclave({ hypervisor, image: VAULT_IMAGE, kms: parent.proxy, randomBytes }));

const said = (step: string, result: string) => console.log(`${step.padEnd(46)} ${result}`);
const attempt = (step: string, call: () => unknown) => {
  try {
    call();
    said(step, "answered");
  } catch (error) {
    said(step, error instanceof AccessDenied ? `refused: ${error.message}` : String(error));
  }
};

console.log(`PCR0 of the model image   ${measure(VAULT_IMAGE)}\n`);

const saved = await parent.saveNote("alice", "n1", "the note");
said("parent asks the enclave to seal a note", saved.ok ? "sealed" : saved.error);
const read = await parent.readNote("alice", "n1");
said("parent asks the enclave to open it", read.ok && "body" in read ? `"${read.body}"` : "failed");

const wrapped = Buffer.from(parent.stored.get("alice/n1")?.wrappedKey ?? "", "base64");
attempt("parent calls Decrypt with the same role", () =>
  parent.proxy.decrypt({ principal: ROLE, ciphertextBlob: wrapped }),
);
const replayed = parent.lastAttestation();
attempt("parent replays the enclave's document", () =>
  parent.proxy.decrypt({
    principal: ROLE,
    ciphertextBlob: wrapped,
    ...(replayed === undefined ? {} : { recipient: replayed }),
  }),
);
const debug = bootEnclave({
  hypervisor,
  image: VAULT_IMAGE,
  debug: true,
  kms: parent.proxy,
  randomBytes,
});
const fromDebug = JSON.parse(
  Buffer.from(
    await debug.send(
      Buffer.from(
        JSON.stringify({
          op: "seal",
          credentials: { roleArn: ROLE },
          owner: "alice",
          noteId: "n2",
          body: "x",
        }),
      ),
    ),
  ).toString("utf8"),
) as { ok: boolean; error?: string };
said("the same image in debug mode asks for a key", fromDebug.ok ? "sealed" : `${fromDebug.error}`);

const held = dataKeys.slice(1).some((key) => parentHolds(parent, key));
console.log(
  `\nData keys issued: ${dataKeys.length - 1}. In the parent's hands: ${held ? "YES" : "none"}.`,
);
console.log("The note's text did pass through the parent. Only the key did not.");
process.exitCode = held ? 1 : 0;
