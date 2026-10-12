import type { Dashboard, GrafanaPanel, Target, TargetBody } from "./schema.ts";
import {
  dimensionValue,
  type Metric,
  type Panel,
  PERIOD_SECONDS,
  type Resources,
  sumExpression,
} from "./signals.ts";

/** Stable across pushes, so a push replaces the dashboard instead of adding another. */
export const DASHBOARD_UID = "aih-notes-api";
// Grafana 12.0 writes 41. A newer workspace migrates an older dashboard when it loads it.
const SCHEMA_VERSION = 41;
// In grid units of 30 px.
const PANEL_HEIGHT = 8;

export type GrafanaOptions = {
  resources: Resources;
  region: string;
  /** The uid of the workspace's CloudWatch data source. */
  datasourceUid: string;
};

// #region target
const refId = (index: number): string => String.fromCodePoint(65 + index);

function metricTarget(
  metric: Metric,
  stat: string,
  options: GrafanaOptions,
  rest: { id?: string; label?: string; hide?: boolean },
): TargetBody {
  return {
    queryMode: "Metrics",
    // 0 and 0: a metric search built in the query builder, not SQL and not code.
    metricQueryType: 0,
    metricEditorMode: 0,
    id: rest.id ?? "",
    region: options.region,
    namespace: metric.namespace,
    metricName: metric.name,
    dimensions: Object.fromEntries(
      metric.dimensions.map(([name, value]) => [name, dimensionValue(value, options.resources)]),
    ),
    // Exactly these dimensions: without it Grafana searches, and may draw up to 100 other series.
    matchExact: true,
    statistic: stat,
    period: String(PERIOD_SECONDS),
    ...(rest.label === undefined ? {} : { label: rest.label }),
    ...(rest.hide === true ? { hide: true } : {}),
  };
}
// #endregion target

// #region dashboard
function targets(panel: Panel, options: GrafanaOptions): Target[] {
  return panel.series
    .flatMap((series): TargetBody[] =>
      series.kind === "metric"
        ? [
            metricTarget(
              series.metric,
              series.stat,
              options,
              series.label === undefined ? {} : { label: series.label },
            ),
          ]
        : [
            {
              queryMode: "Metrics",
              metricQueryType: 0,
              // 1: the expression is written as code.
              metricEditorMode: 1,
              id: "",
              region: options.region,
              namespace: "",
              expression: sumExpression(series),
              label: series.label,
              period: String(PERIOD_SECONDS),
            },
            ...series.of.map((part) =>
              metricTarget(part.metric, "Sum", options, { id: part.id, hide: true }),
            ),
          ],
    )
    .map((target, index) => ({ refId: refId(index), ...target }));
}

/** A dashboard in Grafana's JSON model, with one time series panel per panel of the definition. */
export function grafanaDashboard(
  rows: readonly (readonly Panel[])[],
  options: GrafanaOptions,
): Dashboard {
  const datasource = { type: "cloudwatch", uid: options.datasourceUid } as const;
  let id = 0;
  const panels = rows.flatMap((row, rowIndex) => {
    let x = 0;
    return row.map((panel): GrafanaPanel => {
      id += 1;
      const placed: GrafanaPanel = {
        id,
        type: "timeseries",
        title: panel.title,
        datasource,
        gridPos: { x, y: rowIndex * PANEL_HEIGHT, w: panel.width, h: PANEL_HEIGHT },
        targets: targets(panel, options),
      };
      x += panel.width;
      return placed;
    });
  });
  return {
    // null: Grafana assigns the numeric id. The uid is what identifies the dashboard.
    id: null,
    uid: DASHBOARD_UID,
    title: "Notes API",
    description: "Generated from examples/55-grafana/src/signals.ts. Edits made here are lost.",
    tags: ["aws-in-your-hands"],
    timezone: "browser",
    // The definition in the repository is the source. The workspace only shows it.
    editable: false,
    time: { from: "now-3h", to: "now" },
    refresh: "1m",
    schemaVersion: SCHEMA_VERSION,
    panels,
  };
}
// #endregion dashboard
