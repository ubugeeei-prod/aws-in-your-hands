import {
  DescribeTasksCommand,
  type ECSClient,
  ListTasksCommand,
  StopTaskCommand,
} from "@aws-sdk/client-ecs";
import * as v from "valibot";

import { expired } from "./sweep.ts";

const listSchema = v.object({
  taskArns: v.optional(v.array(v.string()), []),
  nextToken: v.optional(v.string()),
});
const describeSchema = v.object({
  tasks: v.optional(
    v.array(v.object({ taskArn: v.string(), createdAt: v.optional(v.date()) })),
    [],
  ),
});

// #region sweep
/** Stops every task in the cluster that is older than the limit. Returns what it stopped. */
export async function sweep(
  client: Pick<ECSClient, "send">,
  cluster: string,
  now: Date,
  maxSeconds: number,
): Promise<string[]> {
  const stopped: string[] = [];
  let nextToken: string | undefined;
  do {
    // 100 is also the most DescribeTasks takes in one call.
    const page = v.parse(
      listSchema,
      await client.send(
        new ListTasksCommand({ cluster, desiredStatus: "RUNNING", maxResults: 100, nextToken }),
      ),
    );
    nextToken = page.nextToken;
    if (page.taskArns.length === 0) {
      continue;
    }
    const described = v.parse(
      describeSchema,
      await client.send(new DescribeTasksCommand({ cluster, tasks: page.taskArns })),
    );
    const running = described.tasks.flatMap((task) =>
      task.createdAt === undefined ? [] : [{ taskArn: task.taskArn, createdAt: task.createdAt }],
    );
    for (const taskArn of expired(running, now, maxSeconds)) {
      await client.send(
        new StopTaskCommand({ cluster, task: taskArn, reason: "older than the runner time limit" }),
      );
      stopped.push(taskArn);
    }
  } while (nextToken !== undefined);
  return stopped;
}
// #endregion sweep
