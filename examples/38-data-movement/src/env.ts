import * as v from "valibot";

const envSchema = v.object({
  TASK_ARN: v.pipe(
    v.string(),
    v.regex(/^arn:aws[a-z-]*:datasync:[a-z0-9-]+:\d{12}:task\/task-[0-9a-z]+$/),
  ),
  ALERT_TOPIC_ARN: v.pipe(v.string(), v.regex(/^arn:aws[a-z-]*:sns:[a-z0-9-]+:\d{12}:[\w-]+$/)),
});
export type Env = v.InferOutput<typeof envSchema>;

export function readEnv(env: Record<string, string | undefined>): Env {
  return v.parse(envSchema, env);
}
