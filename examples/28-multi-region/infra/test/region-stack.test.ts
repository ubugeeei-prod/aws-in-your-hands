import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { HEALTH_PATH } from "../../src/regional-app.ts";
import { PRIMARY_REGION, type Region, STANDBY_REGION, TABLE_NAME } from "../../src/regions.ts";
import { type DnsProps, RegionStack, type RegionStackProps } from "../lib/region-stack.ts";

const DNS: DnsProps = {
  hostedZoneId: "Z0123456789EXAMPLE",
  zoneName: "example.com",
  domainName: "api.example.com",
  routing: "failover",
};

// Synthesized once each: every synth bundles the function with esbuild.
const synth = (region: Region, options: Partial<RegionStackProps> = {}) =>
  Template.fromStack(
    new RegionStack(
      new App(),
      region === PRIMARY_REGION ? "AihMultiRegion" : "AihMultiRegionStandby",
      {
        region,
        allowedOrigin: "http://localhost:5173",
        writes: "accept",
        replicateUploads: region === PRIMARY_REGION,
        replicationTimeControl: false,
        ...options,
      },
    ),
  );
const tokyo = synth(PRIMARY_REGION);
const osaka = synth(STANDBY_REGION);
const osakaBack = synth(STANDBY_REGION, { replicateUploads: true });
const tokyoTimed = synth(PRIMARY_REGION, { replicationTimeControl: true });
const tokyoDrill = synth(PRIMARY_REGION, { failHealth: true });
const osakaReadOnly = synth(STANDBY_REGION, { writes: "refuse" });
const tokyoDns = synth(PRIMARY_REGION, { dns: DNS });
const osakaDns = synth(STANDBY_REGION, { dns: DNS });
const osakaLatency = synth(STANDBY_REGION, { dns: { ...DNS, routing: "latency" } });

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
const statementsOf = (template: Template): Statement[] =>
  Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
    (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
  );
const typesOf = (template: Template): string[] => {
  const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
  return [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
};

// cdkd 0.296.28 registers a dedicated provider for each of these.
const STANDBY_TYPES = [
  "AWS::ApiGatewayV2::Api",
  "AWS::ApiGatewayV2::Integration",
  "AWS::ApiGatewayV2::Route",
  "AWS::ApiGatewayV2::Stage",
  "AWS::IAM::Policy",
  "AWS::IAM::Role",
  "AWS::Lambda::Function",
  "AWS::Lambda::Permission",
  "AWS::Logs::LogGroup",
  "AWS::S3::Bucket",
  "AWS::S3::BucketPolicy",
];
// AWS::CertificateManager::Certificate and AWS::Route53::RecordSet have providers
// too. The other three go through the Cloud Control API.
const DNS_TYPES = [
  "AWS::ApiGatewayV2::ApiMapping",
  "AWS::ApiGatewayV2::DomainName",
  "AWS::CertificateManager::Certificate",
  "AWS::Route53::HealthCheck",
  "AWS::Route53::RecordSet",
];

describe("the two stacks, by default", () => {
  it("use only resource types the pinned cdkd has a provider for", () => {
    expect(typesOf(osaka)).toEqual(STANDBY_TYPES);
    expect(typesOf(tokyo)).toEqual([...STANDBY_TYPES, "AWS::DynamoDB::GlobalTable"].toSorted());
  });

  it("declare the table once, in Tokyo, with a replica in each Region", () => {
    tokyo.resourceCountIs("AWS::DynamoDB::GlobalTable", 1);
    osaka.resourceCountIs("AWS::DynamoDB::GlobalTable", 0);
    tokyo.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: TABLE_NAME,
      BillingMode: "PAY_PER_REQUEST",
      Replicas: Match.arrayWith([
        Match.objectLike({ Region: STANDBY_REGION }),
        Match.objectLike({ Region: PRIMARY_REGION }),
      ]),
    });
  });

  it("leave the table eventually consistent across Regions, and say so by naming no mode", () => {
    tokyo.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      MultiRegionConsistency: Match.absent(),
      GlobalTableWitnesses: Match.absent(),
    });
  });

  it("keep point-in-time recovery on in both Regions: a replica is not a backup", () => {
    const table = Object.values(tokyo.findResources("AWS::DynamoDB::GlobalTable"))[0];
    const replicas = table?.["Properties"].Replicas as Record<string, unknown>[];
    expect(replicas).toHaveLength(2);
    for (const replica of replicas) {
      expect(replica["PointInTimeRecoverySpecification"]).toEqual({
        PointInTimeRecoveryEnabled: true,
      });
    }
  });

  it("delete the practice table and buckets with the stacks", () => {
    tokyo.hasResource("AWS::DynamoDB::GlobalTable", { DeletionPolicy: "Delete" });
    for (const template of [tokyo, osaka]) {
      template.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Delete" });
    }
  });
});

