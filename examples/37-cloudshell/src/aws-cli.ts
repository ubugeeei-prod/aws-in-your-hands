import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as v from "valibot";

import { deleteArgs, versionsArgs } from "./commands.ts";
import { type BucketIo, deleteDocument, deleteResultSchema, versionsPageSchema } from "./empty.ts";

// The only file that starts a process. It runs the `aws` on PATH with the credentials that
// shell already holds, and adds none of its own.

// #region run
export type Aws = (args: string[]) => Promise<string>;

export const aws: Aws = (args) =>
  new Promise((resolve, reject) => {
    execFile(
      "aws",
      args,
      // No pager: the output is read by this program, not by a person.
      { env: { ...process.env, AWS_PAGER: "" }, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout);
        } else {
          reject(new Error(`aws ${args.slice(0, 2).join(" ")} failed: ${stderr.trim()}`));
        }
      },
    );
  });

/** Some commands print nothing when there is nothing to say. */
export function parseOutput<const Schema extends v.GenericSchema>(
  schema: Schema,
  stdout: string,
): v.InferOutput<Schema> {
  return v.parse(schema, JSON.parse(stdout.trim() === "" ? "{}" : stdout));
}
// #endregion run

// #region bucket
export function bucketIo(
  run: Aws,
  input: { bucket: string; region: string; accountId: string },
): BucketIo {
  return {
    list: async (startingToken) =>
      parseOutput(
        versionsPageSchema,
        await run(versionsArgs(input.bucket, input.region, startingToken)),
      ),
    remove: async (batch) => {
      const directory = mkdtempSync(join(tmpdir(), "aih-empty-"));
      const file = join(directory, "delete.json");
      try {
        writeFileSync(file, JSON.stringify(deleteDocument(batch)));
        return parseOutput(deleteResultSchema, await run(deleteArgs({ ...input, file })));
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}
// #endregion bucket
