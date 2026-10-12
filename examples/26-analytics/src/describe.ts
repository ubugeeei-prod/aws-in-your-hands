import * as v from "valibot";

import type { ACTIONS, RequestRecord, ROUTES } from "./record.ts";

type Route = (typeof ROUTES)[number];
type Action = (typeof ACTIONS)[number];

const NOTE = /^\/notes\/([^/]+)$/;
const namedSchema = v.object({ id: v.pipe(v.string(), v.regex(/^[a-z0-9]{1,64}$/)) });

function routeOf(path: string): Route {
  if (path === "/health" || path === "/notes") {
    return path;
  }
  return NOTE.test(path) ? "/notes/:id" : "other";
}

// #region action
// A record says what happened only when it did happen: the status decides.
function actionOf(method: string, route: Route, status: number): Action | null {
  if (method === "POST" && route === "/notes" && status === 201) {
    return "note_created";
  }
  if (method === "PUT" && route === "/notes/:id") {
    return status === 200 ? "note_updated" : status === 409 ? "update_conflicted" : null;
  }
  if (method === "DELETE" && route === "/notes/:id" && status === 204) {
    return "note_deleted";
  }
  return null;
}
// #endregion action

// #region describe
/**
 * What one answered request looks like to someone asking questions next month.
 * Reads the method, the path and the answer. Never the request body or a header.
 */
export async function describeRequest(input: {
  request: Request;
  response: Response;
  eventId: string;
  answeredAt: Date;
  durationMs: number;
}): Promise<RequestRecord> {
  const { request, response } = input;
  const path = new URL(request.url).pathname;
  const route = routeOf(path);
  const action = actionOf(request.method, route, response.status);

  // A new note's ID is only in the answer. A copy is read, so the caller still gets the body.
  const named = v.safeParse(
    namedSchema,
    action === "note_created" ? await response.clone().json() : { id: NOTE.exec(path)?.[1] },
  );

  return {
    v: 1,
    event_id: input.eventId,
    at: input.answeredAt.toISOString(),
    request_id: response.headers.get("x-request-id") ?? "unknown",
    method: request.method,
    route,
    status: response.status,
    duration_ms: Math.max(0, Math.round(input.durationMs)),
    action,
    // An ID only when something happened to that note: not for a read, and not for a 404.
    note_id: action !== null && named.success ? named.output.id : null,
  };
}
// #endregion describe
