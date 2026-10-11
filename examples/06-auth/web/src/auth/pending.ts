import { z } from "zod";

// #region pending
// Between "send the user to the sign-in page" and "the user comes back with a
// code", the page is unloaded. Two values have to survive that round trip:
// - state: proves that the redirect coming back is the answer to the request
//   this browser tab sent, not one an attacker started.
// - codeVerifier: the PKCE secret. Only its hash went out with the request;
//   presenting the original proves that whoever redeems the code is whoever
//   asked for it.
// sessionStorage is per tab and is cleared when the tab closes.
const pendingSchema = z.object({ state: z.string().min(1), codeVerifier: z.string().min(43), createdAt: z.number() });
export type PendingSignIn = z.infer<typeof pendingSchema>;

const KEY = "aih.auth.pending";
const MAX_AGE_MS = 10 * 60 * 1000;

export type TabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function savePending(storage: TabStorage, pending: PendingSignIn): void {
  storage.setItem(KEY, JSON.stringify(pending));
}

/**
 * Returns the pending sign-in that `returnedState` answers, and forgets it.
 * It can be taken once: replaying the same callback URL finds nothing.
 */
export function takePending(storage: TabStorage, returnedState: string | null, now: number): PendingSignIn | undefined {
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
  if (!pending.success || pending.data.state !== returnedState || now - pending.data.createdAt > MAX_AGE_MS) {
    return undefined;
  }
  return pending.data;
}
// #endregion pending
