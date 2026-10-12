import { at, isSetTo, ofType, references, setting, type Template } from "../template.ts";
import type { Problem } from "./rule.ts";

// #region api-throttle
/** An HTTP API stage with no limit of its own: only the account's limit stands in front of it. */
export function apiThrottle(template: Template): Problem[] {
  return ofType(template, "AWS::ApiGatewayV2::Stage")
    .filter((stage) =>
      ["ThrottlingRateLimit", "ThrottlingBurstLimit"].some((key) => {
        const limit = setting(at(stage.properties, "DefaultRouteSettings", key));
        return typeof limit !== "object" || typeof limit.value !== "number";
      }),
    )
    .map((stage) => ({
      resource: stage.id,
      detail: "DefaultRouteSettings sets no ThrottlingRateLimit and ThrottlingBurstLimit",
    }));
}
// #endregion api-throttle

// #region function-url-auth
/** A function URL that answers anyone who has the URL. */
export function functionUrlAuth(template: Template): Problem[] {
  return ofType(template, "AWS::Lambda::Url")
    .filter((url) => !isSetTo(url.properties["AuthType"], "AWS_IAM"))
    .map((url) => {
      const auth = setting(url.properties["AuthType"]);
      return {
        resource: url.id,
        detail: `AuthType is ${typeof auth === "object" ? auth.value : "not a literal AWS_IAM"}`,
      };
    });
}
// #endregion function-url-auth

// #region queue-dlq
/** A queue a function consumes, with nowhere for a message that keeps failing to go. */
export function queueDlq(template: Template): Problem[] {
  const consumed = new Set(
    ofType(template, "AWS::Lambda::EventSourceMapping").flatMap((mapping) =>
      references(mapping.properties["EventSourceArn"]),
    ),
  );
  return ofType(template, "AWS::SQS::Queue")
    .filter((queue) => consumed.has(queue.id))
    .filter((queue) => at(queue.properties, "RedrivePolicy", "deadLetterTargetArn") === undefined)
    .map((queue) => ({
      resource: queue.id,
      detail: "consumed by a function, and has no RedrivePolicy.deadLetterTargetArn",
    }));
}
// #endregion queue-dlq
