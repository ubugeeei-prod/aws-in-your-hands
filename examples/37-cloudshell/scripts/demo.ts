// vp run cloudshell:demo
//   node scripts/demo.ts
//
// Runs the bundle against test/support/fake-aws.ts, so the output can be read without an
// account. Every figure it prints comes from test/support/fixtures.ts, not from AWS.

import { ACCOUNT, uploads } from "../test/support/fixtures.ts";
import { shellWith } from "../test/support/shell.ts";

const shell = shellWith(uploads);
const commands = [
  ["whoami"],
  ["budget"],
  ["left"],
  ["empty", "aihuploads-uploads-example"],
  ["empty", "aihuploads-uploads-example", "--yes", "--account", ACCOUNT],
];

console.log("The answers below are fixtures. Nothing here reached AWS.\n");
for (const args of commands) {
  const result = shell.run(args);
  console.log(`$ node aih-cloudshell.mjs ${args.join(" ")}`);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  console.log(`(exit ${result.status})\n`);
}
