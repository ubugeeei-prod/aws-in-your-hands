import type { Attempt, ProbeOutput } from "../src/probe.ts";

// A toy, written for this chapter's tests. It is NOT celld and does not model
// celld's protocol. It has just enough moving parts (an ownership record with
// an epoch in a shared "bucket", a durable copy, a local copy per node) to
// produce the histories a client could see, including the wrong ones.

/** How a fleet can be built wrong. "sound" is the only one that keeps both promises. */
export type Flaw = "sound" | "acks-before-durable" | "ignores-the-fence" | "replays-requests";

type Owner = { node: string; epoch: number };
type Local = { value: number; epoch: number };

export class ToyFleet {
  private readonly flaw: Flaw;
  private readonly alive = new Set<string>();
  private readonly owners = new Map<number, Owner>();
  private readonly durable = new Map<number, number>();
  private readonly local = new Map<string, Map<number, Local>>();
  private dropNextResponse = false;
  private seq = 0;
  readonly attempts: Attempt[] = [];

  constructor(nodes: string[], flaw: Flaw = "sound") {
    this.flaw = flaw;
    for (const node of nodes) {
      this.alive.add(node);
      this.local.set(node, new Map());
    }
  }

  /** The machine is gone: no handoff, and whatever only it held in memory is gone too. */
  kill(node: string): void {
    this.alive.delete(node);
    this.local.set(node, new Map());
  }

  /** Stops answering, keeps its memory. Comes back with `resume` believing nothing has changed. */
  freeze(node: string): void {
    this.alive.delete(node);
  }

  resume(node: string): void {
    this.alive.add(node);
  }

  /** The next request is carried out, but its answer never reaches the client. */
  loseNextResponse(): void {
    this.dropNextResponse = true;
  }

  /** One increment of `cell`, entering the fleet at `via`. Records what the client saw. */
  request(via: string, cell: number): Attempt {
    this.seq += 1;
    const answer = this.serve(via, cell);
    const lost = this.dropNextResponse && answer !== null;
    this.dropNextResponse = false;
    const attempt: Attempt =
      answer === null || lost
        ? { seq: this.seq, cell, status: answer === null ? 503 : 0, n: null }
        : { seq: this.seq, cell, status: 200, n: answer };
    this.attempts.push(attempt);
    return attempt;
  }

  output(): ProbeOutput {
    return { attempts: [...this.attempts], complete: true, malformed: [] };
  }

  private serve(via: string, cell: number): number | null {
    if (!this.alive.has(via)) {
      return null;
    }
    const mine = this.local.get(via)?.get(cell);
    // A node that ignores the fence serves from its own memory without rereading the record.
    if (this.flaw === "ignores-the-fence" && mine !== undefined) {
      return this.write(via, cell, mine);
    }
    const record = this.owners.get(cell);
    if (record !== undefined && this.alive.has(record.node) && record.node !== via) {
      // Forwarded to the owner. A replaying ingress sends the request twice.
      const first = this.serve(record.node, cell);
      return this.flaw === "replays-requests" ? this.serve(record.node, cell) : first;
    }
    if (
      record === undefined ||
      record.node !== via ||
      mine === undefined ||
      mine.epoch !== record.epoch
    ) {
      // Take over: a new epoch, and the state the bucket holds.
      const epoch = (record?.epoch ?? 0) + 1;
      this.owners.set(cell, { node: via, epoch });
      const restored: Local = { value: this.durable.get(cell) ?? 0, epoch };
      this.local.get(via)?.set(cell, restored);
      return this.write(via, cell, restored);
    }
    return this.write(via, cell, mine);
  }

  private write(node: string, cell: number, state: Local): number {
    state.value += 1;
    const record = this.owners.get(cell);
    const stillOwner = record?.node === node && record.epoch === state.epoch;
    // Durable before the answer, and only as the current owner. A stale owner's write goes nowhere.
    if (this.flaw !== "acks-before-durable" && stillOwner) {
      this.durable.set(cell, state.value);
    }
    return state.value;
  }
}
