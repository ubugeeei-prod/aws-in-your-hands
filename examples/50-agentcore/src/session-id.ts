import { createHash, randomUUID } from "node:crypto";

import * as v from "valibot";

// #region session-id
/** The first 32 hexadecimal digits of SHA-256 over the user's ID. Not a secret: a label. */
const ownerTag = (sub: string): string =>
  createHash("sha256").update(sub, "utf8").digest("hex").slice(0, 32);

/**
 * A session ID is `<owner tag>-<anything unique>`. AgentCore Runtime asks for 33 characters
 * or more and treats the ID as an opaque routing key. This agent reads more into it.
 */
export const sessionIdSchema = v.pipe(v.string(), v.regex(/^[0-9a-f]{32}-[A-Za-z0-9-]{1,128}$/));

/** A new session for this user. Whoever makes session IDs (a backend, a client) uses this rule. */
export const newSessionId = (sub: string, unique: string = randomUUID()): string =>
  `${ownerTag(sub)}-${unique}`;

/**
 * Whether the session was made for this user. AgentCore Runtime routes by session ID and
 * does not ask whose it is, so the agent does: a session ID that leaks is of no use to
 * anyone but its owner.
 */
export const ownsSession = (sub: string, sessionId: string): boolean =>
  sessionId.startsWith(`${ownerTag(sub)}-`);
// #endregion session-id
