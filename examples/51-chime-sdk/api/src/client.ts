import * as v from "valibot";

import { errorSchema, type RoomView, roomSchema, type Seat, seatSchema } from "./contract.ts";

export class RoomsError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RoomsError";
    this.status = status;
    this.code = code;
  }
}

// #region client
/** `getToken` runs before every request, as in chapter 06's client. */
export function createRoomsClient(
  baseUrl: string,
  getToken: () => string | undefined,
  fetchImpl: typeof fetch = fetch,
) {
  async function call(method: string, path: string): Promise<undefined>;
  async function call<Schema extends v.GenericSchema>(
    method: string,
    path: string,
    schema: Schema,
  ): Promise<v.InferOutput<Schema>>;
  async function call(method: string, path: string, schema?: v.GenericSchema): Promise<unknown> {
    const token = getToken();
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const body = v.safeParse(errorSchema, await response.json().catch(() => undefined));
      // API Gateway rejects a bad token itself, with its own body.
      throw body.success
        ? new RoomsError(response.status, body.output.error.code, body.output.error.message)
        : new RoomsError(
            response.status,
            response.status === 401 || response.status === 403 ? "unauthenticated" : "unexpected",
            `HTTP ${response.status} without an error body`,
          );
    }
    if (schema === undefined) {
      return undefined;
    }
    const body = v.safeParse(schema, await response.json().catch(() => undefined));
    if (!body.success) {
      throw new RoomsError(
        response.status,
        "unexpected",
        "The response does not match the contract.",
      );
    }
    return body.output;
  }
  const room = (id: string) => `/rooms/${encodeURIComponent(id)}`;
  const member = (id: string, sub: string) => `${room(id)}/members/${encodeURIComponent(sub)}`;

  return {
    create: (): Promise<RoomView> => call("POST", "/rooms", roomSchema),
    get: (id: string): Promise<RoomView> => call("GET", room(id), roomSchema),
    invite: (id: string, sub: string) => call("PUT", member(id, sub)),
    remove: (id: string, sub: string) => call("DELETE", member(id, sub)),
    join: (id: string): Promise<Seat> => call("POST", `${room(id)}/join`, seatSchema),
    leave: (id: string) => call("POST", `${room(id)}/leave`),
    close: (id: string) => call("DELETE", room(id)),
  };
}

export type RoomsClient = ReturnType<typeof createRoomsClient>;
// #endregion client
