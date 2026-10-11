import { createError, defineEventHandler, getRouterParam } from "h3";
import type { PublicNote } from "../../../core/notes.ts";
import { context } from "../../context.ts";

export default defineEventHandler((event): PublicNote => {
  const note = context.notes.find(getRouterParam(event, "id") ?? "");
  if (note === undefined) {
    throw createError({ statusCode: 404, statusMessage: "Note not found" });
  }
  return note;
});
