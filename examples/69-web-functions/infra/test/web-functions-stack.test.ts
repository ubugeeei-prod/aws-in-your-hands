import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { parseRelease, type Release } from "../../src/release.ts";
import { WebFunctionsStack } from "../lib/web-functions-stack.ts";

type Resource = {
  Type: string;
  Properties: Record<string, unknown>;
  DependsOn?: string[];
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
};
type Statement = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Principal?: unknown;
  Condition?: unknown;
};

function synth(release: Release | undefined) {
  const stack = new WebFunctionsStack(new App({ analyticsReporting: false }), "AihWebFunctions", {
    env: { region: "ap-northeast-1" },
    allowedOrigin: "http://localhost:5173",
    release,
  });
  const json = Template.fromStack(stack).toJSON() as {
    Resources: Record<string, Resource>;
    Outputs: Record<string, unknown>;
  };
  const ofType = (type: string) =>
    Object.entries(json.Resources)
      .filter(([, resource]) => resource.Type === type)
      .map(([id, resource]) => ({ id, ...resource }));
  const one = (type: string) => {
    const found = ofType(type);
    if (found.length !== 1 || found[0] === undefined) {
      throw new Error(`expected one ${type}, found ${found.length}`);
    }
    return found[0];
  };
  return { ...json, ofType, one };
}

const release = (flags: Record<string, string>) => parseRelease((key) => flags[key]);
const foundation = synth(undefined);
const released = synth(release({ stable: "v1" }));
const canary = synth(release({ stable: "v1", canary: "v2", canaryWeight: "10" }));

const types = (template: ReturnType<typeof synth>) =>
  [...new Set(Object.values(template.Resources).map((resource) => resource.Type))].toSorted();
const statements = (resource: Resource): Statement[] =>
  (resource.Properties["PolicyDocument"] as { Statement: Statement[] }).Statement;

describe("WebFunctionsStack: the resource types", () => {
  // #region types
  // cdkd 0.296.28, src/provisioning/register-providers.ts: a provider of its own for the first
  // five. None for the three AWS::Lambda::WebFunction* types, and the Cloud Control API's list of
  // supported resources did not have them on 2026-10-13. Hence CloudFormation for this stack.
  const CDKD_HAS_A_PROVIDER = [
    "AWS::IAM::Policy",
    "AWS::IAM::Role",
    "AWS::Logs::LogGroup",
    "AWS::S3::Bucket",
    "AWS::S3::BucketPolicy",
  ];
  const CLOUDFORMATION_ONLY = [
    "AWS::Lambda::WebFunction",
    "AWS::Lambda::WebFunctionEndpoint",
    "AWS::Lambda::WebFunctionRevision",
  ];

  it("are exactly these, once a package has been uploaded", () => {
    expect(types(released)).toEqual([...CDKD_HAS_A_PROVIDER, ...CLOUDFORMATION_ONLY].toSorted());
  });
  // #endregion types

  it("hold no revision and no endpoint before the first upload: nothing can be reached yet", () => {
    expect(types(foundation)).toEqual(
      [...CDKD_HAS_A_PROVIDER, "AWS::Lambda::WebFunction"].toSorted(),
    );
    expect(Object.keys(foundation.Outputs).toSorted()).toEqual(["CodeBucket", "FunctionArn"]);
  });

  it("include no API Gateway, no function URL, and no event function: the server needs none", () => {
    const all = types(canary).join(" ");
    expect(all).not.toMatch(
      /ApiGateway|AWS::Lambda::Url|AWS::Lambda::Function|AWS::Lambda::Permission/,
    );
  });
});

describe("WebFunctionsStack: who may reach the server", () => {
  it("has one endpoint, in one Region, that Lambda guards with IAM", () => {
    expect(released.one("AWS::Lambda::WebFunctionEndpoint").Properties).toMatchObject({
      FunctionName: "aih-web-notes",
      EndpointName: "notes",
      EndpointType: "HomeRegion",
      AuthType: "IamAuth",
    });
    expect(JSON.stringify(canary.Resources)).not.toContain("ApplicationManaged");
  });

  it("attaches no resource-based policy: only this account's own principals can be allowed in", () => {
    expect(canary.ofType("AWS::Lambda::ResourcePolicy")).toEqual([]);
  });

  it("puts both brakes on the endpoint", () => {
    expect(released.one("AWS::Lambda::WebFunctionEndpoint").Properties).toMatchObject({
      ScalingConfig: { MaxEnvironments: 2 },
      ThrottleConfig: { RateLimit: 100 },
    });
  });
});

