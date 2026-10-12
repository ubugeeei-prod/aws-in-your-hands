// Server-sent events: a response that never says how long it is, made of small text
// blocks the reader can use one at a time. src/client.ts reads what this writes.

// #region frame
/** One event as it travels: its name, its data, and the blank line that says it is whole. */
export function sseFrame(event: string, data: string): string {
  // A line break inside `data` would end the field, so every line gets a `data:` of its own.
  const lines = data.split(/\r\n|\r|\n/).map((line) => `data: ${line}`);
  return `event: ${event}\n${lines.join("\n")}\n\n`;
}
// #endregion frame
