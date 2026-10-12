import { AsyncLocalStorage } from "node:async_hooks";

export type RequestInfo = { requestId: string };

/** How code far from the handler learns which request it is working for. */
export type RequestScope = {
  run<T>(info: RequestInfo, work: () => T): T;
  current(): RequestInfo | undefined;
};

// #region module-scope
// One variable for the whole module. Right while an execution environment
// handles one request at a time, and wrong from the second request in flight.
let current: RequestInfo | undefined;

export const moduleScope: RequestScope = {
  run(info, work) {
    current = info;
    return work();
  },
  current: () => current,
};
// #endregion module-scope

// #region async-scope
// One value per chain of awaits. Node.js carries it across every await that starts inside run().
const storage = new AsyncLocalStorage<RequestInfo>();

export const asyncScope: RequestScope = {
  run: (info, work) => storage.run(info, work),
  current: () => storage.getStore(),
};
// #endregion async-scope
