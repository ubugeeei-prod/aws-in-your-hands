import { newNoteId } from "@aih/example-05-dynamodb/src/id.ts";
import type { Logger } from "@aih/example-05-dynamodb/src/log.ts";
import type { NoteService } from "@aih/example-05-dynamodb/src/notes.ts";

import type { AttachmentRepository } from "./attachment-repository.ts";
import {
  type Attachment,
  type AttachmentView,
  IMAGE_TYPES,
  MAX_ATTACHMENTS_PER_NOTE,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_PERMITS_PER_OWNER_PER_DAY,
  type UploadPermit,
  type UploadRequest,
} from "./contract.ts";
import { isKeySegment, objectKey } from "./keys.ts";
import type { ObjectStore } from "./object-store.ts";
import { type PermitLedger, permitDay } from "./permit-ledger.ts";

// #region timing
export const UPLOAD_PERMIT_SECONDS = 5 * 60;
export const VIEW_URL_SECONDS = 5 * 60;
// An upload must be finished within this long of arriving in the bucket. It
// keeps "finish" and "clean up" from ever working on the same object.
export const FINISH_WITHIN_MS = 15 * 60 * 1000;
// #endregion timing

export type AttachmentDeps = {
  notes: Pick<NoteService, "get">;
  attachments: AttachmentRepository;
  objects: ObjectStore;
  /** The API always has one. Operator scripts that build this service by hand may leave it out. */
  permits?: PermitLedger;
  now: () => Date;
  randomSuffix: () => string;
  log: Logger;
};

export type FinishResult =
  | { status: "attached"; attachment: Attachment }
  | { status: "note_not_found" }
  | { status: "upload_missing" }
  | { status: "upload_rejected"; reason: string }
  | { status: "limit" };

const isImageType = (value: string): value is Attachment["contentType"] =>
  (IMAGE_TYPES as readonly string[]).includes(value);

