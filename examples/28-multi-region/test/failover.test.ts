import { describe, expect, it } from "vite-plus/test";

import {
  CachingResolver,
  checkerOpinion,
  detectionSeconds,
  failoverAnswer,
  isHealthy,
  latencyAnswer,
} from "../src/failover.ts";
import { createWorld } from "../src/local.ts";
import { failoverBudget, HEALTH_CHECK, judgeRpo, TARGETS } from "../src/objectives.ts";
import { PRIMARY_REGION as TOKYO, type Region, STANDBY_REGION as OSAKA } from "../src/regions.ts";

const ok = true;
const bad = false;

describe("one health checker", () => {
  it("changes its mind only after the threshold of consecutive failures", () => {
    expect(checkerOpinion([ok, bad, bad], 3)).toBe(true);
    expect(checkerOpinion([ok, bad, bad, bad], 3)).toBe(false);
  });

  it("starts counting again after one good answer", () => {
    // A cold start that answers too slowly, twice, does not move traffic.
    expect(checkerOpinion([bad, bad, ok, bad, bad], 3)).toBe(true);
  });

  it("needs the same number of good answers to come back", () => {
    expect(checkerOpinion([bad, bad, bad, ok, ok], 3)).toBe(false);
    expect(checkerOpinion([bad, bad, bad, ok, ok, ok], 3)).toBe(true);
  });
});

describe("the health check as a whole", () => {
  it("stays healthy while more than 18% of the checkers reach the endpoint", () => {
    const checkers = (healthy: number, total: number) =>
      Array.from({ length: total }, (_, index) => index < healthy);
    // 3 of 16 is 18.75%; 2 of 16 is 12.5%.
    expect(isHealthy(checkers(3, 16))).toBe(true);
    expect(isHealthy(checkers(2, 16))).toBe(false);
    expect(isHealthy([])).toBe(false);
  });
});

describe("which record answers", () => {
  it("fails over only when the primary is unhealthy and the secondary is not", () => {
    expect(failoverAnswer({ primary: true, secondary: true })).toBe("primary");
    expect(failoverAnswer({ primary: true, secondary: false })).toBe("primary");
    expect(failoverAnswer({ primary: false, secondary: true })).toBe("secondary");
  });

  it("answers with the primary when nothing is healthy", () => {
    expect(failoverAnswer({ primary: false, secondary: false })).toBe("primary");
  });

  it("sends each user to the nearest healthy Region under latency routing", () => {
    const fromFukuoka = [
      { region: TOKYO, healthy: true, latencyMs: 22 },
      { region: OSAKA, healthy: true, latencyMs: 14 },
    ];
    expect(latencyAnswer(fromFukuoka)).toBe(OSAKA);
    expect(
      latencyAnswer(fromFukuoka.map((each) => ({ ...each, healthy: each.region === TOKYO }))),
    ).toBe(TOKYO);
    expect(latencyAnswer(fromFukuoka.map((each) => ({ ...each, healthy: false })))).toBe(OSAKA);
  });
});

describe("the failover budget", () => {
  it("adds detection, DNS, and the client, and fits the chosen RTO", () => {
    expect(detectionSeconds(HEALTH_CHECK)).toBe(90);
    expect(
      failoverBudget({ healthCheck: HEALTH_CHECK, dnsTtlSeconds: 60, clientSeconds: 60 }),
    ).toEqual({
      detectSeconds: 90,
      dnsSeconds: 60,
      clientSeconds: 60,
      totalSeconds: 210,
      withinTarget: true,
    });
  });

  it("is broken by a long TTL long before the health check matters", () => {
    const budget = failoverBudget({
      healthCheck: { requestIntervalSeconds: 10, failureThreshold: 1 },
      dnsTtlSeconds: 300,
      clientSeconds: 60,
    });
    expect(budget.detectSeconds).toBe(10);
    expect(budget.withinTarget).toBe(false);
  });

  it("compares observed lag with the promised RPO, per store", () => {
    expect(judgeRpo({ tableMaxLagMs: 850, bucketOldestPendingSeconds: undefined })).toEqual({
      table: "ok",
      bucket: "ok",
    });
    expect(
      judgeRpo({
        tableMaxLagMs: (TARGETS.rpoTableSeconds + 1) * 1000,
        bucketOldestPendingSeconds: TARGETS.rpoBucketSeconds + 1,
      }),
    ).toEqual({ table: "over", bucket: "over" });
  });
});

describe("a failover and the clients that have not heard of it", () => {
  // #region stale-dns
  it("lets a client with an old DNS answer overwrite an edit made after the failover", async () => {
    const world = createWorld({ mode: "eventual", lagMs: 1000 });
    const health = { primary: true, secondary: true };
    const target = (): Region => (failoverAnswer(health) === "primary" ? TOKYO : OSAKA);
    const put = (region: Region, title: string) =>
      world.apps[region](
        new Request(`http://api.test/notes/${id}`, {
          method: "PUT",
          body: JSON.stringify({ title, body: "", expectedVersion: 1 }),
        }),
      );

    const created = await world.apps[TOKYO](
      new Request("http://api.test/notes", {
        method: "POST",
        body: JSON.stringify({ title: "shopping list" }),
      }),
    );
    const { id } = (await created.json()) as { id: string };
    world.advance(1000);

    // Two clients resolve the API's name at 0 s and may keep the answer for 60 s.
    const phone = new CachingResolver<Region>(60);
    const laptop = new CachingResolver<Region>(60);
    expect(phone.resolve(0, target)).toBe(TOKYO);

    // At 10 s the health check turns. Tokyo's function is in fact still running.
    health.primary = false;
    expect(laptop.resolve(10, target)).toBe(OSAKA);
    expect(phone.resolve(10, target)).toBe(TOKYO);

    const fromLaptop = await put(laptop.resolve(10, target), "bread");
    world.advance(500);
    const fromPhone = await put(phone.resolve(10, target), "milk, eggs");

    // Both are answered 200, each by a different Region.
    expect([fromLaptop.status, fromLaptop.headers.get("x-aih-region")]).toEqual([200, OSAKA]);
    expect([fromPhone.status, fromPhone.headers.get("x-aih-region")]).toEqual([200, TOKYO]);

    world.advance(1000);
    const read = await world.apps[OSAKA](new Request(`http://api.test/notes/${id}`));
    expect(await read.json()).toMatchObject({ title: "milk, eggs", version: 2 });
    // After 60 s the phone asks again and follows everyone else.
    expect(phone.resolve(61, target)).toBe(OSAKA);
  });
  // #endregion stale-dns

  it("refuses the same late write when the standby is read-only, at the price of a manual step", async () => {
    const world = createWorld({ mode: "eventual", lagMs: 1000, standbyWrites: "refuse" });
    const created = await world.apps[TOKYO](
      new Request("http://api.test/notes", {
        method: "POST",
        body: JSON.stringify({ title: "shopping list" }),
      }),
    );
    const { id } = (await created.json()) as { id: string };
    world.advance(1000);

    const answer = await world.apps[OSAKA](
      new Request(`http://api.test/notes/${id}`, {
        method: "PUT",
        body: JSON.stringify({ title: "bread", body: "", expectedVersion: 1 }),
      }),
    );
    expect(answer.status).toBe(503);
    // Reads still work, so the standby is useful while a person decides.
    expect((await world.apps[OSAKA](new Request(`http://api.test/notes/${id}`))).status).toBe(200);
  });
});
