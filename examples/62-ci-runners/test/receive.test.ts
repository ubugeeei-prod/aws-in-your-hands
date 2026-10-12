import { describe, expect, it } from "vite-plus/test";

import { claimKey } from "../src/claims.ts";
import { MAX_BODY_BYTES, TIMING } from "../src/config.ts";
import { delivery, payload, REPOSITORY, world } from "./fakes.ts";

const KEY = claimKey(REPOSITORY, 31000000001);

describe("one delivery", () => {
  it("starts one task, with the registration of a runner named after the job", async () => {
    const { app, state, claims } = world();
    const response = await app(delivery(payload()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "launched" });
    expect(state.launches).toEqual([
      {
        runnerName: "aih-31000000001-n1",
        encodedJitConfig: "jit-for-aih-31000000001-n1",
        jobId: 31000000001,
      },
    ]);
    expect(claims.entries.get(KEY)).toMatchObject({ state: "launched" });
  });

  it("answers 404 anywhere but POST /webhook", async () => {
    const { app } = world();
    expect((await app(new Request("https://receiver.test/webhook"))).status).toBe(404);
    expect((await app(new Request("https://receiver.test/", { method: "POST" }))).status).toBe(404);
  });
});

describe("a delivery that did not come from GitHub", () => {
  it("is refused before anything is asked of GitHub or ECS", async () => {
    const { app, state, claims } = world();
    const response = await app(delivery(payload(), { secret: "guessed" }));
    expect(response.status).toBe(401);
    expect(state.tokensFor).toEqual([]);
    expect(state.launches).toEqual([]);
    expect(claims.entries.size).toBe(0);
  });

  it("is refused when a signed body was altered on the way", async () => {
    const { app, state } = world();
    const signed = delivery(payload());
    const altered = payload((value) => (value.repository["full_name"] = "attacker/notes"));
    const response = await app(
      delivery(altered, { signature: signed.headers.get("x-hub-signature-256") ?? "" }),
    );
    expect(response.status).toBe(401);
    expect(state.launches).toEqual([]);
  });

  it("is refused with 401, not 400, even when the body is not JSON", async () => {
    const { app } = world();
    expect((await app(delivery("not json", { secret: "guessed" }))).status).toBe(401);
  });

  it("is cut off at the size limit", async () => {
    const { app } = world();
    expect((await app(delivery("x".repeat(MAX_BODY_BYTES + 1)))).status).toBe(413);
  });
});

describe("a signed delivery that is not a job for us", () => {
  it("answers 200 to a ping without reading its body as a job", async () => {
    const { app, state } = world();
    const response = await app(delivery('{"zen":"Keep it logically awesome."}', { event: "ping" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "skipped", reason: "other_event" });
    expect(state.launches).toEqual([]);
  });

  it("answers 400 to a signed body that is not a workflow_job payload", async () => {
    const { app } = world();
    expect((await app(delivery("{}"))).status).toBe(400);
    expect((await app(delivery("not json"))).status).toBe(400);
  });
});

describe("a job from a fork", () => {
  it("registers no runner and starts no task", async () => {
    const { app, state } = world();
    state.run = {
      ...state.run,
      event: "pull_request",
      head_repository: { full_name: "outsider/notes" },
    };
    const response = await app(delivery(payload()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "skipped", reason: "fork" });
    expect(state.runners.size).toBe(0);
    expect(state.launches).toEqual([]);
  });

  it("stays refused when the delivery is sent again", async () => {
    const { app, state } = world();
    state.run = { ...state.run, head_repository: { full_name: "outsider/notes" } };
    await app(delivery(payload()));
    state.run = { ...state.run, head_repository: { full_name: REPOSITORY } };
    expect(await (await app(delivery(payload()))).json()).toEqual({ outcome: "duplicate" });
    expect(state.launches).toEqual([]);
  });
});

describe("a delivery that arrives twice", () => {
  it("starts one task when sent again", async () => {
    const { app, state } = world();
    await app(delivery(payload()));
    const again = await app(delivery(payload()));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ outcome: "duplicate" });
    expect(state.launches).toHaveLength(1);
    expect(state.runners.size).toBe(1);
  });

  it("starts one task when both copies arrive together", async () => {
    const { app, state } = world();
    const answers = await Promise.all([app(delivery(payload())), app(delivery(payload()))]);
    const outcomes = await Promise.all(
      answers.map(async (answer) => (await answer.json()).outcome),
    );
    expect(outcomes.toSorted()).toEqual(["duplicate", "launched"]);
    expect(state.launches).toHaveLength(1);
  });

  it("starts a task for each of two different jobs", async () => {
    const { app, state } = world();
    await app(delivery(payload()));
    await app(delivery(payload((value) => (value.workflow_job["id"] = 31000000002))));
    expect(state.launches.map((launch) => launch.jobId)).toEqual([31000000001, 31000000002]);
  });
});

describe("a launch that fails", () => {
  it("removes the runner it registered, gives the job back, and answers 500", async () => {
    const { app, state, claims } = world();
    state.failLaunch = true;
    const response = await app(delivery(payload()));
    expect(response.status).toBe(500);
    expect(state.removed).toEqual([1]);
    expect(state.runners.size).toBe(0);
    expect(claims.entries.has(KEY)).toBe(false);
  });

  it("succeeds when the same delivery is sent again, under a new runner name", async () => {
    const { app, state } = world();
    state.failLaunch = true;
    await app(delivery(payload()));
    state.failLaunch = false;
    const response = await app(delivery(payload()));
    expect(await response.json()).toMatchObject({ outcome: "launched" });
    expect(state.launches).toHaveLength(1);
    expect(state.launches[0]?.runnerName).not.toBe("aih-31000000001-n1");
  });

  it("still gives the job back when the runner cannot be removed", async () => {
    const { app, state, claims } = world();
    state.failLaunch = true;
    state.failRemove = true;
    expect((await app(delivery(payload()))).status).toBe(500);
    expect(claims.entries.has(KEY)).toBe(false);
    // Left for GitHub to remove: an ephemeral runner that never connects goes after a day.
    expect(state.runners.size).toBe(1);
  });

  it("does not undo a started task because the record of it could not be written", async () => {
    const { app, state } = world();
    state.failComplete = true;
    const response = await app(delivery(payload()));
    expect(response.status).toBe(200);
    expect(state.launches).toHaveLength(1);
    expect(state.removed).toEqual([]);
  });
});

describe("a receiver that died between the claim and the launch", () => {
  it("keeps the job to itself while its lease lasts", async () => {
    const { app, state, claims } = world();
    await claims.claim(KEY, state.now);
    state.now += TIMING.claimLease;
    expect(await (await app(delivery(payload()))).json()).toEqual({ outcome: "duplicate" });
    expect(state.launches).toEqual([]);
  });

  it("loses the job to a redelivery once the lease has run out", async () => {
    const { app, state, claims } = world();
    await claims.claim(KEY, state.now);
    state.now += TIMING.claimLease + 1;
    expect(await (await app(delivery(payload()))).json()).toMatchObject({ outcome: "launched" });
    expect(state.launches).toHaveLength(1);
  });

  it("never loses a launched job, however old the claim", async () => {
    const { app, state } = world();
    await app(delivery(payload()));
    state.now += 100 * TIMING.claimLease;
    expect(await (await app(delivery(payload()))).json()).toEqual({ outcome: "duplicate" });
    expect(state.launches).toHaveLength(1);
  });
});
