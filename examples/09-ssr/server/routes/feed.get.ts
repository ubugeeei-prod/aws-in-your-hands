import { setTimeout as pause } from "node:timers/promises";
import { defineEventHandler, setResponseHeader } from "h3";
import { feedLines } from "../../core/notes.ts";
import { context } from "../context.ts";

// #region feed
// One line per note, with a pause in between. Whether the pauses reach the
// reader says whether every hop on the way streamed.
export default defineEventHandler((event) => {
  setResponseHeader(event, "content-type", "text/plain; charset=utf-8");
  const lines = feedLines(context.notes.list());
  const encoder = new TextEncoder();
  let next = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const line = lines[next];
      if (line === undefined) {
        controller.close();
        return;
      }
      if (next > 0) {
        await pause(context.feedPauseMs);
      }
      next += 1;
      controller.enqueue(encoder.encode(line));
    },
  });
});
// #endregion feed
