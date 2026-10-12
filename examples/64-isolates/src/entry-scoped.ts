import { composeManagedApp } from "@aih/example-35-lambda-managed-instances/src/app.ts";
import { asyncScope, moduleScope } from "@aih/example-35-lambda-managed-instances/src/scope.ts";

import { asWorker } from "./worker.ts";

// #region entry
// Chapter 35's app, which logs each stored note under a request ID. The binding picks where that ID is kept.
export default asWorker((bindings) =>
  composeManagedApp(bindings, bindings["SCOPE"] === "module" ? moduleScope : asyncScope),
);
// #endregion entry
