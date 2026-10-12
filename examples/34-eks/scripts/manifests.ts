// vp run eks:manifests cluster | kubectl apply -f -
// vp run eks:manifests app --tag v1 | kubectl apply -f -
//   node scripts/manifests.ts <cluster|app> [--tag v1] [--node-subnets public|private]
//     [--node-role name --security-group sg-...] [--image repository:tag] [--allowed-origin url]
//
// Prints the manifests with the deployed stacks' values filled in. Reads the stack
// outputs from cdkd's state unless every value it needs is given as a flag.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { CONTAINERS_STACK, parseContainersConfig } from "@aih/example-12-containers/src/config.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { EKS_STACK, NODE_SUBNETS } from "../src/config.ts";
import { referenceProblems } from "../src/k8s/check.ts";
import { parseList } from "../src/k8s/schema.ts";
import { appManifests, clusterManifests } from "../src/manifests.ts";
import { toJson } from "../src/rendered.ts";

const { values, positionals } = parseArgs({
  options: {
    tag: { type: "string" },
    image: { type: "string" },
    "node-role": { type: "string" },
    "security-group": { type: "string" },
    "node-subnets": { type: "string", default: "public" },
    "allowed-origin": { type: "string", default: "http://localhost:5173" },
  },
  allowPositionals: true,
});
const [bundle] = positionals;

try {
  if (bundle !== "cluster" && bundle !== "app") {
    throw new Error("usage: manifests.ts <cluster|app> [--tag v1] [--node-subnets public|private]");
  }

  let rendered;
  if (bundle === "cluster") {
    let nodeRole = values["node-role"];
    let securityGroupId = values["security-group"];
    if (nodeRole === undefined || securityGroupId === undefined) {
      const { target } = await preflight({
        access: "observe",
        action: "read the cluster stack's outputs",
        stack: EKS_STACK,
      });
      const outputs = await readStackOutputs(process.cwd(), EKS_STACK, target.region);
      nodeRole ??= requireOutput(outputs, "NodeRoleName");
      securityGroupId ??= requireOutput(outputs, "ClusterSecurityGroupId");
    }
    rendered = clusterManifests({
      nodeRole,
      securityGroupId,
      nodeSubnets: v.parse(v.picklist(NODE_SUBNETS), values["node-subnets"]),
    });
  } else {
    let image = values.image;
    if (image === undefined) {
      // The same rule chapter 12 applies to the tag it pushes.
      const tag = parseContainersConfig({ imageTag: values.tag }).imageTag;
      if (tag === undefined) {
        throw new Error(
          "say which image to run: --tag v1, the tag pushed with `vp run ecs:image:push v1`",
        );
      }
      const { target } = await preflight({
        access: "observe",
        action: "read the repository URI from chapter 12's stack",
        stack: CONTAINERS_STACK,
      });
      const outputs = await readStackOutputs("../12-containers", CONTAINERS_STACK, target.region);
      image = `${requireOutput(outputs, "RepositoryUri")}:${tag}`;
    }
    rendered = appManifests({ image, allowedOrigin: values["allowed-origin"] });
  }

  // The same schemas the tests use. A value from a stack output is input like any other.
  const checked = parseList(rendered);
  if (bundle === "cluster") {
    const problems = referenceProblems(checked.items);
    if (problems.length > 0) {
      throw new Error(problems.join("\n"));
    }
  }
  process.stdout.write(toJson(checked));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
