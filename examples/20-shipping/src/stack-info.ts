import {
  type CloudFormationClient,
  DescribeStacksCommand,
  ListStacksCommand,
  StackStatus,
} from "@aws-sdk/client-cloudformation";
import * as v from "valibot";

type Sender = Pick<CloudFormationClient, "send">;

const statuses = Object.values(StackStatus);

const stackSchema = v.object({
  StackName: v.string(),
  StackStatus: v.picklist(statuses),
  StackStatusReason: v.optional(v.string()),
  CreationTime: v.date(),
  LastUpdatedTime: v.optional(v.date()),
  EnableTerminationProtection: v.optional(v.boolean()),
  Outputs: v.optional(v.array(v.object({ OutputKey: v.string(), OutputValue: v.string() })), []),
});
export type StackInfo = v.InferOutput<typeof stackSchema>;

/** null when CloudFormation has no stack of that name. */
export async function describeStack(client: Sender, name: string): Promise<StackInfo | null> {
  try {
    const response = await client.send(new DescribeStacksCommand({ StackName: name }));
    return v.parse(stackSchema, response.Stacks?.[0]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "ValidationError" &&
      /does not exist/i.test(error.message)
    ) {
      return null;
    }
    throw error;
  }
}

export function requireOutput(stack: StackInfo, key: string): string {
  const output = stack.Outputs.find((candidate) => candidate.OutputKey === key);
  if (output === undefined) {
    throw new Error(`Stack ${stack.StackName} has no output named ${key}.`);
  }
  return output.OutputValue;
}

const summarySchema = v.object({
  StackName: v.string(),
  StackStatus: v.picklist(statuses),
  CreationTime: v.date(),
});
export type StackSummary = v.InferOutput<typeof summarySchema>;

/** Every stack in the Region that has not finished deleting. */
export async function listLiveStacks(client: Sender): Promise<StackSummary[]> {
  const live = statuses.filter((status) => status !== "DELETE_COMPLETE");
  const stacks: StackSummary[] = [];
  let nextToken: string | undefined;
  do {
    const page = await client.send(
      new ListStacksCommand({ StackStatusFilter: live, NextToken: nextToken }),
    );
    stacks.push(...v.parse(v.array(summarySchema), page.StackSummaries ?? []));
    nextToken = page.NextToken;
  } while (nextToken !== undefined);
  return stacks;
}
