import {
  type DurableContext,
  type DurableLambdaHandler,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

import { ExportCorruptError, toProgress } from "./job.ts";
import {
  atMostPages,
  type Deps,
  discardExport,
  exportPages,
  type Finished,
  finishExport,
} from "./steps.ts";

// #region durable
/** The same export as the state machine, written as one function. The loop is the workflow. */
export function createDurableExport(
  deps: Deps,
  options: { pageSize: number; pagesPerStep: number },
): DurableLambdaHandler {
  return withDurableExecution(
    async (event: unknown, context: DurableContext): Promise<Finished> => {
      let progress = toProgress(event);
      while (!progress.done) {
        const from = progress;
        // The name is built from a checkpointed value, so a replay asks for the same steps in the same order.
        progress = await context.step(`pages-from-${from.nextPart}`, () =>
          exportPages(deps, from, {
            pageSize: options.pageSize,
            mayContinue: atMostPages(options.pagesPerStep),
          }),
        );
      }
      const done = progress;
      try {
        // A missing part does not come back, so this step is not retried.
        return await context.step("finish", () => finishExport(deps, done), {
          retryStrategy: (error, attempt) => ({
            shouldRetry: !(error instanceof ExportCorruptError) && attempt < 3,
            delay: { seconds: 5 * attempt },
          }),
        });
      } catch (error) {
        await context.step("discard", () => discardExport(deps, done));
        throw error;
      }
    },
  );
}
// #endregion durable
