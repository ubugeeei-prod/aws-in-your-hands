import * as v from "valibot";

import type { AuthProvider } from "./provider.ts";

const tokenSchema = v.object({ accessToken: v.pipe(v.string(), v.minLength(1)) });

/** Development sign-in: the local API hands out a token for any user name. No password. */
export function createLocalProvider(apiUrl: string, fetchImpl: typeof fetch = fetch): AuthProvider {
  return {
    mode: "local",
    async signIn(localUser = "alice") {
      const response = await fetchImpl(new URL("/local/token", apiUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: localUser }),
      });
      if (!response.ok) {
        throw new Error(`local sign-in failed with ${response.status}`);
      }
      const { accessToken } = v.parse(tokenSchema, await response.json());
      return { accessToken, expiresAt: Date.now() + 3600 * 1000 };
    },
    completeSignIn: async () => undefined,
    signOutUrl: () => undefined,
  };
}
