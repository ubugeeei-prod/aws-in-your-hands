import type { StopDeploymentCommand } from "@aws-sdk/client-appconfig";
import {
  CreateHostedConfigurationVersionCommand,
  StartDeploymentCommand,
} from "@aws-sdk/client-appconfig";
import { describe, expect, it } from "vite-plus/test";

import { deployFlags, stopDeployment, stopPlan } from "../src/flags/appconfig.ts";
import { parseDocument } from "../src/flags/document.ts";
import { knownFlags } from "../src/flags/evaluate.ts";

const target = {
  applicationId: "app1",
  environmentId: "env1",
  profileId: "prof1",
  strategyId: "str1",
};
const deployment = (State: string, DeploymentNumber = 4) =>
  ({ State, DeploymentNumber }) as Parameters<typeof stopPlan>[0];

describe("stopPlan", () => {
  it("stops a deployment that is still being validated, rolled out, or baked", () => {
    for (const state of ["VALIDATING", "DEPLOYING", "BAKING"]) {
      expect(stopPlan(deployment(state))).toEqual({ action: "stop", deployment: 4 });
    }
  });

  it("calls putting back a finished deployment by its name: a revert", () => {
    expect(stopPlan(deployment("COMPLETE"))).toEqual({ action: "revert", deployment: 4 });
  });

  it("does nothing to a deployment that already went back, or when there is none", () => {
    for (const state of ["ROLLED_BACK", "ROLLING_BACK", "REVERTED"]) {
      expect(stopPlan(deployment(state)).action).toBe("nothing");
    }
    expect(stopPlan(undefined)).toEqual({
      action: "nothing",
      reason: "no deployment has been started",
    });
  });
});

describe("the calls to AppConfig", () => {
  it("stores the document as a version first, then deploys exactly that version", async () => {
    const sent: unknown[] = [];
    const client = {
      send: async (command: unknown) => {
        sent.push(command);
        return command instanceof CreateHostedConfigurationVersionCommand
          ? { VersionNumber: 7 }
          : { DeploymentNumber: 3, ConfigurationVersion: "7", State: "DEPLOYING" };
      },
    };
    const document = parseDocument(
      JSON.stringify({
        version: "1",
        flags: {
          readOnly: {},
          noteStats: { attributes: { rolloutPercent: { constraints: { type: "number" } } } },
        },
        values: { readOnly: { enabled: true }, noteStats: { enabled: false } },
      }),
      knownFlags,
    );
    const result = await deployFlags(client as never, target, document, "test");

    expect(result).toMatchObject({ DeploymentNumber: 3, State: "DEPLOYING" });
    const [store, start] = sent as [
      CreateHostedConfigurationVersionCommand,
      StartDeploymentCommand,
    ];
    expect(store).toBeInstanceOf(CreateHostedConfigurationVersionCommand);
    expect(store.input).toMatchObject({
      ApplicationId: "app1",
      ConfigurationProfileId: "prof1",
      ContentType: "application/json",
    });
    expect(JSON.parse(new TextDecoder().decode(store.input.Content as Uint8Array))).toEqual(
      document,
    );
    expect(start).toBeInstanceOf(StartDeploymentCommand);
    expect(start.input).toMatchObject({
      EnvironmentId: "env1",
      DeploymentStrategyId: "str1",
      ConfigurationVersion: "7",
    });
  });

  it("does not start a deployment when storing the version failed", async () => {
    const sent: unknown[] = [];
    const client = {
      send: async (command: unknown) => {
        sent.push(command);
        throw new Error("BadRequestException");
      },
    };
    const document = parseDocument(
      JSON.stringify({
        version: "1",
        flags: { readOnly: {}, noteStats: {} },
        values: { readOnly: { enabled: false }, noteStats: { enabled: false } },
      }),
      knownFlags,
    );
    await expect(deployFlags(client as never, target, document, "test")).rejects.toThrow();
    expect(sent).toHaveLength(1);
  });

  it("always allows the revert, so that a baking deployment can be stopped too", async () => {
    const sent: StopDeploymentCommand[] = [];
    await stopDeployment(
      {
        send: async (command: unknown) => void sent.push(command as StopDeploymentCommand),
      } as never,
      target,
      { deployment: 4 },
    );
    expect(sent[0]?.input).toEqual({
      ApplicationId: "app1",
      EnvironmentId: "env1",
      DeploymentNumber: 4,
      AllowRevert: true,
    });
  });
});
