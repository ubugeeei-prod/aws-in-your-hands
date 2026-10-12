// The one list of places a task may reach, and the three forms it is handed out in.

// #region allowlist
export type Destination = {
  /** A host name. A leading dot means the name itself and every name under it. */
  host: string;
  why: string;
};

/** HTTPS only, port 443 only. What is not here is not reachable. */
export const ALLOWLIST: readonly Destination[] = [
  { host: "bedrock-runtime.ap-northeast-1.amazonaws.com", why: "the model" },
  { host: "github.com", why: "clone and push over HTTPS" },
  { host: "api.github.com", why: "open the pull request" },
  { host: "registry.npmjs.org", why: "install the repository's packages" },
];
// #endregion allowlist

const HOST =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** Lower case, without the root dot. Undefined for anything that is not a plain host name. */
export function normalizeHost(host: string): string | undefined {
  const name = host.toLowerCase().replace(/\.$/, "");
  // An IP address has no name to compare, so it is never on the list.
  return HOST.test(name) ? name : undefined;
}

// #region allows
export type Verdict = { allowed: true; by: Destination } | { allowed: false; reason: string };

/** Whether a connection to `host` on `port` is on the list. This is the book's own evaluator. */
export function allows(
  host: string,
  port: number,
  list: readonly Destination[] = ALLOWLIST,
): Verdict {
  if (port !== 443) {
    return { allowed: false, reason: `port ${port} is not 443` };
  }
  const name = normalizeHost(host);
  if (name === undefined) {
    return { allowed: false, reason: "not a host name" };
  }
  const by = list.find((entry) =>
    entry.host.startsWith(".")
      ? name === entry.host.slice(1) || name.endsWith(entry.host)
      : name === entry.host,
  );
  return by === undefined
    ? { allowed: false, reason: `${name} is not on the list` }
    : { allowed: true, by };
}

/** The same question for a URL, which adds three ways to lie about the host. */
export function allowsUrl(input: string, list: readonly Destination[] = ALLOWLIST): Verdict {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { allowed: false, reason: "not a URL" };
  }
  if (url.protocol !== "https:") {
    return { allowed: false, reason: `${url.protocol} is not https:` };
  }
  // https://github.com@evil.example/ goes to evil.example. Nothing here needs credentials in a URL.
  if (url.username !== "" || url.password !== "") {
    return { allowed: false, reason: "credentials in the URL" };
  }
  return allows(url.hostname, url.port === "" ? 443 : Number(url.port), list);
}
// #endregion allows

// #region renderings
/**
 * For AWS Network Firewall: the RulesSource of a stateful domain list rule group.
 * Its own syntax is the one this file uses: a leading dot for a name and its subdomains.
 */
export function firewallRulesSource(list: readonly Destination[] = ALLOWLIST) {
  return {
    RulesSourceList: {
      Targets: list.map((entry) => entry.host),
      // HTTPS only: the firewall reads the name from the TLS handshake.
      TargetTypes: ["TLS_SNI"],
      GeneratedRulesType: "ALLOWLIST",
    },
  };
}

/**
 * For Claude Code's Bash sandbox: `sandbox.network.allowedDomains`. There a subdomain
 * wildcard is `*.name`, and a `:port` suffix limits the entry to that port.
 */
export function sandboxAllowedDomains(list: readonly Destination[] = ALLOWLIST): string[] {
  return list.flatMap((entry) =>
    entry.host.startsWith(".")
      ? [`${entry.host.slice(1)}:443`, `*${entry.host}:443`]
      : [`${entry.host}:443`],
  );
}
// #endregion renderings
