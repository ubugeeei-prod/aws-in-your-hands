// vp run nitro:names [type ...]
//
// Reads instance type names part by part, from the naming page as copied into
// src/instance-type.ts. No AWS: it does not know which types exist.

import { decodeInstanceType, describeInstanceType } from "../src/instance-type.ts";

// The book's instances, the two this chapter offers, and a few names that show the options.
const DEFAULTS = [
  "t4g.micro",
  "c6g.large",
  "m6g.large",
  "c6i.xlarge",
  "m7i-flex.large",
  "c7gn.metal",
];

const names = process.argv.slice(2);
for (const name of names.length > 0 ? names : DEFAULTS) {
  try {
    console.log(describeInstanceType(decodeInstanceType(name)).join("\n"));
  } catch (error) {
    console.log(`${name}\n  ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
  console.log("");
}
