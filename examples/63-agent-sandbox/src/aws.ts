// The real ports: ECS, CloudWatch, Secrets Manager, and GitHub over HTTPS.

import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import {
  ConflictException,
  DescribeTasksCommand,
  ECSClient,
  ListTasksCommand,
  RunTaskCommand,
  StopTaskCommand,
} from "@aws-sdk/client-ecs";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import * as v from "valibot";

import type { FunctionEnv } from "./env.ts";
import { type GithubApp, githubAppSchema } from "./github.ts";
import type { RunningTask, Tokens } from "./limits.ts";
import type { Ports } from "./ports.ts";

const METRICS = {
  input: "InputTokenCount",
  output: "OutputTokenCount",
  cacheRead: "CacheReadInputTokenCount",
  cacheWrite: "CacheWriteInputTokenCount",
} as const;

export function awsPorts(env: FunctionEnv): Ports {
  const ecs = new ECSClient({});
  const cloudwatch = new CloudWatchClient({});
  const secrets = new SecretsManagerClient({});
  let app: GithubApp | undefined;

  return {
    now: () => new Date(),

    // #region running
    async runningTasks() {
      const tasks: RunningTask[] = [];
      let nextToken: string | undefined;
      do {
        // desiredStatus RUNNING also covers tasks that are still being provisioned.
        const page = await ecs.send(
          new ListTasksCommand({ cluster: env.CLUSTER_ARN, desiredStatus: "RUNNING", nextToken }),
        );
        const arns = page.taskArns ?? [];
        if (arns.length > 0) {
          const described = await ecs.send(
            new DescribeTasksCommand({ cluster: env.CLUSTER_ARN, tasks: arns }),
          );
          for (const task of described.tasks ?? []) {
            if (task.taskArn !== undefined) {
              tasks.push({ taskArn: task.taskArn, startedBy: task.startedBy });
            }
          }
        }
        nextToken = page.nextToken;
      } while (nextToken !== undefined);
      return tasks;
    },
    // #endregion running

    // #region tokens
    async tokensSince(since, now) {
      const period = 3600;
      const answer = await cloudwatch.send(
        new GetMetricDataCommand({
          StartTime: since,
          EndTime: now,
          // No dimension: Bedrock publishes each metric for the account as a whole as well.
          MetricDataQueries: Object.entries(METRICS).map(([id, name]) => ({
            Id: id,
            MetricStat: {
              Metric: { Namespace: "AWS/Bedrock", MetricName: name },
              Period: period,
              Stat: "Sum",
            },
          })),
        }),
      );
      const sum = (id: string): number =>
        (answer.MetricDataResults?.find((result) => result.Id === id)?.Values ?? []).reduce(
          (total, value) => total + value,
          0,
        );
      const tokens: Tokens = {
        input: sum("input"),
        output: sum("output"),
        cacheRead: sum("cacheRead"),
        cacheWrite: sum("cacheWrite"),
      };
      return tokens;
    },
    // #endregion tokens

    async githubApp() {
      if (app === undefined) {
        const secret = await secrets.send(
          new GetSecretValueCommand({ SecretId: env.GITHUB_APP_SECRET_ARN }),
        );
        app = v.parse(githubAppSchema, JSON.parse(secret.SecretString ?? "null"));
      }
      return app;
    },

    async http(request) {
      const response = await fetch(request.url, request);
      return { status: response.status, body: await response.json().catch(() => null) };
    },

    // #region run-task
    async runTask(plan, overrides) {
      try {
        const answer = await ecs.send(
          new RunTaskCommand({
            cluster: env.CLUSTER_ARN,
            taskDefinition: env.TASK_DEFINITION_ARN,
            launchType: "FARGATE",
            count: 1,
            clientToken: plan.clientToken,
            startedBy: plan.startedBy,
            enableExecuteCommand: env.EXEC === "true",
            networkConfiguration: {
              awsvpcConfiguration: {
                subnets: env.SUBNET_IDS,
                securityGroups: [env.SECURITY_GROUP_ID],
                // No public address. What the task reaches is decided by the subnet's routes.
                assignPublicIp: "DISABLED",
              },
            },
            overrides,
          }),
        );
        const taskArn = answer.tasks?.[0]?.taskArn;
        if (taskArn !== undefined) {
          return { taskArn };
        }
        const failure = answer.failures?.[0];
        return { failure: `${failure?.reason ?? "no task"} ${failure?.detail ?? ""}`.trim() };
      } catch (error) {
        if (error instanceof ConflictException) {
          return { conflict: error.resourceIds ?? [] };
        }
        return { failure: error instanceof Error ? error.name : String(error) };
      }
    },
    // #endregion run-task

    async stopTask(taskArn, reason) {
      await ecs.send(new StopTaskCommand({ cluster: env.CLUSTER_ARN, task: taskArn, reason }));
    },
  };
}
