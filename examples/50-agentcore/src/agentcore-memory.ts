import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  paginateListEvents,
} from "@aws-sdk/client-bedrock-agentcore";

import { fromStoredEvents, toCreateEventInput } from "./memory-events.ts";
import type { MemoryStore } from "./memory-store.ts";

// #region adapter
/** Short-term memory of AgentCore Memory: CreateEvent and ListEvents, nothing else. */
export function createAgentCoreMemoryStore(
  region: string,
  memoryId: string,
  now: () => number,
): MemoryStore {
  const client = new BedrockAgentCoreClient({ region });
  return {
    async load(actorId, sessionId) {
      const events: unknown[] = [];
      const pages = paginateListEvents(
        { client },
        { memoryId, actorId, sessionId, includePayloads: true, maxResults: 100 },
      );
      for await (const page of pages) {
        events.push(...(page.events ?? []));
      }
      return fromStoredEvents(events, actorId, sessionId);
    },
    async append(actorId, sessionId, event) {
      await client.send(
        new CreateEventCommand(
          toCreateEventInput(memoryId, actorId, sessionId, event, new Date(now())),
        ),
      );
    },
  };
}
// #endregion adapter
