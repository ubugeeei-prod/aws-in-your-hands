import * as v from "valibot";

import { type Route, route } from "@aih/example-04-http-api/src/http/router.ts";
import {
  type App,
  type AppDeps as NotesAppDeps,
  createApp as createNotesApp,
  type SignedIn,
} from "@aih/example-06-auth/api/src/app.ts";

import { type ErrorBody, MAX_MEMBERS_PER_ROOM, subSchema } from "./contract.ts";
import { MeetingsError } from "./meetings.ts";
import type { OwnerOutcome, RoomService } from "./rooms.ts";

export type AppDeps = NotesAppDeps & { rooms: RoomService };
export type { App };

const failure = (
  status: number,
  code: ErrorBody["error"]["code"],
  message: string,
  { requestId }: SignedIn,
) => Response.json({ error: { code, message, requestId } } satisfies ErrorBody, { status });

const noRoom = (context: SignedIn) => failure(404, "not_found", "No such room.", context);
const ownerOnly = (context: SignedIn) =>
  failure(403, "forbidden", "Only the room's owner can do that.", context);

export function createApp(deps: AppDeps): App {
  const { rooms } = deps;

  const owner = (outcome: OwnerOutcome, context: SignedIn): Response => {
    switch (outcome) {
      case "done":
        return new Response(null, { status: 204 });
      case "not_found":
        return noRoom(context);
      case "forbidden":
        return ownerOnly(context);
    }
  };

  // Chapter 06 turns any thrown error into a 500. A Chime failure is not this API's bug,
  // and the caller may try again, so it is told apart here.
  const media =
    (handle: Route<SignedIn>["handle"]): Route<SignedIn>["handle"] =>
    async (request, context, params) => {
      try {
        return await handle(request, context, params);
      } catch (error) {
        if (!(error instanceof MeetingsError)) {
          throw error;
        }
        deps.log({
          level: "error",
          message: error.message,
          requestId: context.requestId,
          cause: error.cause instanceof Error ? error.cause.name : String(error.cause),
        });
        return failure(503, "media_unavailable", "The call service did not answer.", context);
      }
    };

  // #region routes
  // As in chapter 06, who is asking comes from the token's `sub` and nowhere else.
  // No route takes a join token, and only one answers with one: the caller's own.
  const routes: Route<SignedIn>[] = [
    route("POST", "/rooms", async (_request, { identity }) =>
      Response.json(await rooms.create(identity.sub), { status: 201 }),
    ),
    route("GET", "/rooms/:id", async (_request, context, { id = "" }) => {
      const room = await rooms.get(context.identity.sub, id);
      return room === undefined ? noRoom(context) : Response.json(room);
    }),
    route("PUT", "/rooms/:id/members/:sub", async (_request, context, { id = "", sub = "" }) => {
      const member = v.safeParse(subSchema, sub);
      if (!member.success) {
        return failure(400, "invalid_request", "That is not a user ID.", context);
      }
      const outcome = await rooms.invite(context.identity.sub, id, member.output);
      return outcome === "full"
        ? failure(409, "room_full", `A room holds ${MAX_MEMBERS_PER_ROOM} members.`, context)
        : owner(outcome, context);
    }),
    route(
      "DELETE",
      "/rooms/:id/members/:sub",
      media(async (_request, context, { id = "", sub = "" }) =>
        owner(await rooms.remove(context.identity.sub, id, sub), context),
      ),
    ),
    route(
      "POST",
      "/rooms/:id/join",
      media(async (_request, context, { id = "" }) => {
        const outcome = await rooms.join(context.identity.sub, id);
        switch (outcome.status) {
          case "seated":
            // The join token is a secret. No cache between here and the browser may keep it.
            return Response.json(outcome.seat, { headers: { "cache-control": "no-store" } });
          case "not_found":
            return noRoom(context);
          case "busy":
            return failure(409, "join_in_progress", "Another join got in the way.", context);
        }
      }),
    ),
    route(
      "POST",
      "/rooms/:id/leave",
      media(async (_request, context, { id = "" }) =>
        (await rooms.leave(context.identity.sub, id)) === "left"
          ? new Response(null, { status: 204 })
          : noRoom(context),
      ),
    ),
    route(
      "DELETE",
      "/rooms/:id",
      media(async (_request, context, { id = "" }) =>
        owner(await rooms.close(context.identity.sub, id), context),
      ),
    ),
  ];
  // #endregion routes

  // Behind chapter 06's guard: without an identity, none of these is reached.
  return createNotesApp(deps, routes);
}
