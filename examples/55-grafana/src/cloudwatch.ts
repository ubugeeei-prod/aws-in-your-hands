import { isDeepStrictEqual } from "node:util";

import * as v from "valibot";

import {
  dimensionValue,
  type Metric,
  type Panel,
  PERIOD_SECONDS,
  type Resource,
  type Resources,
  sumExpression,
} from "./signals.ts";

const WIDGET_HEIGHT = 6;

// #region body
type MetricRow = (string | Record<string, unknown>)[];

const metricRow = (
  metric: Metric,
  resources: Resources,
  options: Record<string, unknown>,
): MetricRow => [
  metric.namespace,
  metric.name,
  ...metric.dimensions.flatMap(([name, value]) => [name, dimensionValue(value, resources)]),
  options,
];

/** The body of a CloudWatch dashboard, in the shape aws-cdk-lib writes for chapter 19's widgets. */
export function cloudWatchBody(
  rows: readonly (readonly Panel[])[],
  resources: Resources,
  region: string,
): { widgets: unknown[] } {
  const widgets = rows.flatMap((row, rowIndex) => {
    let x = 0;
    return row.map((panel) => {
      const metrics = panel.series.flatMap((series): MetricRow[] =>
        series.kind === "metric"
          ? [
              metricRow(series.metric, resources, {
                ...(series.label === undefined ? {} : { label: series.label }),
                period: PERIOD_SECONDS,
                stat: series.stat,
                ...(series.axis === undefined ? {} : { yAxis: series.axis }),
              }),
            ]
          : [
              [
                {
                  label: series.label,
                  expression: sumExpression(series),
                  period: PERIOD_SECONDS,
                },
              ],
              ...series.of.map((part) =>
                metricRow(part.metric, resources, {
                  id: part.id,
                  visible: false,
                  period: PERIOD_SECONDS,
                  stat: "Sum",
                }),
              ),
            ],
      );
      const widget = {
        type: "metric",
        width: panel.width,
        height: WIDGET_HEIGHT,
        x,
        y: rowIndex * WIDGET_HEIGHT,
        properties: { view: "timeSeries", title: panel.title, region, metrics, yAxis: {} },
      };
      x += panel.width;
      return widget;
    });
  });
  return { widgets };
}
// #endregion body

// #region read
// Only what is needed to find the Region and the three names. The comparison below sees the rest.
const bodySchema = v.object({
  widgets: v.pipe(
    v.array(
      v.object({
        properties: v.object({
          region: v.pipe(v.string(), v.regex(/^[a-z]{2}(-[a-z]+)+-\d$/)),
          metrics: v.array(v.array(v.unknown())),
        }),
      }),
    ),
    v.minLength(1),
  ),
});

const DIMENSION_OF: Record<Resource, string> = {
  api: "ApiId",
  function: "FunctionName",
  table: "TableName",
};

export type DeployedDashboard = { region: string; resources: Resources };

/** The Region and the resource names a deployed CloudWatch dashboard body refers to. */
export function readCloudWatchBody(body: unknown): DeployedDashboard {
  const { widgets } = v.parse(bodySchema, body);
  const values = (dimension: string) => {
    const found = new Set<string>();
    for (const row of widgets.flatMap((widget) => widget.properties.metrics)) {
      const at = row.indexOf(dimension);
      const value = row[at + 1];
      if (at >= 2 && typeof value === "string") {
        found.add(value);
      }
    }
    return [...found];
  };
  const only = (what: string, found: string[]): string => {
    const [first] = found;
    if (first === undefined || found.length > 1) {
      throw new Error(`expected one ${what} in the dashboard, found ${String(found.length)}`);
    }
    return first;
  };
  return {
    region: only("Region", [...new Set(widgets.map((widget) => widget.properties.region))]),
    resources: {
      api: only("ApiId", values(DIMENSION_OF.api)),
      function: only("FunctionName", values(DIMENSION_OF.function)),
      table: only("TableName", values(DIMENSION_OF.table)),
    },
  };
}

/**
 * The names in a deployed body, but only if that body is exactly what the
 * definition describes. A dashboard that has drifted from it is refused.
 */
export function agreeingDashboard(
  rows: readonly (readonly Panel[])[],
  body: unknown,
): DeployedDashboard {
  const deployed = readCloudWatchBody(body);
  if (!isDeepStrictEqual(cloudWatchBody(rows, deployed.resources, deployed.region), body)) {
    throw new Error(
      "The CloudWatch dashboard does not show what src/signals.ts describes. " +
        "Change one to match the other before publishing a second dashboard.",
    );
  }
  return deployed;
}
// #endregion read
