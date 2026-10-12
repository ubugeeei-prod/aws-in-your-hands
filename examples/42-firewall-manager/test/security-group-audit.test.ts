import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { contains, parseCidr } from "../src/cidr.ts";
import { AUDIT_ALLOWED } from "../src/policies.ts";
import {
  auditGroup,
  auditRule,
  ingressByGroup,
  type IngressRule,
} from "../src/security-group-audit.ts";

const from = (
  cidr: string,
  protocol: string,
  fromPort?: number,
  toPort: number | undefined = fromPort,
): IngressRule => ({ protocol, fromPort, toPort, source: { kind: "cidr", cidr } });
const status = (rule: IngressRule) => auditRule(rule, AUDIT_ALLOWED).status;

describe("CIDR ranges", () => {
  const cidr = (text: string) => {
    const parsed = parseCidr(text);
    if (parsed === undefined) {
      throw new Error(`${text} did not parse`);
    }
    return parsed;
  };

  it("decides containment by prefix, for both address families", () => {
    expect(contains(cidr("10.0.0.0/8"), cidr("10.1.2.0/24"))).toBe(true);
    expect(contains(cidr("10.0.0.0/8"), cidr("10.0.0.0/7"))).toBe(false);
    expect(contains(cidr("172.16.0.0/12"), cidr("172.31.255.255/32"))).toBe(true);
    expect(contains(cidr("172.16.0.0/12"), cidr("172.32.0.0/16"))).toBe(false);
    expect(contains(cidr("::/0"), cidr("2001:db8::/32"))).toBe(true);
    expect(contains(cidr("2001:db8::/32"), cidr("2001:db9::/48"))).toBe(false);
    expect(contains(cidr("0.0.0.0/0"), cidr("::/0"))).toBe(false);
  });

  it("masks host bits off, so 10.1.2.3/8 is 10.0.0.0/8", () => {
    expect(cidr("10.1.2.3/8")).toEqual(cidr("10.0.0.0/8"));
  });

  it("reads nothing that is not plain CIDR notation", () => {
    for (const text of [
      "10.0.0.0",
      "10.0.0.256/8",
      "10.0.0.0/33",
      "::/129",
      "1::2::3/64",
      "pl-1",
    ]) {
      expect(parseCidr(text)).toBeUndefined();
    }
  });
});

describe("the audit rule: open to the internet on 443 only", () => {
  it("passes HTTPS from anywhere, on IPv4 and IPv6", () => {
    expect(status(from("0.0.0.0/0", "tcp", 443))).toBe("compliant");
    expect(status(from("::/0", "tcp", 443))).toBe("compliant");
    // A narrower source is inside the same range.
    expect(status(from("203.0.113.0/24", "tcp", 443))).toBe("compliant");
    // EC2 takes the protocol number as well as the name.
    expect(status(from("0.0.0.0/0", "6", 443))).toBe("compliant");
  });

  it("passes anything from a private address block", () => {
    expect(status(from("10.1.0.0/16", "tcp", 5432))).toBe("compliant");
    expect(status(from("192.168.1.0/24", "-1"))).toBe("compliant");
    expect(status(from("172.20.0.0/16", "udp", 53))).toBe("compliant");
  });

  it("fails every other port opened to the internet", () => {
    expect(status(from("0.0.0.0/0", "tcp", 22))).toBe("noncompliant");
    expect(status(from("0.0.0.0/0", "tcp", 80))).toBe("noncompliant");
    expect(status(from("::/0", "tcp", 3389))).toBe("noncompliant");
    expect(status(from("0.0.0.0/0", "udp", 443))).toBe("noncompliant");
  });

  it("fails a range that only includes 443", () => {
    expect(status(from("0.0.0.0/0", "tcp", 443, 444))).toBe("noncompliant");
    expect(status(from("0.0.0.0/0", "tcp", 0, 65_535))).toBe("noncompliant");
    expect(status(from("0.0.0.0/0", "-1"))).toBe("noncompliant");
  });

  it("fails a public address that is not the whole internet, which is the usual exception", () => {
    // One office address on SSH. Stricter than "0.0.0.0/0 only": the rule lists what is allowed.
    const verdict = auditRule(from("203.0.113.7/32", "tcp", 22), AUDIT_ALLOWED);
    expect(verdict).toEqual({
      status: "noncompliant",
      reason: "tcp ports 22-22 from 203.0.113.7/32 is outside every allowed range",
    });
  });

  it("fails a block that is wider than a private one or next to it", () => {
    expect(status(from("10.0.0.0/7", "tcp", 22))).toBe("noncompliant");
    expect(status(from("172.32.0.0/16", "tcp", 22))).toBe("noncompliant");
  });

  it("does not call a rule compliant when it cannot read its source", () => {
    const fromGroup: IngressRule = {
      protocol: "tcp",
      fromPort: 8080,
      toPort: 8080,
      source: { kind: "other", what: "another security group" },
    };
    expect(auditRule(fromGroup, AUDIT_ALLOWED)).toEqual({
      status: "not-evaluated",
      reason: "the source is another security group",
    });
    expect(status(from("pl-0123456789abcdef0", "tcp", 443))).toBe("not-evaluated");
  });
});

