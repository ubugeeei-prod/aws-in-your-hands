// The one description of what the notes API's dashboard shows. Chapter 19's
// CloudWatch dashboard is checked against it, and the Grafana dashboard is generated from it.

// #region types
/** The three resources of chapter 19's stack whose names are only known after a deploy. */
export type Resource = "api" | "function" | "table";
export type Resources = Record<Resource, string>;

export type Signal = "traffic" | "errors" | "latency" | "saturation";

export type Metric = {
  namespace: string;
  name: string;
  /** In the order CloudWatch lists them. A value is a literal or one of the deployed resources. */
  dimensions: readonly (readonly [name: string, value: string | { resource: Resource }])[];
};

export type Series =
  | { kind: "metric"; signal: Signal; metric: Metric; stat: string; label?: string; axis?: "right" }
  // One line that adds up several metrics, such as one per DynamoDB operation.
  | { kind: "sum"; signal: Signal; label: string; of: readonly { id: string; metric: Metric }[] };

export type Panel = { title: string; width: number; series: readonly Series[] };
// #endregion types

/** Every series is read per minute, as the alarms of chapter 19 are. */
export const PERIOD_SECONDS = 60;
/** Both CloudWatch and Grafana lay a dashboard out on 24 columns. */
export const GRID_COLUMNS = 24;

const api = (name: string): Metric => ({
  namespace: "AWS/ApiGateway",
  name,
  dimensions: [["ApiId", { resource: "api" }]],
});
const fn = (name: string): Metric => ({
  namespace: "AWS/Lambda",
  name,
  dimensions: [["FunctionName", { resource: "function" }]],
});
const table = (name: string): Metric => ({
  namespace: "AWS/DynamoDB",
  name,
  dimensions: [["TableName", { resource: "table" }]],
});

const OPERATIONS = ["GetItem", "PutItem", "UpdateItem", "DeleteItem", "Query"] as const;
// DynamoDB reports these per operation only, so the line is the sum over the five the API uses.
const perOperation = (name: string) =>
  OPERATIONS.map((operation) => ({
    id: operation.toLowerCase(),
    metric: {
      namespace: "AWS/DynamoDB",
      name,
      dimensions: [
        ["Operation", operation],
        ["TableName", { resource: "table" }],
      ],
    } satisfies Metric,
  }));

const one = (
  signal: Signal,
  metric: Metric,
  stat: string,
): Extract<Series, { kind: "metric" }> => ({
  kind: "metric",
  signal,
  metric,
  stat,
});

// #region rows
// Symptoms on top, causes below: the order of chapter 19's dashboard.
export const rows: readonly (readonly Panel[])[] = [
  [
    {
      title: "API: requests and errors",
      width: 12,
      series: [
        one("traffic", api("Count"), "Sum"),
        { ...one("errors", api("4xx"), "Sum"), label: "4xx (429 when throttled)" },
        one("errors", api("5xx"), "Sum"),
      ],
    },
    {
      title: "API: latency (ms)",
      width: 12,
      series: [
        one("latency", api("Latency"), "p50"),
        one("latency", api("Latency"), "p95"),
        one("latency", api("IntegrationLatency"), "p95"),
      ],
    },
  ],
  [
    {
      title: "Lambda: errors and throttles",
      width: 12,
      series: [
        one("traffic", fn("Invocations"), "Sum"),
        one("errors", fn("Errors"), "Sum"),
        one("saturation", fn("Throttles"), "Sum"),
      ],
    },
    {
      title: "Lambda: duration (ms) and concurrency",
      width: 12,
      series: [
        one("latency", fn("Duration"), "p95"),
        { ...one("saturation", fn("ConcurrentExecutions"), "Maximum"), axis: "right" },
      ],
    },
  ],
  [
    {
      title: "DynamoDB: throttled requests",
      width: 8,
      series: [
        {
          kind: "sum",
          signal: "saturation",
          label: "Sum of throttled requests across all operations",
          of: perOperation("ThrottledRequests"),
        },
      ],
    },
    {
      title: "DynamoDB: server errors",
      width: 8,
      series: [
        {
          kind: "sum",
          signal: "errors",
          label: "Sum of errors across all operations",
          of: perOperation("SystemErrors"),
        },
      ],
    },
    {
      title: "Notes: update conflicts",
      width: 8,
      series: [
        // The custom metric that chapter 19's metric filter counts from the log.
        one(
          "errors",
          { namespace: "AihObservability", name: "NoteConflicts", dimensions: [] },
          "Sum",
        ),
        one("errors", table("ConditionalCheckFailedRequests"), "Sum"),
      ],
    },
  ],
];
// #endregion rows

/** A dimension's value once the deployed names are known. */
export function dimensionValue(
  value: string | { resource: Resource },
  resources: Resources,
): string {
  return typeof value === "string" ? value : resources[value.resource];
}

/** `a + b + c`: the metric math both dashboards use for a sum. */
export function sumExpression(series: Extract<Series, { kind: "sum" }>): string {
  return series.of.map((part) => part.id).join(" + ");
}
