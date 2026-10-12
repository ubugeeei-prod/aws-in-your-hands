import { composeApp } from "@aih/example-04-http-api/src/compose.ts";

import { asWorker } from "./worker.ts";

// #region entry
// Chapter 04's app, as it is. On Lambda this line was `handleApiGateway(app)`.
export default asWorker(composeApp);
// #endregion entry
