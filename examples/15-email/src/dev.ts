import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";
import { route, router } from "@aih/example-04-http-api/src/http/router.ts";

import { composeApp } from "./compose.ts";
import { handleSesMessage } from "./events.ts";

// #region dev
const { app, env, store, log, outbox } = composeApp(process.env);
if (outbox === undefined) {
  // With MAIL_MODE=aws this process would send real mail with your own credentials.
  throw new Error("The dev server only runs with MAIL_MODE=local.");
}

// Stand-ins for what only exists in AWS: the inbox, and SES reporting back.
// Every other request goes to the app, the same one that runs on Lambda.
const dev = router<void>(
  [
    route("GET", "/dev/outbox", () => Response.json({ sent: outbox.sent })),
    // The body is one SES event, as it appears in the SNS notification's Message.
    route("POST", "/dev/ses-events", async (request) =>
      Response.json(await handleSesMessage({ store, log }, await request.text())),
    ),
  ],
  (request) => app(request),
);

const port = Number(process.env["PORT"] ?? 8787);
nodeServer((request) => dev(request)).listen(port, () => {
  console.log(
    `mail API on http://localhost:${port} (from ${env.FROM_ADDRESS}, nothing is really sent)`,
  );
});
// #endregion dev
