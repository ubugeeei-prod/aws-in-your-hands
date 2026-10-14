import awscdk from "oxlint-plugin-awscdk";
import { defineConfig } from "vite-plus";

// Local tasks touch only this checkout, and a few are cached. `live` tasks read
// or change AWS and never are: a replayed "success" says nothing about the
// account as it is now.

// #region kinds
type Task = { command: string; cwd?: string; dependsOn?: string[]; cache?: boolean };

/** Local, but must run fresh every time, such as a dev server. */
const fresh = (command: string, rest: Omit<Task, "command" | "cache"> = {}): Task => ({
  command,
  ...rest,
  cache: false,
});

/** Reads or changes something outside this checkout. */
const live = (command: string, rest: Omit<Task, "command" | "cache"> = {}): Task => ({
  command,
  ...rest,
  cache: false,
});

// Settings such as AIH_AWS_ACCOUNT_ID come from .env when it exists.
const node = "node --env-file-if-exists=.env";
// #endregion kinds

// #region infra
/** The cdkd lifecycle of one CDK app, as `<name>:infra:<action>` tasks. */
function infra(name: string, appDir: string, stack: string): Record<string, Task> {
  const cdkd = (action: string) => `${node} tools/src/infra/cdkd.ts ${action} ${appDir} ${stack}`;
  const drift = (mode: string) => `${node} tools/src/drift/cli.ts ${mode} ${appDir} ${stack}`;
  return {
    // Local: writes <appDir>/cdk.out. Changes nothing in AWS.
    [`${name}:infra:synth`]: fresh(cdkd("synth")),
    // Template against cdkd's state in S3: what a deploy would change.
    [`${name}:infra:diff`]: live(cdkd("diff")),
    [`${name}:infra:deploy`]: live(cdkd("deploy")),
    [`${name}:infra:destroy`]: live(cdkd("destroy")),
    // State against live resources. Writes reports/drift/<stack>.json.
    [`${name}:infra:drift`]: live(drift("check")),
    // Remediation is never run by another task.
    [`${name}:infra:drift:revert:preview`]: live(drift("preview-revert")),
    [`${name}:infra:drift:revert`]: live(drift("revert")),
    [`${name}:infra:drift:accept`]: live(drift("accept")),
  };
}
// #endregion infra

/** Publishing built files into a bucket that an infra task created. */
function site(
  name: string,
  appDir: string,
  stack: string,
  buildDir: string,
  buildTask: string,
): Record<string, Task> {
  const run = (script: string, args = "") =>
    `${node} tools/src/site/${script}.ts ${args}`.trimEnd();
  return {
    [`${name}:publish:plan`]: live(run("publish", `${appDir} ${stack} ${buildDir} --dry-run`), {
      dependsOn: [buildTask],
    }),
    [`${name}:publish`]: live(run("publish", `${appDir} ${stack} ${buildDir}`), {
      dependsOn: [buildTask],
    }),
    [`${name}:smoke`]: live(run("smoke", `${name} ${appDir} ${stack}`)),
    [`${name}:invalidate`]: live(run("invalidate", `${appDir} ${stack}`)),
    [`${name}:unpublish`]: live(run("unpublish", `${appDir} ${stack}`)),
  };
}

// Both lists grow as chapters are added; tools/src/fragments/apply.ts edits them.
const chapterSynthTasks = [
  "hello:infra:synth",
  "spa:infra:synth",
  "api:infra:synth",
  "notes:infra:synth",
  "app:infra:synth",
  "stream:infra:synth",
  "net:infra:synth",
  "ai:infra:synth",
  "mail:infra:synth",
  "edge:infra:synth",
  "sql:infra:synth",
  "uploads:infra:synth",
  "ssr:infra:synth",
  "obs:infra:synth",
  "kv:infra:synth",
  "ship:cfn:synth",
  "ecs:infra:synth",
  "async:infra:synth",
  "ec2:infra:synth",
  "export:infra:synth",
  "sec:infra:synth",
  "recovery:infra:synth",
  "celld:infra:synth",
  "ready:infra:synth",
  "analytics:infra:synth",
  "limits:infra:synth",
  "search:infra:synth",
  "mr:infra:synth",
  "rollout:infra:synth",
  "lmi:infra:synth",
  "tune:infra:synth",
  "events:infra:synth",
  "eks:infra:synth",
  "modeling:infra:synth",
  "move:infra:synth",
  "health:infra:synth",
  "dbmig:infra:synth",
  "dr:infra:synth",
  "fwm:infra:synth:example",
  "fargate:infra:synth",
  "bedrock:infra:synth",
  "shield:infra:synth",
  "sfn:infra:synth",
  "athena:infra:synth",
  "efs:infra:synth",
  "glue:infra:synth",
  "agentcore:infra:synth",
  "grafana:infra:synth",
  "calls:infra:synth",
  "kinesis:infra:synth",
  "ecr:infra:synth",
  "ledger:infra:synth",
  "nova:infra:synth",
  "aurora:infra:synth",
  "runners:infra:synth",
  "polly:infra:synth",
  "rds:infra:synth",
  "sandbox:infra:synth",
  "sqs:infra:synth",
  "isolates:infra:synth",
  "firecracker:infra:synth",
  "nitro:infra:synth",
  "distsql:infra:synth",
  "webfn:cfn:synth",
];
const chapterCheckTasks = [
  "lint:vue",
  "typecheck:vue",
  "build:spa",
  "lint:app:web",
  "typecheck:app:web",
  "build:app:web",
  "lint:stream:web",
  "typecheck:stream:web",
  "build:stream:web",
  "lint:uploads:web",
  "typecheck:uploads:web",
  "build:uploads:web",
  "lint:ssr",
  "typecheck:ssr",
  "ssr:check:output",
  "ecs:bundle:check",
  "ec2:app:build",
  "sec:iam:lint",
  "celld:render",
  "ready:gate",
  "flags:check",
  "eks:render",
  "cloudshell:build",
  "health:replay",
  "dr:demo",
  "fargate:bundle:check",
  "composer:graph",
  "shield:origins:gate",
  "agentcore:bundle:check",
  "grafana:render",
  "lint:calls:web",
  "typecheck:calls:web",
  "build:calls:web",
  "kinesis:demo",
  "ecr:lifecycle:preview",
  "ledger:demo",
  "runners:decide",
  "firecracker:plan",
  "nitro:demo",
  "distsql:render",
];

