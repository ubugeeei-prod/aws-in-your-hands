import { z } from "zod";

// #region viewer
export const profileSchema = z.object({ name: z.string().min(1), signedInAt: z.iso.datetime() });
export type Profile = z.infer<typeof profileSchema>;

/** What the browser is told about the person using it. No token is part of this shape. */
export const viewerSchema = z.discriminatedUnion("signedIn", [
  z.object({ signedIn: z.literal(true), profile: profileSchema }),
  z.object({ signedIn: z.literal(false), signIn: z.enum(["dev", "off"]) }),
]);
export type Viewer = z.infer<typeof viewerSchema>;
// #endregion viewer

// #region upstream
/** The API behind the BFF. It is called with the user's token, from the server only. */
export type ProfileApi = {
  profile(accessToken: string): Promise<Profile | undefined>;
};

export type DevIdentity = {
  /** Stands in for an identity provider: believes any name and hands out a token for it. */
  signIn(name: string): { accessToken: string };
} & ProfileApi;

export function createDevIdentity(deps: { now: () => Date; newToken: () => string }): DevIdentity {
  const profiles = new Map<string, Profile>();
  return {
    signIn: (name) => {
      const accessToken = deps.newToken();
      profiles.set(accessToken, { name, signedInAt: deps.now().toISOString() });
      return { accessToken };
    },
    profile: async (accessToken) => profiles.get(accessToken),
  };
}
// #endregion upstream
