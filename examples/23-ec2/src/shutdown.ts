// #region shutdown
/** The part of `http.Server` that a shutdown needs. */
export type Closable = {
  /** Stops accepting connections; calls back once the ones in use have finished. */
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections(): void;
};

export type ShutdownDeps = {
  server: Closable;
  /** Waits for writes that were already accepted. */
  flush: () => Promise<void>;
  /** Shorter than the unit's TimeoutStopSec, so the process decides before systemd sends SIGKILL. */
  graceMs: number;
  log: (message: string) => void;
  exit: (code: number) => void;
  schedule?: (run: () => void, ms: number) => { cancel: () => void };
};

const realSchedule = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms);
  return { cancel: () => clearTimeout(timer) };
};

/**
 * What to do on SIGTERM: take no new connections, let requests in flight
 * finish, wait for their writes, then exit. A second signal changes nothing.
 */
export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let started: Promise<void> | undefined;
  return (signal) => {
    started ??= (async () => {
      deps.log(`${signal}: no new connections; waiting for requests in flight`);
      const drained = await new Promise<boolean>((resolve) => {
        const timer = (deps.schedule ?? realSchedule)(() => resolve(false), deps.graceMs);
        deps.server.close(() => {
          timer.cancel();
          resolve(true);
        });
      });
      if (!drained) {
        deps.log(`still busy after ${deps.graceMs} ms; closing the remaining connections`);
        deps.server.closeAllConnections();
      }
      await deps.flush();
      deps.exit(drained ? 0 : 1);
    })();
    return started;
  };
}
// #endregion shutdown