export default defineConfig({
  run: {
    tasks: {
      // ---- checks that need nothing but this checkout -------------------
      // Format and lint. Type checking is the two tasks below.
      check: { command: "node tools/src/checks/check.ts" },
      // tools/src/checks/typecheck.ts says why this is not `vp check`.
      typecheck: fresh("node tools/src/checks/typecheck.ts"),
      // Vize gets only the Vue app (src/). The CDK code under infra/ goes through tsc above.
      "typecheck:vue": { command: "./node_modules/.bin/vize check", cwd: "examples/03-spa" },
      // Vize's linter reads the <template> blocks that oxlint does not.
      "lint:vue": {
        command: "./node_modules/.bin/vize lint src --preset essential",
        cwd: "examples/03-spa",
      },
      "test:unit": { command: "vp test run" },
      "content:check": fresh("node tools/src/checks/content.ts"),
      "links:check": fresh("node tools/src/checks/links.ts book/dist", {
        dependsOn: ["build:book"],
      }),
      "infra:synth": fresh("node -e \"console.log('all CDK apps synthesized')\"", {
        dependsOn: ["book:infra:synth", ...chapterSynthTasks],
      }),
      // Loads each synthesized Lambda bundle in plain Node. A bundle that cannot load passes every unit test.
      "bundles:check": fresh("node tools/src/checks/bundles.ts", { dependsOn: ["infra:synth"] }),
      // Everything above plus both builds. Never touches AWS.
      "check:all": fresh("node -e \"console.log('check:all finished without touching AWS')\"", {
        dependsOn: [
          "check",
          "typecheck",
          "test:unit",
          "book:generate:check",
          "content:check",
          "infra:synth",
          "bundles:check",
          "links:check",
          ...chapterCheckTasks,
        ],
      }),

      // ---- the book ----------------------------------------------------
      "dev:book": fresh("vp dev", { cwd: "book" }),
      "build:book": { command: "vp build", cwd: "book", dependsOn: ["book:generate:check"] },
      "preview:book": fresh("vp preview", { cwd: "book", dependsOn: ["build:book"] }),
      "book:generate": fresh("node tools/src/book/generate.ts"),
      "book:generate:check": fresh("node tools/src/book/generate.ts --check"),
      ...infra("book", "book/infra", "AihBookSite"),
      ...site("book", "book/infra", "AihBookSite", "book/dist", "build:book"),

      // >>> chapter 18
      // ---- chapter 18: live streaming ------------------------------------
      // The player page. Shows a notice until a channel is configured. No AWS.
      "dev:stream:web": fresh("vp dev", { cwd: "examples/18-live/web" }),
      "build:stream:web": { command: "vp build", cwd: "examples/18-live/web" },
      // Serves web/dist as it is, so the config written by stream:config survives.
      "preview:stream:web": fresh("vp preview", { cwd: "examples/18-live/web" }),
      "typecheck:stream:web": {
        command: "../node_modules/.bin/vize check",
        cwd: "examples/18-live/web",
      },
      "lint:stream:web": {
        command: "../node_modules/.bin/vize lint src --preset essential",
        cwd: "examples/18-live/web",
      },
      ...infra("stream", "examples/18-live", "AihLive"),
      // Writes the deployed playback URL into the built page.
      "stream:config": live("node --env-file-if-exists=../../.env scripts/write-config.ts", {
        cwd: "examples/18-live",
        dependsOn: ["build:stream:web"],
      }),
      // Read-only: is the channel live, and so accruing input time?
      "stream:status": live("node --env-file-if-exists=../../.env scripts/status.ts", {
        cwd: "examples/18-live",
      }),
      // Prints the encoder settings. The stream key only with --show.
      "stream:key": live("node --env-file-if-exists=../../.env scripts/key.ts", {
        cwd: "examples/18-live",
      }),
      "stream:stop": live("node --env-file-if-exists=../../.env scripts/stop.ts", {
        cwd: "examples/18-live",
      }),
      // <<< chapter 18

      // >>> chapter 11
      // ---- chapter 11: network ------------------------------------------
      // Prints the subnets, routes, and fixed monthly cost of a layout. Reads only this checkout.
      "net:plan": fresh("node scripts/plan.ts", { cwd: "examples/11-network" }),
      ...infra("net", "examples/11-network", "AihNetwork"),
      // <<< chapter 11

      // >>> chapter 17
      // ---- chapter 17: Bedrock ------------------------------------------
      // The summary API on plain Node. Replays a fixture unless .env says AI_BACKEND=bedrock.
      "dev:ai": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/17-ai",
      }),
      ...infra("ai", "examples/17-ai", "AihAi"),
      // BILLED: the next three call a real model. None of them is part of check:all.
      "ai:hello": live(
        "node --env-file-if-exists=../../.env --env-file-if-exists=.env scripts/hello.ts",
        { cwd: "examples/17-ai" },
      ),
      "ai:test:live": live(
        "node --env-file-if-exists=../../.env --env-file-if-exists=.env scripts/live.ts",
        { cwd: "examples/17-ai" },
      ),
      "ai:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/17-ai",
      }),
      "ai:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", {
        cwd: "examples/17-ai",
      }),
      // <<< chapter 17

      // >>> chapter 15
      // ---- chapter 15: email ---------------------------------------------
      // API with an in-memory outbox instead of SES. No Docker, no AWS, nothing is sent.
      "dev:mail": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/15-email",
      }),
      ...infra("mail", "examples/15-email", "AihEmail"),
      // Sends one real, billed mail through the deployed API, twice with the same ID.
      "mail:send": live("node --env-file-if-exists=../../.env scripts/send.ts", {
        cwd: "examples/15-email",
      }),
      "mail:status": live("node --env-file-if-exists=../../.env scripts/status.ts", {
        cwd: "examples/15-email",
      }),
      // Prints the DNS records to publish by hand. Changes nothing.
      "mail:dns": live("node --env-file-if-exists=../../.env scripts/dns.ts", {
        cwd: "examples/15-email",
      }),
      "mail:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", {
        cwd: "examples/15-email",
      }),
      // <<< chapter 15

      // >>> chapter 10
      // ---- chapter 10: edge ----------------------------------------------
      // The deployed function file in front of site/, under plain Node. No Docker, no AWS.
      "dev:edge": fresh("node --watch src/local/dev.ts", { cwd: "examples/10-edge" }),
      // cdkd's own CloudFront emulator, with the store backed by a local file. No AWS.
      "dev:edge:cdkd": fresh(
        "node scripts/kvs-file.ts cdk.out/kvs.local.json && ./node_modules/.bin/cdkd local start-cloudfront AihEdge/Distribution --port 8791 --origin AihEdgeDistributionOrigin162E160A1=site --kvs-file EdgeData=cdk.out/kvs.local.json",
        { cwd: "examples/10-edge" },
      ),
      ...infra("edge", "examples/10-edge", "AihEdge"),
      // The Lambda@Edge function. Its stack is in us-east-1, whatever AIH_AWS_REGION says.
      ...infra("edge:body", "examples/10-edge", "AihEdgeBodyDigest"),
      "edge:publish": live(
        `${node} tools/src/site/publish.ts examples/10-edge AihEdge examples/10-edge/site`,
      ),
      "edge:unpublish": live(`${node} tools/src/site/unpublish.ts examples/10-edge AihEdge`),
      // Compares edge-data.json with the key value store. Reads only.
      "edge:kvs:plan": live("node --env-file-if-exists=../../.env scripts/kvs-sync.ts --dry-run", {
        cwd: "examples/10-edge",
      }),
      "edge:kvs:sync": live("node --env-file-if-exists=../../.env scripts/kvs-sync.ts", {
        cwd: "examples/10-edge",
      }),
      // <<< chapter 10

      // >>> chapter 13
      // ---- chapter 13: SQL -----------------------------------------------
      // The API on PGlite (PostgreSQL inside the Node process). No Docker, no AWS.
      "dev:sql": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/13-sql",
      }),
      "sql:db:migrate:local": fresh("node --env-file-if-exists=.env scripts/local-db.ts migrate", {
        cwd: "examples/13-sql",
      }),
      "sql:db:seed:local": fresh("node --env-file-if-exists=.env scripts/local-db.ts seed", {
        cwd: "examples/13-sql",
      }),
      "sql:db:reset:local": fresh("node --env-file-if-exists=.env scripts/local-db.ts reset", {
        cwd: "examples/13-sql",
      }),
      ...infra("sql", "examples/13-sql", "AihSql"),
      // These connect to the deployed Aurora DSQL cluster as `admin` and change it.
      "sql:db:migrate": live("node --env-file-if-exists=../../.env scripts/cloud-db.ts migrate", {
        cwd: "examples/13-sql",
      }),
      "sql:db:grant": live("node --env-file-if-exists=../../.env scripts/cloud-db.ts grant", {
        cwd: "examples/13-sql",
      }),
      "sql:db:seed": live("node --env-file-if-exists=../../.env scripts/cloud-db.ts seed", {
        cwd: "examples/13-sql",
      }),
      "sql:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/13-sql",
      }),
      "sql:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", {
        cwd: "examples/13-sql",
      }),
      // <<< chapter 13

      // >>> chapter 07
      // ---- chapter 07: image uploads ------------------------------------
      // API with local sign-in and uploads kept in memory, and the SPA that uses it. No Docker, no AWS.
      "dev:uploads:api": fresh("node --watch --env-file-if-exists=.env api/src/dev.ts", {
        cwd: "examples/07-uploads",
      }),
      "dev:uploads:web": fresh("vp dev", { cwd: "examples/07-uploads/web" }),
      "build:uploads:web": { command: "vp build", cwd: "examples/07-uploads/web" },
      "typecheck:uploads:web": {
        command: "../node_modules/.bin/vize check",
        cwd: "examples/07-uploads/web",
      },
      "lint:uploads:web": {
        command: "../node_modules/.bin/vize lint src --preset essential",
        cwd: "examples/07-uploads/web",
      },
      ...infra("uploads", "examples/07-uploads", "AihUploads"),
      "uploads:publish": live(
        "node --env-file-if-exists=../../.env scripts/write-config.ts && node --env-file-if-exists=../../.env ../../tools/src/site/publish.ts . AihUploads web/dist",
        { cwd: "examples/07-uploads", dependsOn: ["build:uploads:web"] },
      ),
      "uploads:smoke:web": live(
        `${node} tools/src/site/smoke.ts spa examples/07-uploads AihUploads`,
      ),
      "uploads:smoke:api": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/07-uploads",
      }),
      // Lists objects that no record points at. Deletes them only with --delete.
      "uploads:sweep": live("node --env-file-if-exists=../../.env scripts/sweep.ts", {
        cwd: "examples/07-uploads",
      }),
      // Counts the uploaded images. Deletes them all only with --yes.
      "uploads:empty": live("node --env-file-if-exists=../../.env scripts/empty-uploads.ts", {
        cwd: "examples/07-uploads",
      }),
      "uploads:unpublish": live(
        `${node} tools/src/site/unpublish.ts examples/07-uploads AihUploads`,
      ),
      "uploads:user:create": live("node --env-file-if-exists=../../.env scripts/user.ts create", {
        cwd: "examples/07-uploads",
      }),
      "uploads:user:delete": live("node --env-file-if-exists=../../.env scripts/user.ts delete", {
        cwd: "examples/07-uploads",
      }),
      // <<< chapter 07

      // >>> chapter 09
      // ---- chapter 09: SSR and a BFF ------------------------------------
      // Nuxt's own dev server. No Docker, no AWS.
      "dev:ssr": fresh("./node_modules/.bin/nuxt dev", { cwd: "examples/09-ssr" }),
      // Never cached: the stack deploys whatever .output holds, so it has to be this checkout's build.
      "build:ssr": fresh("./node_modules/.bin/nuxt build", { cwd: "examples/09-ssr" }),
      // The same app with Nitro's streaming Lambda handler. Overwrites .output.
      "build:ssr:stream": fresh("AIH_SSR_STREAMING=true ./node_modules/.bin/nuxt build", {
        cwd: "examples/09-ssr",
      }),
      // Runs the built handler in this process and checks the headers it sends.
      "ssr:check:output": fresh("node scripts/check-output.ts", {
        cwd: "examples/09-ssr",
        dependsOn: ["build:ssr"],
      }),
      "ssr:check:output:stream": fresh("node scripts/check-output.ts", {
        cwd: "examples/09-ssr",
        dependsOn: ["build:ssr:stream"],
      }),
      "typecheck:ssr": { command: "../node_modules/.bin/vize check", cwd: "examples/09-ssr/app" },
      "lint:ssr": {
        command: "../node_modules/.bin/vize lint . --preset essential",
        cwd: "examples/09-ssr/app",
      },
      ...infra("ssr", "examples/09-ssr", "AihSsr"),
      // Replaces the synth task from infra(): this stack needs the build to exist.
      "ssr:infra:synth": fresh(`${node} tools/src/infra/cdkd.ts synth examples/09-ssr AihSsr`, {
        dependsOn: ["build:ssr"],
      }),
      "ssr:assets:plan": live(
        "node --env-file-if-exists=../../.env scripts/publish-assets.ts --dry-run",
        {
          cwd: "examples/09-ssr",
        },
      ),
      "ssr:assets:publish": live("node --env-file-if-exists=../../.env scripts/publish-assets.ts", {
        cwd: "examples/09-ssr",
      }),
      "ssr:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/09-ssr",
      }),
      "ssr:unpublish": live(`${node} tools/src/site/unpublish.ts examples/09-ssr AihSsr`),
      // <<< chapter 09

      // >>> chapter 19
      // ---- chapter 19: observability -------------------------------------
      // The notes API with spans printed to the console. No Docker, no AWS.
      "dev:obs": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/19-observability",
      }),
      // Prints the text of a Logs Insights query. Runs nothing.
      "obs:query:print": fresh("node scripts/query.ts --print", {
        cwd: "examples/19-observability",
      }),
      ...infra("obs", "examples/19-observability", "AihObservability"),
      // Creates and deletes one note through the deployed API.
      "obs:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/19-observability",
      }),
      // BILLED by the amount of log data scanned.
      "obs:query": live("node --env-file-if-exists=../../.env scripts/query.ts", {
        cwd: "examples/19-observability",
      }),
      "obs:alarms": live("node --env-file-if-exists=../../.env scripts/alarms.ts", {
        cwd: "examples/19-observability",
      }),
      // <<< chapter 19

      // >>> chapter 14
      // ---- chapter 14: key-value stores and caches ------------------------
      // The items API with counters and cache in memory, Valkey, or DynamoDB, as examples/14-kv-cache/.env says.
      "dev:kv": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/14-kv-cache",
      }),
      // Valkey and DynamoDB Local in containers. Needs a running Docker daemon.
      "kv:local:start": fresh("node --env-file-if-exists=.env scripts/local-stores.ts start", {
        cwd: "examples/14-kv-cache",
      }),
      "kv:local:stop": fresh("node --env-file-if-exists=.env scripts/local-stores.ts stop", {
        cwd: "examples/14-kv-cache",
      }),
      "kv:local:migrate": fresh("node --env-file-if-exists=.env scripts/local-stores.ts migrate", {
        cwd: "examples/14-kv-cache",
      }),
      // The store contracts against those two. A store that is not running fails the task instead of being skipped.
      "kv:test:local": fresh("node --env-file-if-exists=.env scripts/test-local.ts", {
        cwd: "examples/14-kv-cache",
      }),
      // `-c store=valkey` adds an ElastiCache Serverless cache, billed for as long as it exists.
      ...infra("kv", "examples/14-kv-cache", "AihKvCache"),
      "kv:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/14-kv-cache",
      }),
      "kv:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", {
        cwd: "examples/14-kv-cache",
      }),
      // <<< chapter 14

      // >>> chapter 20
      // ---- chapter 20: shipping ------------------------------------------
      // The same kind of CDK app through the AWS CDK CLI. Local: writes examples/20-shipping/cdk.out.
      "ship:cfn:synth": fresh(`${node} examples/20-shipping/scripts/cdk.ts synth api`),
      // Once per account and Region: creates the CDKToolkit stack (bucket, ECR repository, five IAM roles).
      "ship:cfn:bootstrap": live(`${node} examples/20-shipping/scripts/cdk.ts bootstrap api`),
      // Synthesized template against the deployed template. `-c stage=prod` selects another stack.
      "ship:cfn:diff": live(`${node} examples/20-shipping/scripts/cdk.ts diff api`),
      "ship:cfn:deploy": live(`${node} examples/20-shipping/scripts/cdk.ts deploy api`),
      "ship:cfn:destroy": live(`${node} examples/20-shipping/scripts/cdk.ts destroy api`),
      // Where the last operation stopped, and what is safe next. Reads only.
      "ship:cfn:status": live(`${node} examples/20-shipping/scripts/status.ts`),
      // CloudFormation drift detection through the same gate as cdkd's. Writes reports/drift/<stack>.json.
      "ship:cfn:drift": live(`${node} examples/20-shipping/scripts/drift.ts`),
      "ship:smoke": live(`${node} examples/20-shipping/scripts/smoke.ts`),
      // Lists preview stacks and their age. Deletes nothing.
      "ship:preview:list": live(`${node} examples/20-shipping/scripts/previews.ts`),
      // The GitHub OIDC provider and the roles workflows assume. Deployed by a person, once.
      "ship:ci:diff": live(`${node} examples/20-shipping/scripts/cdk.ts diff ci`),
      "ship:ci:deploy": live(`${node} examples/20-shipping/scripts/cdk.ts deploy ci`),
      "ship:ci:destroy": live(`${node} examples/20-shipping/scripts/cdk.ts destroy ci`),
      // <<< chapter 20

      // >>> chapter 12
      // ---- chapter 12: containers ----------------------------------------
      // The server the container runs, on plain Node. No Docker, no AWS.
      "dev:ecs": fresh("node --watch --env-file-if-exists=.env src/server.ts", {
        cwd: "examples/12-containers",
      }),
      // One file with the server and its dependencies: the only thing the image copies.
      "ecs:bundle": fresh("node scripts/bundle.ts", { cwd: "examples/12-containers" }),
      // Starts that file away from node_modules, calls it, and stops it with SIGTERM. No Docker.
      "ecs:bundle:check": fresh("node scripts/check-bundle.ts", {
        cwd: "examples/12-containers",
        dependsOn: ["ecs:bundle"],
      }),
      // The next three need a running Docker daemon, which the Nix shell does not provide.
      "ecs:image:build": fresh("node scripts/image.ts build", {
        cwd: "examples/12-containers",
        dependsOn: ["ecs:bundle"],
      }),
      "ecs:image:run": fresh("node scripts/image.ts run", { cwd: "examples/12-containers" }),
      // Logs Docker in to the stack's repository and pushes the image.
      "ecs:image:push": live("node --env-file-if-exists=../../.env scripts/image.ts push", {
        cwd: "examples/12-containers",
      }),
      // BILLED BY THE HOUR once deployed with -c imageTag=...: a load balancer and two Fargate tasks.
      ...infra("ecs", "examples/12-containers", "AihContainers"),
      // Calls /health once a second and prints which image tag answered. Reads only.
      "ecs:watch": live("node --env-file-if-exists=../../.env scripts/watch.ts", {
        cwd: "examples/12-containers",
      }),
      "ecs:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", {
        cwd: "examples/12-containers",
      }),
      // <<< chapter 12

      // >>> chapter 08
      // ---- chapter 08: work off the request ------------------------------
      // Chapter 07's API with an in-memory queue and the worker, in one process. No Docker, no AWS.
      "dev:async": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/08-async",
      }),
      ...infra("async", "examples/08-async", "AihAsync"),
      // Uploads with your credentials and waits for the worker's record.
      "async:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/08-async",
      }),
      // Depth of both queues and a look at the dead-letter queue. Moves messages back only with --redrive.
      "async:queue": live("node --env-file-if-exists=../../.env scripts/queue.ts", {
        cwd: "examples/08-async",
      }),
      "async:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", {
        cwd: "examples/08-async",
      }),
      // Lists what the scheduled function would do. Does it only with --delete.
      "async:housekeeping": live("node --env-file-if-exists=../../.env scripts/housekeeping.ts", {
        cwd: "examples/08-async",
      }),
      // Chapter 07's SPA, pointed at this chapter's stack.
      "async:publish": live(
        "node --env-file-if-exists=../../.env scripts/write-config.ts && node --env-file-if-exists=../../.env ../../tools/src/site/publish.ts . AihAsync ../07-uploads/web/dist",
        { cwd: "examples/08-async", dependsOn: ["build:uploads:web"] },
      ),
      "async:smoke:web": live(`${node} tools/src/site/smoke.ts spa examples/08-async AihAsync`),
      // Counts the uploaded images. Deletes them all only with --yes.
      "async:empty": live("node --env-file-if-exists=../../.env scripts/empty-uploads.ts", {
        cwd: "examples/08-async",
      }),
      "async:unpublish": live(`${node} tools/src/site/unpublish.ts examples/08-async AihAsync`),
      "async:user:create": live("node --env-file-if-exists=../../.env scripts/user.ts create", {
        cwd: "examples/08-async",
      }),
      "async:user:delete": live("node --env-file-if-exists=../../.env scripts/user.ts delete", {
        cwd: "examples/08-async",
      }),
      // <<< chapter 08

      // >>> chapter 23
      // ---- chapter 23: EC2 ----------------------------------------------
      // The chapter 04 API as a long-running process that keeps notes in a file. No AWS.
      "dev:ec2": fresh("node --watch --env-file-if-exists=.env src/server.ts", {
        cwd: "examples/23-ec2",
      }),
      // Where the instance would live, whether it could reach Systems Manager, and the idle cost. Reads only this checkout.
      "ec2:plan": fresh("node scripts/plan.ts", { cwd: "examples/23-ec2" }),
      // Fails when deploy/ differs from what the generators produce. `--write` rewrites it.
      "ec2:render": fresh("node scripts/render.ts", { cwd: "examples/23-ec2" }),
      "ec2:app:build": fresh("node scripts/build.ts", { cwd: "examples/23-ec2" }),
      ...infra("ec2", "examples/23-ec2", "AihEc2"),
      // Everything below goes through Systems Manager to the deployed instance.
      "ec2:status": live("node --env-file-if-exists=../../.env scripts/remote.ts status", {
        cwd: "examples/23-ec2",
      }),
      "ec2:session": live("node --env-file-if-exists=../../.env scripts/remote.ts session", {
        cwd: "examples/23-ec2",
      }),
      "ec2:forward": live("node --env-file-if-exists=../../.env scripts/remote.ts forward", {
        cwd: "examples/23-ec2",
      }),
      "ec2:app:release": live("node --env-file-if-exists=../../.env scripts/remote.ts release", {
        cwd: "examples/23-ec2",
        dependsOn: ["ec2:app:build"],
      }),
      "ec2:app:rollback": live("node --env-file-if-exists=../../.env scripts/remote.ts rollback", {
        cwd: "examples/23-ec2",
      }),
      "ec2:smoke": live("node --env-file-if-exists=../../.env scripts/remote.ts smoke", {
        cwd: "examples/23-ec2",
      }),
      "ec2:logs": live("node --env-file-if-exists=../../.env scripts/remote.ts logs", {
        cwd: "examples/23-ec2",
      }),
      "ec2:data:unmount": live("node --env-file-if-exists=../../.env scripts/remote.ts unmount", {
        cwd: "examples/23-ec2",
      }),
      "ec2:data:mount": live("node --env-file-if-exists=../../.env scripts/remote.ts mount", {
        cwd: "examples/23-ec2",
      }),
      "ec2:patch:check": live(
        "node --env-file-if-exists=../../.env scripts/remote.ts patch-check",
        {
          cwd: "examples/23-ec2",
        },
      ),
      "ec2:patch:apply": live(
        "node --env-file-if-exists=../../.env scripts/remote.ts patch-apply",
        {
          cwd: "examples/23-ec2",
        },
      ),
      "ec2:releases:empty": live(
        "node --env-file-if-exists=../../.env scripts/remote.ts releases-empty",
        {
          cwd: "examples/23-ec2",
        },
      ),
      // <<< chapter 23

      // >>> chapter 16
      // ---- chapter 16: long-running jobs ----------------------------------
      // The deployed workflow definition, run in memory with injected interruptions. No AWS.
      "export:local": fresh("node scripts/run-local.ts", { cwd: "examples/16-long-jobs" }),
      ...infra("export", "examples/16-long-jobs", "AihLongJobs"),
      // Writes sample notes to the deployed table.
      "export:seed": live("node --env-file-if-exists=../../.env scripts/seed.ts", {
        cwd: "examples/16-long-jobs",
      }),
      // Starts one export now. --wait follows it to the end.
      "export:start": live("node --env-file-if-exists=../../.env scripts/start.ts", {
        cwd: "examples/16-long-jobs",
      }),
      // Recent executions and finished exports. --redrive <arn> resumes a failed one.
      "export:status": live("node --env-file-if-exists=../../.env scripts/status.ts", {
        cwd: "examples/16-long-jobs",
      }),
      // Tails one step's log group.
      "export:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", {
        cwd: "examples/16-long-jobs",
      }),
      // Counts, and with --yes deletes, every object in the exports bucket.
      "export:empty": live("node --env-file-if-exists=../../.env scripts/empty.ts", {
        cwd: "examples/16-long-jobs",
      }),
      // Starts the durable-function variant. Needs a deploy with -c durable=true.
      "export:durable:start": live(
        "node --env-file-if-exists=../../.env scripts/durable-start.ts",
        {
          cwd: "examples/16-long-jobs",
        },
      ),
      // <<< chapter 16

      // >>> chapter 21
      // ---- chapter 21: security and governance -----------------------------
      // The token API with a made-up signing key in memory. No AWS.
      "dev:sec": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/21-security",
      }),
      // Lints IAM policies in synthesized templates. Pass other cdk.out directories to lint other chapters.
      "sec:iam:lint": fresh("node examples/21-security/scripts/iam-lint.ts", {
        dependsOn: ["sec:infra:synth"],
      }),
      // One secret is the only monthly fee. `-c cmk=on` adds a KMS key, `-c webAclArn=...` attaches a web ACL.
      ...infra("sec", "examples/21-security", "AihSecurity"),
      // The web ACL for CloudFront, in us-east-1 whatever AIH_AWS_REGION says. Billed by the month while it exists.
      ...infra("sec:waf", "examples/21-security", "AihSecurityWaf"),
      "sec:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/21-security",
      }),
      // Lists the secret's versions and staging labels. Never prints a value.
      "sec:secret:versions": live(
        "node --env-file-if-exists=../../.env scripts/rotate.ts versions",
        {
          cwd: "examples/21-security",
        },
      ),
      // Writes a new version of the signing secret. The previous one stays accepted.
      "sec:secret:rotate": live("node --env-file-if-exists=../../.env scripts/rotate.ts rotate", {
        cwd: "examples/21-security",
      }),
      // Which account-level protections are on. Reads only.
      "sec:posture": live("node --env-file-if-exists=../../.env scripts/posture.ts", {
        cwd: "examples/21-security",
      }),
      // Recent IAM changes from CloudTrail event history in us-east-1. Reads only.
      "sec:trail:iam": live("node --env-file-if-exists=../../.env scripts/trail.ts", {
        cwd: "examples/21-security",
      }),
      // <<< chapter 21

      // >>> chapter 22
      // ---- chapter 22: backup and recovery ---------------------------------
      // The whole drill in memory: an accident, two stores restored to different points, check, repair. No AWS.
      "recovery:demo": fresh("node scripts/demo.ts", { cwd: "examples/22-recovery" }),
      // The drill record under reports/drills/: new, mark, set, summary. Local files only.
      "recovery:drill": fresh("node scripts/drill.ts", { cwd: "examples/22-recovery" }),
      // `-c backup=on` and `-c replica=on` add resources that are billed for as long as they exist.
      ...infra("recovery", "examples/22-recovery", "AihRecovery"),
      // These four only read.
      "recovery:status": live("node --env-file-if-exists=../../.env scripts/recovery.ts status", {
        cwd: "examples/22-recovery",
      }),
      "recovery:verify": live("node --env-file-if-exists=../../.env scripts/recovery.ts verify", {
        cwd: "examples/22-recovery",
      }),
      "recovery:audit": live("node --env-file-if-exists=../../.env scripts/recovery.ts audit", {
        cwd: "examples/22-recovery",
      }),
      "recovery:diff": live("node --env-file-if-exists=../../.env scripts/recovery.ts diff", {
        cwd: "examples/22-recovery",
      }),
      // Everything below prints its plan and changes nothing unless --apply is given.
      "recovery:seed": live("node --env-file-if-exists=../../.env scripts/recovery.ts seed", {
        cwd: "examples/22-recovery",
      }),
      "recovery:accident": live(
        "node --env-file-if-exists=../../.env scripts/recovery.ts accident",
        {
          cwd: "examples/22-recovery",
        },
      ),
      "recovery:restore:table": live(
        "node --env-file-if-exists=../../.env scripts/recovery.ts restore-table",
        {
          cwd: "examples/22-recovery",
        },
      ),
      "recovery:restore:objects": live(
        "node --env-file-if-exists=../../.env scripts/recovery.ts restore-objects",
        {
          cwd: "examples/22-recovery",
        },
      ),
      "recovery:protect": live("node --env-file-if-exists=../../.env scripts/recovery.ts protect", {
        cwd: "examples/22-recovery",
      }),
      "recovery:repair": live("node --env-file-if-exists=../../.env scripts/recovery.ts repair", {
        cwd: "examples/22-recovery",
      }),
      "recovery:drop-table": live(
        "node --env-file-if-exists=../../.env scripts/recovery.ts drop-table",
        {
          cwd: "examples/22-recovery",
        },
      ),
      "recovery:empty": live("node --env-file-if-exists=../../.env scripts/recovery.ts empty", {
        cwd: "examples/22-recovery",
      }),
      // <<< chapter 22

      // >>> chapter 24
      // ---- chapter 24: celld ----------------------------------------------
      // The fleet a deploy would create, what celld documents about its size, and the idle cost. Reads only this checkout.
      "celld:plan": fresh("node scripts/plan.ts", { cwd: "examples/24-celld" }),
      // Fails when deploy/ differs from what the generators produce. `--write` rewrites it.
      "celld:render": fresh("node scripts/render.ts", { cwd: "examples/24-celld" }),
      // Downloads the pinned release from github.com and checks its SHA-256. No AWS. Runs nothing it downloads.
      "celld:fetch": live("node scripts/fetch.ts", { cwd: "examples/24-celld" }),
      ...infra("celld", "examples/24-celld", "AihCelld"),
      // Everything below goes through Systems Manager to the deployed nodes.
      "celld:status": live("node --env-file-if-exists=../../.env scripts/fleet.ts status", {
        cwd: "examples/24-celld",
      }),
      "celld:logs": live("node --env-file-if-exists=../../.env scripts/fleet.ts logs", {
        cwd: "examples/24-celld",
      }),
      "celld:diagnose": live("node --env-file-if-exists=../../.env scripts/fleet.ts diagnose", {
        cwd: "examples/24-celld",
      }),
      "celld:cells": live("node --env-file-if-exists=../../.env scripts/fleet.ts cells", {
        cwd: "examples/24-celld",
      }),
      "celld:smoke": live("node --env-file-if-exists=../../.env scripts/fleet.ts smoke", {
        cwd: "examples/24-celld",
      }),
      "celld:artifacts": live("node --env-file-if-exists=../../.env scripts/fleet.ts artifacts", {
        cwd: "examples/24-celld",
      }),
      "celld:install": live("node --env-file-if-exists=../../.env scripts/fleet.ts install", {
        cwd: "examples/24-celld",
      }),
      "celld:start": live("node --env-file-if-exists=../../.env scripts/fleet.ts start", {
        cwd: "examples/24-celld",
      }),
      // Runs the local celld binary against the fleet bucket with your credentials.
      "celld:app-deploy": live("node --env-file-if-exists=../../.env scripts/fleet.ts app-deploy", {
        cwd: "examples/24-celld",
      }),
      // SIGTERM to one node: it hands its cells off, then stops.
      "celld:drain": live("node --env-file-if-exists=../../.env scripts/fleet.ts drain", {
        cwd: "examples/24-celld",
      }),
      "celld:stop-all": live("node --env-file-if-exists=../../.env scripts/fleet.ts stop-all", {
        cwd: "examples/24-celld",
      }),
      // One node at a time, or a stopped fleet, depending on what the upgrade notes say for the version pair.
      "celld:rollout": live("node --env-file-if-exists=../../.env scripts/fleet.ts rollout", {
        cwd: "examples/24-celld",
      }),
      // Stops an instance without an OS shutdown. The instance and its volumes stay.
      "celld:kill": live("node --env-file-if-exists=../../.env scripts/fleet.ts kill", {
        cwd: "examples/24-celld",
      }),
      "celld:revive": live("node --env-file-if-exists=../../.env scripts/fleet.ts revive", {
        cwd: "examples/24-celld",
      }),
      "celld:loss-check": live("node --env-file-if-exists=../../.env scripts/fleet.ts loss-check", {
        cwd: "examples/24-celld",
      }),
      // Only a stopped fleet: snapshots of every data volume plus a copy of the fleet prefix.
      "celld:backup": live("node --env-file-if-exists=../../.env scripts/fleet.ts backup", {
        cwd: "examples/24-celld",
      }),
      // Lists what it would overwrite. `--yes` overwrites the fleet bucket.
      "celld:restore": live("node --env-file-if-exists=../../.env scripts/fleet.ts restore", {
        cwd: "examples/24-celld",
      }),
      // Lists what it would delete. `--yes` deletes every object.
      "celld:bucket-empty": live(
        "node --env-file-if-exists=../../.env scripts/fleet.ts bucket-empty",
        {
          cwd: "examples/24-celld",
        },
      ),
      // <<< chapter 24

      // >>> chapter 33
      // ---- chapter 33: production readiness ---------------------------------
      // The review as a list to go through. Reads only this checkout.
      "ready:review": fresh("node examples/33-production-readiness/scripts/review.ts"),
      // Local: writes examples/33-production-readiness/cdk.out. Two stacks that are read, never deployed.
      "ready:infra:synth": fresh(
        `${node} tools/src/infra/cdkd.ts synth examples/33-production-readiness AihReadyProduction`,
      ),
      // The practice twin is reported; the production twin has to pass.
      "ready:gate": fresh(
        "node examples/33-production-readiness/scripts/check.ts --gate AihReadyProduction examples/33-production-readiness/cdk.out",
        { dependsOn: ["ready:infra:synth"] },
      ),
      // Every synthesized stack of the book, as a report. The practice stacks have findings on purpose.
      "ready:check": fresh("node examples/33-production-readiness/scripts/check.ts", {
        dependsOn: ["infra:synth"],
      }),
      // <<< chapter 33

      // >>> chapter 26
      // ---- chapter 26: analytics ------------------------------------------
      // The notes API; each request becomes a record under dist/lake. No Docker, no AWS.
      "dev:analytics": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/26-analytics",
      }),
      // Prints the SQL of a query. Runs nothing.
      "analytics:query:print": fresh("node scripts/query.ts --print", {
        cwd: "examples/26-analytics",
      }),
      // Evaluates a query over the files under dist/lake with the chapter's own model. No SQL engine.
      "analytics:query:local": fresh("node --env-file-if-exists=.env scripts/query.ts --local", {
        cwd: "examples/26-analytics",
      }),
      // Sample records as gzip JSON and as Parquet: bytes per column.
      "analytics:sizes": fresh("node scripts/sizes.ts", { cwd: "examples/26-analytics" }),
      ...infra("analytics", "examples/26-analytics", "AihAnalytics"),
      // Creates, edits and deletes one note through the deployed API.
      "analytics:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/26-analytics",
      }),
      // BILLED by the bytes Athena scans, 10 MB at least per query.
      "analytics:query": live("node --env-file-if-exists=../../.env scripts/query.ts", {
        cwd: "examples/26-analytics",
      }),
      // Counts the objects in the lake bucket; with --yes, deletes them all.
      "analytics:empty": live("node --env-file-if-exists=../../.env scripts/empty-lake.ts", {
        cwd: "examples/26-analytics",
      }),
      // <<< chapter 26

      // >>> chapter 32
      // ---- chapter 32: limits -----------------------------------------------
      // The notes API behind a token bucket and a per-caller limit. No Docker, no AWS.
      "dev:limits": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/32-limits",
      }),
      // Two seeded simulations of retries against a service that refuses. Local.
      "limits:simulate": fresh("node scripts/simulate.ts", { cwd: "examples/32-limits" }),
      // Sends load to the development server. Refuses any address that is not this machine.
      "limits:load": fresh("node scripts/load.ts", { cwd: "examples/32-limits" }),
      // The quota defaults the book's chapters lean on, with where each was read. Local.
      "limits:quotas:book": fresh("node scripts/quotas.ts --book", { cwd: "examples/32-limits" }),
      // Prints the Cost Explorer command. Runs nothing.
      "limits:cost:print": fresh("node scripts/cost.ts --print", { cwd: "examples/32-limits" }),
      ...infra("limits", "examples/32-limits", "AihLimits"),
      // The quotas that apply to your account, for one service.
      "limits:quotas": live("node --env-file-if-exists=../../.env scripts/quotas.ts", {
        cwd: "examples/32-limits",
      }),
      // BILLED: USD 0.01 for every run.
      "limits:cost": live("node --env-file-if-exists=../../.env scripts/cost.ts", {
        cwd: "examples/32-limits",
      }),
      // <<< chapter 32

      // >>> chapter 27
      // ---- chapter 27: search ----------------------------------------------
      // The search API on plain Node: seed notes, a hashing embedder, a canned answer. No AWS.
      "dev:search": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/27-search",
      }),
      ...infra("search", "examples/27-search", "AihSearch"),
      // Writes the seed notes to the deployed table. The indexer then embeds them (billed).
      "search:seed": live("node --env-file-if-exists=../../.env scripts/seed.ts", {
        cwd: "examples/27-search",
      }),
      // BILLED: three embeddings and one short answer through the deployed function URL.
      "search:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/27-search",
      }),
      // Compares table and index. Changes nothing unless --apply is given (then embeddings are billed).
      "search:reindex": live("node --env-file-if-exists=../../.env scripts/reindex.ts", {
        cwd: "examples/27-search",
      }),
      "search:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", {
        cwd: "examples/27-search",
      }),
      // <<< chapter 27

      // >>> chapter 28
      // ---- chapter 28: two Regions -----------------------------------------
      // Local: two Regions as a model in memory. No AWS.
      "mr:demo": fresh("node scripts/demo.ts", { cwd: "examples/28-multi-region" }),
      // The primary stack, in Tokyo. `mr:infra:synth` writes the templates of both stacks.
      ...infra("mr", "examples/28-multi-region", "AihMultiRegion"),
      // The standby stack, in Osaka: deployed first, destroyed last.
      "mr:standby:infra:diff": live(
        `${node} tools/src/infra/cdkd.ts diff examples/28-multi-region AihMultiRegionStandby`,
      ),
      "mr:standby:infra:deploy": live(
        `${node} tools/src/infra/cdkd.ts deploy examples/28-multi-region AihMultiRegionStandby`,
      ),
      "mr:standby:infra:destroy": live(
        `${node} tools/src/infra/cdkd.ts destroy examples/28-multi-region AihMultiRegionStandby`,
      ),
      // Reads both Regions: replica status, replication rules, the health endpoints.
      "mr:status": live("node --env-file-if-exists=../../.env scripts/mr.ts status", {
        cwd: "examples/28-multi-region",
      }),
      // With --apply: edits one note in both Regions at once and reports which edit survived.
      "mr:conflict": live("node --env-file-if-exists=../../.env scripts/mr.ts conflict", {
        cwd: "examples/28-multi-region",
      }),
      // Counts the object versions in both buckets; --apply deletes them.
      "mr:empty": live("node --env-file-if-exists=../../.env scripts/mr.ts empty", {
        cwd: "examples/28-multi-region",
      }),
      // <<< chapter 28

      // >>> chapter 31
      // ---- chapter 31: progressive delivery --------------------------------
      // The notes API with flags read from flags/flags.json on every request. Local.
      "dev:rollout": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/31-progressive-delivery",
      }),
      // The steps of a shift, and how much a small share of requests sees. Arithmetic only.
      "rollout:plan": fresh("node scripts/rollout.ts plan", {
        cwd: "examples/31-progressive-delivery",
      }),
      // Reads flags/flags.json the way the application would. Local.
      "flags:check": fresh("node scripts/flags.ts check", {
        cwd: "examples/31-progressive-delivery",
      }),
      ...infra("rollout", "examples/31-progressive-delivery", "AihProgressive"),
      // Reads the alias and the two alarms.
      "rollout:status": live("node --env-file-if-exists=../../.env scripts/rollout.ts status", {
        cwd: "examples/31-progressive-delivery",
      }),
      // Sends GET /health and counts which version answered. Creates nothing.
      "rollout:probe": live("node --env-file-if-exists=../../.env scripts/probe.ts", {
        cwd: "examples/31-progressive-delivery",
      }),
      // Everything below prints its plan and changes nothing unless --apply is given.
      "rollout:start": live("node --env-file-if-exists=../../.env scripts/rollout.ts start", {
        cwd: "examples/31-progressive-delivery",
      }),
      "rollout:rollback": live("node --env-file-if-exists=../../.env scripts/rollout.ts rollback", {
        cwd: "examples/31-progressive-delivery",
      }),
      "flags:status": live("node --env-file-if-exists=../../.env scripts/flags.ts status", {
        cwd: "examples/31-progressive-delivery",
      }),
      "flags:deploy": live("node --env-file-if-exists=../../.env scripts/flags.ts deploy", {
        cwd: "examples/31-progressive-delivery",
      }),
      "flags:stop": live("node --env-file-if-exists=../../.env scripts/flags.ts stop", {
        cwd: "examples/31-progressive-delivery",
      }),
      "flags:clear": live("node --env-file-if-exists=../../.env scripts/flags.ts clear", {
        cwd: "examples/31-progressive-delivery",
      }),
      // <<< chapter 31

      // >>> chapter 35
      // ---- chapter 35: Lambda Managed Instances --------------------------
      // The chapter 04 API in one Node.js process, which answers many requests at once. No AWS.
      "dev:lmi": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/35-lambda-managed-instances",
      }),
      // What the stack would run, whether its logs could leave the VPC, the idle cost, and the break-even. Reads only this checkout.
      "lmi:plan": fresh("node scripts/plan.ts", { cwd: "examples/35-lambda-managed-instances" }),
      ...infra("lmi", "examples/35-lambda-managed-instances", "AihManagedInstances"),
      "lmi:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/35-lambda-managed-instances",
      }),
      // <<< chapter 35

      // >>> chapter 29
      // ---- chapter 29: lambda tuning ------------------------------------
      // Bundles the function five ways and times a fresh Node.js process importing each. No AWS.
      "tune:bundle": fresh("node scripts/bundle.ts", { cwd: "examples/29-lambda-tuning" }),
      // The timeout chain and what memory and provisioned concurrency cost. Reads only this checkout.
      "tune:plan": fresh("node scripts/plan.ts", { cwd: "examples/29-lambda-tuning" }),
      // Summarizes the REPORT lines copied from the Lambda documentation. No AWS.
      "tune:report:sample": fresh("node scripts/report.ts --file fixtures/report-lines.txt", {
        cwd: "examples/29-lambda-tuning",
      }),
      ...infra("tune", "examples/29-lambda-tuning", "AihLambdaTuning"),
      // Creates one note, reads it a number of times, deletes it.
      "tune:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/29-lambda-tuning",
      }),
      // Reads the function's log group and summarizes the invocation reports.
      "tune:report": live("node --env-file-if-exists=../../.env scripts/report.ts", {
        cwd: "examples/29-lambda-tuning",
      }),
      // <<< chapter 29

      // >>> chapter 25
      // ---- chapter 25: events --------------------------------------------
      // A morning of changes through the in-memory bus, a duplicate, and a replay. No AWS.
      "events:demo": fresh("node scripts/demo.ts", { cwd: "examples/25-events" }),
      ...infra("events", "examples/25-events", "AihEvents"),
      // Writes a note and a rejected upload with your credentials and waits for the consumers to hear of them.
      "events:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/25-events",
      }),
      // The archive, the queues, and a look at the dead-letter queue.
      "events:status": live("node --env-file-if-exists=../../.env scripts/status.ts", {
        cwd: "examples/25-events",
      }),
      // Prints what a replay would cover. Starts it only with --yes.
      "events:replay": live("node --env-file-if-exists=../../.env scripts/replay.ts", {
        cwd: "examples/25-events",
      }),
      // Counts the uploaded images. Deletes them all only with --yes.
      "events:empty": live("node --env-file-if-exists=../../.env scripts/empty-uploads.ts", {
        cwd: "examples/25-events",
      }),
      // <<< chapter 25

      // >>> chapter 34
      // ---- chapter 34: Kubernetes on EKS ---------------------------------
      // Fails when k8s/ is not what the generators produce; --write rewrites it. No cluster, no AWS.
      "eks:render": fresh("node scripts/render.ts", { cwd: "examples/34-eks" }),
      // BILLED BY THE HOUR once deployed: the EKS control plane, then nodes and a load balancer.
      ...infra("eks", "examples/34-eks", "AihEks"),
      // Prints the manifests with the stacks' outputs filled in, for `kubectl apply -f -`. Reads only.
      "eks:manifests": live("node --env-file-if-exists=../../.env scripts/manifests.ts", {
        cwd: "examples/34-eks",
      }),
      // <<< chapter 34

      // >>> chapter 30
      // ---- chapter 30: data modeling ---------------------------------------
      // Every access pattern on the in-memory model, with what each one sent and cost. No AWS.
      "modeling:demo": fresh("node scripts/demo.ts", { cwd: "examples/30-data-modeling" }),
      // The table, its index and its stream in DynamoDB Local. Refuses any endpoint that is not on this machine.
      "modeling:db:migrate:local": fresh(
        "node --env-file-if-exists=.env scripts/local-db.ts migrate",
        {
          cwd: "examples/30-data-modeling",
        },
      ),
      "modeling:db:reset:local": fresh("node --env-file-if-exists=.env scripts/local-db.ts reset", {
        cwd: "examples/30-data-modeling",
      }),
      "modeling:test:local": fresh("node --env-file-if-exists=.env scripts/test-local.ts", {
        cwd: "examples/30-data-modeling",
      }),
      ...infra("modeling", "examples/30-data-modeling", "AihModeling"),
      // Writes one note, waits for the index and the stream consumer, removes it.
      "modeling:smoke": live("node --env-file-if-exists=../../.env scripts/modeling.ts smoke", {
        cwd: "examples/30-data-modeling",
      }),
      // These print their plan and change nothing unless --apply is given.
      "modeling:backfill": live(
        "node --env-file-if-exists=../../.env scripts/modeling.ts backfill",
        {
          cwd: "examples/30-data-modeling",
        },
      ),
      "modeling:verify": live("node --env-file-if-exists=../../.env scripts/modeling.ts verify", {
        cwd: "examples/30-data-modeling",
      }),
      "modeling:remove-legacy": live(
        "node --env-file-if-exists=../../.env scripts/modeling.ts remove-legacy",
        {
          cwd: "examples/30-data-modeling",
        },
      ),
      // <<< chapter 30

      // >>> chapter 38
      // ---- chapter 38: data movement ---------------------------------------
      // Local: four executions of the archive copy against two buckets in memory. No AWS.
      "move:demo": fresh("node scripts/demo.ts", { cwd: "examples/38-data-movement" }),
      // The source stack, in Tokyo. `move:infra:synth` writes the templates of both stacks.
      ...infra("move", "examples/38-data-movement", "AihDataMovement"),
      // The archive stack, in Osaka. `-c sourceLocation=<arn>` adds the scheduled task; each execution reads both buckets.
      "move:archive:infra:diff": live(
        `${node} tools/src/infra/cdkd.ts diff examples/38-data-movement AihDataMovementArchive`,
      ),
      "move:archive:infra:deploy": live(
        `${node} tools/src/infra/cdkd.ts deploy examples/38-data-movement AihDataMovementArchive`,
      ),
      "move:archive:infra:destroy": live(
        `${node} tools/src/infra/cdkd.ts destroy examples/38-data-movement AihDataMovementArchive`,
      ),
      // Counts the object versions in both buckets; --yes deletes them.
      "move:empty": live("node --env-file-if-exists=../../.env scripts/empty.ts", {
        cwd: "examples/38-data-movement",
      }),
      // <<< chapter 38

      // >>> chapter 37
      // ---- chapter 37: CloudShell --------------------------------------------
      // One file for CloudShell: dist/aih-cloudshell.mjs. Local; nothing is uploaded.
      "cloudshell:build": fresh("node scripts/build.ts", { cwd: "examples/37-cloudshell" }),
      // The built file against a fake `aws`: fixture answers, no AWS.
      "cloudshell:demo": fresh("node scripts/demo.ts", { cwd: "examples/37-cloudshell" }),
      // Prints an IAM policy document: use, use-no-files, deny, or vpc-only. Creates nothing.
      "cloudshell:policy": fresh("node scripts/policy.ts", { cwd: "examples/37-cloudshell" }),
      // <<< chapter 37

      // >>> chapter 44
      // ---- chapter 44: AWS Health ------------------------------------------
      // Sends the fixtures through the function's own code and prints what it would publish. No AWS.
      "health:replay": fresh("node scripts/replay.ts", { cwd: "examples/44-health" }),
      // The Region the book's stacks run in.
      ...infra("health", "examples/44-health", "AihHealth"),
      // us-east-1: global events arrive only there.
      ...infra("health:global", "examples/44-health", "AihHealthGlobal"),
      // <<< chapter 44

      // >>> chapter 39
      // ---- chapter 39: database migration ----------------------------------
      // The cutover on two in-memory databases, with the chapter's model in place of AWS DMS. No AWS.
      "dbmig:demo": fresh("node scripts/demo.ts", { cwd: "examples/39-database-migration" }),
      // Deployed, the stack bills for two secrets. A started replication bills by the hour.
      ...infra("dbmig", "examples/39-database-migration", "AihDatabaseMigration"),
      // These connect to both databases (SOURCE_DATABASE_URL, TARGET_DATABASE_URL) and only read.
      "dbmig:preflight": live("node --env-file-if-exists=../../.env scripts/db.ts preflight", {
        cwd: "examples/39-database-migration",
      }),
      "dbmig:verify": live("node --env-file-if-exists=../../.env scripts/db.ts verify", {
        cwd: "examples/39-database-migration",
      }),
      // Prints the plan. Moves the target's sequences only with --apply.
      "dbmig:sequences": live("node --env-file-if-exists=../../.env scripts/db.ts sequences", {
        cwd: "examples/39-database-migration",
      }),
      // <<< chapter 39

      // >>> chapter 40
      // ---- chapter 40: disaster recovery ----------------------------------
      // Source checks, network paths, idle cost, and the setup commands. Reads only this checkout.
      "dr:plan": fresh("node scripts/plan.ts", { cwd: "examples/40-disaster-recovery" }),
      // A failover and a failback between two sites in memory. No AWS.
      "dr:demo": fresh("node scripts/demo.ts", { cwd: "examples/40-disaster-recovery" }),
      // The private layout adds two interface endpoints, billed by the hour.
      ...infra("dr", "examples/40-disaster-recovery", "AihDr"),
      // These read the DRS API.
      "dr:status": live("node --env-file-if-exists=../../.env scripts/dr.ts status", {
        cwd: "examples/40-disaster-recovery",
      }),
      "dr:job": live("node --env-file-if-exists=../../.env scripts/dr.ts job", {
        cwd: "examples/40-disaster-recovery",
      }),
      "dr:billed": live("node --env-file-if-exists=../../.env scripts/dr.ts billed", {
        cwd: "examples/40-disaster-recovery",
      }),
      // These print their plan and change nothing unless --apply is given.
      "dr:drill": live("node --env-file-if-exists=../../.env scripts/dr.ts drill", {
        cwd: "examples/40-disaster-recovery",
      }),
      "dr:terminate": live("node --env-file-if-exists=../../.env scripts/dr.ts terminate", {
        cwd: "examples/40-disaster-recovery",
      }),
      // <<< chapter 40

      // >>> chapter 42
      // ---- chapter 42: Firewall Manager -----------------------------------
      // The month the two policies would cost a small organization, from data/pricing. No AWS.
      "fwm:cost": fresh("node scripts/cost.ts", { cwd: "examples/42-firewall-manager" }),
      // This chapter's audit rule over the security groups in every synthesized template. Reads files only.
      "fwm:audit:templates": fresh("node examples/42-firewall-manager/scripts/audit-templates.ts"),
      // For the Firewall Manager administrator account only. Each policy is USD 100 a month.
      // Every task below needs `-c adminAccountId=<12 digits> -c orgUnitIds=<ou-...>`: there is no default.
      ...infra("fwm", "examples/42-firewall-manager", "AihFirewallManager"),
      // The AWS WAF policy for CloudFront, in us-east-1 whatever AIH_AWS_REGION says.
      ...infra("fwm:edge", "examples/42-firewall-manager", "AihFirewallManagerEdge"),
      // Synth with the example IDs of AWS's documentation, so that check:all has a template to read.
      "fwm:infra:synth:example": fresh(
        `${node} tools/src/infra/cdkd.ts synth examples/42-firewall-manager AihFirewallManager -c adminAccountId=111122223333 -c orgUnitIds=ou-ex42-workload1`,
      ),
      // <<< chapter 42

      // >>> chapter 41
      // ---- chapter 41: Fargate --------------------------------------------
      // The cheapest task size for a measured peak, from the documented table. Reads only this checkout.
      "fargate:size": fresh("node scripts/size.ts", { cwd: "examples/41-fargate" }),
      // This chapter's model of target tracking over a hand-written load curve. Not Application Auto Scaling.
      "fargate:simulate": fresh("node scripts/simulate.ts", { cwd: "examples/41-fargate" }),
      // The nightly job on plain Node. Ctrl-C interrupts it the way a Spot notice would.
      "dev:fargate:job": fresh("node src/job-main.ts", { cwd: "examples/41-fargate" }),
      // Chapter 12's server and this chapter's job, one file each: all the image copies.
      "fargate:bundle": fresh("node scripts/bundle.ts", { cwd: "examples/41-fargate" }),
      "fargate:bundle:check": fresh("node scripts/check-bundle.ts", {
        cwd: "examples/41-fargate",
        dependsOn: ["fargate:bundle"],
      }),
      // Needs a running Docker daemon, which the Nix shell does not provide.
      "fargate:image:build": fresh("node scripts/image.ts build", {
        cwd: "examples/41-fargate",
        dependsOn: ["fargate:bundle"],
      }),
      "fargate:image:push": live("node --env-file-if-exists=../../.env scripts/image.ts push", {
        cwd: "examples/41-fargate",
      }),
      // BILLED BY THE HOUR once deployed with -c imageTag=...: a load balancer and two Fargate tasks.
      ...infra("fargate", "examples/41-fargate", "AihFargate"),
      // Starts the job once, outside its schedule. Starts a billed task.
      "fargate:job:run": live("node --env-file-if-exists=../../.env scripts/task.ts run", {
        cwd: "examples/41-fargate",
      }),
      // A shell in a running task. Only works on a stack deployed with -c exec=true.
      "fargate:exec": live("node --env-file-if-exists=../../.env scripts/task.ts exec", {
        cwd: "examples/41-fargate",
      }),
      // <<< chapter 41

      // >>> chapter 45
      // ---- chapter 45: Infrastructure Composer -------------------------------
      // A synthesized template as a graph, in text. Files only. With no argument: the fixture.
      //   vp run composer:graph ../20-shipping AihShipCi [--figure] [--against other.template.json]
      "composer:graph": fresh("node scripts/graph.ts", {
        cwd: "examples/45-infrastructure-composer",
      }),
      "composer:graph:hello": fresh("node scripts/graph.ts ../02-toolchain AihHello", {
        cwd: "examples/45-infrastructure-composer",
        dependsOn: ["hello:infra:synth"],
      }),
      "composer:graph:ship": fresh("node scripts/graph.ts ../20-shipping AihShipApi", {
        cwd: "examples/45-infrastructure-composer",
        dependsOn: ["ship:cfn:synth"],
      }),
      // <<< chapter 45

      // >>> chapter 36
      // ---- chapter 36: Bedrock after the first call ----------------------
      // The assistant API on plain Node. Plays a transcript unless .env says AI_BACKEND=bedrock.
      "dev:bedrock": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/36-bedrock",
      }),
      // Local: the regression suite against the scripted model, and the shape of a batch input file.
      "bedrock:eval": fresh("node scripts/eval.ts", { cwd: "examples/36-bedrock" }),
      "bedrock:batch:plan": fresh("node scripts/batch-plan.ts", { cwd: "examples/36-bedrock" }),
      ...infra("bedrock", "examples/36-bedrock", "AihBedrock"),
      // BILLED: the next two call a real model. Neither is part of check:all.
      "bedrock:eval:live": live(
        "node --env-file-if-exists=../../.env --env-file-if-exists=.env scripts/eval.ts --live",
        { cwd: "examples/36-bedrock" },
      ),
      "bedrock:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/36-bedrock",
      }),
      "bedrock:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", {
        cwd: "examples/36-bedrock",
      }),
      // <<< chapter 36

      // >>> chapter 46
      // ---- chapter 46: Shield ----------------------------------------------
      // Seeded floods against the rate rule, the cache and the brake, priced with data/pricing. Local.
      "shield:flood": fresh("node scripts/flood.ts", { cwd: "examples/46-shield" }),
      // Every function URL, load balancer and API in the book's synthesized stacks: reachable without CloudFront?
      "shield:origins": fresh("node examples/46-shield/scripts/origins.ts", {
        dependsOn: ["infra:synth"],
      }),
      // This chapter's own stack has to come out closed.
      "shield:origins:gate": fresh(
        "node examples/46-shield/scripts/origins.ts --gate AihShield examples/46-shield/cdk.out",
        { dependsOn: ["shield:infra:synth"] },
      ),
      ...infra("shield", "examples/46-shield", "AihShield"),
      // In us-east-1 whatever AIH_AWS_REGION says. BILLED by the month once deployed: a web ACL and a rule.
      // `-c shieldAdvanced=on` adds a protection, for an account already subscribed (USD 3,000 a month, for a year).
      ...infra("shield:edge", "examples/46-shield", "AihShieldEdge"),
      // <<< chapter 46

      // >>> chapter 47
      // ---- chapter 47: Step Functions in depth -------------------------------
      // The import's definition, walked in memory with injected failures. No AWS.
      "sfn:local": fresh("node scripts/run-local.ts", { cwd: "examples/47-step-functions" }),
      ...infra("sfn", "examples/47-step-functions", "AihStepFunctions"),
      // Uploads a small file and starts one import.
      "sfn:start": live("node --env-file-if-exists=../../.env scripts/start.ts", {
        cwd: "examples/47-step-functions",
      }),
      // Plays the scanner: answers one waiting task token.
      "sfn:callback": live("node --env-file-if-exists=../../.env scripts/callback.ts", {
        cwd: "examples/47-step-functions",
      }),
      // Recent imports and where each stopped. --redrive <arn> resumes a failed one.
      "sfn:status": live("node --env-file-if-exists=../../.env scripts/status.ts", {
        cwd: "examples/47-step-functions",
      }),
      // Runs the Express workflow synchronously.
      "sfn:digest": live("node --env-file-if-exists=../../.env scripts/digest.ts", {
        cwd: "examples/47-step-functions",
      }),
      // Asks the TestState API, with mocks, what single states do. Needs credentials, no stack.
      "sfn:test-state": live("node --env-file-if-exists=../../.env scripts/test-state.ts", {
        cwd: "examples/47-step-functions",
      }),
      // Counts, and with --yes deletes, every object in the files bucket.
      "sfn:empty": live("node --env-file-if-exists=../../.env scripts/empty.ts", {
        cwd: "examples/47-step-functions",
      }),
      // <<< chapter 47

      // >>> chapter 49
      // ---- chapter 49: athena ---------------------------------------------
      // Prints one of the chapter's statements and its parameters. Runs nothing.
      "athena:sql": fresh("node scripts/query.ts", { cwd: "examples/49-athena" }),
      // Prints the CREATE TABLE statement AWS documents for a log, filled in. Runs nothing.
      "athena:logs:ddl": fresh("node scripts/log-table.ts", { cwd: "examples/49-athena" }),
      ...infra("athena", "examples/49-athena", "AihAthena"),
      // BILLED by the bytes Athena scans, 10 MB at least per query. Writes to S3.
      "athena:run": live("node --env-file-if-exists=../../.env scripts/query.ts --run", {
        cwd: "examples/49-athena",
      }),
      // Counts the objects in the output bucket; with --yes, deletes them all.
      "athena:empty": live("node --env-file-if-exists=../../.env scripts/empty-output.ts", {
        cwd: "examples/49-athena",
      }),
      // <<< chapter 49

      // >>> chapter 48
      // ---- chapter 48: the SDK ----------------------------------------------
      // What the installed SDK does when nothing is configured, read from the SDK itself. Local.
      "sdk:defaults": fresh("node scripts/defaults.ts", { cwd: "examples/48-sdk" }),
      // One throttled call against a local endpoint, with a log line per attempt. Local.
      "sdk:tour": fresh("node scripts/tour.ts", { cwd: "examples/48-sdk" }),
      // Where this machine's default credentials come from. Some providers call AWS to refresh.
      "sdk:credentials": live("node scripts/credentials.ts", { cwd: "examples/48-sdk" }),
      // <<< chapter 48

      // >>> chapter 53
      // ---- chapter 53: EFS ----------------------------------------------
      // The chapter 04 API over a directory. Start it twice (PORT=8788) to have two writers. No AWS.
      "dev:efs": fresh("node --watch src/dev.ts", { cwd: "examples/53-efs" }),
      ...infra("efs", "examples/53-efs", "AihEfs"),
      // <<< chapter 53

      // >>> chapter 43
      // ---- chapter 43: glue ------------------------------------------------
      // What the job has to write for the sample raw files. No Spark, no AWS.
      "glue:spec": fresh("node scripts/spec.ts", { cwd: "examples/43-glue" }),
      // Copies the columns and the data quality rules from TypeScript into glue/curate.py.
      "glue:contract": fresh("node scripts/contract.ts", { cwd: "examples/43-glue" }),
      ...infra("glue", "examples/43-glue", "AihGlue"),
      // Uploads the sample raw files to the stack's bucket.
      "glue:seed": live("node --env-file-if-exists=../../.env scripts/seed.ts", {
        cwd: "examples/43-glue",
      }),
      // BILLED per DPU-second, for one minute at least. Replaces the days' curated folders.
      "glue:run": live("node --env-file-if-exists=../../.env scripts/run.ts", {
        cwd: "examples/43-glue",
      }),
      // Downloads what the job wrote for the sample days and compares it with the specification.
      "glue:verify": live("node --env-file-if-exists=../../.env scripts/verify.ts", {
        cwd: "examples/43-glue",
      }),
      // Counts the objects in the bucket; with --yes, deletes them all.
      "glue:empty": live("node --env-file-if-exists=../../.env scripts/empty.ts", {
        cwd: "examples/43-glue",
      }),
      // <<< chapter 43

      // >>> chapter 50
      // ---- chapter 50: AgentCore -------------------------------------------
      // The agent behind AgentCore Runtime's HTTP contract, on this machine, playing chapter 36's transcripts. No AWS.
      "dev:agentcore": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/50-agentcore",
      }),
      // Bundles the agent as the stack does, starts the one file, and asks it what needs no AWS call.
      "agentcore:bundle:check": fresh("node scripts/check-bundle.ts", {
        cwd: "examples/50-agentcore",
      }),
      ...infra("agentcore", "examples/50-agentcore", "AihAgentCore"),
      // BILLED: two questions to the deployed runtime. Needs AIH_ACCESS_TOKEN.
      "agentcore:invoke": live("node --env-file-if-exists=../../.env scripts/invoke.ts", {
        cwd: "examples/50-agentcore",
      }),
      // <<< chapter 50

      // >>> chapter 55
      // ---- chapter 55: Amazon Managed Grafana ------------------------------
      // Prints the Grafana dashboard generated from src/signals.ts. Local: reads and sends nothing.
      "grafana:render": fresh("node scripts/render.ts", { cwd: "examples/55-grafana" }),
      // By default a role only. With `-c authentication=AWS_SSO` (or SAML) a workspace, BILLED by the month.
      ...infra("grafana", "examples/55-grafana", "AihGrafana"),
      // CHANGES AWS: mints a 15-minute token, saves the data source and the dashboard, deletes the token.
      "grafana:push": live("node --env-file-if-exists=../../.env scripts/push.ts", {
        cwd: "examples/55-grafana",
      }),
      // <<< chapter 55

      // >>> chapter 51
      // ---- chapter 51: calls with the Chime SDK -------------------------
      // The notes API with rooms: local sign-in and a model of the meetings API. No Docker, no AWS, no media.
      "dev:calls:api": fresh("node --watch --env-file-if-exists=.env api/src/dev.ts", {
        cwd: "examples/51-chime-sdk",
      }),
      "dev:calls:web": fresh("vp dev", { cwd: "examples/51-chime-sdk/web" }),
      "build:calls:web": { command: "vp build", cwd: "examples/51-chime-sdk/web" },
      // Serves web/dist as it is, so the config written by calls:config survives.
      "preview:calls:web": fresh("vp preview", { cwd: "examples/51-chime-sdk/web" }),
      "typecheck:calls:web": {
        command: "../node_modules/.bin/vize check",
        cwd: "examples/51-chime-sdk/web",
      },
      "lint:calls:web": {
        command: "../node_modules/.bin/vize lint src --preset essential",
        cwd: "examples/51-chime-sdk/web",
      },
      ...infra("calls", "examples/51-chime-sdk", "AihCalls"),
      // Points the built page at the deployed API and user pool, with media on.
      "calls:config": live("node --env-file-if-exists=../../.env scripts/write-config.ts", {
        cwd: "examples/51-chime-sdk",
        dependsOn: ["build:calls:web"],
      }),
      "calls:user:create": live("node --env-file-if-exists=../../.env scripts/user.ts create", {
        cwd: "examples/51-chime-sdk",
      }),
      "calls:user:delete": live("node --env-file-if-exists=../../.env scripts/user.ts delete", {
        cwd: "examples/51-chime-sdk",
      }),
      // BILLED per connected attendee until a meeting ends. Lists the meetings on record; ends them only with --yes.
      "calls:end": live("node --env-file-if-exists=../../.env scripts/end-meetings.ts", {
        cwd: "examples/51-chime-sdk",
      }),
      // <<< chapter 51

      // >>> chapter 54
      // ---- chapter 54: Kinesis Data Streams ---------------------------------
      // The chapter's failures through the in-memory stream and the model of the event source mapping. No AWS.
      "kinesis:demo": fresh("node scripts/demo.ts", { cwd: "examples/54-kinesis" }),
      ...infra("kinesis", "examples/54-kinesis", "AihKinesis"),
      // Writes revisions of one note to the deployed stream with your credentials.
      "kinesis:put": live("node --env-file-if-exists=../../.env scripts/put.ts", {
        cwd: "examples/54-kinesis",
      }),
      // What the function derived for one note.
      "kinesis:history": live("node --env-file-if-exists=../../.env scripts/history.ts", {
        cwd: "examples/54-kinesis",
      }),
      // Reads the stream from its oldest record on your machine and builds the histories in memory.
      "kinesis:replay": live("node --env-file-if-exists=../../.env scripts/replay.ts", {
        cwd: "examples/54-kinesis",
      }),
      // The batches Lambda gave up on, read back from the stream. Deletes the messages only with --delete.
      "kinesis:failures": live("node --env-file-if-exists=../../.env scripts/failures.ts", {
        cwd: "examples/54-kinesis",
      }),
      // <<< chapter 54

      // >>> chapter 52
      // ---- chapter 52: ECR in depth ----------------------------------------
      // The chapter's lifecycle evaluator over a saved image list. No AWS, and not ECR's own preview.
      "ecr:lifecycle:preview": fresh("node scripts/lifecycle-preview.ts", {
        cwd: "examples/52-ecr",
      }),
      ...infra("ecr", "examples/52-ecr", "AihEcr"),
      // Asks ECR to preview the same policy on the real repository and compares. Deletes nothing.
      "ecr:lifecycle:compare": live(
        "node --env-file-if-exists=../../.env scripts/lifecycle-compare.ts",
        { cwd: "examples/52-ecr" },
      ),
      // Waits for one image's scan and fails unless it may be deployed.
      "ecr:scan:gate": live("node --env-file-if-exists=../../.env scripts/scan-gate.ts", {
        cwd: "examples/52-ecr",
      }),
      // <<< chapter 52

      // >>> chapter 58
      // ---- chapter 58: ledger ---------------------------------------------------
      // Appends, locks a digest, rewrites history, and audits, on the in-memory models. No AWS.
      "ledger:demo": fresh("node scripts/demo.ts", { cwd: "examples/58-ledger" }),
      // The table in DynamoDB Local. Refuses any endpoint that is not on this machine.
      "ledger:db:migrate:local": fresh(
        "node --env-file-if-exists=.env scripts/local-db.ts migrate",
        {
          cwd: "examples/58-ledger",
        },
      ),
      "ledger:db:reset:local": fresh("node --env-file-if-exists=.env scripts/local-db.ts reset", {
        cwd: "examples/58-ledger",
      }),
      "ledger:test:local": fresh("node --env-file-if-exists=.env scripts/test-local.ts", {
        cwd: "examples/58-ledger",
      }),
      ...infra("ledger", "examples/58-ledger", "AihLedger"),
      // One sample entry, then a digest, with your own credentials.
      "ledger:append": live("node --env-file-if-exists=../../.env scripts/ledger.ts append", {
        cwd: "examples/58-ledger",
      }),
      "ledger:digest": live("node --env-file-if-exists=../../.env scripts/ledger.ts digest", {
        cwd: "examples/58-ledger",
      }),
      // Reads the whole ledger and every digest version. Exits 1 on any finding.
      "ledger:verify": live("node --env-file-if-exists=../../.env scripts/ledger.ts verify", {
        cwd: "examples/58-ledger",
      }),
      // Prints what it would delete from the digest bucket unless --apply is given. Never bypasses a lock.
      "ledger:purge": live("node --env-file-if-exists=../../.env scripts/ledger.ts purge", {
        cwd: "examples/58-ledger",
      }),
      // <<< chapter 58

      // >>> chapter 56
      // ---- chapter 56: the Amazon Nova family ------------------------------
      // The description API on plain Node. Plays a script unless .env says NOVA_BACKEND=bedrock.
      "dev:nova": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/56-nova",
      }),
      // Local: the family as src/catalog.ts has it, against today's date.
      "nova:catalog": fresh("node scripts/catalog.ts", { cwd: "examples/56-nova" }),
      ...infra("nova", "examples/56-nova", "AihNova"),
      // Reads AWS and calls no model: what the account lists, against the catalog.
      "nova:models": live("node --env-file-if-exists=../../.env scripts/models.ts", {
        cwd: "examples/56-nova",
      }),
      // BILLED: the next two call a real model. Neither is part of check:all.
      "nova:hello": live(
        "node --env-file-if-exists=../../.env --env-file-if-exists=.env scripts/hello.ts",
        { cwd: "examples/56-nova" },
      ),
      "nova:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/56-nova",
      }),
      "nova:empty": live("node --env-file-if-exists=../../.env scripts/empty.ts", {
        cwd: "examples/56-nova",
      }),
      // <<< chapter 56

      // >>> chapter 60
      // ---- chapter 60: Aurora ------------------------------------------------
      // Deployed, the cluster bills for storage and one secret, and for capacity whenever it is awake.
      ...infra("aurora", "examples/60-aurora", "AihAurora"),
      // These reach the deployed cluster through the RDS Data API and change it. They wake a paused instance.
      "aurora:db:schema": live("node --env-file-if-exists=../../.env scripts/cloud.ts schema", {
        cwd: "examples/60-aurora",
      }),
      "aurora:smoke": live("node --env-file-if-exists=../../.env scripts/cloud.ts smoke", {
        cwd: "examples/60-aurora",
      }),
      // <<< chapter 60

      // >>> chapter 62
      // ---- chapter 62: CI runners ------------------------------------------
      // Hand-written deliveries through the real receiver, with stand-ins for GitHub, ECS and DynamoDB.
      "runners:decide": fresh("node scripts/decide.ts", { cwd: "examples/62-ci-runners" }),
      // Nothing billed by the hour. Two secrets at USD 0.40 a month each; a Fargate task per job.
      ...infra("runners", "examples/62-ci-runners", "AihCiRunners"),
      // <<< chapter 62

      // >>> chapter 57
      // ---- chapter 57: a note read aloud by Polly --------------------------------
      // The speech API on plain Node. A tone stands in for the voice unless .env says SPEECH_BACKEND=polly.
      "dev:polly": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/57-polly",
      }),
      ...infra("polly", "examples/57-polly", "AihPolly"),
      // BILLED: calls Polly through the deployed function. Not part of check:all.
      "polly:listen": live("node --env-file-if-exists=../../.env scripts/listen.ts", {
        cwd: "examples/57-polly",
      }),
      "polly:empty": live("node --env-file-if-exists=../../.env scripts/empty.ts", {
        cwd: "examples/57-polly",
      }),
      // <<< chapter 57

      // >>> chapter 59
      // ---- chapter 59: RDS -----------------------------------------------
      // The API on a model of a primary and a lagging replica (two PGlite). No Docker, no AWS.
      "dev:rds": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/59-rds",
      }),
      ...infra("rds", "examples/59-rds", "AihRds"),
      // These invoke the operations function in the VPC, which changes the database.
      "rds:db:bootstrap": live("node --env-file-if-exists=../../.env scripts/ops.ts bootstrap", {
        cwd: "examples/59-rds",
      }),
      "rds:db:migrate": live("node --env-file-if-exists=../../.env scripts/ops.ts migrate", {
        cwd: "examples/59-rds",
      }),
      "rds:db:status": live("node --env-file-if-exists=../../.env scripts/ops.ts status", {
        cwd: "examples/59-rds",
      }),
      "rds:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/59-rds",
      }),
      // <<< chapter 59

      // >>> chapter 63
      // ---- chapter 63: agent sandbox --------------------------------------
      // What the launcher would decide for one request, and what the task would be started with. Calls nothing.
      "sandbox:plan": fresh("node scripts/plan.ts", { cwd: "examples/63-agent-sandbox" }),
      // What each role of the stack could be allowed to do, by this chapter's own evaluator. Not IAM's answer.
      "sandbox:policy": fresh("node scripts/policy.ts", { cwd: "examples/63-agent-sandbox" }),
      // The container's program and Claude Code's settings file: all the image copies.
      "sandbox:bundle": fresh("node scripts/bundle.ts", { cwd: "examples/63-agent-sandbox" }),
      // Needs a running Docker daemon, which the Nix shell does not provide.
      "sandbox:image:build": fresh("node scripts/ops.ts image-build", {
        cwd: "examples/63-agent-sandbox",
        dependsOn: ["sandbox:bundle"],
      }),
      "sandbox:image:push": live("node --env-file-if-exists=../../.env scripts/ops.ts image-push", {
        cwd: "examples/63-agent-sandbox",
      }),
      // Deploy to an account that is not production. Nothing here is billed by the hour unless -c modelEndpoint=true.
      ...infra("sandbox", "examples/63-agent-sandbox", "AihAgentSandbox"),
      // Starts one billed Fargate task that runs a coding agent and calls a model.
      "sandbox:launch": live("node --env-file-if-exists=../../.env scripts/ops.ts launch", {
        cwd: "examples/63-agent-sandbox",
      }),
      "sandbox:logs": live("node --env-file-if-exists=../../.env scripts/ops.ts logs", {
        cwd: "examples/63-agent-sandbox",
      }),
      // A shell in a running task. Only works on a stack deployed with -c exec=true.
      "sandbox:exec": live("node --env-file-if-exists=../../.env scripts/ops.ts exec", {
        cwd: "examples/63-agent-sandbox",
      }),
      // <<< chapter 63

      // >>> chapter 61
      // ---- chapter 61: sqs -----------------------------------------------
      // The model queue and the worker's code, with a ledger that remembers and one that does not. No AWS.
      "sqs:demo": fresh("node scripts/demo.ts", { cwd: "examples/61-sqs" }),
      ...infra("sqs", "examples/61-sqs", "AihSqs"),
      // Sends a few commands for one note with your credentials, one of them twice.
      "sqs:send": live("node --env-file-if-exists=../../.env scripts/send.ts", {
        cwd: "examples/61-sqs",
      }),
      // Both queues, the dead letters, and one note. With --redrive it moves the dead letters back.
      "sqs:status": live("node --env-file-if-exists=../../.env scripts/status.ts", {
        cwd: "examples/61-sqs",
      }),
      // <<< chapter 61

      // >>> chapter 64
      // ---- chapter 64: isolates ------------------------------------------
      // One bundle per worker, and the configuration the container runs. No AWS, no Docker.
      "isolates:bundle": fresh("node scripts/bundle.ts", { cwd: "examples/64-isolates" }),
      // Chapter 04's app in the real workerd on this machine. No AWS, no Docker.
      "dev:isolates": fresh("node scripts/serve.ts", {
        cwd: "examples/64-isolates",
        dependsOn: ["isolates:bundle"],
      }),
      // Starts workerd and prints what it does under a busy worker and at SIGTERM. No AWS, no Docker.
      "isolates:observe": fresh("node scripts/observe.ts", { cwd: "examples/64-isolates" }),
      // Downloads the pinned Linux arm64 workerd from the npm registry and checks its digest. No AWS.
      "isolates:fetch": live("node scripts/fetch.ts", { cwd: "examples/64-isolates" }),
      // Needs a running Docker daemon, which the Nix shell does not provide.
      "isolates:image:build": fresh("node scripts/image.ts build", {
        cwd: "examples/64-isolates",
        dependsOn: ["isolates:bundle"],
      }),
      // Logs Docker in to the stack's repository and pushes the image.
      "isolates:image:push": live("node --env-file-if-exists=../../.env scripts/image.ts push", {
        cwd: "examples/64-isolates",
      }),
      // BILLED BY THE HOUR once deployed with -c imageTag=...: a load balancer and one Fargate task.
      ...infra("isolates", "examples/64-isolates", "AihIsolates"),
      "isolates:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/64-isolates",
      }),
      // <<< chapter 64

      // >>> chapter 67
      // ---- chapter 67: Firecracker ----------------------------------------
      // The requests a boot would send, as curl commands. Opens no socket; runs on any machine.
      //   vp run firecracker:plan [config.json] [--socket path] [--snapshot]
      "firecracker:plan": fresh("node scripts/plan.ts", { cwd: "examples/67-firecracker" }),
      // dist/kit: the guest server, plan and boot as single files, with deploy/. Local.
      "firecracker:kit:build": fresh("node scripts/build.ts", { cwd: "examples/67-firecracker" }),
      // Reads GitHub, not AWS: the pinned API specification against spec/*.subset.json.
      "firecracker:spec": live("node scripts/spec.ts", { cwd: "examples/67-firecracker" }),
      // Linux with KVM only: sends the boot sequence to a listening Firecracker and times the guest.
      "firecracker:boot": live("node scripts/boot.ts", { cwd: "examples/67-firecracker" }),
      // A place to try it. `-c run=true` adds a c7i.large, BILLED by the hour until destroyed.
      ...infra("firecracker", "examples/67-firecracker", "AihFirecracker"),
      "firecracker:kit:publish": live(
        "node --env-file-if-exists=../../.env scripts/kit.ts publish",
        {
          cwd: "examples/67-firecracker",
          dependsOn: ["firecracker:kit:build"],
        },
      ),
      "firecracker:kit:empty": live("node --env-file-if-exists=../../.env scripts/kit.ts empty", {
        cwd: "examples/67-firecracker",
      }),
      // <<< chapter 67

      // >>> chapter 68
      // ---- chapter 68: the Nitro System, Nitro Enclaves, Graviton -----------
      // Instance type names read part by part, from the naming page. No AWS.
      "nitro:names": fresh("node scripts/names.ts", { cwd: "examples/68-nitro" }),
      // arm64 against x86 unit prices, and what this stack costs idle. Reads data/pricing only.
      "nitro:prices": fresh("node scripts/prices.ts", { cwd: "examples/68-nitro" }),
      // A parent, an enclave, and KMS in one process: who can get the data key. No AWS.
      "nitro:demo": fresh("node scripts/demo.ts", { cwd: "examples/68-nitro" }),
      // One c6g.large, billed by the hour, and one KMS key, billed by the month.
      ...infra("nitro", "examples/68-nitro", "AihNitro"),
      // <<< chapter 68

      // >>> chapter 66
      // ---- chapter 66: distributed SQL ---------------------------------------
      // Downloads the pinned YugabyteDB archive from software.yugabyte.com into .yugabyte/ and checks its SHA-256. No AWS. Starts nothing.
      "distsql:fetch": fresh("node scripts/fetch.ts", { cwd: "examples/66-distributed-sql" }),
      // A certificate authority and a certificate for 127.0.0.1 in .yugabyte/. Needs openssl on PATH.
      "distsql:local:certs": fresh("node scripts/certs.ts", { cwd: "examples/66-distributed-sql" }),
      // Three nodes on 127.0.0.1 (ports 23001-29103), as detached processes. `--tls` on a new cluster.
      "distsql:local:start": fresh("node scripts/cluster.ts start", {
        cwd: "examples/66-distributed-sql",
      }),
      "distsql:local:status": fresh("node scripts/cluster.ts status", {
        cwd: "examples/66-distributed-sql",
      }),
      // SIGKILL to both processes of one node: `vp run distsql:local:kill b`.
      "distsql:local:kill": fresh("node scripts/cluster.ts kill", {
        cwd: "examples/66-distributed-sql",
      }),
      "distsql:local:stop": fresh("node scripts/cluster.ts stop", {
        cwd: "examples/66-distributed-sql",
      }),
      // Stops every node and deletes .yugabyte/run.
      "distsql:local:destroy": fresh("node scripts/cluster.ts destroy", {
        cwd: "examples/66-distributed-sql",
      }),
      // Chapter 13's migrations and repository on the local cluster, a real conflict, one node killed, two nodes killed, a dump restored.
      "distsql:local:verify": fresh("node scripts/verify.ts", {
        cwd: "examples/66-distributed-sql",
      }),
      // Fails when deploy/ differs from what the generators produce. `--write` rewrites it.
      "distsql:render": fresh("node scripts/render.ts", { cwd: "examples/66-distributed-sql" }),
      // With `-c nodes=3`: three instances and their volumes, billed by the hour.
      ...infra("distsql", "examples/66-distributed-sql", "AihDistSql"),
      // Everything below goes through Systems Manager to the deployed nodes.
      "distsql:status": live("node --env-file-if-exists=../../.env scripts/nodes.ts status", {
        cwd: "examples/66-distributed-sql",
      }),
      "distsql:logs": live("node --env-file-if-exists=../../.env scripts/nodes.ts logs", {
        cwd: "examples/66-distributed-sql",
      }),
      "distsql:health": live("node --env-file-if-exists=../../.env scripts/nodes.ts health", {
        cwd: "examples/66-distributed-sql",
      }),
      // Uploads the archive that `distsql:fetch --nodes` downloaded.
      "distsql:artifact": live("node --env-file-if-exists=../../.env scripts/nodes.ts artifact", {
        cwd: "examples/66-distributed-sql",
      }),
      "distsql:install": live("node --env-file-if-exists=../../.env scripts/nodes.ts install", {
        cwd: "examples/66-distributed-sql",
      }),
      // Each node makes its key; the CA in .yugabyte/ca-aws signs the request. Needs openssl on PATH.
      "distsql:certs": live("node --env-file-if-exists=../../.env scripts/nodes.ts certs", {
        cwd: "examples/66-distributed-sql",
      }),
      "distsql:configure": live("node --env-file-if-exists=../../.env scripts/nodes.ts configure", {
        cwd: "examples/66-distributed-sql",
      }),
      "distsql:start": live("node --env-file-if-exists=../../.env scripts/nodes.ts start", {
        cwd: "examples/66-distributed-sql",
      }),
      // One node: `vp run distsql:stop b`.
      "distsql:stop": live("node --env-file-if-exists=../../.env scripts/nodes.ts stop", {
        cwd: "examples/66-distributed-sql",
      }),
      // An interactive shell on one node. Needs the Session Manager plugin.
      "distsql:session": live("node --env-file-if-exists=../../.env scripts/nodes.ts session", {
        cwd: "examples/66-distributed-sql",
      }),
      // <<< chapter 66

      // >>> chapter 69
      // ---- chapter 69: Web Functions -------------------------------------
      // The notes API as a Node.js server on 127.0.0.1:8787, restarted on change. No AWS.
      "dev:webfn": fresh("node --watch --env-file-if-exists=.env src/index.ts", {
        cwd: "examples/69-web-functions",
      }),
      // The entry file as its own process: fifty requests at once, then a SIGTERM. No AWS.
      "webfn:demo": fresh("node scripts/demo.ts", { cwd: "examples/69-web-functions" }),
      // Writes dist/function.zip, the archive a revision is made from. Local.
      "webfn:package": fresh("node scripts/package.ts", { cwd: "examples/69-web-functions" }),
      // cdkd 0.296.28 has no provider for AWS::Lambda::WebFunction, so this stack goes through
      // the AWS CDK CLI and CloudFormation, as chapter 20 does. Local: writes cdk.out.
      "webfn:cfn:synth": fresh(`${node} examples/69-web-functions/scripts/cdk.ts synth`),
      // Template against the deployed template. Takes the same -c flags as the deploy.
      "webfn:cfn:diff": live(`${node} examples/69-web-functions/scripts/cdk.ts diff`),
      // --foundation before the first upload, -c stable=<S3 version ID> after it.
      // With neither, it refuses to run.
      "webfn:cfn:deploy": live(`${node} examples/69-web-functions/scripts/cdk.ts deploy`),
      "webfn:cfn:destroy": live(`${node} examples/69-web-functions/scripts/cdk.ts destroy`),
      // Builds the package and puts it in the code bucket. Prints the S3 version ID.
      "webfn:upload": live("node --env-file-if-exists=../../.env scripts/upload.ts", {
        cwd: "examples/69-web-functions",
      }),
      // Signed requests to the endpoint: creates and deletes a note, counts answers per upload.
      "webfn:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/69-web-functions",
      }),
      // Counts the object versions in the code bucket. Deletes them all only with --yes.
      "webfn:empty": live("node --env-file-if-exists=../../.env scripts/empty.ts", {
        cwd: "examples/69-web-functions",
      }),
      // <<< chapter 69

      // ---- chapter task blocks are inserted above this line ----

      // ---- pricing and source distribution -----------------------------
      "pricing:refresh": live("node tools/src/pricing/refresh.ts"),
      "sources:pack": fresh("node tools/src/sources/pack.ts"),

      // ---- chapter 01: account ------------------------------------------
      "account:whoami": live(`${node} tools/src/aws/whoami.ts`),
      "account:budget:create": live(`${node} tools/src/aws/budget.ts create examples/01-account`),
      "account:budget:delete": live(`${node} tools/src/aws/budget.ts delete examples/01-account`),

      // ---- chapter 02: toolchain ----------------------------------------
      // Once per account and region: creates cdkd's state and asset storage.
      "infra:bootstrap": live(`${node} tools/src/infra/cdkd.ts bootstrap book/infra -`),
      ...infra("hello", "examples/02-toolchain", "AihHello"),
      // The same app through the AWS CDK CLI. Local only; shown for comparison.
      "hello:infra:synth:cdk": fresh(
        "CDK_DISABLE_CLI_TELEMETRY=1 CDK_DISABLE_VERSION_CHECK=1 cdk synth --quiet",
        {
          cwd: "examples/02-toolchain",
        },
      ),

      // ---- chapter 03: SPA ----------------------------------------------
      "dev:spa": fresh("vp dev", { cwd: "examples/03-spa" }),
      "build:spa": { command: "vp build", cwd: "examples/03-spa" },
      "preview:spa": fresh("vp preview", { cwd: "examples/03-spa", dependsOn: ["build:spa"] }),
      ...infra("spa", "examples/03-spa", "AihSpa"),
      ...site("spa", "examples/03-spa", "AihSpa", "examples/03-spa/dist", "build:spa"),

      // ---- chapter 04: HTTP API -----------------------------------------
      // Plain Node, restarted on change. No Docker, no AWS.
      "dev:api": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/04-http-api",
      }),
      // The synthesized API in local Lambda containers. Needs a running Docker daemon.
      "dev:api:cdkd": fresh(
        `${node} tools/src/infra/cdkd.ts local-api examples/04-http-api AihHttpApi`,
      ),
      ...infra("api", "examples/04-http-api", "AihHttpApi"),
      "api:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/04-http-api",
      }),
      "api:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", {
        cwd: "examples/04-http-api",
      }),

      // ---- chapter 05: DynamoDB -----------------------------------------
      // The API with notes kept in memory or in DynamoDB, as examples/05-dynamodb/.env says.
      "dev:notes": fresh("node --watch --env-file-if-exists=.env src/dev.ts", {
        cwd: "examples/05-dynamodb",
      }),
      // DynamoDB Local in a container. Needs a running Docker daemon.
      "db:local:start": fresh("node --env-file-if-exists=.env scripts/local-db.ts start", {
        cwd: "examples/05-dynamodb",
      }),
      "db:local:stop": fresh("node --env-file-if-exists=.env scripts/local-db.ts stop", {
        cwd: "examples/05-dynamodb",
      }),
      "db:migrate:local": fresh("node --env-file-if-exists=.env scripts/local-db.ts migrate", {
        cwd: "examples/05-dynamodb",
      }),
      "db:seed:local": fresh("node --env-file-if-exists=.env scripts/local-db.ts seed", {
        cwd: "examples/05-dynamodb",
      }),
      "db:reset:local": fresh("node --env-file-if-exists=.env scripts/local-db.ts reset", {
        cwd: "examples/05-dynamodb",
      }),
      "test:local:dynamodb": fresh("node --env-file-if-exists=.env scripts/test-local.ts", {
        cwd: "examples/05-dynamodb",
      }),
      ...infra("notes", "examples/05-dynamodb", "AihNotes"),
      "notes:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/05-dynamodb",
      }),

      // ---- chapter 06: sign-in and authorization ------------------------
      // API with local development sign-in, and the SPA that uses it. No Docker, no AWS.
      "dev:app:api": fresh("node --watch --env-file-if-exists=.env api/src/dev.ts", {
        cwd: "examples/06-auth",
      }),
      "dev:app:web": fresh("vp dev", { cwd: "examples/06-auth/web" }),
      "build:app:web": { command: "vp build", cwd: "examples/06-auth/web" },
      "typecheck:app:web": {
        command: "../node_modules/.bin/vize check",
        cwd: "examples/06-auth/web",
      },
      "lint:app:web": {
        command: "../node_modules/.bin/vize lint src --preset essential",
        cwd: "examples/06-auth/web",
      },
      ...infra("app", "examples/06-auth", "AihNotesApp"),
      // Writes the deployed endpoints into the built SPA, then publishes it.
      "app:publish": live(
        "node --env-file-if-exists=../../.env scripts/write-config.ts && node --env-file-if-exists=../../.env ../../tools/src/site/publish.ts . AihNotesApp web/dist",
        { cwd: "examples/06-auth", dependsOn: ["build:app:web"] },
      ),
      "app:smoke:web": live(`${node} tools/src/site/smoke.ts spa examples/06-auth AihNotesApp`),
      "app:smoke:api": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/06-auth",
      }),
      "app:unpublish": live(`${node} tools/src/site/unpublish.ts examples/06-auth AihNotesApp`),
      "app:user:create": live("node --env-file-if-exists=../../.env scripts/user.ts create", {
        cwd: "examples/06-auth",
      }),
      "app:user:delete": live("node --env-file-if-exists=../../.env scripts/user.ts delete", {
        cwd: "examples/06-auth",
      }),
    },
  },
  test: {
    include: ["{book/infra,book/theme,tools,examples}/**/*.test.ts"],
    // CDK tests synthesize a stack and bundle with esbuild. 5 seconds is not enough on a busy machine.
    testTimeout: 30_000,
  },
  lint: {
    ignorePatterns: [".claude/**"],
    // Types are checked by `vp run typecheck` (tsc per project) and by Vize for .vue files.
    options: { typeAware: false, typeCheck: false },
    plugins: ["typescript", "import", "unicorn", "oxc"],
    // awscdk-lint by ren-yamanashi (https://awscdk-lint.dev/): the mistakes CDK lets you make
    // without complaint, such as a construct ID built from a variable or `scope` passed where
    // `this` was meant. Its recommended set, as published.
    jsPlugins: awscdk.configs.recommended.jsPlugins,
    rules: {
      ...awscdk.configs.recommended.rules,
      curly: "warn",
      eqeqeq: "warn",
      "object-shorthand": "warn",
      "prefer-template": "warn",
      "prefer-const": "warn",
      "no-else-return": "warn",
      "no-useless-rename": "warn",
      "arrow-body-style": "warn",
      "no-lonely-if": "warn",
      "import/no-duplicates": "warn",
      "import/first": "warn",
      "typescript/consistent-type-imports": "warn",
      "typescript/consistent-type-definitions": ["warn", "type"],
      "typescript/array-type": "warn",
      "unicorn/prefer-node-protocol": "warn",
      "unicorn/no-negated-condition": "warn",
      "unicorn/prefer-string-replace-all": "warn",
      "unicorn/no-lonely-if": "warn",
    },
    // The CDK rules ask the type checker about each `new`, and a .vue file is not in any
    // TypeScript project it can ask. No CDK code lives in one.
    overrides: [
      {
        files: ["**/*.vue"],
        rules: Object.fromEntries(
          Object.keys(awscdk.configs.recommended.rules).map((rule) => [rule, "off"]),
        ),
      },
    ],
  },
  fmt: {
    // The book shows code in a column about this wide; longer lines would scroll sideways.
    printWidth: 100,
    // Imports read top-down: Node, packages, other workspace packages, then this package.
    // A blank line between each.
    sortImports: {
      internalPattern: ["@aih/"],
      groups: ["builtin", "external", "internal", ["parent", "sibling", "index"], "unknown"],
      newlinesBetween: true,
    },
    ignorePatterns: [
      // Prose and recorded fixtures are kept byte for byte as written.
      // Worktrees of in-progress chapters live here.
      ".claude/**",
      "book/content/**",
      "**/fixtures/**",
      "data/pricing/unit-prices.json",
      "**/*.md",
      "pnpm-lock.yaml",
      "flake.lock",
    ],
  },
});
