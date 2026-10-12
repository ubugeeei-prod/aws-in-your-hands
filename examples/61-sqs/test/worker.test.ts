import { describe, expect, it } from "vite-plus/test";

import { MAX_LINES } from "../src/ledger.ts";
import { createCarryOnHandler, ForgetfulLedger } from "../src/naive.ts";
import type { PolledRecord } from "../src/poller.ts";
import { createFifoBatchHandler } from "../src/worker.ts";
import { append, MAX_RECEIVES, retitle, setup, VISIBILITY_MS } from "./harness.ts";

// The invariant: for each note, commands take effect in the order the queue
// accepted them, and each takes effect once, however often it is delivered.
// The queue is the model in src/fifo-queue.ts; the worker is the deployed code.

describe("the invariant, with nothing going wrong", () => {
  it("applies each note's commands in order, whatever the other notes are doing", async () => {
    const context = setup();
    context.send(retitle("Groceries"));
    context.send(append("milk", { noteId: "n2" }));
    context.send(append("eggs"));
    context.send(retitle("Shopping"));
    context.send(append("bread", { noteId: "n2" }));

    expect(await context.deliver()).toEqual({ received: 5, deleted: 5, late: 0 });
    expect(await context.note("n1")).toEqual({ title: "Shopping", lines: ["eggs"], applied: 3 });
    expect(await context.note("n2")).toEqual({ title: "", lines: ["milk", "bread"], applied: 2 });
  });
});

describe("a producer that sends the same command twice", () => {
  it("within five minutes: the queue drops the second send", async () => {
    const context = setup({ ledger: new ForgetfulLedger() });
    const command = append("milk");
    expect(context.send(command)).toBe("queued");
    context.advanceMinutes(4);
    expect(context.send(command)).toBe("deduplicated");

    await context.deliver();
    // Even a ledger with no memory ends with one line: the queue did the work.
    expect((await context.note())?.lines).toEqual(["milk"]);
  });

  it("after five minutes: the queue delivers both, and a ledger without memory applies both", async () => {
    const context = setup({ ledger: new ForgetfulLedger() });
    const command = append("milk");
    context.send(command);
    await context.deliver();
    // The answer to the first send was lost. The producer tries again later.
    context.advanceMinutes(5);
    expect(context.send(command)).toBe("queued");
    await context.deliver();

    expect((await context.note())?.lines).toEqual(["milk", "milk"]);
  });

  it("after five minutes: the ledger recognizes the command and changes nothing", async () => {
    const context = setup();
    const command = append("milk");
    context.send(command);
    await context.deliver();
    context.advanceMinutes(5);
    context.send(command);

    expect(await context.deliver()).toEqual({ received: 1, deleted: 1, late: 0 });
    expect(await context.note()).toEqual({ title: "", lines: ["milk"], applied: 1 });
    expect(context.results()).toEqual(["applied", "already_applied"]);
  });
});

describe("a consumer that outlives its visibility timeout", () => {
  // Worker A stops just before it writes. The queue takes the message back
  // and lends it to worker B, which finishes. Then A wakes up.
  async function race(context: ReturnType<typeof setup>) {
    context.send(append("milk"));
    const release = context.pauseNext();
    const slow = context.deliver();
    context.advance(VISIBILITY_MS);
    const fast = await context.deliver();
    release();
    return { slow: await slow, fast };
  }

  it("with a ledger without memory, the command takes effect twice", async () => {
    const context = setup({ ledger: new ForgetfulLedger() });
    await race(context);
    expect((await context.note())?.lines).toEqual(["milk", "milk"]);
  });

  it("with the ledger, the second worker's write stands and the first one's is refused", async () => {
    const context = setup();
    const { slow, fast } = await race(context);

    expect(await context.note()).toEqual({ title: "", lines: ["milk"], applied: 1 });
    expect(context.results()).toEqual(["applied", "already_applied"]);
    expect(fast).toEqual({ received: 1, deleted: 1, late: 0 });
    // A's delete arrives with a receipt handle the queue no longer honours.
    expect(slow).toEqual({ received: 1, deleted: 0, late: 1 });
  });

  it("does not let the late worker undo a later command", async () => {
    const context = setup();
    context.send(retitle("Draft"));
    context.send(retitle("Final"));
    const release = context.pauseNext();
    const slow = context.deliver();
    context.advance(VISIBILITY_MS);
    await context.deliver();
    expect((await context.note())?.title).toBe("Final");

    release();
    await slow;
    expect(await context.note()).toEqual({ title: "Final", lines: [], applied: 2 });
  });
});

