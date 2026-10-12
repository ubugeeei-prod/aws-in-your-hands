import { describe, expect, it } from "vite-plus/test";

import { originBrake, RATE_RULE } from "../src/defences.ts";
import {
  ATTACK,
  type Defences,
  DEPLOYED,
  flood,
  type Scenario,
  served,
  simulate,
  total,
  USERS,
} from "../src/flood.ts";

const { rateRule, cacheSeconds, brake } = DEPLOYED;
const run = (attack: Parameters<typeof flood>[0], defences: Defences) =>
  simulate(flood(attack, defences));

// 3,000 seconds at 5,000 a second, and an hour at 100 a second.
const ATTACK_SENT = 15_000_000;
const USERS_SENT = 360_000;

describe("the model accounts for every request", () => {
  it.each([
    ["no defence", {}],
    ["all of them", DEPLOYED],
  ])("each request ends in exactly one place: %s", (_name, defences) => {
    for (const attack of ["fewSources", "manySources", "cachedRoute"] as const) {
      const outcome = run(attack, defences);
      expect(outcome.attack.sent).toBe(ATTACK_SENT);
      expect(outcome.users.sent).toBe(USERS_SENT);
      for (const count of [outcome.users, outcome.attack]) {
        expect(count.blocked + count.cached + count.throttled + count.origin).toBe(count.sent);
      }
      const reached = outcome.timeline.reduce((sum, second) => sum + second.origin, 0);
      expect(reached).toBe(total(outcome).origin);
    }
  });

  it("gives the same numbers for the same seed, and others for another", () => {
    const scenario = flood("manySources", { brake });
    expect(simulate(scenario)).toEqual(simulate(scenario));
    expect(simulate({ ...scenario, seed: 47 }).users.origin).not.toBe(
      simulate(scenario).users.origin,
    );
  });
});

describe("with nothing in front", () => {
  it("lets the whole flood run the function, and the users do not notice", () => {
    const outcome = run("fewSources", {});
    expect(outcome.attack.origin).toBe(ATTACK_SENT);
    expect(served(outcome)).toBe(1);
  });
});

describe("the rate-based rule", () => {
  it("stops a flood from few addresses once it has noticed, and never the users", () => {
    const outcome = run("fewSources", { rateRule });
    // Each address passes the limit in its second second, and is blocked 30 seconds later.
    const beforeNotice = 20 * 250 * (1 + rateRule.noticeSeconds);
    expect(outcome.attack.origin).toBe(beforeNotice);
    expect(outcome.attack.blocked).toBe(ATTACK_SENT - beforeNotice);
    expect(outcome.users.blocked).toBe(0);
    expect(served(outcome)).toBe(1);
  });

  it("sees nothing when the same flood comes from addresses that each stay under the limit", () => {
    const outcome = run("manySources", { rateRule });
    // One request every four seconds is 15 in the window, against a limit of 300.
    expect(0.25 * RATE_RULE.windowSeconds).toBeLessThan(RATE_RULE.limit);
    expect(outcome.attack.blocked).toBe(0);
    expect(outcome.attack.origin).toBe(ATTACK_SENT);
  });

  it("draws the line at the limit: 300 in the window passes, 360 does not", () => {
    const one = (ratePerAddress: number): Scenario => ({
      seconds: 600,
      sources: [{ ...USERS, label: "attack", addresses: 1, ratePerAddress, to: 600 }],
      defences: { rateRule },
      seed: 1,
    });
    expect(simulate(one(5)).attack.blocked).toBe(0);
    // Over the limit from second 51, noticed 30 seconds later, blocked from then on.
    expect(simulate(one(6)).attack.blocked).toBe((600 - 80) * 6);
  });
});

describe("the cache", () => {
  it("answers a flood on the shared route with one run of the function per lifetime", () => {
    const outcome = run("cachedRoute", { cacheSeconds });
    const all = total(outcome);
    // The cached route is refilled once every five seconds for the hour.
    const fills = 3600 / cacheSeconds;
    const dynamic = USERS_SENT * (1 - USERS.cachedShare);
    expect(all.origin).toBe(dynamic + fills);
    expect(outcome.attack.origin).toBeLessThanOrEqual(fills);
    expect(served(outcome)).toBe(1);
  });

  it("does nothing for a flood on a route that is not cached", () => {
    const outcome = run("manySources", { cacheSeconds });
    expect(outcome.attack.cached).toBe(0);
    expect(outcome.attack.origin).toBe(ATTACK_SENT);
  });
});

describe("the brake", () => {
  const outcome = run("manySources", { rateRule, brake });

  it("is ten requests a second for each unit of reserved concurrency", () => {
    expect(originBrake(20)).toEqual({ ratePerSecond: 200, burst: 20 });
  });

  it("bounds what runs, whatever arrives", () => {
    // The bucket's rate, plus what it held at the start of the second.
    const ceiling = brake.ratePerSecond + brake.burst;
    expect(Math.max(...outcome.timeline.map((second) => second.origin))).toBeLessThanOrEqual(
      ceiling,
    );
    expect(total(outcome).origin).toBeLessThan(3600 * brake.ratePerSecond + brake.burst + 1);
  });

  it("does not tell users from the flood: while it lasts, nearly all of them are refused", () => {
    // 200 of 5,100 requests a second get through, whoever sent them.
    expect(served(outcome, ATTACK.from, ATTACK.to)).toBeLessThan(0.05);
    expect(served(outcome, 0, ATTACK.from)).toBe(1);
    // The bucket refills within a second of the flood stopping.
    expect(served(outcome, ATTACK.to + 1)).toBe(1);
  });

  it("leaves the users alone when there is no flood", () => {
    const quiet = simulate({ ...flood("manySources", { brake }), sources: [USERS] });
    expect(quiet.users.throttled).toBe(0);
  });
});
