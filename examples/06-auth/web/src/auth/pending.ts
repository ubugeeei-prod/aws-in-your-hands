import { z } from "zod";

// #region pending
// The page is unloaded during sign-in, so these two values wait in
// sessionStorage: per tab, and cleared when the tab closes.
const pendingSchema = z.object({
  state: z.string().min(1),
  codeVerifier: z.string().min(43),
  createdAt: z.number(),
});
export type PendingSignIn = z.infer<typeof pendingSchema>;

const KEY = "aih.auth.pending";
const MAX_AGE_MS = 10 * 60 * 1000;

export type TabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function savePending(storage: TabStorage, pending: PendingSignIn): void {
  storage.setItem(KEY, JSON.stringify(pending));
}

/** Takes the pending sign-in out, once. Replaying the same callback URL finds nothing. */
export function takePending(
  storage: TabStorage,
  returnedState: string | null,
  now: number,
): PendingSignIn | undefined {
  const raw = storage.getItem(KEY);
  storage.removeItem(KEY);
  if (raw === null || returnedState === null) {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const pending = pendingSchema.safeParse(json);
  if (
    !pending.success ||
    pending.data.state !== returnedState ||
    now - pending.data.createdAt > MAX_AGE_MS
  ) {
    return undefined;
  }
  return pending.data;
}
// #endregion pending
