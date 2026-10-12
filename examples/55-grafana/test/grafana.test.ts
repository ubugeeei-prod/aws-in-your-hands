import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { DASHBOARD_UID, grafanaDashboard } from "../src/grafana.ts";
import { type Dashboard, dashboardSchema, queriedMetrics } from "../src/schema.ts";
import { GRID_COLUMNS, rows } from "../src/signals.ts";
import { chapter19, chapter19Body, metricsOfBody, REGION, sortMetrics } from "./harness.ts";

const body = chapter19Body(chapter19());
const options = {
  resources: { api: "ApiF70053CD", function: "Handler886CB40B", table: "Notes5BB3582F" },
  region: REGION,
  datasourceUid: "cw-uid",
};
const dashboard = grafanaDashboard(rows, options);

const accepts = (candidate: unknown) => v.safeParse(dashboardSchema, candidate).success;
const edited = (edit: (copy: Dashboard) => void): Dashboard => {
  const copy = structuredClone(dashboard);
  edit(copy);
  return copy;
};

describe("the generated dashboard", () => {
  it("passes this chapter's schema", () => {
    expect(v.parse(dashboardSchema, dashboard)).toEqual(dashboard);
  });

  it("reads exactly the metrics chapter 19's dashboard reads, with the same statistic and period", () => {
    // The left side comes from the generator, the right side from chapter 19's template.
    expect(sortMetrics(queriedMetrics(dashboard))).toEqual(sortMetrics(metricsOfBody(body)));
  });

  it("has a panel for every widget, under the same title and as wide", () => {
    const widgets = body.widgets as { width: number; x: number; properties: { title: string } }[];
    expect(
      dashboard.panels.map((panel) => [panel.title, panel.gridPos.x, panel.gridPos.w]),
    ).toEqual(widgets.map((widget) => [widget.properties.title, widget.x, widget.width]));
    expect(GRID_COLUMNS).toBe(24);
  });

  it("draws a sum as one visible line over hidden parts", () => {
    const panel = dashboard.panels.find((each) => each.title === "DynamoDB: throttled requests");
    const visible = panel?.targets.filter((target) => !("hide" in target && target.hide === true));
    expect(visible).toHaveLength(1);
    expect(visible?.[0]).toMatchObject({
      expression: "getitem + putitem + updateitem + deleteitem + query",
      label: "Sum of throttled requests across all operations",
    });
    expect(panel?.targets).toHaveLength(6);
  });

  it("asks for exact dimensions, so no other API's series can slip into a panel", () => {
    for (const target of dashboard.panels.flatMap((panel) => panel.targets)) {
      if ("metricName" in target) {
        expect(target.matchExact).toBe(true);
      }
    }
  });

  it("is the same JSON every time, under a fixed uid", () => {
    expect(JSON.stringify(grafanaDashboard(rows, options))).toBe(JSON.stringify(dashboard));
    expect(dashboard.uid).toBe(DASHBOARD_UID);
    expect(dashboard.id).toBeNull();
    expect(dashboard.editable).toBe(false);
  });
});

describe("the schema", () => {
  it("refuses a field this chapter does not write", () => {
    expect(accepts({ ...dashboard, style: "dark" })).toBe(false);
    expect(
      accepts(
        edited((copy) => {
          Object.assign(copy.panels[0] ?? {}, { alert: {} });
        }),
      ),
    ).toBe(false);
  });

  it("refuses a uid Grafana would not take", () => {
    expect(accepts({ ...dashboard, uid: "short" })).toBe(false);
    expect(accepts({ ...dashboard, uid: "x".repeat(41) })).toBe(false);
  });

  it("refuses panels that overlap or leave the grid", () => {
    expect(
      accepts(
        edited((copy) => {
          const [first, second] = copy.panels;
          if (first !== undefined && second !== undefined) {
            second.gridPos = { ...first.gridPos };
          }
        }),
      ),
    ).toBe(false);
    expect(
      accepts(
        edited((copy) => {
          const second = copy.panels[1];
          if (second !== undefined) {
            second.gridPos.w = 13;
          }
        }),
      ),
    ).toBe(false);
  });

  it("refuses a sum over a query the panel does not have", () => {
    expect(
      accepts(
        edited((copy) => {
          const sum = copy.panels[4]?.targets[0];
          if (sum !== undefined && "expression" in sum) {
            sum.expression = "getitem + scan";
          }
        }),
      ),
    ).toBe(false);
  });

  it("refuses a period CloudWatch does not have, and a statistic that is not one", () => {
    const withTarget = (change: Record<string, unknown>) =>
      edited((copy) => {
        Object.assign(copy.panels[0]?.targets[0] ?? {}, change);
      });
    expect(accepts(withTarget({ period: "45" }))).toBe(false);
    expect(accepts(withTarget({ period: "auto" }))).toBe(false);
    expect(accepts(withTarget({ statistic: "median" }))).toBe(false);
    expect(accepts(withTarget({ matchExact: false }))).toBe(false);
    expect(accepts(withTarget({ period: "300", statistic: "p99.9" }))).toBe(true);
  });

  it("refuses two panels with one id and two queries with one letter", () => {
    expect(
      accepts(
        edited((copy) => {
          const second = copy.panels[1];
          if (second !== undefined) {
            second.id = 1;
          }
        }),
      ),
    ).toBe(false);
    expect(
      accepts(
        edited((copy) => {
          const second = copy.panels[0]?.targets[1];
          if (second !== undefined) {
            second.refId = "A";
          }
        }),
      ),
    ).toBe(false);
  });
});
