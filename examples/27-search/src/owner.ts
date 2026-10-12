// #region owner
export const OWNER_HEADER = "x-notes-owner";
const OWNER = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * This chapter's stand-in for sign-in: the caller names the owner in a header. That is
 * only acceptable because the function URL lets in nobody but IAM principals you
 * allowed. With chapter 06, the owner is the `sub` of a verified access token instead.
 */
export function ownerFromTrustedHeader(request: Request): string | undefined {
  const value = request.headers.get(OWNER_HEADER);
  return value !== null && OWNER.test(value) ? value : undefined;
}
// #endregion owner