describe("the buckets", () => {
  it("are private, encrypted, versioned, and reachable over TLS only", () => {
    for (const template of [tokyo, osaka]) {
      template.hasResourceProperties("AWS::S3::Bucket", {
        VersioningConfiguration: { Status: "Enabled" },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
      });
      template.hasResourceProperties("AWS::S3::BucketPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Deny",
              Condition: { Bool: { "aws:SecureTransport": "false" } },
            }),
          ]),
        },
      });
    }
  });

  it("replicate from Tokyo to Osaka, without delete markers and without a promised time", () => {
    tokyo.hasResourceProperties("AWS::S3::Bucket", {
      ReplicationConfiguration: {
        Rules: [
          Match.objectLike({
            Id: `to-${STANDBY_REGION}`,
            Status: "Enabled",
            DeleteMarkerReplication: { Status: "Disabled" },
            Destination: Match.objectLike({
              ReplicationTime: Match.absent(),
              Metrics: Match.absent(),
            }),
          }),
        ],
      },
    });
  });

  it("add the 15-minute promise and its metrics only when asked, because both are billed", () => {
    tokyoTimed.hasResourceProperties("AWS::S3::Bucket", {
      ReplicationConfiguration: {
        Rules: [
          Match.objectLike({
            Destination: Match.objectLike({
              ReplicationTime: { Status: "Enabled", Time: { Minutes: 15 } },
              Metrics: { Status: "Enabled", EventThreshold: { Minutes: 15 } },
            }),
          }),
        ],
      },
    });
  });

  it("do not replicate back from Osaka until asked, because Tokyo's bucket must exist first", () => {
    osaka.hasResourceProperties("AWS::S3::Bucket", { ReplicationConfiguration: Match.absent() });
    osaka.resourceCountIs("AWS::IAM::Role", 1);
    osakaBack.hasResourceProperties("AWS::S3::Bucket", {
      ReplicationConfiguration: { Rules: [Match.objectLike({ Id: `to-${PRIMARY_REGION}` })] },
    });
  });

  it("give the replication role no fixed name, so two stacks do not collide in IAM", () => {
    for (const template of [tokyo, osakaBack]) {
      template.hasResourceProperties("AWS::IAM::Role", {
        RoleName: Match.absent(),
        AssumeRolePolicyDocument: {
          Statement: [Match.objectLike({ Principal: { Service: "s3.amazonaws.com" } })],
        },
      });
    }
  });
});

describe("permissions", () => {
  it("never use a wildcard action, or a wildcard resource", () => {
    for (const template of [tokyo, osaka, osakaBack, tokyoDns]) {
      for (const statement of statementsOf(template)) {
        expect(statement.Effect).toBe("Allow");
        expect([statement.Action].flat().filter((action) => action.includes("*"))).toEqual([]);
        expect(statement.Resource).not.toBe("*");
      }
    }
  });

  it("let each function reach the table copy in its own Region only", () => {
    for (const [template, region, other] of [
      [tokyo, PRIMARY_REGION, STANDBY_REGION],
      [osaka, STANDBY_REGION, PRIMARY_REGION],
    ] as const) {
      const table = statementsOf(template).filter((statement) =>
        [statement.Action].flat().some((action) => action.startsWith("dynamodb:")),
      );
      expect(table).toHaveLength(1);
      expect(table[0]?.Action).toEqual([
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
      ]);
      const resource = JSON.stringify(table[0]?.Resource);
      expect(resource).toContain(`:dynamodb:${region}:`);
      expect(resource).not.toContain(other);
    }
  });

  it("let the replication role read one bucket and write replicas into the other", () => {
    const actions = statementsOf(tokyo)
      .flatMap((statement) => [statement.Action].flat())
      .filter((action) => action.startsWith("s3:"));
    expect(actions.toSorted()).toEqual([
      "s3:GetObjectVersionAcl",
      "s3:GetObjectVersionForReplication",
      "s3:GetObjectVersionTagging",
      "s3:GetReplicationConfiguration",
      "s3:ListBucket",
      "s3:ReplicateDelete",
      "s3:ReplicateObject",
      "s3:ReplicateTags",
    ]);
  });
});

