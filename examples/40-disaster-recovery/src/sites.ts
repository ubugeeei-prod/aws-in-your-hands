// Two sites and one replication stream, small enough to hold in the head. Block-level
// replication knows disks, not notes: a note here stands for the blocks that carry it.
// A model for tests and for the reader. It is not the service and not the notes app.

// #region world
export type SiteName = "source" | "recovery";
export type Write = { id: string; site: SiteName; at: number };

type Site = { notes: Map<string, Write>; alive: boolean; accepting: boolean };

/** A loss that was written down: either the writes by name, or a window nobody could read. */
export type Accounted =
  | { kind: "write"; id: string; reason: string }
  | { kind: "window"; site: SiteName; after: number; reason: string };

export class TwoSites {
  readonly source: Site = { notes: new Map(), alive: true, accepting: true };
  readonly recovery: Site = { notes: new Map(), alive: false, accepting: false };
  /** What has arrived in the staging area. A recovery instance starts as a copy of this. */
  readonly staging = new Map<string, Write>();
  /** Acknowledged at the source, not yet in the staging area. Its length is the lag. */
  readonly inFlight: Write[] = [];
  /** Every write some client was told had succeeded. */
  readonly acknowledged: Write[] = [];
  readonly accounted: Accounted[] = [];
  /** The site clients are told to use. Changing it is the failover, and it happens outside DRS. */
  address: SiteName = "source";
  /** Logical time of the newest write in the staging area when the recovery instance launched. */
  recoveryPoint = 0;
  #clock = 0;

  /** A client writes to the site it believes in. False: the site refused, and the client knows. */
  write(site: SiteName, id: string): boolean {
    const target = this[site];
    if (!target.alive || !target.accepting) {
      return false;
    }
    const write = { id, site, at: ++this.#clock };
    target.notes.set(id, write);
    this.acknowledged.push(write);
    if (site === "source") {
      this.inFlight.push(write);
    }
    return true;
  }

  /** The stream delivers up to `count` writes, in the order they were made. */
  replicate(count = Number.POSITIVE_INFINITY): void {
    for (const write of this.inFlight.splice(0, count)) {
      this.staging.set(write.id, write);
    }
  }

  loseSource(): void {
    this.source.alive = false;
    this.source.accepting = false;
    // What had not left the source when it died never arrives.
    this.inFlight.length = 0;
  }

  /** StartRecovery: the instance holds what the staging area held, and nothing newer. */
  launchRecovery(): void {
    this.recovery.notes = new Map(this.staging);
    this.recovery.alive = true;
    this.recoveryPoint = Math.max(0, ...[...this.staging.values()].map((write) => write.at));
  }

  switchAddress(to: SiteName): void {
    this.address = to;
    this[to].accepting = true;
  }

  /** The source is back. Unfenced, it serves whoever still holds its address. */
  returnSource(options: { fenced: boolean }): void {
    this.source.alive = true;
    this.source.accepting = !options.fenced;
  }

  fenceSource(): void {
    this.source.accepting = false;
  }

  /** Both sites take writes at once. */
  get splitBrain(): boolean {
    return this.source.accepting && this.recovery.accepting;
  }
  // #endregion world

  // #region failback
  /**
   * Reverse replication as the service does it: the recovery instance's disks become the
   * source's disks. Whatever only the source held is gone, and nothing says so.
   */
  failbackNaive(): void {
    this.source.notes = new Map(this.recovery.notes);
    this.#finishFailback();
  }

  /**
   * The same overwrite, after the two questions it cannot answer for you. Is the source
   * fenced? And what does the source hold that the recovery instance never saw?
   */
  failbackAccounted(options: { sourceReadable: boolean }): Accounted[] {
    if (this.source.accepting) {
      throw new Error("The source still accepts writes. Fence it before replicating over it.");
    }
    const before = this.accounted.length;
    if (options.sourceReadable) {
      for (const write of this.source.notes.values()) {
        if (!this.recovery.notes.has(write.id)) {
          this.accounted.push({
            kind: "write",
            id: write.id,
            reason: "acknowledged by the source, never reached the recovery instance",
          });
        }
      }
    } else {
      // The disk is gone. The writes cannot be named, so the window is.
      this.accounted.push({
        kind: "window",
        site: "source",
        after: this.recoveryPoint,
        reason: "the source could not be read; everything it acknowledged after the recovery point",
      });
    }
    this.source.notes = new Map(this.recovery.notes);
    this.#finishFailback();
    return this.accounted.slice(before);
  }

  #finishFailback(): void {
    this.source.alive = true;
    this.recovery.accepting = false;
    this.switchAddress("source");
  }
  // #endregion failback

  // #region invariant
  /**
   * The invariant: after failback, no acknowledged write from either side is lost silently.
   * Returns the writes that break it: acknowledged, absent where clients now read, and
   * covered by no entry in `accounted`.
   */
  silentlyLost(): Write[] {
    const serving = this[this.address].notes;
    return this.acknowledged.filter((write) => {
      if (serving.has(write.id)) {
        return false;
      }
      return !this.accounted.some((entry) =>
        entry.kind === "write"
          ? entry.id === write.id
          : entry.site === write.site && write.at > entry.after,
      );
    });
  }
  // #endregion invariant
}
