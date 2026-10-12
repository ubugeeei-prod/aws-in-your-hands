import { App } from "aws-cdk-lib";

import { LedgerStack, parseLock } from "../lib/ledger-stack.ts";

const app = new App();

new LedgerStack(app, "AihLedger", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 58: an append-only ledger and its locked digests",
  // `-c lockMode=compliance -c lockDays=2557` for digests nobody can delete for seven years.
  lock: parseLock({
    mode: app.node.tryGetContext("lockMode"),
    days: app.node.tryGetContext("lockDays"),
  }),
});
