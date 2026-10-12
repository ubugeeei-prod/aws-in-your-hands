import { describe, expect, it } from "vite-plus/test";

import { buildSteps, execSteps, launchSteps, pushSteps, render } from "../src/commands.ts";

describe("the commands the reader runs", () => {
  it("builds for arm64 and pushes with the password on a pipe", () => {
    expect(render(buildSteps("a1")[0] ?? { title: "", command: [] })).toBe(
      "docker build --platform linux/arm64 --tag aih-agent-sandbox:a1 .",
    );
    const [login, tag, push] = pushSteps(
      "a1",
      "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/repo",
      "ap-northeast-1",
    );
    expect(login?.input).toEqual([
      "aws",
      "ecr",
      "get-login-password",
      "--region",
      "ap-northeast-1",
    ]);
    expect(login?.command).toContain("--password-stdin");
    expect(tag?.command.at(-1)).toBe("123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/repo:a1");
    expect(push?.command).toEqual([
      "docker",
      "push",
      "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/repo:a1",
    ]);
    expect(() => pushSteps("a1", "docker.io/library/node", "ap-northeast-1")).toThrow(/ECR/);
  });

  it("invokes the launcher with the request as one quoted argument", () => {
    const [step] = launchSteps("launcher", "ap-northeast-1", {
      requestId: "0b9f6c1e-52a7-4a3e-9d55-3f1f0c2a7e10",
      repository: "acme/notes",
      task: "Fix it; don't break main",
    });
    const payload = step?.command[step.command.indexOf("--payload") + 1] ?? "";
    expect(JSON.parse(payload)).toMatchObject({
      repository: "acme/notes",
      task: "Fix it; don't break main",
    });
    // What is printed can be pasted into a shell without the task text becoming a command.
    expect(render(step ?? { title: "", command: [] })).toContain(`don'\\''t break main`);
  });

  it("opens a shell in the agent's container by name", () => {
    const [step] = execSteps("cluster", "ap-northeast-1", "0123abcd");
    expect(step?.command).toEqual(
      expect.arrayContaining(["execute-command", "--container", "agent", "--interactive"]),
    );
  });
});