describe("the function", () => {
  it("is told its Region and its write mode by the stack", () => {
    tokyo.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          REGION: PRIMARY_REGION,
          WRITES: "accept",
          TABLE_NAME,
          NOTES_STORE: "dynamodb",
        }),
      },
    });
    osakaReadOnly.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ REGION: STANDBY_REGION, WRITES: "refuse" }) },
    });
  });

  it("fails its health check on purpose only when a drill asks for it", () => {
    tokyo.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ HEALTH: "probe" }) },
    });
    tokyoDrill.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ HEALTH: "fail" }) },
    });
  });

  it("has a route for the health check and a throttle on the stage", () => {
    for (const template of [tokyo, osaka]) {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: `GET ${HEALTH_PATH}`,
      });
      template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
        DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
      });
    }
  });
});

describe("with a domain", () => {
  it("adds exactly the DNS resources, in both Regions", () => {
    expect(typesOf(osakaDns)).toEqual([...STANDBY_TYPES, ...DNS_TYPES].toSorted());
    expect(typesOf(tokyoDns)).toEqual(
      [...STANDBY_TYPES, ...DNS_TYPES, "AWS::DynamoDB::GlobalTable"].toSorted(),
    );
  });

  it("checks each Region at its own endpoint, with the interval and threshold the RTO assumes", () => {
    for (const [template, region] of [
      [tokyoDns, PRIMARY_REGION],
      [osakaDns, STANDBY_REGION],
    ] as const) {
      template.hasResourceProperties("AWS::Route53::HealthCheck", {
        HealthCheckConfig: Match.objectLike({
          Type: "HTTPS",
          Port: 443,
          ResourcePath: HEALTH_PATH,
          RequestInterval: 30,
          FailureThreshold: 3,
        }),
      });
      const check = Object.values(template.findResources("AWS::Route53::HealthCheck"))[0];
      const fqdn = JSON.stringify(check?.["Properties"].HealthCheckConfig.FullyQualifiedDomainName);
      expect(fqdn).toContain(`.execute-api.${region}.`);
      expect(fqdn).not.toContain(DNS.domainName);
    }
  });

  it("makes Tokyo the primary record and Osaka the secondary, each tied to its health check", () => {
    for (const [template, region, failover] of [
      [tokyoDns, PRIMARY_REGION, "PRIMARY"],
      [osakaDns, STANDBY_REGION, "SECONDARY"],
    ] as const) {
      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Name: `${DNS.domainName}.`,
        Type: "A",
        SetIdentifier: region,
        Failover: failover,
        Region: Match.absent(),
        HealthCheckId: Match.anyValue(),
        AliasTarget: Match.objectLike({ EvaluateTargetHealth: true }),
      });
    }
  });

  it("swaps failover for the Region name under latency routing", () => {
    osakaLatency.hasResourceProperties("AWS::Route53::RecordSet", {
      SetIdentifier: STANDBY_REGION,
      Region: STANDBY_REGION,
      Failover: Match.absent(),
    });
  });

  it("asks for a certificate in each Region, validated through the zone", () => {
    for (const template of [tokyoDns, osakaDns]) {
      template.hasResourceProperties("AWS::CertificateManager::Certificate", {
        DomainName: DNS.domainName,
        ValidationMethod: "DNS",
        DomainValidationOptions: [{ DomainName: DNS.domainName, HostedZoneId: DNS.hostedZoneId }],
      });
    }
  });
});
