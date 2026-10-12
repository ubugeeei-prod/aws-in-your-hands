import { ECSClient } from "@aws-sdk/client-ecs";
import * as v from "valibot";

import { RUNNER } from "./config.ts";
import { sweeperEnvSchema } from "./env.ts";
import { sweep } from "./sweeper.ts";

const env = v.parse(sweeperEnvSchema, process.env);
const client = new ECSClient({});

export const handler = async (): Promise<{ stopped: string[] }> => {
  const stopped = await sweep(client, env.CLUSTER, new Date(), RUNNER.maxTaskSeconds);
  console.log(JSON.stringify({ message: "sweep", stopped }));
  return { stopped };
};
