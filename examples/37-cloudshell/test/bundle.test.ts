import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vite-plus/test";

import { ACCOUNT, uploads } from "./support/fixtures.ts";
import { type Shell, shellWith } from "./support/shell.ts";

// The file a reader uploads, run as they would run it, with a fake `aws` first on PATH.
const BUCKET = "aihuploads-uploads-example";
const subcommands = (shell: Shell) => shell.calls().map((call) => call.slice(0, 2).join(" "));

let shell: Shell;
beforeEach(() => {
  shell = shellWith(uploads);
});

describe("the bundle", () => {
  it("imports nothing but Node.js built-ins", () => {
    const source = readFileSync(shell.bundle, "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((name) => name?.startsWith("node:"))).toBe(true);
    expect(source).not.toMatch(/\bimport\(/);
  });

  it("prints usage, and calls nothing, when given no command", () => {
    const result = shell.run([]);
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/usage: node aih-cloudshell\.mjs/);
    expect(shell.calls()).toEqual([]);
  });
});

describe("reading", () => {
  it("whoami prints the account and the caller", () => {
    const result = shell.run(["whoami"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`account: ${ACCOUNT}`);
    expect(result.stdout).toContain(`caller:  arn:aws:iam::${ACCOUNT}:user/aih-dev`);
    expect(subcommands(shell)).toEqual(["sts get-caller-identity"]);
  });

  it("whoami fails when the shell is signed in to another account", () => {
    const result = shell.run(["whoami", "--account", "222222222222"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/belong to account 111111111111/);
  });

  it("budget asks us-east-1, whatever Region the shell was opened in", () => {
    const result = shell.run(["budget"], { AWS_REGION: "eu-west-1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("The forecast for this period is above the limit.");
    const call = shell.calls().find((args) => args[0] === "budgets");
    expect(call?.slice(call.indexOf("--region"), call.indexOf("--region") + 2)).toEqual([
      "--region",
      "us-east-1",
    ]);
  });

  it("left reads the state bucket of this account in the book's Region", () => {
    const result = shell.run(["left"], { AWS_REGION: "eu-west-1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("AihNetwork (ap-northeast-1): 5 resources");
    expect(result.stdout).toContain("3 stacks recorded in cdkd-state-111111111111");
    const listing = shell.calls().find((args) => args[1] === "list-objects-v2") ?? [];
    expect(listing).toContain(`cdkd-state-${ACCOUNT}`);
    expect(listing.slice(listing.indexOf("--region"), listing.indexOf("--region") + 2)).toEqual([
      "--region",
      "ap-northeast-1",
    ]);
    expect(subcommands(shell).every((name) => !name.includes("delete"))).toBe(true);
  });
});

describe("emptying", () => {
  it("counts without --yes, and never calls delete-objects", () => {
    const result = shell.run(["empty", BUCKET]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("versions: 3, delete markers: 1, bytes: 3584");
    expect(result.stdout).toContain("Nothing was deleted.");
    expect(subcommands(shell)).toEqual(["sts get-caller-identity", "s3api list-object-versions"]);
    expect(shell.bucket()).toHaveLength(4);
  });

  it("refuses --yes until the account is named, before touching the bucket", () => {
    const result = shell.run(["empty", BUCKET, "--yes"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/pass --account 111111111111/);
    expect(subcommands(shell)).toEqual(["sts get-caller-identity"]);
    expect(shell.bucket()).toHaveLength(4);
  });

  it("refuses --yes for an account other than the one signed in", () => {
    const result = shell.run(["empty", BUCKET, "--yes", "--account", "222222222222"]);
    expect(result.status).toBe(1);
    expect(subcommands(shell)).toEqual(["sts get-caller-identity"]);
    expect(shell.bucket()).toHaveLength(4);
  });

  it("deletes every version and marker, naming the bucket's owner on each delete", () => {
    const result = shell.run(["empty", BUCKET, "--yes", "--account", ACCOUNT]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("deleted: 4 in 1 rounds");
    expect(shell.bucket()).toEqual([]);
    const deletes = shell.calls().filter((args) => args[1] === "delete-objects");
    expect(deletes).toHaveLength(1);
    for (const call of deletes) {
      expect(call.slice(call.indexOf("--expected-bucket-owner")).slice(0, 2)).toEqual([
        "--expected-bucket-owner",
        ACCOUNT,
      ]);
    }
  });

  it("exits 1 and lists the keys S3 refused, and finishes when run again", () => {
    const args = ["empty", BUCKET, "--yes", "--account", ACCOUNT];
    const first = shell.run(args, { AIH_FAKE_LOCKED: "notes/b.png" });
    expect(first.status).toBe(1);
    expect(first.stderr).toContain("not deleted: notes/b.png m1 AccessDenied");
    expect(shell.bucket().map((item) => item.Key)).toEqual(["notes/b.png", "notes/b.png"]);

    const second = shell.run(args);
    expect(second.status).toBe(0);
    expect(shell.bucket()).toEqual([]);
  });

  it("will not empty cdkd's state bucket, and calls nothing to find that out", () => {
    const result = shell.run(["empty", `cdkd-state-${ACCOUNT}`, "--yes", "--account", ACCOUNT]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/belongs to cdkd/);
    expect(shell.calls()).toEqual([]);
  });
});
