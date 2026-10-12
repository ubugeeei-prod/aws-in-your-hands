// Stands in for the `aws` executable: answers from fixtures, keeps one bucket in a JSON file,
// and writes down every call. It never opens a socket.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

import { budget, caller, type FakeVersion, stateKeys, states } from "./fixtures.ts";

const args = process.argv.slice(2);
const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`fake aws: ${name} is not set`);
  }
  return value;
};
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

appendFileSync(env("AIH_FAKE_LOG"), `${JSON.stringify(args)}\n`);

const bucketFile = env("AIH_FAKE_BUCKET");
const readBucket = (): FakeVersion[] => JSON.parse(readFileSync(bucketFile, "utf8"));
const PAGE = 1000;

switch (args.slice(0, 2).join(" ")) {
  case "sts get-caller-identity":
    print(caller);
    break;
  case "budgets describe-budget":
    print(budget);
    break;
  case "s3api list-objects-v2":
    print(stateKeys);
    break;
  case "s3 cp": {
    const key = (args[2] ?? "").replace(/^s3:\/\/[^/]+\//, "");
    process.stdout.write(JSON.stringify(states[key]));
    break;
  }
  case "s3api list-object-versions": {
    const start = Number(option("--starting-token") ?? "0");
    const page = readBucket().slice(start, start + PAGE);
    const rest = readBucket().length > start + PAGE;
    print({
      Versions: page.filter((item) => item.marker !== true),
      DeleteMarkers: page
        .filter((item) => item.marker === true)
        .map(({ Key, VersionId }) => ({ Key, VersionId })),
      ...(rest ? { NextToken: String(start + PAGE) } : {}),
    });
    break;
  }
  case "s3api delete-objects": {
    const file = (option("--delete") ?? "").replace(/^file:\/\//, "");
    const { Objects } = JSON.parse(readFileSync(file, "utf8")) as { Objects: FakeVersion[] };
    if (Objects.length > PAGE) {
      throw new Error("fake aws: more than 1000 keys in one delete-objects");
    }
    // Keys the test wants S3 to refuse, as it would under a deny or an Object Lock.
    const locked = new Set((process.env["AIH_FAKE_LOCKED"] ?? "").split(",").filter(Boolean));
    const gone = new Set(
      Objects.filter((item) => !locked.has(item.Key)).map(
        (item) => `${item.Key}\n${item.VersionId}`,
      ),
    );
    writeFileSync(
      bucketFile,
      JSON.stringify(readBucket().filter((item) => !gone.has(`${item.Key}\n${item.VersionId}`))),
    );
    const errors = Objects.filter((item) => locked.has(item.Key)).map((item) => ({
      Key: item.Key,
      VersionId: item.VersionId,
      Code: "AccessDenied",
      Message: "Access Denied",
    }));
    // Quiet mode: nothing at all is printed when every key was deleted.
    if (errors.length > 0) {
      print({ Errors: errors });
    }
    break;
  }
  default:
    process.stderr.write(`fake aws: no answer for ${args.join(" ")}\n`);
    process.exit(2);
}
