import type { SecretSource } from "./secret-source.ts";
import type { SigningKey } from "./token.ts";

export type KeyringOptions = {
  source: SecretSource;
  /** Milliseconds since the epoch. Injected so tests own the clock. */
  now: () => number;
  /** How long a loaded pair of keys is used without asking again. */
  ttlMs: number;
  /** The shortest gap between two loads that an unknown version id may trigger. */
  minRefreshMs: number;
  onError?: (error: unknown) => void;
};

export type Keyring = {
  /** The key to sign with. */
  current(): Promise<SigningKey>;
  /** The key a token names, if it is the current or the previous version. */
  find(versionId: string): Promise<SigningKey | null>;
};

type Loaded = { current: SigningKey; previous: SigningKey | null; at: number };

// #region keyring
/** The signing keys of one execution environment. Every environment has its own copy, loaded at its own time. */
export function createKeyring(options: KeyringOptions): Keyring {
  let loaded: Loaded | undefined;
  let lastAttempt = Number.NEGATIVE_INFINITY;
  let loading: Promise<Loaded> | undefined;

  // Concurrent requests share one load: two GetSecretValue calls, not two per request.
  const load = (): Promise<Loaded> => {
    loading ??= (async () => {
      lastAttempt = options.now();
      try {
        const [current, previous] = await Promise.all([
          options.source.read("AWSCURRENT"),
          options.source.read("AWSPREVIOUS"),
        ]);
        if (current === null) {
          throw new Error("the signing secret has no AWSCURRENT version");
        }
        loaded = { current, previous, at: options.now() };
        return loaded;
      } finally {
        loading = undefined;
      }
    })();
    return loading;
  };

  const fresh = async (): Promise<Loaded> => {
    if (loaded !== undefined && options.now() - loaded.at < options.ttlMs) {
      return loaded;
    }
    // A load just failed: keep using what we have instead of retrying on every request.
    if (loaded !== undefined && options.now() - lastAttempt < options.minRefreshMs) {
      return loaded;
    }
    try {
      return await load();
    } catch (error) {
      // Keys that were good a few minutes ago beat no keys at all.
      if (loaded === undefined) {
        throw error;
      }
      options.onError?.(error);
      return loaded;
    }
  };

  const match = (keys: Loaded, versionId: string): SigningKey | null =>
    [keys.current, keys.previous].find((key) => key?.versionId === versionId) ?? null;

  return {
    current: async () => (await fresh()).current,
    async find(versionId) {
      const known = match(await fresh(), versionId);
      if (known !== null) {
        return known;
      }
      // An unknown id is either a rotation this environment has not seen, or junk.
      // Ask again, but only so often: anyone can send junk ids, and each load costs money.
      if (options.now() - lastAttempt < options.minRefreshMs) {
        return null;
      }
      try {
        return match(await load(), versionId);
      } catch (error) {
        options.onError?.(error);
        return null;
      }
    },
  };
}
// #endregion keyring