describe("a failure in the middle of a batch", () => {
  it("a handler that carries on applies a later command before an earlier one", async () => {
    const context = setup();
    context.send(retitle("Draft"));
    context.send(retitle("Final"));
    context.failNext(1);

    await context.deliver(createCarryOnHandler(context.ledger));
    context.advance(VISIBILITY_MS);
    await context.deliver(createCarryOnHandler(context.ledger));
    // Each command took effect once, and the note ends with the older title.
    expect(await context.note()).toEqual({ title: "Draft", lines: [], applied: 2 });
  });

  it("the worker stops at the failure, and the retry applies both in order", async () => {
    const context = setup();
    context.send(retitle("Draft"));
    context.send(retitle("Final"));
    context.send(append("milk", { noteId: "n2" }));
    context.failNext(1);

    expect(await context.deliver()).toEqual({ received: 3, deleted: 0, late: 0 });
    expect(await context.note()).toBeUndefined();
    context.advance(VISIBILITY_MS);
    expect(await context.deliver()).toEqual({ received: 3, deleted: 3, late: 0 });
    expect(await context.note()).toEqual({ title: "Final", lines: [], applied: 2 });
    expect((await context.note("n2"))?.lines).toEqual(["milk"]);
  });

  it("reports the failure and what follows it, and not what was applied before it", async () => {
    const context = setup();
    context.send(append("milk"));
    context.send(append("eggs"));
    context.send(append("bread"));
    context.failNext(1, 1);

    expect(await context.deliver()).toEqual({ received: 3, deleted: 1, late: 0 });
    expect((await context.note())?.lines).toEqual(["milk"]);
    context.advance(VISIBILITY_MS);
    const again = context.queue.receive(10);
    expect(again.map((received) => received.receiveCount)).toEqual([2, 2]);
  });
});

describe("a message the worker can never read", () => {
  it("is parked at once, and the rest of its note's commands go ahead", async () => {
    const context = setup();
    context.send(append("milk"));
    context.queue.send({ body: "not JSON", groupId: "alice/n1", deduplicationId: "x1" });
    context.queue.send({
      body: JSON.stringify({ version: 2, commandId: "c", owner: "alice", noteId: "n1" }),
      groupId: "alice/n1",
      deduplicationId: "x2",
    });
    context.send(append("eggs"));

    expect(await context.deliver()).toEqual({ received: 4, deleted: 4, late: 0 });
    expect((await context.note())?.lines).toEqual(["milk", "eggs"]);
    expect(context.deadLetters.bodies()).toHaveLength(2);
    expect(context.logs.filter((entry) => entry.message === "parked")).toEqual([
      expect.objectContaining({ reason: "not_json" }),
      expect.objectContaining({ reason: "not_a_command" }),
    ]);
  });

  it("stays in the queue if it cannot be parked", async () => {
    const context = setup();
    context.queue.send({ body: "not JSON", groupId: "alice/n1", deduplicationId: "x1" });
    const handler = createFifoBatchHandler({
      ledger: context.ledger,
      park: async () => {
        throw new Error("the dead-letter queue is not answering");
      },
      log: () => {},
    });

    expect(await context.deliver(handler)).toEqual({ received: 1, deleted: 0, late: 0 });
    expect(context.queue.stats()).toMatchObject({ visible: 0, inFlight: 1 });
  });
});

describe("a command that can never take effect", () => {
  it("is answered once and not delivered again", async () => {
    const context = setup();
    for (let line = 0; line < MAX_LINES; line++) {
      await context.ledger.apply(append(`line ${line}`));
    }
    context.send(append("one too many"));

    expect(await context.deliver()).toEqual({ received: 1, deleted: 1, late: 0 });
    expect(context.results()).toEqual(["refused"]);
    expect((await context.note())?.lines).toHaveLength(MAX_LINES);
    expect(context.deadLetters.bodies()).toEqual([]);
  });
});

describe("a table that stays down longer than the queue will retry", () => {
  it("sends the commands to the dead-letter queue in order, and a redrive applies them in order", async () => {
    const context = setup();
    context.send(retitle("Draft"));
    context.send(append("milk"));
    context.send(retitle("Final"));

    context.failNext(MAX_RECEIVES);
    for (let attempt = 0; attempt < MAX_RECEIVES; attempt++) {
      await context.deliver();
      context.advance(VISIBILITY_MS);
    }
    expect((await context.deliver()).received).toBe(0);
    expect(context.deadLetters.bodies()).toHaveLength(3);
    expect(await context.note()).toBeUndefined();

    expect(context.deadLetters.redriveTo(context.queue)).toBe(3);
    await context.deliver();
    expect(await context.note()).toEqual({ title: "Final", lines: ["milk"], applied: 3 });
  });

  it("a redriven command that had been applied before is not applied again", async () => {
    const context = setup();
    const command = append("milk");
    context.send(command);
    // Applied, and then the worker never returns: no delete, five times over.
    const applyThenHang = async (batch: { Records: PolledRecord[] }) => {
      await context.worker(batch);
      return {
        batchItemFailures: batch.Records.map((record) => ({ itemIdentifier: record.messageId })),
      };
    };
    for (let attempt = 0; attempt < MAX_RECEIVES; attempt++) {
      await context.deliver(applyThenHang);
      context.advance(VISIBILITY_MS);
    }
    await context.deliver();
    expect(context.deadLetters.bodies()).toHaveLength(1);

    context.deadLetters.redriveTo(context.queue);
    await context.deliver();
    expect(await context.note()).toEqual({ title: "", lines: ["milk"], applied: 1 });
  });
});

describe("what the handler is given", () => {
  it("refuses a batch that did not come from a FIFO queue", async () => {
    const context = setup();
    await expect(
      context.worker({ Records: [{ messageId: "m1", body: "{}", attributes: {} }] }),
    ).rejects.toThrow();
  });
});
