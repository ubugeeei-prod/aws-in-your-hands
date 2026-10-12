import * as v from "valibot";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

import { composeMeasuredApp } from "./compose.ts";
import { LocalDelivery } from "./lake.ts";
import { saveObject } from "./local-files.ts";

// #region dev
const settings = v.parse(
  v.object({
    PORT: v.optional(v.pipe(v.string(), v.transform(Number), v.integer()), "8787"),
    LAKE_DIR: v.optional(v.pipe(v.string(), v.minLength(1)), "dist/lake"),
    LAKE_FLUSH_SECONDS: v.optional(
      v.pipe(v.string(), v.transform(Number), v.number(), v.minValue(1), v.maxValue(900)),
      "5",
    ),
  }),
  process.env,
);

// In place of Firehose: records wait in memory, then become one file under LAKE_DIR.
const delivery = new LocalDelivery();
const flush = () => {
  const object = delivery.flush();
  if (object !== undefined) {
    console.log(`delivered ${saveObject(settings.LAKE_DIR, object)}`);
  }
};
setInterval(flush, settings.LAKE_FLUSH_SECONDS * 1000).unref();

const app = composeMeasuredApp(process.env, (line) => {
  delivery.put(line, new Date());
  return Promise.resolve();
});

const server = nodeServer(app).listen(settings.PORT, () => {
  console.log(
    `notes API on http://localhost:${settings.PORT}, records to ${settings.LAKE_DIR} every ${settings.LAKE_FLUSH_SECONDS} s`,
  );
});

process.on("SIGINT", () => {
  flush();
  server.close();
});
// #endregion dev
