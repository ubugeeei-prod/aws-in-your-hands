import {
  type CloudFormationClient,
  DescribeStacksCommand,
  ListStacksCommand,
  StackStatus,
} from "@aws-sdk/client-cloudformation";
import { z } from "zod";

type Sender = Pick<CloudFormationClient, "send">;

const statuses = Object.values(StackStatus) as [StackStatus, ...StackStatus[]];

const stackSchema = z.object({
  StackName: z.string(),
  StackStatus: z.enum(statuses),
  StackStatusReason: z.string().optional(),
  CreationTime: z.date(),
  LastUpdatedTime: z.date().optional(),
  EnableTerminationProtection: z.boolean().optional(),
  Outputs: z.array(z.object({ OutputKey: z.string(), OutputValue: z.string() })).default([]),
});
export type StackInfo = z.infer<typeof stackSchema>;

/** null when CloudFormation has no stack of that name. */
export async function describeStack(client: Sender, name: string): Promise<StackInfo | null> {
  try {
    const response = await client.send(new DescribeStacksCommand({ StackName: name }));
    return stackSchema.parse(response.Stacks?.[0]);
  } catch (error) {
    if (error instanceof Error && error.name === "ValidationError" && /does not exist/i.test(error.message)) {
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

const summarySchema = z.object({
  StackName: z.string(),
  StackStatus: z.enum(statuses),
  CreationTime: z.date(),
});
export type StackSummary = z.infer<typeof summarySchema>;

/** Every stack in the Region that has not finished deleting. */
export async function listLiveStacks(client: Sender): Promise<StackSummary[]> {
  const live = statuses.filter((status) => status !== "DELETE_COMPLETE");
  const stacks: StackSummary[] = [];
  let nextToken: string | undefined;
  do {
    const page = await client.send(new ListStacksCommand({ StackStatusFilter: live, NextToken: nextToken }));
    stacks.push(...z.array(summarySchema).parse(page.StackSummaries ?? []));
    nextToken = page.NextToken;
  } while (nextToken !== undefined);
  return stacks;
}
