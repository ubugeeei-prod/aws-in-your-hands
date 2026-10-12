import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { metricsPerRefresh, metricsRequestedPerMonth, refreshSeconds } from "../src/cost-inputs.ts";
import { grafanaDashboard } from "../src/grafana.ts";
import { rows } from "../src/signals.ts";
import { REGION } from "./harness.ts";

const dashboard = grafanaDashboard(rows, {
  resources: { api: "a", function: "f", table: "t" },
  region: REGION,
  datasourceUid: "u",
});

type Fragment = {
  scenarios: { id: string; items: { priceId: string; quantity: number }[] }[];
};
const fragment = JSON.parse(
  readFileSync(new URL("../../../data/fragments/55.json", import.meta.url), "utf8"),
) as Fragment;

describe("what an open dashboard asks CloudWatch for", () => {
  it("is 23 metrics a minute: the hidden parts of a sum are requested too", () => {
    expect(metricsPerRefresh(dashboard)).toBe(23);
    expect(refreshSeconds(dashboard)).toBe(60);
  });

  it("is the quantity the pricing scenario multiplies", () => {
    const month = metricsRequestedPerMonth(dashboard, { hoursPerDay: 8, daysPerMonth: 20 });
    expect(month).toBe(220_800);
    const item = fragment.scenarios
      .find((scenario) => scenario.id === "grafana-small")
      ?.items.find((each) => each.priceId === "cloudwatch.api.getmetricdata");
    expect(item?.quantity).toBe(month);
  });
});
