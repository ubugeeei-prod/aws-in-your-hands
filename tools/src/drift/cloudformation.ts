import * as v from "valibot";

import {
  type DetectionStatus,
  detectionStatusSchema,
  detectStartSchema,
  type ResourceDrift,
  resourceDriftPageSchema,
  type StackResource,
  stackResourcePageSchema,
} from "./cloudformation-schema.ts";
import {
  type DriftReport,
  GATE_EXIT,
  gateFor,
  type StackReport,
  type Status,
  type Uninspected,
} from "./report.ts";

// CloudFormation's own drift detection, turned into the report and gate that
// the cdkd check uses. IN_SYNC from CloudFormation covers only the resources it
// checked, so the stack's full resource list is read as well.

// #region api
/** The four calls this needs. The SDK adapter lives with the code that owns the client. */
export type CfnDriftApi = {
  detectStackDrift(stack: string): Promise<unknown>;
  describeDetectionStatus(detectionId: string): Promise<unknown>;
  describeResourceDrifts(stack: string, nextToken: string | undefined): Promise<unknown>;
  listStackResources(stack: string, nextToken: string | undefined): Promise<unknown>;
};

export type Polling = { intervalMs: number; maxAttempts: number };

export type Outcome =
  | { kind: "missing-stack"; message: string }
  | { kind: "error"; step: "start" | "poll" | "results" | "inventory"; message: string }
  | { kind: "timeout"; detectionId: string; attempts: number }
  | {
      kind: "finished";
      detection: DetectionStatus;
      drifts: ResourceDrift[];
      resources: StackResource[];
    };
// #endregion api

const MAX_PAGES = 200;

const messageOf = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : `${error}`;

// CloudFormation answers a missing stack with a ValidationError, not a dedicated error type.
const isMissingStack = (error: unknown): boolean =>
  error instanceof Error &&
  error.name === "ValidationError" &&
  /does not exist/i.test(error.message);

async function allPages<Item>(
  fetchPage: (
    nextToken: string | undefined,
  ) => Promise<{ items: Item[]; nextToken: string | undefined }>,
): Promise<Item[]> {
  const items: Item[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(nextToken);
    items.push(...result.items);
    if (result.nextToken === undefined) {
      return items;
    }
    nextToken = result.nextToken;
  }
  throw new Error(`more than ${MAX_PAGES} pages: refusing to report on a partial list`);
}

// #region detect
export async function detectStackDrift(input: {
  stack: string;
  api: CfnDriftApi;
  polling: Polling;
  sleep: (ms: number) => Promise<void>;
}): Promise<Outcome> {
  const { stack, api, polling, sleep } = input;
  if (!Number.isInteger(polling.maxAttempts) || polling.maxAttempts < 1 || polling.intervalMs < 0) {
    throw new Error("polling needs maxAttempts >= 1 and intervalMs >= 0");
  }

  let detectionId: string;
  try {
    detectionId = v.parse(
      detectStartSchema,
      await api.detectStackDrift(stack),
    ).StackDriftDetectionId;
  } catch (error) {
    return isMissingStack(error)
      ? { kind: "missing-stack", message: messageOf(error) }
      : { kind: "error", step: "start", message: messageOf(error) };
  }

  let detection: DetectionStatus | undefined;
  for (let attempt = 1; attempt <= polling.maxAttempts && detection === undefined; attempt += 1) {
    try {
      const status = v.parse(detectionStatusSchema, await api.describeDetectionStatus(detectionId));
      if (status.DetectionStatus !== "DETECTION_IN_PROGRESS") {
        detection = status;
      }
    } catch (error) {
      return { kind: "error", step: "poll", message: messageOf(error) };
    }
    if (detection === undefined && attempt < polling.maxAttempts) {
      await sleep(polling.intervalMs);
    }
  }
  if (detection === undefined) {
    // Results from an earlier run may still be readable. They are not this run's answer.
    return { kind: "timeout", detectionId, attempts: polling.maxAttempts };
  }

  let drifts: ResourceDrift[];
  try {
    drifts = await allPages(async (nextToken) => {
      const page = v.parse(
        resourceDriftPageSchema,
        await api.describeResourceDrifts(stack, nextToken),
      );
      return { items: page.StackResourceDrifts, nextToken: page.NextToken };
    });
  } catch (error) {
    return { kind: "error", step: "results", message: messageOf(error) };
  }

  // DescribeStackResourceDrifts lists only what was checked. This is the other half.
  let resources: StackResource[];
  try {
    resources = await allPages(async (nextToken) => {
      const page = v.parse(stackResourcePageSchema, await api.listStackResources(stack, nextToken));
      return { items: page.StackResourceSummaries, nextToken: page.NextToken };
    });
  } catch (error) {
    return { kind: "error", step: "inventory", message: messageOf(error) };
  }

  return { kind: "finished", detection, drifts, resources };
}
// #endregion detect

