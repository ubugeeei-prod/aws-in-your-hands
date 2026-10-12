import { defineEventHandler } from "h3";

import type { NoteList } from "../../../core/notes.ts";
import { context } from "../../context.ts";

export default defineEventHandler((): NoteList => ({ notes: context.notes.list() }));
