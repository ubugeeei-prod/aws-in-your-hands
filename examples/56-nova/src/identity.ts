import { createHash } from "node:crypto";

import * as v from "valibot";

// #region owner
// A function URL with AuthType AWS_IAM has checked the SigV4 signature before the function
// runs, and writes who signed into the event. The owner is that ID and nothing the request says.
const eventSchema = v.object({
  requestContext: v.object({
    authorizer: v.object({ iam: v.object({ userId: v.pipe(v.string(), v.minLength(1)) }) }),
  }),
});

/**
 * The caller as one segment of an object key. An IAM user ID can carry ":" and a session
 * name, which a key segment may not, so it is hashed. In the notes app the owner is the
 * Cognito `sub` of chapter 06, which is a segment already.
 */
export function ownerFromFunctionUrl(event: unknown): string | undefined {
  const parsed = v.safeParse(eventSchema, event);
  // A URL without AWS_IAM in front carries no `iam`: that means "nobody", never "anybody".
  return parsed.success
    ? createHash("sha256")
        .update(parsed.output.requestContext.authorizer.iam.userId)
        .digest("hex")
        .slice(0, 32)
    : undefined;
}
// #endregion owner
