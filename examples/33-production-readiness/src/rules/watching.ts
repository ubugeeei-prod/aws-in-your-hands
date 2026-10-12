import {
  at,
  isSetTo,
  ofType,
  references,
  type Resource,
  setting,
  type Template,
} from "../template.ts";
import type { Problem } from "./rule.ts";

// #region log-retention
/** Logs that are kept for ever, or kept by a log group the template does not describe. */
export function logRetention(template: Template): Problem[] {
  const problems: Problem[] = [];
  for (const group of ofType(template, "AWS::Logs::LogGroup")) {
    const days = setting(group.properties["RetentionInDays"]);
    if (days === "absent") {
      problems.push({ resource: group.id, detail: "no RetentionInDays: log events never expire" });
    } else if (days === "intrinsic") {
      problems.push({ resource: group.id, detail: "RetentionInDays is decided at deploy time" });
    }
  }
  for (const fn of ofType(template, "AWS::Lambda::Function")) {
    if (at(fn.properties, "LoggingConfig", "LogGroup") === undefined) {
      problems.push({
        resource: fn.id,
        detail:
          "no LoggingConfig.LogGroup: Lambda writes to a log group this template does not configure",
      });
    }
  }
  return problems;
}
// #endregion log-retention

// #region watch-points
/**
 * What an alarm may watch on behalf of a function: the function itself, an HTTP API that
 * integrates with it, and a queue that feeds it together with that queue's dead-letter queue.
 * Schedules, topics, state machines and bucket notifications are not followed.
 */
export function watchPoints(template: Template, fn: Resource): Set<string> {
  const points = new Set([fn.id]);
  const pointsAtAny = (value: unknown): boolean => references(value).some((id) => points.has(id));

  // An integration may name an alias or a version, not the function.
  for (const part of ofType(template, "AWS::Lambda::Alias", "AWS::Lambda::Version")) {
    if (pointsAtAny(part.properties["FunctionName"])) {
      points.add(part.id);
    }
  }
  for (const integration of ofType(template, "AWS::ApiGatewayV2::Integration")) {
    if (pointsAtAny(integration.properties["IntegrationUri"])) {
      references(integration.properties["ApiId"]).forEach((id) => points.add(id));
    }
  }
  for (const mapping of ofType(template, "AWS::Lambda::EventSourceMapping")) {
    if (pointsAtAny(mapping.properties["FunctionName"])) {
      for (const source of references(mapping.properties["EventSourceArn"])) {
        points.add(source);
        const queue = template.resources.find((resource) => resource.id === source);
        references(queue?.properties["RedrivePolicy"]).forEach((id) => points.add(id));
      }
    }
  }
  return points;
}
// #endregion watch-points

// #region function-alarm
/** A function that can fail without any alarm in the template changing state. */
export function functionAlarm(template: Template): Problem[] {
  const watched = new Set(
    ofType(template, "AWS::CloudWatch::Alarm").flatMap((alarm) => [
      ...references(alarm.properties["Dimensions"]),
      ...references(alarm.properties["Metrics"]),
    ]),
  );
  return ofType(template, "AWS::Lambda::Function")
    .filter((fn) => [...watchPoints(template, fn)].every((id) => !watched.has(id)))
    .map((fn) => ({
      resource: fn.id,
      detail: "no alarm watches the function, an API in front of it, or a queue that feeds it",
    }));
}
// #endregion function-alarm

// #region alarm-recipient
/** An alarm that changes state without anyone being told. */
export function alarmRecipient(template: Template): Problem[] {
  const topics = new Set(ofType(template, "AWS::SNS::Topic").map((topic) => topic.id));
  const subscribed = new Set([
    ...ofType(template, "AWS::SNS::Subscription").flatMap((subscription) =>
      references(subscription.properties["TopicArn"]),
    ),
    ...ofType(template, "AWS::SNS::Topic")
      .filter((topic) => [topic.properties["Subscription"]].flat().some((entry) => entry))
      .map((topic) => topic.id),
  ]);

  const problems: Problem[] = [];
  for (const alarm of ofType(template, "AWS::CloudWatch::Alarm")) {
    const actions = [alarm.properties["AlarmActions"] ?? []].flat();
    if (isSetTo(alarm.properties["ActionsEnabled"], false)) {
      problems.push({ resource: alarm.id, detail: "ActionsEnabled is false" });
    } else if (actions.length === 0) {
      problems.push({ resource: alarm.id, detail: "no AlarmActions: nobody is told" });
    } else {
      // An ARN written out, or imported from another stack, is beyond what this template shows.
      const local = actions.map((action) => references(action).filter((id) => topics.has(id)));
      const allLocal = local.every((ids) => ids.length > 0);
      if (allLocal && local.flat().every((id) => !subscribed.has(id))) {
        problems.push({
          resource: alarm.id,
          detail: `notifies ${[...new Set(local.flat())].join(", ")}, which has no subscription in this template`,
        });
      }
    }
  }
  return problems;
}
// #endregion alarm-recipient
