import { composeApp as composeNotes } from "@aih/example-04-http-api/src/compose.ts";
import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";

import { withSharedCache } from "./cache.ts";
import { SHARED_CACHE } from "./defences.ts";

/** Chapter 04's notes API, unchanged, with one header added on the way out. */
export const composeApp = (source: Record<string, string | undefined>): Fetch =>
  withSharedCache(composeNotes(source), SHARED_CACHE);
