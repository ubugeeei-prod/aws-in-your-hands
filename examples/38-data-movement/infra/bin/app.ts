import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { ARCHIVE_TASK } from "../../src/task.ts";
import { ArchiveStack } from "../lib/archive-stack.ts";
import { ARCHIVE_REGION, SOURCE_REGION } from "../lib/regions.ts";
import { SourceStack } from "../lib/source-stack.ts";

const app = new App();

// #region context
//   -c sourceLocation=<arn>   the source stack's SourceLocationArn: adds the task, its logs and the alert
//   -c deletes=remove         delete from the archive what the source no longer has
//   -c excludes='<filter>'    a DataSync exclude filter, patterns joined with "|"
//   -c writerRole=<arn>       a DataSync role in another account that may write to the archive
const context = v.parse(
  v.object({
    sourceLocation: v.optional(
      v.pipe(
        v.string(),
        v.regex(/^arn:aws[a-z-]*:datasync:[a-z0-9-]+:\d{12}:location\/loc-[0-9a-z]+$/),
      ),
    ),
    deletes: v.optional(v.picklist(["keep", "remove"]), "keep"),
    excludes: v.optional(v.pipe(v.string(), v.minLength(1))),
    writerRole: v.optional(
      v.pipe(v.string(), v.regex(/^arn:aws[a-z-]*:iam::\d{12}:role\/[\w+=,.@/-]+$/)),
    ),
  }),
  {
    sourceLocation: app.node.tryGetContext("sourceLocation"),
    deletes: app.node.tryGetContext("deletes"),
    excludes: app.node.tryGetContext("excludes"),
    writerRole: app.node.tryGetContext("writerRole"),
  },
);
// #endregion context

// #region stacks
new SourceStack(app, "AihDataMovement", {
  env: { region: SOURCE_REGION },
  description: "AWS in Your Hands chapter 38: the attachments bucket and its DataSync location",
});

// The task lives with the destination, as the user guide asks of a cross-Region copy.
new ArchiveStack(app, "AihDataMovementArchive", {
  env: { region: ARCHIVE_REGION },
  description:
    "AWS in Your Hands chapter 38: an archive bucket in a second Region and the copy into it",
  sourceLocationArn: context.sourceLocation,
  crossAccountWriterArn: context.writerRole,
  task: {
    ...ARCHIVE_TASK,
    excludes: context.excludes,
    options: {
      ...ARCHIVE_TASK.options,
      preserveDeletedFiles: context.deletes === "remove" ? "REMOVE" : "PRESERVE",
    },
  },
});
// #endregion stacks
