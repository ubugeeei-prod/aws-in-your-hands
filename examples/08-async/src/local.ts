import type { Env } from "@aih/example-05-dynamodb/src/env.ts";
import type { Logger } from "@aih/example-05-dynamodb/src/log.ts";
import { InMemoryNoteRepository } from "@aih/example-05-dynamodb/src/memory-repository.ts";
import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";
import { MAX_NOTES_PER_OWNER } from "@aih/example-06-auth/api/src/contract.ts";
import { createLocalAuthenticator } from "@aih/example-06-auth/api/src/local-auth.ts";
import { createApp } from "@aih/example-07-uploads/api/src/app.ts";
import { InMemoryAttachmentRepository } from "@aih/example-07-uploads/api/src/attachment-repository.ts";
import { createAttachmentService } from "@aih/example-07-uploads/api/src/attachments.ts";
import { InMemoryPermitLedger } from "@aih/example-07-uploads/api/src/permit-ledger.ts";

import { housekeep } from "./housekeeping.ts";
import { InMemoryInspectionRepository } from "./inspection.ts";
import { LocalBucket } from "./local-bucket.ts";
import { deliverOnce, LocalQueue } from "./local-queue.ts";
import { createBatchHandler } from "./worker.ts";

export type LocalOptions = {
  env: Env;
  secret: string;
  baseUrl: string;
  now: () => Date;
  randomSuffix: () => string;
  newId: () => string;
  log: Logger;
  queue: { visibilityTimeoutMs: number; maxReceiveCount: number; duplicate: boolean };
  /** Tests wrap a store here to make one of its calls fail. */
  wrap?: <T extends object>(name: "bucket" | "inspections" | "attachments", target: T) => T;
};

// #region local
/**
 * Chapter 07's app, a bucket that announces its events, a queue, and the
 * worker, wired the way the stack wires them, all in one process. The worker
 * is the very function Lambda runs; only what stands around it differs.
 */
export function createLocal(options: LocalOptions) {
  const wrap = options.wrap ?? ((_name, target) => target);
  const queue = new LocalQueue({ now: options.now, newId: options.newId, ...options.queue });
  const bucket = new LocalBucket({
    baseUrl: options.baseUrl,
    secret: options.secret,
    now: options.now,
    // S3 -> SQS. With `duplicate`, the same event arrives as two messages
    // with two message IDs, which is how a duplicate from S3 would look.
    notify: (body) => {
      queue.send(body);
      if (options.queue.duplicate) {
        queue.send(body);
      }
    },
  });
  const noteRepository = new InMemoryNoteRepository(MAX_NOTES_PER_OWNER);
  const attachmentRepository = wrap("attachments", new InMemoryAttachmentRepository());
  const inspections = new InMemoryInspectionRepository();
  const objects = wrap("bucket", bucket);

  const notes = createNoteService({
    repository: noteRepository,
    now: options.now,
    randomSuffix: options.randomSuffix,
  });
  const app = createApp({
    env: options.env,
    authenticate: createLocalAuthenticator(options.secret),
    log: options.log,
    notes,
    attachments: createAttachmentService({
      notes,
      attachments: attachmentRepository,
      objects,
      permits: new InMemoryPermitLedger(),
      now: options.now,
      randomSuffix: options.randomSuffix,
      log: options.log,
    }),
    newRequestId: options.newId,
    now: () => options.now().getTime(),
  });

  const worker = createBatchHandler({
    reader: objects,
    inspections: wrap("inspections", inspections),
    attachments: attachmentRepository,
    objects,
    now: options.now,
    log: options.log,
  });

  return {
    app,
    bucket,
    queue,
    worker,
    inspections,
    /** SQS -> Lambda, one batch. */
    deliver: (batchSize = 10) => deliverOnce(queue, worker, batchSize),
    /** What the schedule starts. */
    housekeep: (run: { dryRun: boolean }) =>
      housekeep(
        {
          objects,
          attachments: attachmentRepository,
          notes: noteRepository,
          inspections,
          now: options.now,
        },
        run,
      ),
  };
}
// #endregion local
