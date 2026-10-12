import * as v from "valibot";

// #region viewer
export const profileSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  signedInAt: v.pipe(v.string(), v.isoTimestamp()),
});
export type Profile = v.InferOutput<typeof profileSchema>;

/** What the browser is told about the person using it. No token is part of this shape. */
export const viewerSchema = v.variant("signedIn", [
  v.object({ signedIn: v.literal(true), profile: profileSchema }),
  v.object({ signedIn: v.literal(false), signIn: v.picklist(["dev", "off"]) }),
]);
export type Viewer = v.InferOutput<typeof viewerSchema>;
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
