import {
  DescribeJobsCommand,
  DescribeRecoveryInstancesCommand,
  DescribeRecoverySnapshotsCommand,
  DescribeSourceServersCommand,
  type DrsClient,
  StartRecoveryCommand,
  TerminateRecoveryInstancesCommand,
} from "@aws-sdk/client-drs";
import * as v from "valibot";

import type { ProtectedServer, StartRecoveryInput } from "./drill.ts";
import {
  type Job,
  jobSchema,
  lagSeconds,
  type RecoveryInstance,
  recoveryInstanceSchema,
  type RecoverySnapshot,
  recoverySnapshotSchema,
  type SourceServer,
  sourceServerSchema,
} from "./drs.ts";

// #region port
/** Everything this chapter asks of the service. Tests implement it with recorded shapes. */
export type DrsApi = {
  sourceServers(): Promise<SourceServer[]>;
  recoverySnapshots(sourceServerID: string): Promise<RecoverySnapshot[]>;
  recoveryInstances(): Promise<RecoveryInstance[]>;
  job(jobID: string): Promise<Job | undefined>;
  startRecovery(input: StartRecoveryInput): Promise<Job>;
  terminateRecoveryInstances(recoveryInstanceIDs: string[]): Promise<Job>;
};

/** What the planner needs, gathered from two calls per server. */
export async function protectedServers(api: DrsApi): Promise<ProtectedServer[]> {
  const servers = await api.sourceServers();
  return Promise.all(
    servers.map(async (server) => ({
      sourceServerID: server.sourceServerID,
      state: server.dataReplicationInfo.dataReplicationState,
      lagSeconds: lagSeconds(server.dataReplicationInfo.lagDuration),
      snapshots: (await api.recoverySnapshots(server.sourceServerID)).flatMap((snapshot) =>
        // A snapshot without a timestamp was expected and not taken.
        snapshot.timestamp === undefined
          ? []
          : [{ snapshotID: snapshot.snapshotID, takenAt: snapshot.timestamp }],
      ),
    })),
  );
}

/** Only drills, and only those that still exist in EC2. A real recovery is never swept up. */
export const drillInstances = (instances: RecoveryInstance[]): RecoveryInstance[] =>
  instances.filter(
    (instance) =>
      instance.isDrill === true &&
      instance.ec2InstanceState !== "TERMINATED" &&
      instance.ec2InstanceState !== "NOT_FOUND",
  );
// #endregion port

// #region aws
type Page<Item> = { items?: Item[] | undefined; nextToken?: string | undefined };

async function all<Item>(fetchPage: (nextToken: string | undefined) => Promise<Page<Item>>) {
  const items: Item[] = [];
  let nextToken: string | undefined;
  do {
    const page = await fetchPage(nextToken);
    items.push(...(page.items ?? []));
    nextToken = page.nextToken;
  } while (nextToken !== undefined);
  return items;
}

/** The same port over the real service. Answers are checked before anything decides on them. */
export class AwsDrs implements DrsApi {
  readonly #client: DrsClient;

  constructor(client: DrsClient) {
    this.#client = client;
  }

  async sourceServers(): Promise<SourceServer[]> {
    const items = await all((nextToken) =>
      this.#client.send(new DescribeSourceServersCommand({ nextToken })),
    );
    return v.parse(v.array(sourceServerSchema), items);
  }

  async recoverySnapshots(sourceServerID: string): Promise<RecoverySnapshot[]> {
    const items = await all((nextToken) =>
      this.#client.send(
        new DescribeRecoverySnapshotsCommand({ sourceServerID, order: "DESC", nextToken }),
      ),
    );
    return v.parse(v.array(recoverySnapshotSchema), items);
  }

  async recoveryInstances(): Promise<RecoveryInstance[]> {
    const items = await all((nextToken) =>
      this.#client.send(new DescribeRecoveryInstancesCommand({ nextToken })),
    );
    return v.parse(v.array(recoveryInstanceSchema), items);
  }

  async job(jobID: string): Promise<Job | undefined> {
    const page = await this.#client.send(new DescribeJobsCommand({ filters: { jobIDs: [jobID] } }));
    const [job] = page.items ?? [];
    return job === undefined ? undefined : v.parse(jobSchema, job);
  }

  async startRecovery(input: StartRecoveryInput): Promise<Job> {
    const answer = await this.#client.send(new StartRecoveryCommand(input));
    return v.parse(jobSchema, answer.job);
  }

  async terminateRecoveryInstances(recoveryInstanceIDs: string[]): Promise<Job> {
    const answer = await this.#client.send(
      new TerminateRecoveryInstancesCommand({ recoveryInstanceIDs }),
    );
    return v.parse(jobSchema, answer.job);
  }
}
// #endregion aws
