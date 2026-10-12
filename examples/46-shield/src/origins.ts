import {
  at,
  isSetTo,
  ofType,
  readTemplate,
  references,
  type Resource,
  setting,
  type Template,
} from "@aih/example-33-production-readiness/src/template.ts";

// #region finding
/**
 * closed: nothing on the internet reaches it except through CloudFront, or not at all.
 * bypassable: a distribution is in front, and the origin answers without it too.
 * direct: it answers the internet and no distribution in this template points at it.
 * unknown: the template does not say. A deploy-time value, or a resource defined elsewhere.
 */
export type Exposure = "closed" | "bypassable" | "direct" | "unknown";

export type Finding = {
  id: string;
  type: string;
  exposure: Exposure;
  reason: string;
};
// #endregion finding

const FUNCTION_URL = "AWS::Lambda::Url";
const LOAD_BALANCER = "AWS::ElasticLoadBalancingV2::LoadBalancer";
const HTTP_API = "AWS::ApiGatewayV2::Api";
const REST_API = "AWS::ApiGateway::RestApi";

/** The resource types this check has an opinion about. Anything else is not looked at. */
export const EXAMINED = [FUNCTION_URL, LOAD_BALANCER, HTTP_API, REST_API] as const;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// #region fronted
/** Logical IDs that some distribution in the template names in one of its origins. */
export function frontedIds(template: Template): Set<string> {
  const byId = new Map(template.resources.map((resource) => [resource.id, resource]));
  const found = new Set<string>();
  for (const distribution of ofType(template, "AWS::CloudFront::Distribution")) {
    for (const id of references(at(distribution.properties, "DistributionConfig", "Origins"))) {
      found.add(id);
      // A VPC origin is a resource of its own that points at the load balancer.
      const target = byId.get(id);
      if (target?.type === "AWS::CloudFront::VpcOrigin") {
        references(target.properties).forEach((inner) => found.add(inner));
      }
    }
  }
  return found;
}
// #endregion fronted

type Door = { open: boolean | "unknown"; reason: string };

// #region function-url
function functionUrlDoor(url: Resource, template: Template): Door {
  const authType = setting(url.properties["AuthType"]);
  if (authType === "absent" || authType === "intrinsic") {
    return { open: "unknown", reason: "AuthType is not a literal in the template" };
  }
  if (authType.value === "NONE") {
    return { open: true, reason: "AuthType NONE: anyone who has the URL can invoke it" };
  }
  // AWS_IAM: only a signed request gets in. Who may sign is in the function's permissions.
  // CDK writes them against the URL's own FunctionArn; by hand they name the function.
  const targets = new Set([url.id, ...references(url.properties["TargetFunctionArn"])]);
  const permissions = ofType(template, "AWS::Lambda::Permission").filter((permission) =>
    references(permission.properties["FunctionName"]).some((id) => targets.has(id)),
  );
  for (const permission of permissions) {
    const principal = permission.properties["Principal"];
    if (principal === "*") {
      return { open: true, reason: `${permission.id} lets any principal invoke it` };
    }
    if (
      principal === "cloudfront.amazonaws.com" &&
      permission.properties["SourceArn"] === undefined
    ) {
      return {
        open: true,
        reason: `${permission.id} names CloudFront without SourceArn: any distribution, in any account`,
      };
    }
  }
  return { open: false, reason: "AuthType AWS_IAM, and no permission for an unnamed caller" };
}
// #endregion function-url

// #region load-balancer
const EVERYONE = ["0.0.0.0/0", "::/0"];

type Ingress = { cidr: unknown; prefixList: unknown; group: unknown };

const ingressOf = (rule: unknown): Ingress => ({
  cidr: at(rule, "CidrIp") ?? at(rule, "CidrIpv6"),
  prefixList: at(rule, "SourcePrefixListId"),
  group: at(rule, "SourceSecurityGroupId"),
});

function loadBalancerDoor(loadBalancer: Resource, template: Template): Door {
  // CloudFormation's default is internet-facing, so only the literal "internal" closes it.
  if (isSetTo(loadBalancer.properties["Scheme"], "internal")) {
    return { open: false, reason: "Scheme internal: no public address" };
  }
  const groupIds = new Set(references(loadBalancer.properties["SecurityGroups"]));
  const groups = ofType(template, "AWS::EC2::SecurityGroup").filter((group) =>
    groupIds.has(group.id),
  );
  if (
    groups.length === 0 ||
    groups.length < list(loadBalancer.properties["SecurityGroups"]).length
  ) {
    return { open: "unknown", reason: "a security group of it is not defined in this template" };
  }
  const rules = [
    ...groups.flatMap((group) => list(group.properties["SecurityGroupIngress"])),
    ...ofType(template, "AWS::EC2::SecurityGroupIngress")
      .filter((rule) => references(rule.properties["GroupId"]).some((id) => groupIds.has(id)))
      .map((rule) => rule.properties),
  ].map(ingressOf);

  if (rules.some((rule) => typeof rule.cidr === "string" && EVERYONE.includes(rule.cidr))) {
    return {
      open: true,
      reason: "internet-facing, and its security group admits 0.0.0.0/0 or ::/0",
    };
  }
  // A CIDR narrower than everyone may be an office or an attacker's whole provider. Not judged.
  if (rules.some((rule) => rule.cidr !== undefined)) {
    return {
      open: "unknown",
      reason: "its security group admits a CIDR this check cannot attribute",
    };
  }
  return {
    open: false,
    reason:
      rules.length === 0
        ? "internet-facing, but its security group admits nothing"
        : "internet-facing, but ingress is only from a prefix list or another security group",
  };
}
// #endregion load-balancer

// #region api-gateway
function apiDoor(api: Resource): Door {
  if (
    api.type === REST_API &&
    list(at(api.properties, "EndpointConfiguration", "Types")).includes("PRIVATE")
  ) {
    return { open: false, reason: "a private REST API: reachable only through a VPC endpoint" };
  }
  // No security group and, for an HTTP API, no resource policy: the endpoint is on the internet.
  return {
    open: true,
    reason: "API Gateway serves it on a public endpoint of its own; its throttle is the only brake",
  };
}
// #endregion api-gateway

// #region check
/** Every function URL, load balancer and API in one synthesized template, and how it can be reached. */
export function checkOrigins(input: unknown): Finding[] {
  const template = readTemplate(input);
  const fronted = frontedIds(template);
  return ofType(template, ...EXAMINED).map((resource): Finding => {
    const door =
      resource.type === FUNCTION_URL
        ? functionUrlDoor(resource, template)
        : resource.type === LOAD_BALANCER
          ? loadBalancerDoor(resource, template)
          : apiDoor(resource);
    const exposure: Exposure =
      door.open === "unknown"
        ? "unknown"
        : door.open
          ? fronted.has(resource.id)
            ? "bypassable"
            : "direct"
          : "closed";
    return { id: resource.id, type: resource.type, exposure, reason: door.reason };
  });
}

/** What a review has to look at: everything that is not known to be closed. */
export const notClosed = (findings: Finding[]): Finding[] =>
  findings.filter((finding) => finding.exposure !== "closed");
// #endregion check
