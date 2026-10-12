import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";

import { parseRunnerConfig, RUNNER, TIMING } from "../src/config.ts";

describe("the stack's context", () => {
  it("allows no repository and names no app unless told", () => {
    expect(parseRunnerConfig({})).toEqual({ repositories: [], runnerGroupId: 1 });
  });

  it("takes a list of exact repositories", () => {
    const config = parseRunnerConfig({ repositories: "example-org/notes, example-org/web" });
    expect(config.repositories).toEqual(["example-org/notes", "example-org/web"]);
  });

  it.each(["example-org/*", "*", "example-org", "example-org/notes/extra", "a/b c"])(
    "refuses %s as a repository",
    (repositories) => {
      expect(() => parseRunnerConfig({ repositories })).toThrow(/Invalid CDK context/);
    },
  );
});

describe("the timing", () => {
  it("lets the receiver finish before GitHub gives up, and a claim outlive the receiver", () => {
    expect(TIMING.receiverTimeout).toBeLessThan(TIMING.githubAnswerLimit);
    expect(TIMING.claimLease).toBeGreaterThan(TIMING.receiverTimeout);
  });

  it("pins the runner image by digest", () => {
    expect(RUNNER.image).toMatch(/^ghcr\.io\/actions\/actions-runner:[\d.]+@sha256:[0-9a-f]{64}$/);
  });
});

describe("the example workflow", () => {
  const workflow = parse(readFileSync(new URL("../workflows/ci.yml", import.meta.url), "utf8")) as {
    on: Record<string, unknown>;
    jobs: Record<string, { "runs-on": unknown; permissions: Record<string, string> }>;
  };

  it("asks for exactly the label the runners carry", () => {
    expect(workflow.jobs["test"]?.["runs-on"]).toBe(RUNNER.label);
  });

  it("gets its AWS access by OIDC, not from the runner", () => {
    expect(workflow.jobs["test"]?.permissions["id-token"]).toBe("write");
  });

  it("is not triggered by pull_request_target", () => {
    expect(Object.keys(workflow.on)).not.toContain("pull_request_target");
  });
});
