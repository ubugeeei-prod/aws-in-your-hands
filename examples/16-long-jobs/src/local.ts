import { progressSchema, toProgress } from "./job.ts";
import type { Invoke } from "./local-workflow.ts";
import { type Budget, type Deps, discardExport, exportPages, finishExport } from "./steps.ts";
import { exportWorkflow } from "./workflow.ts";

const NAMES = {
  exportPages: "local:export-pages",
  finish: "local:finish",
  discard: "local:discard",
};

/** The deployed definition, with names in place of the function ARNs. */
export const localDefinition = exportWorkflow(NAMES);

// #region local
/** What the three Lambda handlers do, minus Lambda: parse the input, call the step. */
export function localInvoke(deps: Deps, budget: () => Budget): Invoke {
  return async (resource, input) => {
    switch (resource) {
      case NAMES.exportPages:
        return exportPages(deps, toProgress(input), budget());
      case NAMES.finish:
        return finishExport(deps, progressSchema.parse(input));
      case NAMES.discard:
        return discardExport(deps, progressSchema.pick({ exportId: true }).parse(input));
      default:
        throw new Error(`nothing is registered as ${resource}`);
    }
  };
}
// #endregion local
