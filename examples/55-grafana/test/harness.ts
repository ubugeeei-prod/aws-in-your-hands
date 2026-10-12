import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { ObservabilityStack } from "@aih/example-19-observability/infra/lib/observability-stack.ts";

import type { QueriedMetric } from "../src/schema.ts";

export const REGION = "ap-northeast-1";

/** Chapter 19's stack as it is today, synthesized without bundling its function. */
export function chapter19(): Template {
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  return Template.fromStack(
    new ObservabilityStack(app, "AihObservability", {
      env: { region: REGION },
      allowedOrigin: "http://localhost:5173",
    }),
  );
}

type Join = { "Fn::Join": [string, (string | { Ref: string })[]] };

/**
 * The dashboard body of that template as CloudWatch would receive it. A reference to a
 * resource becomes its logical ID, which stands in for the name a deploy would give.
 */
export function chapter19Body(template: Template): { widgets: unknown[] } {
  const [dashboard] = Object.values(template.findResources("AWS::CloudWatch::Dashboard"));
  if (dashboard === undefined) {
    throw new Error("chapter 19's stack has no dashboard");
  }
  const [separator, parts] = (dashboard["Properties"].DashboardBody as Join)["Fn::Join"];
  const text = parts
    .map((part) =>
      typeof part === "string" ? part : part.Ref === "AWS::Region" ? REGION : part.Ref,
    )
    .join(separator);
  return JSON.parse(text) as { widgets: unknown[] };
}

type Widget = { properties: { metrics: unknown[][] } };

/** The metrics a CloudWatch body reads, taken from the body itself and not from this chapter's definition. */
export function metricsOfBody(body: { widgets: unknown[] }): QueriedMetric[] {
  return (body.widgets as Widget[]).flatMap((widget) =>
    widget.properties.metrics.flatMap((row) => {
      const [namespace, name, ...rest] = row;
      if (typeof namespace !== "string" || typeof name !== "string") {
        return [];
      }
      const options = rest.at(-1) as { stat: string; period: number };
      const pairs = rest.slice(0, -1) as string[];
      const dimensions: Record<string, string> = {};
      for (let index = 0; index < pairs.length; index += 2) {
        dimensions[pairs[index] ?? ""] = pairs[index + 1] ?? "";
      }
      return [{ namespace, name, dimensions, stat: options.stat, period: options.period }];
    }),
  );
}

export const sortMetrics = (metrics: QueriedMetric[]): string[] =>
  metrics
    .map((metric) =>
      JSON.stringify([
        metric.namespace,
        metric.name,
        Object.entries(metric.dimensions).toSorted(([a], [b]) => a.localeCompare(b)),
        metric.stat,
        metric.period,
      ]),
    )
    .toSorted();
