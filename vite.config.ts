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
function site(name: string, appDir: string, stack: string, buildDir: string, buildTask: string): Record<string, Task> {
  const run = (script: string, args = "") => `${node} tools/src/site/${script}.ts ${args}`.trimEnd();
  return {
    [`${name}:publish:plan`]: live(run("publish", `${appDir} ${stack} ${buildDir} --dry-run`), {
      dependsOn: [buildTask],
    }),
    [`${name}:publish`]: live(run("publish", `${appDir} ${stack} ${buildDir}`), { dependsOn: [buildTask] }),
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
];

export default defineConfig({
  run: {
    tasks: {
      // ---- checks that need nothing but this checkout -------------------
      // Format and lint. Type checking is the two tasks below.
      check: { command: "vp check" },
      // tools/src/checks/typecheck.ts says why this is not `vp check`.
      typecheck: fresh("node tools/src/checks/typecheck.ts"),
      // Vize gets only the Vue app (src/). The CDK code under infra/ goes through tsc above.
      "typecheck:vue": { command: "./node_modules/.bin/vize check", cwd: "examples/03-spa" },
      // Vize's linter reads the <template> blocks that oxlint does not.
      "lint:vue": { command: "./node_modules/.bin/vize lint src --preset essential", cwd: "examples/03-spa" },
      "test:unit": { command: "vp test run" },
      "content:check": fresh("node tools/src/checks/content.ts"),
      "links:check": fresh("node tools/src/checks/links.ts book/dist", { dependsOn: ["build:book"] }),
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
      "typecheck:stream:web": { command: "../node_modules/.bin/vize check", cwd: "examples/18-live/web" },
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
      "stream:status": live("node --env-file-if-exists=../../.env scripts/status.ts", { cwd: "examples/18-live" }),
      // Prints the encoder settings. The stream key only with --show.
      "stream:key": live("node --env-file-if-exists=../../.env scripts/key.ts", { cwd: "examples/18-live" }),
      "stream:stop": live("node --env-file-if-exists=../../.env scripts/stop.ts", { cwd: "examples/18-live" }),
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
      "dev:ai": fresh("node --watch --env-file-if-exists=.env src/dev.ts", { cwd: "examples/17-ai" }),
      ...infra("ai", "examples/17-ai", "AihAi"),
      // BILLED: the next three call a real model. None of them is part of check:all.
      "ai:hello": live("node --env-file-if-exists=../../.env --env-file-if-exists=.env scripts/hello.ts", {
        cwd: "examples/17-ai",
      }),
      "ai:test:live": live("node --env-file-if-exists=../../.env --env-file-if-exists=.env scripts/live.ts", {
        cwd: "examples/17-ai",
      }),
      "ai:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", { cwd: "examples/17-ai" }),
      "ai:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", { cwd: "examples/17-ai" }),
      // <<< chapter 17

      // >>> chapter 15
      // ---- chapter 15: email ---------------------------------------------
      // API with an in-memory outbox instead of SES. No Docker, no AWS, nothing is sent.
      "dev:mail": fresh("node --watch --env-file-if-exists=.env src/dev.ts", { cwd: "examples/15-email" }),
      ...infra("mail", "examples/15-email", "AihEmail"),
      // Sends one real, billed mail through the deployed API, twice with the same ID.
      "mail:send": live("node --env-file-if-exists=../../.env scripts/send.ts", { cwd: "examples/15-email" }),
      "mail:status": live("node --env-file-if-exists=../../.env scripts/status.ts", { cwd: "examples/15-email" }),
      // Prints the DNS records to publish by hand. Changes nothing.
      "mail:dns": live("node --env-file-if-exists=../../.env scripts/dns.ts", { cwd: "examples/15-email" }),
      "mail:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", { cwd: "examples/15-email" }),
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
      "edge:publish": live(`${node} tools/src/site/publish.ts examples/10-edge AihEdge examples/10-edge/site`),
      "edge:unpublish": live(`${node} tools/src/site/unpublish.ts examples/10-edge AihEdge`),
      // Compares edge-data.json with the key value store. Reads only.
      "edge:kvs:plan": live("node --env-file-if-exists=../../.env scripts/kvs-sync.ts --dry-run", {
        cwd: "examples/10-edge",
      }),
      "edge:kvs:sync": live("node --env-file-if-exists=../../.env scripts/kvs-sync.ts", { cwd: "examples/10-edge" }),
      // <<< chapter 10

      // >>> chapter 13
      // ---- chapter 13: SQL -----------------------------------------------
      // The API on PGlite (PostgreSQL inside the Node process). No Docker, no AWS.
      "dev:sql": fresh("node --watch --env-file-if-exists=.env src/dev.ts", { cwd: "examples/13-sql" }),
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
      "sql:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", { cwd: "examples/13-sql" }),
      "sql:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", { cwd: "examples/13-sql" }),
      // <<< chapter 13

      // >>> chapter 07
      // ---- chapter 07: image uploads ------------------------------------
      // API with local sign-in and uploads kept in memory, and the SPA that uses it. No Docker, no AWS.
      "dev:uploads:api": fresh("node --watch --env-file-if-exists=.env api/src/dev.ts", { cwd: "examples/07-uploads" }),
      "dev:uploads:web": fresh("vp dev", { cwd: "examples/07-uploads/web" }),
      "build:uploads:web": { command: "vp build", cwd: "examples/07-uploads/web" },
      "typecheck:uploads:web": { command: "../node_modules/.bin/vize check", cwd: "examples/07-uploads/web" },
      "lint:uploads:web": {
        command: "../node_modules/.bin/vize lint src --preset essential",
        cwd: "examples/07-uploads/web",
      },
      ...infra("uploads", "examples/07-uploads", "AihUploads"),
      "uploads:publish": live(
        "node --env-file-if-exists=../../.env scripts/write-config.ts && node --env-file-if-exists=../../.env ../../tools/src/site/publish.ts . AihUploads web/dist",
        { cwd: "examples/07-uploads", dependsOn: ["build:uploads:web"] },
      ),
      "uploads:smoke:web": live(`${node} tools/src/site/smoke.ts spa examples/07-uploads AihUploads`),
      "uploads:smoke:api": live("node --env-file-if-exists=../../.env scripts/smoke.ts", {
        cwd: "examples/07-uploads",
      }),
      // Lists objects that no record points at. Deletes them only with --delete.
      "uploads:sweep": live("node --env-file-if-exists=../../.env scripts/sweep.ts", { cwd: "examples/07-uploads" }),
      // Counts the uploaded images. Deletes them all only with --yes.
      "uploads:empty": live("node --env-file-if-exists=../../.env scripts/empty-uploads.ts", {
        cwd: "examples/07-uploads",
      }),
      "uploads:unpublish": live(`${node} tools/src/site/unpublish.ts examples/07-uploads AihUploads`),
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
      "build:ssr:stream": fresh("AIH_SSR_STREAMING=true ./node_modules/.bin/nuxt build", { cwd: "examples/09-ssr" }),
      // Runs the built handler in this process and checks the headers it sends.
      "ssr:check:output": fresh("node scripts/check-output.ts", { cwd: "examples/09-ssr", dependsOn: ["build:ssr"] }),
      "ssr:check:output:stream": fresh("node scripts/check-output.ts", {
        cwd: "examples/09-ssr",
        dependsOn: ["build:ssr:stream"],
      }),
      "typecheck:ssr": { command: "../node_modules/.bin/vize check", cwd: "examples/09-ssr/app" },
      "lint:ssr": { command: "../node_modules/.bin/vize lint . --preset essential", cwd: "examples/09-ssr/app" },
      ...infra("ssr", "examples/09-ssr", "AihSsr"),
      // Replaces the synth task from infra(): this stack needs the build to exist.
      "ssr:infra:synth": fresh(`${node} tools/src/infra/cdkd.ts synth examples/09-ssr AihSsr`, {
        dependsOn: ["build:ssr"],
      }),
      "ssr:assets:plan": live("node --env-file-if-exists=../../.env scripts/publish-assets.ts --dry-run", {
        cwd: "examples/09-ssr",
      }),
      "ssr:assets:publish": live("node --env-file-if-exists=../../.env scripts/publish-assets.ts", {
        cwd: "examples/09-ssr",
      }),
      "ssr:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", { cwd: "examples/09-ssr" }),
      "ssr:unpublish": live(`${node} tools/src/site/unpublish.ts examples/09-ssr AihSsr`),
      // <<< chapter 09

      // >>> chapter 19
      // ---- chapter 19: observability -------------------------------------
      // The notes API with spans printed to the console. No Docker, no AWS.
      "dev:obs": fresh("node --watch --env-file-if-exists=.env src/dev.ts", { cwd: "examples/19-observability" }),
      // Prints the text of a Logs Insights query. Runs nothing.
      "obs:query:print": fresh("node scripts/query.ts --print", { cwd: "examples/19-observability" }),
      ...infra("obs", "examples/19-observability", "AihObservability"),
      // Creates and deletes one note through the deployed API.
      "obs:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", { cwd: "examples/19-observability" }),
      // BILLED by the amount of log data scanned.
      "obs:query": live("node --env-file-if-exists=../../.env scripts/query.ts", { cwd: "examples/19-observability" }),
      "obs:alarms": live("node --env-file-if-exists=../../.env scripts/alarms.ts", {
        cwd: "examples/19-observability",
      }),
      // <<< chapter 19

      // >>> chapter 14
      // ---- chapter 14: key-value stores and caches ------------------------
      // The items API with counters and cache in memory, Valkey, or DynamoDB, as examples/14-kv-cache/.env says.
      "dev:kv": fresh("node --watch --env-file-if-exists=.env src/dev.ts", { cwd: "examples/14-kv-cache" }),
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
      "kv:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", { cwd: "examples/14-kv-cache" }),
      "kv:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", { cwd: "examples/14-kv-cache" }),
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
      "dev:ecs": fresh("node --watch --env-file-if-exists=.env src/server.ts", { cwd: "examples/12-containers" }),
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
      "ecs:watch": live("node --env-file-if-exists=../../.env scripts/watch.ts", { cwd: "examples/12-containers" }),
      "ecs:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", { cwd: "examples/12-containers" }),
      // <<< chapter 12

      // >>> chapter 08
      // ---- chapter 08: work off the request ------------------------------
      // Chapter 07's API with an in-memory queue and the worker, in one process. No Docker, no AWS.
      "dev:async": fresh("node --watch --env-file-if-exists=.env src/dev.ts", { cwd: "examples/08-async" }),
      ...infra("async", "examples/08-async", "AihAsync"),
      // Uploads with your credentials and waits for the worker's record.
      "async:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", { cwd: "examples/08-async" }),
      // Depth of both queues and a look at the dead-letter queue. Moves messages back only with --redrive.
      "async:queue": live("node --env-file-if-exists=../../.env scripts/queue.ts", { cwd: "examples/08-async" }),
      "async:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", { cwd: "examples/08-async" }),
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
      "dev:ec2": fresh("node --watch --env-file-if-exists=.env src/server.ts", { cwd: "examples/23-ec2" }),
      // Where the instance would live, whether it could reach Systems Manager, and the idle cost. Reads only this checkout.
      "ec2:plan": fresh("node scripts/plan.ts", { cwd: "examples/23-ec2" }),
      // Fails when deploy/ differs from what the generators produce. `--write` rewrites it.
      "ec2:render": fresh("node scripts/render.ts", { cwd: "examples/23-ec2" }),
      "ec2:app:build": fresh("node scripts/build.ts", { cwd: "examples/23-ec2" }),
      ...infra("ec2", "examples/23-ec2", "AihEc2"),
      // Everything below goes through Systems Manager to the deployed instance.
      "ec2:status": live("node --env-file-if-exists=../../.env scripts/remote.ts status", { cwd: "examples/23-ec2" }),
      "ec2:session": live("node --env-file-if-exists=../../.env scripts/remote.ts session", { cwd: "examples/23-ec2" }),
      "ec2:forward": live("node --env-file-if-exists=../../.env scripts/remote.ts forward", { cwd: "examples/23-ec2" }),
      "ec2:app:release": live("node --env-file-if-exists=../../.env scripts/remote.ts release", {
        cwd: "examples/23-ec2",
        dependsOn: ["ec2:app:build"],
      }),
      "ec2:app:rollback": live("node --env-file-if-exists=../../.env scripts/remote.ts rollback", {
        cwd: "examples/23-ec2",
      }),
      "ec2:smoke": live("node --env-file-if-exists=../../.env scripts/remote.ts smoke", { cwd: "examples/23-ec2" }),
      "ec2:logs": live("node --env-file-if-exists=../../.env scripts/remote.ts logs", { cwd: "examples/23-ec2" }),
      "ec2:data:unmount": live("node --env-file-if-exists=../../.env scripts/remote.ts unmount", {
        cwd: "examples/23-ec2",
      }),
      "ec2:data:mount": live("node --env-file-if-exists=../../.env scripts/remote.ts mount", {
        cwd: "examples/23-ec2",
      }),
      "ec2:patch:check": live("node --env-file-if-exists=../../.env scripts/remote.ts patch-check", {
        cwd: "examples/23-ec2",
      }),
      "ec2:patch:apply": live("node --env-file-if-exists=../../.env scripts/remote.ts patch-apply", {
        cwd: "examples/23-ec2",
      }),
      "ec2:releases:empty": live("node --env-file-if-exists=../../.env scripts/remote.ts releases-empty", {
        cwd: "examples/23-ec2",
      }),
      // <<< chapter 23

      // >>> chapter 16
      // ---- chapter 16: long-running jobs ----------------------------------
      // The deployed workflow definition, run in memory with injected interruptions. No AWS.
      "export:local": fresh("node scripts/run-local.ts", { cwd: "examples/16-long-jobs" }),
      ...infra("export", "examples/16-long-jobs", "AihLongJobs"),
      // Writes sample notes to the deployed table.
      "export:seed": live("node --env-file-if-exists=../../.env scripts/seed.ts", { cwd: "examples/16-long-jobs" }),
      // Starts one export now. --wait follows it to the end.
      "export:start": live("node --env-file-if-exists=../../.env scripts/start.ts", { cwd: "examples/16-long-jobs" }),
      // Recent executions and finished exports. --redrive <arn> resumes a failed one.
      "export:status": live("node --env-file-if-exists=../../.env scripts/status.ts", { cwd: "examples/16-long-jobs" }),
      // Tails one step's log group.
      "export:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", { cwd: "examples/16-long-jobs" }),
      // Counts, and with --yes deletes, every object in the exports bucket.
      "export:empty": live("node --env-file-if-exists=../../.env scripts/empty.ts", { cwd: "examples/16-long-jobs" }),
      // Starts the durable-function variant. Needs a deploy with -c durable=true.
      "export:durable:start": live("node --env-file-if-exists=../../.env scripts/durable-start.ts", {
        cwd: "examples/16-long-jobs",
      }),
      // <<< chapter 16

      // >>> chapter 21
      // ---- chapter 21: security and governance -----------------------------
      // The token API with a made-up signing key in memory. No AWS.
      "dev:sec": fresh("node --watch --env-file-if-exists=.env src/dev.ts", { cwd: "examples/21-security" }),
      // Lints IAM policies in synthesized templates. Pass other cdk.out directories to lint other chapters.
      "sec:iam:lint": fresh("node examples/21-security/scripts/iam-lint.ts", { dependsOn: ["sec:infra:synth"] }),
      // One secret is the only monthly fee. `-c cmk=on` adds a KMS key, `-c webAclArn=...` attaches a web ACL.
      ...infra("sec", "examples/21-security", "AihSecurity"),
      // The web ACL for CloudFront, in us-east-1 whatever AIH_AWS_REGION says. Billed by the month while it exists.
      ...infra("sec:waf", "examples/21-security", "AihSecurityWaf"),
      "sec:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", { cwd: "examples/21-security" }),
      // Lists the secret's versions and staging labels. Never prints a value.
      "sec:secret:versions": live("node --env-file-if-exists=../../.env scripts/rotate.ts versions", {
        cwd: "examples/21-security",
      }),
      // Writes a new version of the signing secret. The previous one stays accepted.
      "sec:secret:rotate": live("node --env-file-if-exists=../../.env scripts/rotate.ts rotate", {
        cwd: "examples/21-security",
      }),
      // Which account-level protections are on. Reads only.
      "sec:posture": live("node --env-file-if-exists=../../.env scripts/posture.ts", { cwd: "examples/21-security" }),
      // Recent IAM changes from CloudTrail event history in us-east-1. Reads only.
      "sec:trail:iam": live("node --env-file-if-exists=../../.env scripts/trail.ts", { cwd: "examples/21-security" }),
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
      "recovery:accident": live("node --env-file-if-exists=../../.env scripts/recovery.ts accident", {
        cwd: "examples/22-recovery",
      }),
      "recovery:restore:table": live("node --env-file-if-exists=../../.env scripts/recovery.ts restore-table", {
        cwd: "examples/22-recovery",
      }),
      "recovery:restore:objects": live("node --env-file-if-exists=../../.env scripts/recovery.ts restore-objects", {
        cwd: "examples/22-recovery",
      }),
      "recovery:protect": live("node --env-file-if-exists=../../.env scripts/recovery.ts protect", {
        cwd: "examples/22-recovery",
      }),
      "recovery:repair": live("node --env-file-if-exists=../../.env scripts/recovery.ts repair", {
        cwd: "examples/22-recovery",
      }),
      "recovery:drop-table": live("node --env-file-if-exists=../../.env scripts/recovery.ts drop-table", {
        cwd: "examples/22-recovery",
      }),
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
      "celld:logs": live("node --env-file-if-exists=../../.env scripts/fleet.ts logs", { cwd: "examples/24-celld" }),
      "celld:diagnose": live("node --env-file-if-exists=../../.env scripts/fleet.ts diagnose", {
        cwd: "examples/24-celld",
      }),
      "celld:cells": live("node --env-file-if-exists=../../.env scripts/fleet.ts cells", { cwd: "examples/24-celld" }),
      "celld:smoke": live("node --env-file-if-exists=../../.env scripts/fleet.ts smoke", { cwd: "examples/24-celld" }),
      "celld:artifacts": live("node --env-file-if-exists=../../.env scripts/fleet.ts artifacts", {
        cwd: "examples/24-celld",
      }),
      "celld:install": live("node --env-file-if-exists=../../.env scripts/fleet.ts install", {
        cwd: "examples/24-celld",
      }),
      "celld:start": live("node --env-file-if-exists=../../.env scripts/fleet.ts start", { cwd: "examples/24-celld" }),
      // Runs the local celld binary against the fleet bucket with your credentials.
      "celld:app-deploy": live("node --env-file-if-exists=../../.env scripts/fleet.ts app-deploy", {
        cwd: "examples/24-celld",
      }),
      // SIGTERM to one node: it hands its cells off, then stops.
      "celld:drain": live("node --env-file-if-exists=../../.env scripts/fleet.ts drain", { cwd: "examples/24-celld" }),
      "celld:stop-all": live("node --env-file-if-exists=../../.env scripts/fleet.ts stop-all", {
        cwd: "examples/24-celld",
      }),
      // One node at a time, or a stopped fleet, depending on what the upgrade notes say for the version pair.
      "celld:rollout": live("node --env-file-if-exists=../../.env scripts/fleet.ts rollout", {
        cwd: "examples/24-celld",
      }),
      // Stops an instance without an OS shutdown. The instance and its volumes stay.
      "celld:kill": live("node --env-file-if-exists=../../.env scripts/fleet.ts kill", { cwd: "examples/24-celld" }),
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
      "celld:bucket-empty": live("node --env-file-if-exists=../../.env scripts/fleet.ts bucket-empty", {
        cwd: "examples/24-celld",
      }),
      // <<< chapter 24

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
      "hello:infra:synth:cdk": fresh("cdk synth --quiet", { cwd: "examples/02-toolchain" }),

      // ---- chapter 03: SPA ----------------------------------------------
      "dev:spa": fresh("vp dev", { cwd: "examples/03-spa" }),
      "build:spa": { command: "vp build", cwd: "examples/03-spa" },
      "preview:spa": fresh("vp preview", { cwd: "examples/03-spa", dependsOn: ["build:spa"] }),
      ...infra("spa", "examples/03-spa", "AihSpa"),
      ...site("spa", "examples/03-spa", "AihSpa", "examples/03-spa/dist", "build:spa"),

      // ---- chapter 04: HTTP API -----------------------------------------
      // Plain Node, restarted on change. No Docker, no AWS.
      "dev:api": fresh("node --watch --env-file-if-exists=.env src/dev.ts", { cwd: "examples/04-http-api" }),
      // The synthesized API in local Lambda containers. Needs a running Docker daemon.
      "dev:api:cdkd": fresh(`${node} tools/src/infra/cdkd.ts local-api examples/04-http-api AihHttpApi`),
      ...infra("api", "examples/04-http-api", "AihHttpApi"),
      "api:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", { cwd: "examples/04-http-api" }),
      "api:logs": live("node --env-file-if-exists=../../.env scripts/logs.ts", { cwd: "examples/04-http-api" }),

      // ---- chapter 05: DynamoDB -----------------------------------------
      // The API with notes kept in memory or in DynamoDB, as examples/05-dynamodb/.env says.
      "dev:notes": fresh("node --watch --env-file-if-exists=.env src/dev.ts", { cwd: "examples/05-dynamodb" }),
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
      "notes:smoke": live("node --env-file-if-exists=../../.env scripts/smoke.ts", { cwd: "examples/05-dynamodb" }),

      // ---- chapter 06: sign-in and authorization ------------------------
      // API with local development sign-in, and the SPA that uses it. No Docker, no AWS.
      "dev:app:api": fresh("node --watch --env-file-if-exists=.env api/src/dev.ts", { cwd: "examples/06-auth" }),
      "dev:app:web": fresh("vp dev", { cwd: "examples/06-auth/web" }),
      "build:app:web": { command: "vp build", cwd: "examples/06-auth/web" },
      "typecheck:app:web": { command: "../node_modules/.bin/vize check", cwd: "examples/06-auth/web" },
      "lint:app:web": { command: "../node_modules/.bin/vize lint src --preset essential", cwd: "examples/06-auth/web" },
      ...infra("app", "examples/06-auth", "AihNotesApp"),
      // Writes the deployed endpoints into the built SPA, then publishes it.
      "app:publish": live(
        "node --env-file-if-exists=../../.env scripts/write-config.ts && node --env-file-if-exists=../../.env ../../tools/src/site/publish.ts . AihNotesApp web/dist",
        { cwd: "examples/06-auth", dependsOn: ["build:app:web"] },
      ),
      "app:smoke:web": live(`${node} tools/src/site/smoke.ts spa examples/06-auth AihNotesApp`),
      "app:smoke:api": live("node --env-file-if-exists=../../.env scripts/smoke.ts", { cwd: "examples/06-auth" }),
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
    include: ["{book/infra,tools,examples}/**/*.test.ts"],
    // CDK tests synthesize a stack and bundle with esbuild. 5 seconds is not enough on a busy machine.
    testTimeout: 30_000,
  },
  lint: {
    ignorePatterns: [".claude/**"],
    // Types are checked by `vp run typecheck` (tsc per project) and by Vize for .vue files.
    options: { typeAware: false, typeCheck: false },
  },
  fmt: {
    printWidth: 120,
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
