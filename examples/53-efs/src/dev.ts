import { resolve } from "node:path";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

import { composeApp } from "./compose.ts";

// #region dev
// Start it twice with different ports and the same directory: two writers, one file system.
const port = Number(process.env["PORT"] ?? 8787);
const notesDir = resolve(process.env["NOTES_DIR"] ?? ".data");
const app = await composeApp({
  ALLOWED_ORIGIN: "http://localhost:5173",
  ...process.env,
  NOTES_DIR: notesDir,
});

nodeServer(app).listen(port, "127.0.0.1", () => {
  console.log(`notes API on http://localhost:${port}, files in ${notesDir}`);
});
// #endregion dev
