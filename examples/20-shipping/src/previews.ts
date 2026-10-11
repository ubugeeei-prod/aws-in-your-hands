import { API_STACK_PREFIX } from "../infra/lib/config.ts";

// A preview stack is created by a workflow and forgotten by a person.
// Nothing in AWS knows that its pull request was closed.

// #region previews
export type Preview = { stack: string; pullRequest: number; ageDays: number; verdict: "recent" | "old" | "leftover" };

const PREVIEW_NAME = new RegExp(`^${API_STACK_PREFIX}Pr([1-9]\\d{0,5})$`);
const DAY_MS = 24 * 60 * 60 * 1000;

export function listPreviews(input: {
  stacks: { StackName: string; CreationTime: Date }[];
  now: Date;
  /** Open pull request numbers, when known. Without them, only age can be judged. */
  openPullRequests?: number[];
  maxAgeDays: number;
}): Preview[] {
  const previews: Preview[] = [];
  for (const stack of input.stacks) {
    const match = PREVIEW_NAME.exec(stack.StackName);
    if (match === null) {
      continue;
    }
    const pullRequest = Number(match[1]);
    const ageDays = Math.floor((input.now.getTime() - stack.CreationTime.getTime()) / DAY_MS);
    const closed = input.openPullRequests !== undefined && !input.openPullRequests.includes(pullRequest);
    previews.push({
      stack: stack.StackName,
      pullRequest,
      ageDays,
      verdict: closed ? "leftover" : ageDays > input.maxAgeDays ? "old" : "recent",
    });
  }
  return previews.toSorted((a, b) => b.ageDays - a.ageDays);
}
// #endregion previews
