// #region provider
/** Kept in memory only. After a reload, the user signs in again. */
export type Session = { accessToken: string; expiresAt: number };

export type AuthProvider = {
  readonly mode: "local" | "cognito";
  /** Starts sign-in. The Cognito provider navigates away and never resolves. */
  signIn(localUser?: string): Promise<Session | undefined>;
  /** Finishes a sign-in when `url` is the redirect back from the sign-in page. */
  completeSignIn(url: URL): Promise<Session | undefined>;
  /** Where to send the browser to end the sign-in page's own session, if there is one. */
  signOutUrl(): string | undefined;
};
// #endregion provider
