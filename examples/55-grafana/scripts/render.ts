// vp run grafana:render
//   node scripts/render.ts [--cloudwatch] [--api-id x --function-name y --table-name z]
//
// Prints the Grafana dashboard JSON this chapter would publish, or with --cloudwatch the
// CloudWatch dashboard body the same definition describes. Local: reads and sends nothing.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { cloudWatchBody } from "../src/cloudwatch.ts";
import { grafanaDashboard } from "../src/grafana.ts";
import { dashboardSchema } from "../src/schema.ts";
import { rows } from "../src/signals.ts";

const REGION = "ap-northeast-1";

const { values } = parseArgs({
  options: {
    cloudwatch: { type: "boolean", default: false },
    // Placeholders stand in for the names a deploy of chapter 19 would give.
    "api-id": { type: "string", default: "API_ID" },
    "function-name": { type: "string", default: "FUNCTION_NAME" },
    "table-name": { type: "string", default: "TABLE_NAME" },
    "datasource-uid": { type: "string", default: "DATASOURCE_UID" },
  },
});

const resources = {
  api: values["api-id"],
  function: values["function-name"],
  table: values["table-name"],
};

const output = values.cloudwatch
  ? cloudWatchBody(rows, resources, REGION)
  : // Parsed on the way out: what is printed is what the schema of this chapter accepts.
    v.parse(
      dashboardSchema,
      grafanaDashboard(rows, {
        resources,
        region: REGION,
        datasourceUid: values["datasource-uid"],
      }),
    );

console.log(JSON.stringify(output, null, 2));
