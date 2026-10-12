import { readFileSync } from "node:fs";

import { type HealthEvent, parseHealthEvent } from "../src/event.ts";

type File = { events: { name: string; event: Record<string, unknown> }[] };
const load = (file: string) =>
  (JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url), "utf8")) as File)
    .events;

/** The sample payloads of the schema reference, unchanged. */
export const documented = load("documented.json");
/** Written for this chapter from the documented fields. Never received from AWS. */
export const written = load("written.json");

export function raw(name: string): Record<string, unknown> {
  const found = [...documented, ...written].find((fixture) => fixture.name === name);
  if (found === undefined) {
    throw new Error(`no fixture named ${name}`);
  }
  return structuredClone(found.event);
}

export function parsed(name: string): HealthEvent {
  const result = parseHealthEvent(raw(name));
  if (!result.ok) {
    throw new Error(`${name} does not parse: ${result.issues.join("; ")}`);
  }
  return result.event;
}

/** A fixture with some fields of its detail replaced. */
export function withDetail(name: string, detail: Record<string, unknown>): Record<string, unknown> {
  const event = raw(name);
  return { ...event, detail: { ...(event["detail"] as object), ...detail } };
}
