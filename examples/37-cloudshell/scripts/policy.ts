// vp run cloudshell:policy <use|use-no-files|deny|vpc-only>
//   node scripts/policy.ts <name>
//
// Prints an IAM policy document. It creates nothing: attach it yourself, where it belongs.

import {
  allowShell,
  denyPublicEnvironments,
  denyShell,
  type PolicyDocument,
} from "../src/policy.ts";

const documents: Record<string, () => PolicyDocument> = {
  use: () => allowShell({ credentials: true, fileTransfer: true }),
  "use-no-files": () => allowShell({ credentials: true, fileTransfer: false }),
  deny: denyShell,
  "vpc-only": denyPublicEnvironments,
};

const name = process.argv[2] ?? "";
const document = documents[name];
if (document === undefined) {
  console.error(`usage: policy.ts <${Object.keys(documents).join("|")}>`);
  process.exit(64);
}
console.log(JSON.stringify(document(), null, 2));
