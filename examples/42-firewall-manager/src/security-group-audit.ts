// The audit rule this chapter's policy states, applied to inbound rules on a laptop.
// The documentation says a rule must be "within the allowed range" of the audit security
// group's rules. What "within" means below is this chapter's reading, not the service's code.

import * as v from "valibot";

import { jsonEntries, jsonObject } from "@aih/example-21-security/src/json-object.ts";

import { contains, parseCidr } from "./cidr.ts";

// #region rule
export type AllowedRange = {
  /** `all` is IpProtocol -1: every protocol and every port. */
  protocol: "tcp" | "udp" | "icmp" | "icmpv6" | "all";
  fromPort?: number;
  toPort?: number;
  cidr: string;
  description: string;
};

export type IngressRule = {
  protocol: string;
  fromPort?: number | undefined;
  toPort?: number | undefined;
  source:
    | { kind: "cidr"; cidr: string }
    // Another security group, a prefix list, or a value CloudFormation fills in at deploy time.
    | { kind: "other"; what: string };
};

// IANA protocol numbers, which EC2 accepts in place of the names.
const PROTOCOL_NAMES: Readonly<Record<string, string>> = {
  "-1": "all",
  "1": "icmp",
  "6": "tcp",
  "17": "udp",
  "58": "icmpv6",
};
const protocolName = (protocol: string): string =>
  PROTOCOL_NAMES[protocol] ?? protocol.toLowerCase();
// #endregion rule

// #region audit-rule
export type RuleVerdict =
  | { status: "compliant"; allowedBy: string }
  | { status: "noncompliant"; reason: string }
  // Not "compliant": a rule this model cannot read is a rule it cannot vouch for.
  | { status: "not-evaluated"; reason: string };

function within(rule: IngressRule, cidr: string, allowed: AllowedRange): boolean {
  const outer = parseCidr(allowed.cidr);
  const inner = parseCidr(cidr);
  if (outer === undefined || inner === undefined || !contains(outer, inner)) {
    return false;
  }
  if (allowed.protocol === "all") {
    return true;
  }
  if (protocolName(rule.protocol) !== allowed.protocol) {
    return false;
  }
  // A rule without ports where the allowed range has them covers more than the range.
  return (
    rule.fromPort !== undefined &&
    rule.toPort !== undefined &&
    rule.fromPort >= (allowed.fromPort ?? 0) &&
    rule.toPort <= (allowed.toPort ?? 65_535) &&
    rule.fromPort <= rule.toPort
  );
}

export function auditRule(rule: IngressRule, allowed: readonly AllowedRange[]): RuleVerdict {
  if (rule.source.kind === "other") {
    return { status: "not-evaluated", reason: `the source is ${rule.source.what}` };
  }
  const { cidr } = rule.source;
  if (parseCidr(cidr) === undefined) {
    return { status: "not-evaluated", reason: `"${cidr}" is not CIDR notation this model reads` };
  }
  const match = allowed.find((range) => within(rule, cidr, range));
  if (match !== undefined) {
    return { status: "compliant", allowedBy: match.description };
  }
  const ports =
    rule.fromPort === undefined ? "all ports" : `ports ${rule.fromPort}-${rule.toPort ?? "?"}`;
  return {
    status: "noncompliant",
    reason: `${protocolName(rule.protocol)} ${ports} from ${cidr} is outside every allowed range`,
  };
}
// #endregion audit-rule

// #region audit-group
export type GroupAudit = {
  id: string;
  status: "compliant" | "noncompliant" | "incomplete";
  rules: { rule: IngressRule; verdict: RuleVerdict }[];
};

export function auditGroup(
  id: string,
  rules: readonly IngressRule[],
  allowed: readonly AllowedRange[],
): GroupAudit {
  const audited = rules.map((rule) => ({ rule, verdict: auditRule(rule, allowed) }));
  const has = (status: RuleVerdict["status"]) =>
    audited.some((entry) => entry.verdict.status === status);
  // One bad rule decides the group. A rule that could not be read keeps it from passing.
  const unread = has("not-evaluated") ? "incomplete" : "compliant";
  return { id, status: has("noncompliant") ? "noncompliant" : unread, rules: audited };
}
// #endregion audit-group

// #region from-template
const ingressSchema = v.pipe(
  jsonObject,
  v.looseObject({
    IpProtocol: v.unknown(),
    FromPort: v.optional(v.unknown()),
    ToPort: v.optional(v.unknown()),
    CidrIp: v.optional(v.unknown()),
    CidrIpv6: v.optional(v.unknown()),
    SourceSecurityGroupId: v.optional(v.unknown()),
    SourcePrefixListId: v.optional(v.unknown()),
    GroupId: v.optional(v.unknown()),
  }),
);
type RawIngress = v.InferOutput<typeof ingressSchema>;

const templateSchema = v.pipe(
  jsonObject,
  v.looseObject({
    Resources: jsonEntries(
      v.pipe(jsonObject, v.looseObject({ Type: v.string(), Properties: v.optional(jsonObject) })),
    ),
  }),
);

const port = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;

function sourceOf(raw: RawIngress): IngressRule["source"] {
  const cidr = raw.CidrIp ?? raw.CidrIpv6;
  if (typeof cidr === "string") {
    return { kind: "cidr", cidr };
  }
  if (cidr !== undefined) {
    return { kind: "other", what: "a CIDR known only at deploy time" };
  }
  if (raw.SourceSecurityGroupId !== undefined) {
    return { kind: "other", what: "another security group" };
  }
  return {
    kind: "other",
    what: raw.SourcePrefixListId === undefined ? "not stated" : "a prefix list",
  };
}

function toRule(raw: RawIngress): IngressRule {
  const protocol =
    typeof raw.IpProtocol === "string" || typeof raw.IpProtocol === "number"
      ? String(raw.IpProtocol)
      : "unresolved";
  return {
    protocol,
    fromPort: port(raw.FromPort),
    toPort: port(raw.ToPort),
    source: sourceOf(raw),
  };
}

/** The logical ID a `Ref` or `Fn::GetAtt` points at, when the value is one. */
function logicalId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const { Ref: ref, "Fn::GetAtt": getAtt } = value as Record<string, unknown>;
  if (typeof ref === "string") {
    return ref;
  }
  return Array.isArray(getAtt) && typeof getAtt[0] === "string" ? getAtt[0] : undefined;
}

/**
 * The inbound rules of every security group in a synthesized template, by logical ID.
 * Rules declared inline and rules declared as AWS::EC2::SecurityGroupIngress are both read.
 */
export function ingressByGroup(template: unknown): Map<string, IngressRule[]> {
  const { Resources: resources } = v.parse(templateSchema, template);
  const groups = new Map<string, IngressRule[]>();
  for (const [id, resource] of resources) {
    if (resource.Type === "AWS::EC2::SecurityGroup") {
      const inline = v.parse(
        v.optional(v.array(ingressSchema), []),
        resource.Properties?.["SecurityGroupIngress"],
      );
      groups.set(id, inline.map(toRule));
    }
  }
  for (const [id, resource] of resources) {
    if (resource.Type === "AWS::EC2::SecurityGroupIngress") {
      const raw = v.parse(ingressSchema, resource.Properties ?? {});
      // A rule for a group outside this template still gets a row, under its own name.
      const group = logicalId(raw.GroupId) ?? `(group of ${id})`;
      groups.set(group, [...(groups.get(group) ?? []), toRule(raw)]);
    }
  }
  return groups;
}
// #endregion from-template
