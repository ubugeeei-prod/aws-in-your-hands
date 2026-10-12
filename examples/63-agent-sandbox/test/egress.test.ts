import { describe, expect, it } from "vite-plus/test";

import {
  ALLOWLIST,
  allows,
  allowsUrl,
  firewallRulesSource,
  sandboxAllowedDomains,
} from "../src/egress.ts";

describe("the allowlist evaluator", () => {
  it("lets through the four places a task needs, on 443", () => {
    for (const entry of ALLOWLIST) {
      expect(allows(entry.host, 443), entry.host).toMatchObject({ allowed: true });
    }
    expect(allows("GitHub.com.", 443)).toMatchObject({ allowed: true });
  });

  it("is not fooled by a name that only contains an allowed one", () => {
    const lookalikes = [
      "github.com.evil.example",
      "evilgithub.com",
      "raw.github.com",
      "gist.github.com",
      "registry.npmjs.org.evil.example",
      "bedrock-runtime.us-east-1.amazonaws.com",
      "bedrock.ap-northeast-1.amazonaws.com",
      "sts.amazonaws.com",
      "s3.ap-northeast-1.amazonaws.com",
    ];
    for (const host of lookalikes) {
      expect(allows(host, 443), host).toMatchObject({ allowed: false });
    }
  });

  it("refuses every port but 443, and anything that is not a name", () => {
    expect(allows("github.com", 22)).toMatchObject({ allowed: false });
    expect(allows("github.com", 80)).toMatchObject({ allowed: false });
    for (const host of ["140.82.112.3", "[::1]", "169.254.170.2", "localhost", "", "github..com"]) {
      expect(allows(host, 443), host).toMatchObject({ allowed: false });
    }
  });

  it("reads the host of a URL the way a client would", () => {
    expect(allowsUrl("https://github.com/acme/notes.git")).toMatchObject({ allowed: true });
    const refused = [
      "http://github.com/acme/notes.git",
      "https://github.com@evil.example/acme/notes.git",
      "https://user:pass@github.com/acme/notes.git",
      "https://github.com:8443/acme/notes.git",
      "https://evil.example/?next=https://github.com/",
      "ssh://git@github.com/acme/notes.git",
      "not a url",
    ];
    for (const url of refused) {
      expect(allowsUrl(url), url).toMatchObject({ allowed: false });
    }
  });

  it("gives a leading dot the meaning Network Firewall gives it", () => {
    const list = [{ host: ".example.com", why: "test" }];
    expect(allows("example.com", 443, list)).toMatchObject({ allowed: true });
    expect(allows("a.b.example.com", 443, list)).toMatchObject({ allowed: true });
    expect(allows("notexample.com", 443, list)).toMatchObject({ allowed: false });
  });
});

describe("the same list in the two other forms", () => {
  it("is a TLS allowlist for Network Firewall, entry for entry", () => {
    expect(firewallRulesSource()).toEqual({
      RulesSourceList: {
        Targets: ALLOWLIST.map((entry) => entry.host),
        TargetTypes: ["TLS_SNI"],
        GeneratedRulesType: "ALLOWLIST",
      },
    });
  });

  it("is a port-bound list for Claude Code's sandbox, with a wildcard spelled its way", () => {
    expect(sandboxAllowedDomains()).toEqual(ALLOWLIST.map((entry) => `${entry.host}:443`));
    expect(sandboxAllowedDomains([{ host: ".example.com", why: "test" }])).toEqual([
      "example.com:443",
      "*.example.com:443",
    ]);
  });

  it("has no wildcard and no broad domain in it", () => {
    for (const entry of ALLOWLIST) {
      expect(entry.host.startsWith("."), entry.host).toBe(false);
      expect(entry.host.split(".").length, entry.host).toBeGreaterThanOrEqual(2);
    }
    expect(ALLOWLIST.map((entry) => entry.host)).not.toContain("amazonaws.com");
  });
});