describe("WebFunctionsStack: revisions and traffic", () => {
  const weights = (template: ReturnType<typeof synth>) =>
    template.one("AWS::Lambda::WebFunctionEndpoint").Properties["RevisionWeights"] as {
      RevisionId: { "Fn::GetAtt": [string, string] };
      Weight: number;
    }[];
  const versionOf = (template: ReturnType<typeof synth>, id: string) =>
    (
      template.Resources[id]?.Properties["BuildConfig"] as
        | { CodeConfig: { S3Object: { VersionId: string } } }
        | undefined
    )?.CodeConfig.S3Object.VersionId;

  it("pins a revision to one version of the object, on the only runtime there is", () => {
    const revision = released.one("AWS::Lambda::WebFunctionRevision");
    expect(revision.Properties["BuildConfig"]).toEqual({
      CodeConfig: {
        S3Object: {
          Bucket: { Ref: released.one("AWS::S3::Bucket").id },
          Key: "notes/function.zip",
          VersionId: "v1",
        },
      },
      RuntimeConfig: { Runtime: "nodejs24.x" },
    });
  });

  it("writes out every setting: a revision copies nothing from the one before", () => {
    const role = released.one("AWS::IAM::Role");
    expect(released.one("AWS::Lambda::WebFunctionRevision").Properties["ServiceConfig"]).toEqual({
      ExecutionRoleArn: { "Fn::GetAtt": [role.id, "Arn"] },
      TimeoutSeconds: 10,
      MaxConcurrencyPerEnvironment: 64,
      EnvironmentVariables: {
        ALLOWED_ORIGIN: "http://localhost:5173",
        LOG_LEVEL: "info",
        STAGE: "dev",
        RELEASE: "v1",
      },
      TelemetryConfig: {
        LoggingConfig: {
          LogGroup: "/aih/web-notes",
          ApplicationLogLevel: "INFO",
          SystemLogLevel: "INFO",
        },
      },
    });
  });

  it("sets no variable Lambda reserves", () => {
    const reserved =
      /^AWS_(ACCESS_KEY|SECRET|SECURITY_TOKEN|SESSION_TOKEN|DEFAULT_REGION|REGION|LAMBDA_)/;
    for (const revision of canary.ofType("AWS::Lambda::WebFunctionRevision")) {
      const variables = (revision.Properties["ServiceConfig"] as { EnvironmentVariables: object })
        .EnvironmentVariables;
      expect(Object.keys(variables).filter((name) => reserved.test(name))).toEqual([]);
    }
  });

  it("sends everything to the one revision when there is no canary", () => {
    expect(weights(released)).toEqual([
      {
        RevisionId: {
          "Fn::GetAtt": [released.one("AWS::Lambda::WebFunctionRevision").id, "RevisionId"],
        },
        Weight: 100,
      },
    ]);
  });

  // #region two-revisions
  it("keeps the stable revision as the same resource when a canary is added next to it", () => {
    const stableId = released.one("AWS::Lambda::WebFunctionRevision").id;
    const split = weights(canary);
    expect(split.map((entry) => entry.Weight)).toEqual([90, 10]);
    // Same logical ID and same properties: CloudFormation leaves the revision that is serving alone.
    expect(split[0]?.RevisionId["Fn::GetAtt"][0]).toBe(stableId);
    expect(canary.Resources[stableId]).toEqual(released.Resources[stableId]);
    expect(split.map((entry) => versionOf(canary, entry.RevisionId["Fn::GetAtt"][0]))).toEqual([
      "v1",
      "v2",
    ]);
  });

  it("promotes by naming the canary's upload as stable: its revision is not created again", () => {
    const promoted = synth(release({ stable: "v2" }));
    const canaryId = weights(canary)[1]?.RevisionId["Fn::GetAtt"][0] ?? "";
    expect(weights(promoted)).toEqual([
      { RevisionId: { "Fn::GetAtt": [canaryId, "RevisionId"] }, Weight: 100 },
    ]);
    expect(promoted.Resources[canaryId]).toEqual(canary.Resources[canaryId]);
    // The old revision leaves the template, and with it the stack: rolling back means creating it again.
    expect(promoted.ofType("AWS::Lambda::WebFunctionRevision")).toHaveLength(1);
  });
  // #endregion two-revisions

  it("creates a revision only after the function, the bucket policy, the role's policy and the log groups", () => {
    const revision = canary.ofType("AWS::Lambda::WebFunctionRevision")[0];
    expect(revision?.DependsOn?.toSorted()).toEqual(
      [
        canary.one("AWS::Lambda::WebFunction").id,
        canary.one("AWS::S3::BucketPolicy").id,
        canary.one("AWS::IAM::Policy").id,
        ...canary.ofType("AWS::Logs::LogGroup").map((group) => group.id),
      ].toSorted(),
    );
  });
});

