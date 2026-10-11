import { z } from "zod";
import type { AuthProvider } from "./provider.ts";

const tokenSchema = z.object({ accessToken: z.string().min(1) });

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
      const { accessToken } = tokenSchema.parse(await response.json());
      return { accessToken, expiresAt: Date.now() + 3600 * 1000 };
    },
    completeSignIn: async () => undefined,
    signOutUrl: () => undefined,
  };
}
