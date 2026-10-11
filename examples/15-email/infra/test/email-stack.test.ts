import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { EmailStack, type EmailStackProps } from "../lib/email-stack.ts";

const synth = (props: Partial<EmailStackProps> = {}) =>
  Template.fromStack(
    new EmailStack(new App(), "AihEmail", {
      env: { region: "ap-northeast-1" },
      fromAddress: "notes@example.com",
      senderIdentity: "notes@example.com",
      appOrigin: "https://notes.example.com",
      ...props,
    }),
  );

// Synthesis bundles two handlers with esbuild, so each variant runs once for the file.
const template = synth();
const domainTemplate = synth({ senderIdentity: "example.com", mailFromDomain: "bounce.example.com" });

type Statement = { Effect: string; Action: string | string[]; Resource: unknown; Condition?: unknown };
type Policy = { Properties: { PolicyDocument: { Statement: Statement[] }; Roles: { Ref: string }[] } };

const statementsOf = (rolePrefix: string): Statement[] =>
  (Object.values(template.findResources("AWS::IAM::Policy")) as Policy[])
    .filter((policy) => policy.Properties.Roles.some((role) => role.Ref.startsWith(rolePrefix)))
    .flatMap((policy) => policy.Properties.PolicyDocument.Statement);
const actionsOf = (statements: Statement[]) => statements.flatMap((statement) => statement.Action).toSorted();

describe("EmailStack", () => {
  it("lets the sending function send from one address, through one identity and one configuration set", () => {
    const statements = statementsOf("ApiRole");
    expect(actionsOf(statements)).toEqual([
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "ses:SendEmail",
    ]);

    const send = statements.find((statement) => statement.Action === "ses:SendEmail");
    expect(send?.Condition).toEqual({ StringEquals: { "ses:FromAddress": "notes@example.com" } });
    const resources = JSON.stringify(send?.Resource);
    expect(send?.Resource).toHaveLength(2);
    expect(resources).toContain(":identity/");
    expect(resources).toContain(":configuration-set/");
    expect(resources).not.toContain("identity/*");
  });

  it("gives the function that records events no way to send mail or read the table", () => {
    expect(actionsOf(statementsOf("EventsRole"))).toEqual([
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
  });

  it("uses no wildcard resource and no AWS-managed policy", () => {
    for (const statement of [...statementsOf("ApiRole"), ...statementsOf("EventsRole")]) {
      expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
    }
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("requires a signed IAM request on every route", () => {
    const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route")).map(
      (route) => route["Properties"] as { RouteKey: string; AuthorizationType: string },
    );
    expect(routes.map((route) => route.RouteKey).toSorted()).toEqual([
      "GET /health",
      "GET /share-notifications/{id}",
      "POST /share-notifications",
    ]);
    for (const route of routes) {
      expect(route.AuthorizationType).toBe("AWS_IAM");
    }
    // No CORS: nothing in a browser is meant to call this.
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", { CorsConfiguration: Match.absent() });
  });

  it("publishes bounces, complaints and deliveries to the topic, and nothing else", () => {
    template.hasResourceProperties("AWS::SES::ConfigurationSetEventDestination", {
      EventDestination: {
        Enabled: true,
        MatchingEventTypes: ["bounce", "complaint", "delivery"],
        SnsDestination: { TopicARN: { Ref: Match.stringLikeRegexp("^MailEvents") } },
      },
    });
  });

  it("lets only SES, for this configuration set, publish to the topic", () => {
    const policies = Object.values(template.findResources("AWS::SNS::TopicPolicy"));
    const statements = policies.flatMap(
      (policy) => policy["Properties"].PolicyDocument.Statement as (Statement & { Principal: unknown })[],
    );
    const allows = statements.filter((statement) => statement.Effect === "Allow");
    expect(allows).toHaveLength(1);
    expect(allows[0]).toMatchObject({ Action: "sns:Publish", Principal: { Service: "ses.amazonaws.com" } });
    expect(JSON.stringify(allows[0]?.Condition)).toContain(":configuration-set/");
    // enforceSSL adds a Deny for plain HTTP; that is the only other statement.
    expect(statements.filter((statement) => statement.Effect === "Deny")).toHaveLength(1);
  });

  it("turns on SES's own suppression for both reasons on the configuration set", () => {
    template.hasResourceProperties("AWS::SES::ConfigurationSet", {
      SuppressionOptions: { SuppressedReasons: ["BOUNCE", "COMPLAINT"] },
    });
  });

  it("makes the configuration set the identity's default", () => {
    template.hasResourceProperties("AWS::SES::EmailIdentity", {
      EmailIdentity: "notes@example.com",
      ConfigurationSetAttributes: { ConfigurationSetName: { Ref: Match.stringLikeRegexp("^Notifications") } },
    });
  });

  it("expires notification records and deletes the practice table with the stack", () => {
    template.hasResource("AWS::DynamoDB::Table", {
      Properties: {
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
        TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
      },
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("expires both log groups after a week and deletes them with the stack", () => {
    const groups = Object.values(template.findResources("AWS::Logs::LogGroup"));
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group).toMatchObject({ Properties: { RetentionInDays: 7 }, DeletionPolicy: "Delete" });
    }
  });

  it("tells each function only the settings it uses", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: { MAIL_MODE: "aws", FROM_ADDRESS: "notes@example.com", CONFIGURATION_SET_NAME: Match.anyValue() },
      },
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: { MAIL_MODE: Match.absent(), FROM_ADDRESS: Match.absent(), TABLE_NAME: Match.anyValue() },
      },
    });
  });

  it("verifies a domain with DKIM outputs and an optional MAIL FROM domain", () => {
    domainTemplate.hasResourceProperties("AWS::SES::EmailIdentity", {
      EmailIdentity: "example.com",
      MailFromAttributes: { MailFromDomain: "bounce.example.com", BehaviorOnMxFailure: "USE_DEFAULT_VALUE" },
    });
    const outputs = Object.keys(domainTemplate.toJSON()["Outputs"] as Record<string, unknown>);
    expect(outputs).toEqual(expect.arrayContaining(["DkimName1", "DkimValue3", "MailFromDomain"]));
    // An address identity has no DNS records of its own to publish.
    expect(Object.keys(template.toJSON()["Outputs"] as Record<string, unknown>)).not.toContain("DkimName1");
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect([...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted()).toEqual([
      "AWS::ApiGatewayV2::Api",
      "AWS::ApiGatewayV2::Integration",
      "AWS::ApiGatewayV2::Route",
      "AWS::ApiGatewayV2::Stage",
      "AWS::DynamoDB::Table",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
      // No dedicated provider in cdkd 0.296.28: these three go through Cloud Control API.
      "AWS::SES::ConfigurationSet",
      "AWS::SES::ConfigurationSetEventDestination",
      "AWS::SES::EmailIdentity",
      "AWS::SNS::Subscription",
      "AWS::SNS::Topic",
      "AWS::SNS::TopicPolicy",
    ]);
  });
});