const NESTED_STACK = "AWS::CloudFormation::Stack";

type Gap = Uninspected & { kind: "incomplete" | "unsupported" };

const placeholder = (
  stack: string,
  region: string,
  status: Status,
  detail: string,
): StackReport => ({
  stack,
  region,
  status,
  detail,
  counts: { clean: 0, drifted: 0, deleted: 0, uninspected: 0 },
  drifted: [],
  deleted: [],
  uninspected: [],
  warnings: [],
});

// #region classify
export function reportStack(stack: string, region: string, outcome: Outcome): StackReport {
  switch (outcome.kind) {
    case "missing-stack":
      return placeholder(
        stack,
        region,
        "missing-target",
        `CloudFormation has no such stack. ${outcome.message}`,
      );
    case "error":
      return placeholder(
        stack,
        region,
        "failed",
        `The ${outcome.step} step failed. ${outcome.message}`,
      );
    case "timeout":
      return placeholder(
        stack,
        region,
        "failed",
        `Detection ${outcome.detectionId} was still in progress after ${outcome.attempts} status check(s).`,
      );
    case "finished":
      break;
  }

  const { detection, drifts, resources } = outcome;
  const startedAt = detection.Timestamp.getTime();
  const driftById = new Map(drifts.map((drift) => [drift.LogicalResourceId, drift]));
  const live = resources.filter((resource) => resource.ResourceStatus !== "DELETE_COMPLETE");

  let clean = 0;
  const drifted: StackReport["drifted"] = [];
  const deleted: StackReport["deleted"] = [];
  const gaps: Gap[] = [];

  for (const resource of live) {
    const ref = { logicalId: resource.LogicalResourceId, type: resource.ResourceType };
    const drift = driftById.get(resource.LogicalResourceId);
    if (drift === undefined) {
      gaps.push(
        resource.ResourceType === NESTED_STACK
          ? {
              ...ref,
              kind: "incomplete",
              reason: "nested stack: detection does not descend into it",
            }
          : {
              ...ref,
              kind: "unsupported",
              reason: "no drift result: the type is not supported, or it was skipped",
            },
      );
      continue;
    }
    if (drift.Timestamp.getTime() < startedAt) {
      const checked = drift.Timestamp.toISOString();
      gaps.push({
        ...ref,
        kind: "incomplete",
        reason: `stale result from ${checked}, before this detection started`,
      });
      continue;
    }
    switch (drift.StackResourceDriftStatus) {
      case "IN_SYNC":
        clean += 1;
        break;
      case "MODIFIED":
        drifted.push({
          ...ref,
          paths: (drift.PropertyDifferences ?? []).map((difference) => difference.PropertyPath),
        });
        break;
      case "DELETED":
        deleted.push(ref);
        break;
      case "UNKNOWN":
        gaps.push({
          ...ref,
          kind: "incomplete",
          reason: `could not be checked: ${drift.DriftStatusReason ?? "no reason given"}`,
        });
        break;
      case "NOT_CHECKED":
      case "UNSUPPORTED":
        gaps.push({
          ...ref,
          kind: "unsupported",
          reason: `reported as ${drift.StackResourceDriftStatus}`,
        });
        break;
    }
  }

  const liveIds = new Set(live.map((resource) => resource.LogicalResourceId));
  const warnings = drifts
    .filter((drift) => !liveIds.has(drift.LogicalResourceId))
    .map(
      (drift) =>
        `drift result for ${drift.LogicalResourceId}, which is not in the stack's resource list`,
    );

  const differs = drifted.length + deleted.length > 0;
  const stackStatus = detection.StackDriftStatus ?? "(none)";
  const reason =
    detection.DetectionStatusReason === undefined ? "" : ` ${detection.DetectionStatusReason}`;

  let status: Status;
  let detail: string;
  if (detection.DetectionStatus === "DETECTION_FAILED") {
    status = "failed";
    detail = `Detection failed for at least one resource.${reason} Partial results are listed.`;
  } else if (live.length === 0) {
    status = "incomplete";
    detail = "The stack lists no resources, so nothing was compared.";
  } else if ((detection.StackDriftStatus === "DRIFTED") !== differs) {
    // Stack status and resource results must agree. If they do not, trust neither.
    status = "failed";
    detail = `CloudFormation reports the stack as ${stackStatus}, but ${drifted.length + deleted.length} resource result(s) from this run differ.`;
  } else if (deleted.length > 0) {
    status = "deleted";
    detail = `${deleted.length} resource(s) in the stack no longer exist in AWS.`;
  } else if (drifted.length > 0) {
    status = "drifted";
    detail = `${drifted.length} resource(s) differ from the template's values.`;
  } else if (detection.StackDriftStatus !== "IN_SYNC") {
    status = "incomplete";
    detail = `CloudFormation reports the stack as ${stackStatus}.${reason}`;
  } else if (gaps.some((gap) => gap.kind === "incomplete")) {
    status = "incomplete";
    detail = `${gaps.filter((gap) => gap.kind === "incomplete").length} resource(s) could not be compared.`;
  } else if (gaps.length > 0) {
    status = "unsupported";
    detail = `${gaps.length} resource(s) were not checked by CloudFormation.`;
  } else {
    status = "clean";
    detail = `All ${clean} resource(s) were checked and match. Only properties set in the template are compared.`;
  }

  return {
    stack,
    region,
    status,
    detail,
    counts: { clean, drifted: drifted.length, deleted: deleted.length, uninspected: gaps.length },
    drifted,
    deleted,
    uninspected: gaps.map(({ logicalId, type, reason: why }) => ({ logicalId, type, reason: why })),
    warnings,
  };
}
// #endregion classify

