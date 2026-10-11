import { defineConfig } from "vite-plus";

// Every project task lives in this file and is started with `vp run <task>`
// from the repository root. `vp run` without a name lists them.
//
// Two kinds of task are kept apart:
// - local tasks read and write only this checkout. A few of them are cached,
//   with the default file tracking, because their result depends on nothing
//   else.
// - `live` tasks read or change AWS (or another network service). They are
//   never cached: a replayed "success" from an earlier run would say nothing
//   about the account as it is now.

// #region kinds
type Task = { command: string; cwd?: string; dependsOn?: string[]; cache?: boolean };

/** A local task whose output must come from a fresh run, such as a dev server. */
const fresh = (command: string, rest: Omit<Task, "command" | "cache"> = {}): Task => ({
  command,
  ...rest,
  cache: false,
});

/** A task that reads or changes something outside this checkout. */
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
    // Local: runs the CDK app and writes <appDir>/cdk.out. Changes nothing in AWS.
    [`${name}:infra:synth`]: fresh(cdkd("synth")),
    // Reads cdkd's state in S3 and shows what a deploy would change.
    [`${name}:infra:diff`]: live(cdkd("diff")),
    [`${name}:infra:deploy`]: live(cdkd("deploy")),
    [`${name}:infra:destroy`]: live(cdkd("destroy")),
    // Compares the recorded state with the live resources and writes reports/drift/<stack>.json.
    [`${name}:infra:drift`]: live(drift("check")),
    // Remediation is separate from detection and is never run by another task.
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

export default defineConfig({
  run: {
    tasks: {
      // ---- checks that need nothing but this checkout -------------------
      // Format and lint. Type checking is the two tasks below.
      check: { command: "vp check" },
      // tsc for every non-Vue project; see tools/src/checks/typecheck.ts for
      // why this is separate from `vp check`.
      typecheck: fresh("node tools/src/checks/typecheck.ts"),
      // .vue files are checked by Vize. It is given only the Vue app (src/):
      // the CDK code under infra/ imports aws-cdk-lib and goes through the
      // single-threaded tsc run above.
      "typecheck:vue": { command: "./node_modules/.bin/vize check", cwd: "examples/03-spa" },
      // Vize's linter reads the <template> blocks that oxlint does not.
      "lint:vue": { command: "./node_modules/.bin/vize lint src --preset essential", cwd: "examples/03-spa" },
      "test:unit": { command: "vp test run" },
      "content:check": fresh("node tools/src/checks/content.ts"),
      "links:check": fresh("node tools/src/checks/links.ts book/dist", { dependsOn: ["build:book"] }),
      "infra:synth": fresh("node -e \"console.log('all CDK apps synthesized')\"", {
        dependsOn: [
          "book:infra:synth",
          "hello:infra:synth",
          "spa:infra:synth",
          "api:infra:synth",
          "notes:infra:synth",
          "app:infra:synth",
        ],
      }),
      // Everything above plus both builds. Never touches AWS.
      "check:all": fresh("node -e \"console.log('check:all finished without touching AWS')\"", {
        dependsOn: [
          "check",
          "typecheck:vue",
          "test:unit",
          "book:generate:check",
          "content:check",
          "infra:synth",
          "links:check",
          "build:spa",
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
  },
  lint: {
    // Off on purpose: the type-aware pass intermittently mis-resolves
    // aws-cdk-lib subpath imports. `vp run typecheck` checks types instead.
    options: { typeAware: false, typeCheck: false },
  },
  fmt: {
    printWidth: 120,
    ignorePatterns: [
      // Prose and recorded fixtures are kept byte for byte as written.
      "book/content/**",
      "**/fixtures/**",
      "data/pricing/unit-prices.json",
      "**/*.md",
      "pnpm-lock.yaml",
      "flake.lock",
    ],
  },
});
