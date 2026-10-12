import { describe, expect, it } from "vite-plus/test";

import { calls, explain, renderExplanations, type Tasks, tasks } from "./tasks.ts";

const all: Tasks = {
  "dev:notes": { command: "node --watch src/dev.ts", cwd: "examples/05-dynamodb" },
  "notes:infra:synth": {
    command:
      "node --env-file-if-exists=.env tools/src/infra/cdkd.ts synth examples/05-dynamodb AihNotes",
  },
  "notes:infra:deploy": {
    command:
      "node --env-file-if-exists=.env tools/src/infra/cdkd.ts deploy examples/05-dynamodb AihNotes",
  },
  "notes:infra:drift:revert:preview": {
    command:
      "node --env-file-if-exists=.env tools/src/drift/cli.ts preview-revert examples/05-dynamodb AihNotes",
  },
  "spa:publish": { command: "node tools/src/site/publish.ts a b c", dependsOn: ["build:spa"] },
  "check:all": { command: "node -e \"console.log('done')\"", dependsOn: ["check", "typecheck"] },
};

describe("the vp run lines of a shell block", () => {
  it("finds each task, with its arguments and the settings written before it", () => {
    expect(
      calls(
        "cp .env.example .env\nvp run dev:notes\nAI_FIXTURE=x vp run dev:ai --port 1\n# vp run",
      ),
    ).toEqual([
      { prefix: "", task: "dev:notes", args: [] },
      { prefix: "AI_FIXTURE=x ", task: "dev:ai", args: ["--port", "1"] },
    ]);
  });
});

describe("the command behind a task", () => {
  it("is the task's command, in the task's directory", () => {
    expect(explain({ prefix: "", task: "dev:notes", args: [] }, all)).toEqual({
      task: "dev:notes",
      before: [],
      command: "(cd examples/05-dynamodb && node --watch src/dev.ts)",
    });
  });

  it("shows the cdkd command a wrapper starts, with the arguments passed on", () => {
    const deploy = explain(
      { prefix: "", task: "notes:infra:deploy", args: ["-c", "nodes=1"] },
      all,
    );
    expect(deploy.cdkd).toEqual({
      command:
        "(cd examples/05-dynamodb && AWS_REGION=${AIH_AWS_REGION:-ap-northeast-1} cdkd deploy AihNotes --full-wait -c nodes=1)",
      via: "tools/src/infra/cdkd.ts",
      checksAccount: true,
    });
    expect(explain({ prefix: "", task: "notes:infra:synth", args: [] }, all).cdkd).toMatchObject({
      checksAccount: false,
    });
    expect(
      explain({ prefix: "", task: "notes:infra:drift:revert:preview", args: [] }, all).cdkd
        ?.command,
    ).toContain("cdkd drift AihNotes --revert --dry-run");
  });

  it("lists what runs first, and shows no command for a task that only gathers others", () => {
    expect(explain({ prefix: "", task: "spa:publish", args: [] }, all).before).toEqual([
      "build:spa",
    ]);
    expect(explain({ prefix: "", task: "check:all", args: [] }, all)).toEqual({
      task: "check:all",
      before: ["check", "typecheck"],
    });
  });

  it("refuses a task that does not exist", () => {
    expect(() => explain({ prefix: "", task: "nope", args: [] }, all)).toThrow("no such task");
  });

  it("can explain every task this repository defines", () => {
    for (const task of Object.keys(tasks)) {
      expect(() => explain({ prefix: "", task, args: [] })).not.toThrow();
    }
    expect(explain({ prefix: "", task: "hello:infra:deploy", args: [] }).cdkd?.command).toContain(
      "cdkd deploy",
    );
  });
});

describe("the block under a shell block", () => {
  it("is nothing when no task was named", () => {
    expect(renderExplanations([], "ja")).toBeUndefined();
  });

  it("escapes what it prints", () => {
    const html = renderExplanations([{ task: "a", before: [], command: "echo <b> && true" }], "en");
    expect(html).toContain("echo &lt;b&gt; &amp;&amp; true");
    expect(html).toContain("What actually runs");
  });
});
