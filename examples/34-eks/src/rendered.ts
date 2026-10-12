import type { ManifestList } from "./k8s/schema.ts";
import { appManifests, type AppInput, type ClusterInput, clusterManifests } from "./manifests.ts";

// #region example
/**
 * Stand-ins for the three values that exist only after a deploy. k8s/ holds the manifests
 * rendered with these, so they can be read and reviewed without an AWS account.
 */
export const EXAMPLE_CLUSTER: ClusterInput = {
  nodeRole: "AihEks-NodeRole-EXAMPLE",
  securityGroupId: "sg-0123456789abcdef0",
  nodeSubnets: "public",
};

export const EXAMPLE_APP: AppInput = {
  image: "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/repository-name:v1",
  allowedOrigin: "http://localhost:5173",
};

export function renderedFiles(): Record<string, ManifestList> {
  return {
    "cluster.json": clusterManifests(EXAMPLE_CLUSTER),
    "app.json": appManifests(EXAMPLE_APP),
  };
}
// #endregion example

/** kubectl reads JSON as readily as YAML, and JSON needs no extra dependency to write. */
export const toJson = (list: ManifestList): string => `${JSON.stringify(list, null, 2)}\n`;
