// vp run distsql:local:certs
//   node scripts/certs.ts
//
// Makes a certificate authority in .yugabyte/ca/ and one node certificate for
// 127.0.0.1 in .yugabyte/certs/, for a local cluster with TLS. Needs `openssl`
// on PATH (macOS ships one; the Nix shell does not add one). No network.

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { caArgs, certFiles, extensionsFor, requestArgs, signArgs } from "../src/certs.ts";

const caDirectory = resolve(".yugabyte/ca");
const certsDirectory = resolve(".yugabyte/certs");
const address = "127.0.0.1";
const files = certFiles(address);

function openssl(args: string[]): void {
  try {
    execFileSync("openssl", args, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    console.error(
      `openssl ${args[0]} failed. Is openssl on PATH?\n${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}

mkdirSync(caDirectory, { recursive: true });
mkdirSync(certsDirectory, { recursive: true });
if (!existsSync(`${caDirectory}/ca.key`)) {
  openssl(caArgs(caDirectory));
  chmodSync(`${caDirectory}/ca.key`, 0o400);
  console.log(`${caDirectory}/ca.crt  (new certificate authority)`);
}
if (!existsSync(`${certsDirectory}/${files.certificate}`)) {
  openssl(requestArgs(certsDirectory, address));
  writeFileSync(`${certsDirectory}/node.ext`, extensionsFor(address));
  openssl(
    signArgs({
      caDirectory,
      request: `${certsDirectory}/node.csr`,
      extensions: `${certsDirectory}/node.ext`,
      out: `${certsDirectory}/${files.certificate}`,
    }),
  );
  chmodSync(`${certsDirectory}/${files.key}`, 0o400);
  copyFileSync(`${caDirectory}/ca.crt`, `${certsDirectory}/${files.ca}`);
  console.log(`${certsDirectory}/${files.certificate}  (signed for ${address})`);
}
console.log(
  "Start the cluster with TLS: node scripts/cluster.ts start --tls (on an empty .yugabyte/run)",
);
