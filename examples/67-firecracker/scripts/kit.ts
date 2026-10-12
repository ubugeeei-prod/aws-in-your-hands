// vp run firecracker:kit:publish    upload dist/kit as one archive to the stack's bucket
// vp run firecracker:kit:empty      delete it, so that the bucket can be destroyed
//
// Both call AWS with the aws CLI and your credentials.

import { spawnSync } from "node:child_process";

import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { HOST_STACK, KIT_FILE, KIT_PREFIX, REGION } from "../src/host-config.ts";

const action = process.argv[2];
if (action !== "publish" && action !== "empty") {
  console.error("usage: kit.ts publish|empty");
  process.exit(64);
}

const run = (command: string, args: string[]): void => {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
};

const outputs = await readStackOutputs(process.cwd(), HOST_STACK, REGION);
const target = `s3://${requireOutput(outputs, "KitBucketName")}/${KIT_PREFIX}`;

if (action === "publish") {
  run("tar", ["-czf", `dist/${KIT_FILE}`, "-C", "dist/kit", "."]);
  run("aws", ["s3", "cp", `dist/${KIT_FILE}`, `${target}${KIT_FILE}`, "--region", REGION]);
  console.log(`On the instance: aws s3 cp ${target}${KIT_FILE} . && tar -xzf ${KIT_FILE}`);
} else {
  run("aws", ["s3", "rm", target, "--recursive", "--region", REGION]);
}
