// vp run account:whoami
import { preflight } from "./preflight.ts";

try {
  await preflight({ access: "observe", action: "identify credentials" });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof Error && error.cause instanceof Error) {
    console.error(`cause: ${error.cause.message}`);
  }
  process.exit(1);
}
