import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { composeApp } from "./compose.ts";
import { handleSesMessage } from "./events.ts";

// #region dev
const { app, env, store, log, outbox } = composeApp(process.env);
if (outbox === undefined) {
  // With MAIL_MODE=aws this process would send real mail with your own credentials.
  throw new Error("The dev server only runs with MAIL_MODE=local.");
}

// Stand-ins for what only exists in AWS: the inbox, and SES reporting back.
const dev = new Hono()
  .get("/dev/outbox", (c) => c.json({ sent: outbox.sent }))
  // The body is one SES event, as it appears in the SNS notification's Message.
  .post("/dev/ses-events", async (c) => c.json(await handleSesMessage({ store, log }, await c.req.text())))
  .route("/", app);

const port = Number(process.env["PORT"] ?? 8787);
serve({ fetch: dev.fetch, port }, (info) => {
  console.log(`mail API on http://localhost:${info.port} (from ${env.FROM_ADDRESS}, nothing is really sent)`);
});
// #endregion dev
