import { describe, expect, it } from "vite-plus/test";

import { parseContainersConfig } from "../src/config.ts";
import { buildSteps, pushSteps, render, runSteps } from "../src/image.ts";

describe("parseContainersConfig", () => {
  it("means 'repository only' when no tag is given", () => {
    expect(parseContainersConfig({})).toEqual({
      taskSubnets: "public",
      allowedOrigin: "http://localhost:5173",
    });
  });

  it("refuses 'latest': it says nothing about what is running", () => {
    expect(() => parseContainersConfig({ imageTag: "latest" })).toThrow(/imageTag: name the build/);
  });

  it("refuses a tag that would end up as something else on a command line", () => {
    for (const imageTag of ["v1 --privileged", "v1;rm", "-v1", "repo:v1", ""]) {
      expect(() => parseContainersConfig({ imageTag }), imageTag).toThrow(/imageTag/);
    }
    expect(parseContainersConfig({ imageTag: "2026-10-12_6a933b2" }).imageTag).toBe(
      "2026-10-12_6a933b2",
    );
  });

  it("refuses a subnet tier that does not exist", () => {
    expect(() => parseContainersConfig({ taskSubnets: "isolated" })).toThrow(/taskSubnets/);
  });
});

describe("the docker commands", () => {
  const uri = "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/aihcontainers-repository";

  it("build for the architecture the task definition asks for", () => {
    expect(buildSteps("v1").map(render)).toEqual([
      "docker build --platform linux/arm64 --tag aih-notes:v1 .",
    ]);
  });

  it("run the image the way the task does: read-only, with the version in the environment", () => {
    const [step] = runSteps("v1").map(render);
    expect(step).toContain("--read-only");
    expect(step).toContain("--env APP_VERSION=v1");
    expect(step).toContain("--publish 8080:8080");
  });

  it("log in to the registry of the repository, with the password on stdin only", () => {
    const [login, tag, push] = pushSteps("v1", uri, "ap-northeast-1");
    expect(login && render(login)).toBe(
      "aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.ap-northeast-1.amazonaws.com",
    );
    expect(tag?.command).toEqual(["docker", "tag", "aih-notes:v1", `${uri}:v1`]);
    expect(push?.command).toEqual(["docker", "push", `${uri}:v1`]);
  });

  it("refuse to send the password to a host that is not an ECR registry", () => {
    expect(() => pushSteps("v1", "registry.example.com/notes", "ap-northeast-1")).toThrow(/ECR/);
    expect(() =>
      pushSteps("v1", "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com.evil.example/x", "x"),
    ).toThrow();
  });
});
