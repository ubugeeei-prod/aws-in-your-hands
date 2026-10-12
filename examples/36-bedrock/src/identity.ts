import * as v from "valibot";

import type { Identity } from "@aih/example-06-auth/api/src/identity.ts";

// #region function-url
// A function URL with AuthType AWS_IAM has checked the SigV4 signature before the function
// runs, and writes who signed into the event. The owner is that ID and nothing the request says.
const eventSchema = v.object({
  requestContext: v.object({
    authorizer: v.object({ iam: v.object({ userId: v.pipe(v.string(), v.minLength(1)) }) }),
  }),
});

export function identityFromFunctionUrl(event: unknown): Identity | undefined {
  const parsed = v.safeParse(eventSchema, event);
  // A URL without AWS_IAM in front carries no `iam`: that means "nobody", never "anybody".
  return parsed.success ? { sub: parsed.output.requestContext.authorizer.iam.userId } : undefined;
}
// #endregion function-url