export function createAttachmentService(deps: AttachmentDeps) {
  async function removeOne(owner: string, noteId: string, id: string): Promise<boolean> {
    // #region remove
    // Record first, object second: the opposite order of finishing an upload.
    // Stopping halfway leaves an object nobody points at, never a record that
    // points at nothing.
    if (!(await deps.attachments.delete(owner, noteId, id))) {
      return false;
    }
    try {
      await deps.objects.delete(objectKey({ owner, noteId, attachmentId: id }));
    } catch (error) {
      // The user's delete has already happened. The object is now garbage for the sweep.
      deps.log({
        level: "warn",
        message: "orphaned object left for the sweep",
        noteId,
        attachmentId: id,
        error,
      });
    }
    return true;
    // #endregion remove
  }

  return {
    // #region request-upload
    async requestUpload(
      owner: string,
      noteId: string,
      input: UploadRequest,
    ): Promise<
      | { status: "permitted"; permit: UploadPermit }
      | { status: "note_not_found" }
      | { status: "limit" }
      | { status: "quota" }
    > {
      // The note is looked up under the caller's own `sub`, so someone else's
      // note is "not found" here exactly as it is in chapter 06.
      if ((await deps.notes.get(owner, noteId)) === undefined) {
        return { status: "note_not_found" };
      }
      if ((await deps.attachments.listByNote(owner, noteId)).length >= MAX_ATTACHMENTS_PER_NOTE) {
        return { status: "limit" };
      }
      const now = deps.now();
      // Last of the checks, so a refusal above does not use up the day's allowance.
      if (
        deps.permits !== undefined &&
        !(await deps.permits.take(owner, permitDay(now), MAX_UPLOAD_PERMITS_PER_OWNER_PER_DAY))
      ) {
        return { status: "quota" };
      }
      const attachmentId = newNoteId(now, deps.randomSuffix());
      const upload = await deps.objects.presignUpload({
        key: objectKey({ owner, noteId, attachmentId }),
        contentType: input.contentType,
        maxBytes: MAX_UPLOAD_BYTES,
        expiresInSeconds: UPLOAD_PERMIT_SECONDS,
      });
      // No record and no object yet. A permit that is never used leaves only its count.
      return {
        status: "permitted",
        permit: {
          attachmentId,
          upload,
          maxBytes: MAX_UPLOAD_BYTES,
          expiresAt: new Date(now.getTime() + UPLOAD_PERMIT_SECONDS * 1000).toISOString(),
        },
      };
    },
    // #endregion request-upload

    // #region finish
    async finish(owner: string, noteId: string, attachmentId: string): Promise<FinishResult> {
      if (!isKeySegment(attachmentId) || (await deps.notes.get(owner, noteId)) === undefined) {
        return { status: "note_not_found" };
      }
      // Asked twice (a retry, a lost response): the first answer stands.
      const existing = await deps.attachments.get(owner, noteId, attachmentId);
      if (existing !== undefined) {
        return { status: "attached", attachment: existing };
      }

      const key = objectKey({ owner, noteId, attachmentId });
      const object = await deps.objects.head(key);
      if (object === undefined) {
        return { status: "upload_missing" };
      }
      // S3 already enforced type and size. Checked again because a wrong
      // record is worse than a refused one.
      if (!isImageType(object.contentType) || object.size < 1 || object.size > MAX_UPLOAD_BYTES) {
        return {
          status: "upload_rejected",
          reason: "The uploaded object is not an allowed image.",
        };
      }
      if (deps.now().getTime() - object.lastModified.getTime() > FINISH_WITHIN_MS) {
        return {
          status: "upload_rejected",
          reason: "The upload was not finished in time. Upload the image again.",
        };
      }
      if ((await deps.attachments.listByNote(owner, noteId)).length >= MAX_ATTACHMENTS_PER_NOTE) {
        return { status: "limit" };
      }

      // Object first, record second. Stopping between the two leaves an
      // object without a record; the reverse order would leave a record
      // whose object the lifecycle rule deletes a day later.
      await deps.objects.markAttached(key);
      const attachment: Attachment = {
        id: attachmentId,
        noteId,
        contentType: object.contentType,
        size: object.size,
        createdAt: deps.now().toISOString(),
      };
      if ((await deps.attachments.create(owner, attachment)) === "already_exists") {
        // Two finishes ran side by side. The other one's record is the record.
        return {
          status: "attached",
          attachment: (await deps.attachments.get(owner, noteId, attachmentId)) ?? attachment,
        };
      }
      return { status: "attached", attachment };
    },
    // #endregion finish

    // #region list
    async list(owner: string, noteId: string): Promise<AttachmentView[] | undefined> {
      if ((await deps.notes.get(owner, noteId)) === undefined) {
        return undefined;
      }
      const urlExpiresAt = new Date(deps.now().getTime() + VIEW_URL_SECONDS * 1000).toISOString();
      return Promise.all(
        (await deps.attachments.listByNote(owner, noteId)).map(async (attachment) => ({
          ...attachment,
          // Signed for this one key. Whoever holds the URL can read the image until it expires.
          url: await deps.objects.presignView(
            objectKey({ owner, noteId, attachmentId: attachment.id }),
            VIEW_URL_SECONDS,
          ),
          urlExpiresAt,
        })),
      );
    },
    // #endregion list

    async remove(owner: string, noteId: string, attachmentId: string): Promise<boolean> {
      if (!isKeySegment(attachmentId) || (await deps.notes.get(owner, noteId)) === undefined) {
        return false;
      }
      return removeOne(owner, noteId, attachmentId);
    },

    /** After a note is deleted. The note is already gone, so there is no note check. */
    async removeAllOf(owner: string, noteId: string): Promise<void> {
      for (const attachment of await deps.attachments.listByNote(owner, noteId)) {
        await removeOne(owner, noteId, attachment.id);
      }
    },
  };
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;

// #region cascade
/** Chapter 06's note service, with one change: deleting a note also deletes its attachments. */
export function withAttachmentCleanup(
  notes: NoteService,
  attachments: Pick<AttachmentService, "removeAllOf">,
  log: Logger,
): NoteService {
  return {
    ...notes,
    async remove(owner, id) {
      // The note goes first: once it is gone, nothing can reach its
      // attachments through the API, and what is left is cleanup.
      const removed = await notes.remove(owner, id);
      if (removed) {
        try {
          await attachments.removeAllOf(owner, id);
        } catch (error) {
          log({
            level: "warn",
            message: "attachments of a deleted note left for the sweep",
            noteId: id,
            error,
          });
        }
      }
      return removed;
    },
  };
}
// #endregion cascade
