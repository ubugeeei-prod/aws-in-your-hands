// #region spin
// Not part of the app. A worker that does nothing but hold the CPU, so that
// scripts/observe.ts can see what that does to its neighbours.
export default {
  fetch(request: Request): Response {
    const ms = Math.min(Number(new URL(request.url).searchParams.get("ms") ?? "0"), 5000);
    const started = performance.now();
    let turns = 0;
    // The turn count is a second way out, in case the clock does not move while code runs.
    while (performance.now() - started < ms && turns < 2e9) {
      turns += 1;
    }
    return Response.json({ ms, turns });
  },
};
// #endregion spin