describe("a security group", () => {
  it("is non-compliant for one bad rule, and incomplete for one unread rule", () => {
    const good = from("0.0.0.0/0", "tcp", 443);
    const bad = from("0.0.0.0/0", "tcp", 22);
    const unread: IngressRule = {
      protocol: "tcp",
      source: { kind: "other", what: "a prefix list" },
    };
    expect(auditGroup("a", [], AUDIT_ALLOWED).status).toBe("compliant");
    expect(auditGroup("b", [good], AUDIT_ALLOWED).status).toBe("compliant");
    expect(auditGroup("c", [good, unread], AUDIT_ALLOWED).status).toBe("incomplete");
    expect(auditGroup("d", [good, unread, bad], AUDIT_ALLOWED).status).toBe("noncompliant");
  });
});

describe("security groups in a synthesized template", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/network.template.json", import.meta.url), "utf8"),
  ) as unknown;
  const statusOf = (id: string) => {
    const rules = ingressByGroup(fixture).get(id);
    return rules === undefined ? undefined : auditGroup(id, rules, AUDIT_ALLOWED).status;
  };

  it("reads inline rules and rules declared as their own resource", () => {
    expect([...ingressByGroup(fixture).keys()]).toEqual([
      "LoadBalancerGroup",
      "ServiceGroup",
      "BastionGroup",
      "(group of ImportedGroupRule)",
    ]);
    expect(ingressByGroup(fixture).get("ServiceGroup")).toHaveLength(1);
  });

  it("gives each group the verdict its rules earn", () => {
    expect(statusOf("LoadBalancerGroup")).toBe("compliant");
    // Its one rule names another security group as the source.
    expect(statusOf("ServiceGroup")).toBe("incomplete");
    // Port 22 from anywhere outweighs the rule whose CIDR is a parameter.
    expect(statusOf("BastionGroup")).toBe("noncompliant");
    expect(statusOf("(group of ImportedGroupRule)")).toBe("noncompliant");
  });

  it("refuses a file that is not a template", () => {
    expect(() => ingressByGroup({})).toThrow();
    expect(() => ingressByGroup([])).toThrow();
  });

  // The book's own stacks, when their synth tasks have run. Read-only, and no verdict is
  // pinned: other chapters own those files and change them.
  const examples = fileURLToPath(new URL("../../", import.meta.url));
  const templates = readdirSync(examples)
    .map((name) => join(examples, name, "cdk.out"))
    .filter((directory) => existsSync(directory))
    .flatMap((directory) =>
      readdirSync(directory)
        .filter((name) => name.endsWith(".template.json"))
        .map((name) => join(directory, name)),
    );

  it.skipIf(templates.length === 0)("reads every template the book has synthesized", () => {
    for (const file of templates) {
      const groups = ingressByGroup(JSON.parse(readFileSync(file, "utf8")));
      for (const [id, rules] of groups) {
        expect(["compliant", "noncompliant", "incomplete"]).toContain(
          auditGroup(id, rules, AUDIT_ALLOWED).status,
        );
      }
    }
  });
});
