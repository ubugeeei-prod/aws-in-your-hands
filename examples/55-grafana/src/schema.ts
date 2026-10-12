// A schema for the part of Grafana's dashboard JSON this chapter writes, and no more.
// Field names and meanings are from kinds/dashboard/dashboard_kind.cue and the CloudWatch
// data source's dataquery.cue at Grafana v13.0.9. It is not Grafana's own validation.

import * as v from "valibot";

import { GRID_COLUMNS } from "./signals.ts";

// #region target
// "Valid values include 1, 5, 10, 30, or any multiple of 60."
const period = v.pipe(
  v.string(),
  v.regex(/^[1-9]\d*$/),
  v.check((text) => [1, 5, 10, 30].includes(Number(text)) || Number(text) % 60 === 0),
);
// What a metric math expression can refer to: starts with a lowercase letter.
const queryId = v.pipe(v.string(), v.regex(/^[a-z][a-zA-Z0-9_]*$/));

const common = {
  refId: v.pipe(v.string(), v.regex(/^[A-Z]$/)),
  queryMode: v.literal("Metrics"),
  metricQueryType: v.literal(0),
  region: v.pipe(v.string(), v.regex(/^[a-z]{2}(-[a-z]+)+-\d$/)),
  period,
  label: v.optional(v.pipe(v.string(), v.minLength(1))),
};

const metricTargetSchema = v.strictObject({
  ...common,
  metricEditorMode: v.literal(0),
  id: v.union([v.literal(""), queryId]),
  namespace: v.pipe(v.string(), v.regex(/^[A-Za-z0-9/]+$/)),
  metricName: v.pipe(v.string(), v.minLength(1)),
  dimensions: v.record(v.string(), v.pipe(v.string(), v.minLength(1))),
  matchExact: v.literal(true),
  statistic: v.pipe(
    v.string(),
    v.regex(/^(Sum|Average|Minimum|Maximum|SampleCount|p\d{1,2}(\.\d+)?)$/),
  ),
  hide: v.optional(v.literal(true)),
});

const expressionTargetSchema = v.strictObject({
  ...common,
  metricEditorMode: v.literal(1),
  id: v.literal(""),
  namespace: v.literal(""),
  expression: v.pipe(v.string(), v.minLength(1)),
});

const targetSchema = v.union([metricTargetSchema, expressionTargetSchema]);
export type Target = v.InferOutput<typeof targetSchema>;
/** A query before it is given its letter. */
type WithoutRefId<T> = T extends unknown ? Omit<T, "refId"> : never;
export type TargetBody = WithoutRefId<Target>;
// #endregion target

// #region panel
const panelSchema = v.pipe(
  v.strictObject({
    id: v.pipe(v.number(), v.integer(), v.minValue(1)),
    type: v.literal("timeseries"),
    title: v.pipe(v.string(), v.minLength(1)),
    datasource: v.strictObject({
      type: v.literal("cloudwatch"),
      uid: v.pipe(v.string(), v.minLength(1)),
    }),
    gridPos: v.strictObject({
      x: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(GRID_COLUMNS - 1)),
      y: v.pipe(v.number(), v.integer(), v.minValue(0)),
      w: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(GRID_COLUMNS)),
      h: v.pipe(v.number(), v.integer(), v.minValue(1)),
    }),
    targets: v.pipe(v.array(targetSchema), v.minLength(1)),
  }),
  v.check((panel) => panel.gridPos.x + panel.gridPos.w <= GRID_COLUMNS, "wider than the grid"),
  v.check(
    (panel) => new Set(panel.targets.map((target) => target.refId)).size === panel.targets.length,
    "two queries share a refId",
  ),
  // An expression that names a query the panel does not have draws nothing, without an error here.
  v.check((panel) => {
    const ids = new Set(panel.targets.map((target) => target.id).filter((id) => id !== ""));
    return panel.targets.every(
      (target) =>
        !("expression" in target) ||
        (target.expression.match(/[a-z][a-zA-Z0-9_]*/g) ?? []).every((name) => ids.has(name)),
    );
  }, "an expression refers to a query that is not in the panel"),
);
export type GrafanaPanel = v.InferOutput<typeof panelSchema>;
// #endregion panel

// #region dashboard
type Box = GrafanaPanel["gridPos"];
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const dashboardSchema = v.pipe(
  v.strictObject({
    id: v.null(),
    // "string (8-40)"
    uid: v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_-]{8,40}$/)),
    title: v.pipe(v.string(), v.minLength(1)),
    description: v.string(),
    tags: v.array(v.string()),
    timezone: v.picklist(["browser", "utc"]),
    editable: v.boolean(),
    time: v.strictObject({ from: v.string(), to: v.string() }),
    refresh: v.pipe(v.string(), v.regex(/^\d+[smhd]$/)),
    schemaVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
    panels: v.pipe(v.array(panelSchema), v.minLength(1)),
  }),
  v.check(
    (dashboard) =>
      new Set(dashboard.panels.map((panel) => panel.id)).size === dashboard.panels.length,
    "two panels share an id",
  ),
  v.check(
    (dashboard) =>
      dashboard.panels.every((a, index) =>
        dashboard.panels.slice(index + 1).every((b) => !overlap(a.gridPos, b.gridPos)),
      ),
    "two panels overlap",
  ),
);
export type Dashboard = v.InferOutput<typeof dashboardSchema>;
// #endregion dashboard

// #region queried
export type QueriedMetric = {
  namespace: string;
  name: string;
  dimensions: Record<string, string>;
  stat: string;
  period: number;
};

/** Every CloudWatch metric the dashboard reads, whether it is drawn or only feeds a sum. */
export function queriedMetrics(dashboard: Dashboard): QueriedMetric[] {
  return dashboard.panels.flatMap((panel) =>
    panel.targets.flatMap((target) =>
      "metricName" in target
        ? [
            {
              namespace: target.namespace,
              name: target.metricName,
              dimensions: target.dimensions,
              stat: target.statistic,
              period: Number(target.period),
            },
          ]
        : [],
    ),
  );
}
// #endregion queried
