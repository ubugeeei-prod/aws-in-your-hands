// #region failover
export type Endpoint = { host: string; port: number };

export class NoNodeReachableError extends Error {
  constructor(failures: { endpoint: Endpoint; error: unknown }[]) {
    const detail = failures
      .map(({ endpoint, error }) => `${endpoint.host}:${endpoint.port} (${messageOf(error)})`)
      .join(", ");
    super(`No node accepted a connection: ${detail}`);
    this.name = "NoNodeReachableError";
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Opens a session on the first node that accepts one, starting with the node
 * that worked last time. Only the opening is retried elsewhere: a connection
 * that was never made did nothing, so another node is as good. Once `use`
 * runs, an error is the caller's to judge, because a COMMIT whose answer was
 * lost may or may not have happened.
 */
export function createFailover<Session>(
  endpoints: readonly Endpoint[],
  connect: (endpoint: Endpoint) => Promise<Session>,
  onSkip: (info: { endpoint: Endpoint; error: unknown }) => void = () => undefined,
): { open(): Promise<{ session: Session; endpoint: Endpoint }> } {
  if (endpoints.length === 0) {
    throw new Error("at least one endpoint is needed");
  }
  let preferred = 0;
  return {
    async open() {
      const failures: { endpoint: Endpoint; error: unknown }[] = [];
      for (let offset = 0; offset < endpoints.length; offset++) {
        const index = (preferred + offset) % endpoints.length;
        const endpoint = endpoints[index];
        if (endpoint === undefined) {
          continue;
        }
        try {
          const session = await connect(endpoint);
          preferred = index;
          return { session, endpoint };
        } catch (error) {
          failures.push({ endpoint, error });
          onSkip({ endpoint, error });
        }
      }
      throw new NoNodeReachableError(failures);
    },
  };
}
// #endregion failover
