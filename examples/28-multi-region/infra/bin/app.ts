import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { PRIMARY_REGION, STANDBY_REGION } from "../../src/regions.ts";
import { type DnsProps, RegionStack } from "../lib/region-stack.ts";

const app = new App();

// #region context
// What costs money while idle, needs a domain, or needs the other stack to exist first is asked for by name.
//   -c back=on                 Osaka's bucket also replicates to Tokyo (deploy Tokyo once before this)
//   -c rtc=on                  S3 Replication Time Control and its metrics on every replication rule
//   -c standbyWrites=refuse    Osaka answers reads only, until deployed again without it
//   -c domain=api.example.com -c zoneId=Z... -c zoneName=example.com
//                              a custom domain in both Regions, health checks, and DNS records
//   -c routing=latency         with a domain: nearest healthy Region instead of Tokyo first
//   -c drill=on                Tokyo's health check answers 503 while Tokyo keeps working
const contextSchema = v.object({
  allowedOrigin: v.optional(v.pipe(v.string(), v.url()), "http://localhost:5173"),
  back: v.optional(v.picklist(["on", "off"]), "off"),
  rtc: v.optional(v.picklist(["on", "off"]), "off"),
  drill: v.optional(v.picklist(["on", "off"]), "off"),
  standbyWrites: v.optional(v.picklist(["accept", "refuse"]), "accept"),
  routing: v.optional(v.picklist(["failover", "latency"]), "failover"),
  domain: v.optional(v.pipe(v.string(), v.regex(/^[a-z0-9.-]+\.[a-z]{2,}$/))),
  zoneId: v.optional(v.pipe(v.string(), v.regex(/^Z[A-Z0-9]+$/))),
  zoneName: v.optional(v.pipe(v.string(), v.regex(/^[a-z0-9.-]+\.[a-z]{2,}$/))),
});
// A misspelled value stops the synth here instead of deploying the default.
const context = v.parse(
  contextSchema,
  Object.fromEntries(
    Object.keys(contextSchema.entries).map((name) => [name, app.node.tryGetContext(name)]),
  ),
);

function dnsProps(): DnsProps | undefined {
  const { domain, zoneId, zoneName, routing } = context;
  if (domain === undefined && zoneId === undefined && zoneName === undefined) {
    return undefined;
  }
  if (domain === undefined || zoneId === undefined || zoneName === undefined) {
    throw new Error("domain, zoneId and zoneName go together: pass all three or none.");
  }
  if (!domain.endsWith(`.${zoneName}`)) {
    throw new Error(`${domain} is not a name inside the zone ${zoneName}.`);
  }
  if (routing === "latency" && context.standbyWrites === "refuse") {
    throw new Error(
      "Latency routing sends writes to Osaka. It cannot be combined with standbyWrites=refuse.",
    );
  }
  return { hostedZoneId: zoneId, zoneName, domainName: domain, routing };
}
const dns = dnsProps();
// #endregion context

// #region stacks
// Osaka first: Tokyo's bucket replicates into Osaka's, which must exist by then.
new RegionStack(app, "AihMultiRegionStandby", {
  region: STANDBY_REGION,
  description: "AWS in Your Hands chapter 28: the standby Region (Osaka)",
  allowedOrigin: context.allowedOrigin,
  writes: context.standbyWrites,
  replicateUploads: context.back === "on",
  replicationTimeControl: context.rtc === "on",
  dns,
});

new RegionStack(app, "AihMultiRegion", {
  region: PRIMARY_REGION,
  description: "AWS in Your Hands chapter 28: the primary Region (Tokyo) and the global table",
  allowedOrigin: context.allowedOrigin,
  writes: "accept",
  replicateUploads: true,
  replicationTimeControl: context.rtc === "on",
  failHealth: context.drill === "on",
  dns,
});
// #endregion stacks
