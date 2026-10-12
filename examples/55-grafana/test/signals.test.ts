import { describe, expect, it } from "vite-plus/test";

import { agreeingDashboard, cloudWatchBody, readCloudWatchBody } from "../src/cloudwatch.ts";
import { rows, type Signal } from "../src/signals.ts";
import { chapter19, chapter19Body, REGION } from "./harness.ts";

const template = chapter19();
const body = chapter19Body(template);

describe("the definition and chapter 19's dashboard", () => {
  it("describes that dashboard exactly: every widget, metric, statistic, label and position", () => {
    const { resources, region } = readCloudWatchBody(body);
    expect(cloudWatchBody(rows, resources, region)).toEqual(body);
  });

  it("finds the Region and the three resources in the body", () => {
    expect(readCloudWatchBody(body)).toEqual({
      region: REGION,
      resources: {
        api: expect.stringMatching(/^Api/),
        function: expect.stringMatching(/^Handler/),
        table: expect.stringMatching(/^Notes/),
      },
    });
  });

  it("names the custom metric that chapter 19's metric filter emits", () => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      MetricTransformations: [{ MetricNamespace: "AihObservability", MetricName: "NoteConflicts" }],
    });
    expect(JSON.stringify(rows)).toContain('"namespace":"AihObservability","name":"NoteConflicts"');
  });
});

describe("a dashboard that drifted from the definition", () => {
  const changed = (edit: (widgets: { properties: { metrics: unknown[][] } }[]) => void) => {
    const copy = structuredClone(body) as { widgets: { properties: { metrics: unknown[][] } }[] };
    edit(copy.widgets);
    return copy;
  };

  it("is accepted while nothing changed", () => {
    expect(agreeingDashboard(rows, body).region).toBe(REGION);
  });

  it("is refused when a statistic changed", () => {
    const drifted = changed((widgets) => {
      const options = widgets[1]?.properties.metrics[1]?.at(-1);
      Object.assign(options ?? {}, { stat: "p99" });
    });
    expect(() => agreeingDashboard(rows, drifted)).toThrow(/does not show what/);
  });

  it("is refused when a line was added by hand", () => {
    const drifted = changed((widgets) => {
      widgets[0]?.properties.metrics.push([
        "AWS/ApiGateway",
        "DataProcessed",
        "ApiId",
        "ApiF70053CD",
        { period: 60, stat: "Sum" },
      ]);
    });
    expect(() => agreeingDashboard(rows, drifted)).toThrow(/does not show what/);
  });

  it("is refused when it reads two different tables", () => {
    const drifted = changed((widgets) => {
      const row = widgets[6]?.properties.metrics[1];
      if (row !== undefined) {
        row[3] = "AnotherTable";
      }
    });
    expect(() => agreeingDashboard(rows, drifted)).toThrow(/expected one TableName/);
  });

  it("is refused when it is not a dashboard body at all", () => {
    expect(() => agreeingDashboard(rows, { widgets: [] })).toThrow();
    expect(() => agreeingDashboard(rows, "{}")).toThrow();
  });
});

describe("the four signals", () => {
  it("are all on the dashboard", () => {
    const seen = new Set(
      rows.flat().flatMap((panel) => panel.series.map((series) => series.signal)),
    );
    expect([...seen].toSorted()).toEqual<Signal[]>(["errors", "latency", "saturation", "traffic"]);
  });

  it("put what a user feels in the first row", () => {
    const first = rows[0]?.flatMap((panel) => panel.series.map((series) => series.signal));
    expect(new Set(first)).toEqual(new Set(["traffic", "errors", "latency"]));
  });
});