// #region acknowledge
export type Acknowledgement = { types: string[]; exitCode: number; note: string | null };

/** A reviewed list of types nobody can check. It changes the exit code, never the status. */
export function acknowledge(stack: StackReport, types: string[]): Acknowledgement {
  const gateExit = gateFor(stack.status).exitCode;
  if (stack.status !== "unsupported") {
    return { types, exitCode: gateExit, note: null };
  }
  const unexpected = [
    ...new Set(stack.uninspected.map((r) => r.type).filter((type) => !types.includes(type))),
  ];
  if (unexpected.length > 0) {
    return {
      types,
      exitCode: gateExit,
      note: `Not compared and not acknowledged: ${unexpected.join(", ")}.`,
    };
  }
  return {
    types,
    exitCode: GATE_EXIT.clean,
    note: `${stack.uninspected.length} resource(s) of acknowledged types were not compared. That is not the same as in sync.`,
  };
}
// #endregion acknowledge

export type CfnDriftReport = Omit<DriftReport, "tool"> & {
  tool: { name: "cloudformation"; version: string };
  acknowledged: Acknowledgement;
};

export function buildCfnReport(input: {
  stack: string;
  outcome: Outcome;
  target: { accountId: string; region: string };
  executedAt: Date;
  toolVersion: string;
  acknowledgedTypes: string[];
}): CfnDriftReport {
  const stack = reportStack(input.stack, input.target.region, input.outcome);
  return {
    schemaVersion: 1,
    tool: { name: "cloudformation", version: input.toolVersion },
    target: input.target,
    requestedStacks: [input.stack],
    executedAt: input.executedAt.toISOString(),
    // There is no process to exit: 0 means the calls ran to a result, 1 that they did not.
    exitCode: input.outcome.kind === "finished" ? 0 : 1,
    status: stack.status,
    stacks: [stack],
    gate: gateFor(stack.status),
    acknowledged: acknowledge(stack, input.acknowledgedTypes),
  };
}

export function summarizeCfn(report: CfnDriftReport): string {
  const lines = [
    `drift check at ${report.executedAt}`,
    `account ${report.target.accountId}, region ${report.target.region}, CloudFormation drift detection (${report.tool.version})`,
  ];
  for (const stack of report.stacks) {
    const { clean, drifted, deleted, uninspected } = stack.counts;
    lines.push(
      `- ${stack.stack}: ${stack.status}`,
      `    ${stack.detail}`,
      `    checked and matching: ${clean}, drifted: ${drifted}, deleted: ${deleted}, not compared: ${uninspected}`,
      ...stack.drifted.map((r) => `    ~ ${r.logicalId} (${r.type}): ${r.paths.join(", ")}`),
      ...stack.deleted.map((r) => `    - ${r.logicalId} (${r.type})`),
      ...stack.uninspected.map((r) => `    ? ${r.logicalId} (${r.type}): ${r.reason}`),
      ...stack.warnings.map((warning) => `    ! ${warning}`),
    );
  }
  lines.push(
    `gate: ${report.gate.passed ? "PASS" : "FAIL"} (exit ${report.gate.exitCode}): ${report.gate.reason}`,
  );
  if (report.acknowledged.note !== null) {
    lines.push(`acknowledged: exit ${report.acknowledged.exitCode}. ${report.acknowledged.note}`);
  }
  return lines.join("\n");
}
