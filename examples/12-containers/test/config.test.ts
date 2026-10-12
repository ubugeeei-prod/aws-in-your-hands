import { describe, expect, it } from "vite-plus/test";

import { imageOf, parseContainersConfig } from "../src/config.ts";
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

  it("takes the image by digest as well, and refuses anything that is not a whole SHA-256", () => {
    const imageDigest = `sha256:${"0123456789abcdef".repeat(4)}`;
    const config = parseContainersConfig({ imageDigest });
    expect(config.imageDigest).toBe(imageDigest);
    expect(imageOf(config)).toBe(imageDigest);
    expect(imageOf(parseContainersConfig({ imageTag: "v1" }))).toBe("v1");
    expect(imageOf(parseContainersConfig({}))).toBeUndefined();

    const malformed = [
      "sha256:abc",
      "0123456789abcdef".repeat(4),
      `sha256:${"0123456789ABCDEF".repeat(4)}`,
      `sha256:${"0123456789abcdef".repeat(4)}0`,
      `sha512:${"0123456789abcdef".repeat(4)}`,
      `${imageDigest} --privileged`,
      "v1",
      "",
    ];
    for (const value of malformed) {
      expect(() => parseContainersConfig({ imageDigest: value }), value).toThrow(
        /imageDigest: expected sha256:/,
      );
    }
  });

  it("refuses a digest where a tag belongs, and a tag together with a digest", () => {
    const imageDigest = `sha256:${"0123456789abcdef".repeat(4)}`;
    expect(() => parseContainersConfig({ imageTag: imageDigest })).toThrow(/imageTag/);
    expect(() => parseContainersConfig({ imageTag: "v1", imageDigest })).toThrow(/not both/);
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
