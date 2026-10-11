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
];
const chapterCheckTasks = [
  "lint:vue",
  "typecheck:vue",
  "build:spa",
  "lint:app:web",
  "typecheck:app:web",
  "build:app:web",
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
      // Everything above plus both builds. Never touches AWS.
      "check:all": fresh("node -e \"console.log('check:all finished without touching AWS')\"", {
        dependsOn: [
          "check",
          "typecheck",
          "test:unit",
          "book:generate:check",
          "content:check",
          "infra:synth",
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
  },
  lint: {
    // The type-aware pass intermittently mis-resolves aws-cdk-lib subpath
    // imports. `vp run typecheck` checks types instead.
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