describe("WebFunctionsStack: least privilege", () => {
  const groups = released.ofType("AWS::Logs::LogGroup");

  it("lets the server write to its two log groups and do nothing else", () => {
    expect(statements(released.one("AWS::IAM::Policy"))).toEqual([
      {
        Effect: "Allow",
        Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: groups.map((group) => ({ "Fn::GetAtt": [group.id, "Arn"] })),
      },
    ]);
    expect(released.one("AWS::IAM::Role").Properties["ManagedPolicyArns"]).toBeUndefined();
  });

  it("lets only Lambda assume the execution role", () => {
    expect(released.one("AWS::IAM::Role").Properties["AssumeRolePolicyDocument"]).toMatchObject({
      Statement: [
        {
          Effect: "Allow",
          Action: "sts:AssumeRole",
          Principal: { Service: "lambda.amazonaws.com" },
        },
      ],
    });
  });

  it("allows no action and no resource by wildcard in any policy", () => {
    const allowed = [
      ...released.ofType("AWS::IAM::Policy"),
      ...released.ofType("AWS::S3::BucketPolicy"),
    ]
      .flatMap(statements)
      .filter((statement) => statement.Effect === "Allow");
    expect(allowed.length).toBeGreaterThan(0);
    for (const statement of allowed) {
      expect([statement.Action].flat().filter((action) => action.includes("*"))).toEqual([]);
      expect(statement.Resource).not.toBe("*");
      expect(statement.Principal).not.toBe("*");
      expect(statement.Principal).not.toEqual({ AWS: "*" });
    }
  });

  it("lets Lambda read the package only on behalf of this function's revisions", () => {
    const bucket = released.one("AWS::S3::Bucket");
    const [read] = statements(released.one("AWS::S3::BucketPolicy")).filter(
      (statement) => statement.Effect === "Allow",
    );
    expect(read).toEqual({
      Sid: "LambdaReadsRevisionCode",
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: ["s3:GetObject", "s3:GetObjectVersion"],
      Resource: { "Fn::Join": ["", [{ "Fn::GetAtt": [bucket.id, "Arn"] }, "/notes/*"]] },
      Condition: {
        ArnLike: {
          "aws:SourceArn": {
            "Fn::Join": [
              "",
              [
                "arn:",
                { Ref: "AWS::Partition" },
                ":lambda:ap-northeast-1:",
                { Ref: "AWS::AccountId" },
                ":web-function/aih-web-notes/revision/*",
              ],
            ],
          },
        },
      },
    });
  });
});

describe("WebFunctionsStack: storage, retention and removal", () => {
  it("keeps the code bucket private, versioned, encrypted, and reachable over TLS only", () => {
    const bucket = released.one("AWS::S3::Bucket");
    expect(bucket.Properties).toMatchObject({
      VersioningConfiguration: { Status: "Enabled" },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
    });
    const deny = statements(released.one("AWS::S3::BucketPolicy")).filter(
      (statement) => statement.Effect === "Deny",
    );
    expect(deny).toHaveLength(1);
    expect(deny[0]?.Condition).toEqual({ Bool: { "aws:SecureTransport": "false" } });
  });

  it("creates both log groups itself, with one week of retention", () => {
    expect(released.ofType("AWS::Logs::LogGroup").map((group) => group.Properties)).toEqual([
      { LogGroupName: "/aih/web-notes", RetentionInDays: 7 },
      { LogGroupName: "/aih/web-notes.local", RetentionInDays: 7 },
    ]);
  });

  it("leaves nothing behind on purpose: no resource is retained", () => {
    for (const [id, resource] of Object.entries(canary.Resources)) {
      expect(resource.DeletionPolicy, id).not.toBe("Retain");
      expect(resource.UpdateReplacePolicy, id).not.toBe("Retain");
    }
    for (const type of ["AWS::S3::Bucket", "AWS::Logs::LogGroup"]) {
      for (const resource of canary.ofType(type)) {
        expect(resource.DeletionPolicy, resource.id).toBe("Delete");
      }
    }
  });

  it("names no account: the stack synthesizes without credentials", () => {
    expect(JSON.stringify(canary.Resources)).not.toMatch(/\d{12}/);
  });
});
