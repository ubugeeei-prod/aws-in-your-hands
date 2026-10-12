// vp run nova:models
//   node scripts/models.ts
//
// Asks the account which Amazon Nova models and inference profiles exist in the Region,
// and compares the answer with src/catalog.ts. Reads AWS. Calls no model: nothing is billed.

import {
  BedrockClient,
  ListFoundationModelsCommand,
  paginateListInferenceProfiles,
} from "@aws-sdk/client-bedrock";
import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";

import { CHECKED_AT, type NovaModel, novaModels, retiredNovaModels } from "../src/catalog.ts";

// #region shapes
// The fields of ListFoundationModels and ListInferenceProfiles this script reads.
const modelsSchema = v.object({
  modelSummaries: v.array(
    v.looseObject({
      modelId: v.string(),
      inputModalities: v.optional(v.array(v.string()), []),
      outputModalities: v.optional(v.array(v.string()), []),
      inferenceTypesSupported: v.optional(v.array(v.string()), []),
      modelLifecycle: v.optional(v.looseObject({ status: v.string() })),
    }),
  ),
});
const profilesSchema = v.object({
  inferenceProfileSummaries: v.optional(
    v.array(v.looseObject({ inferenceProfileId: v.string(), status: v.optional(v.string()) })),
    [],
  ),
});
// #endregion shapes

try {
  const { target } = await preflight({
    access: "observe",
    action: "list Amazon Nova models and inference profiles",
  });
  const client = new BedrockClient({ region: target.region });

  const listed = v
    .parse(
      modelsSchema,
      await client.send(new ListFoundationModelsCommand({ byProvider: "Amazon" })),
    )
    .modelSummaries.filter((model) => model.modelId.includes("nova"));
  console.log(`models in ${target.region}:`);
  for (const model of listed) {
    console.log(
      `  ${model.modelId}  ${model.modelLifecycle?.status ?? "?"}  ` +
        `${model.inputModalities.join("+")} -> ${model.outputModalities.join("+")}  ` +
        `[${model.inferenceTypesSupported.join(", ")}]`,
    );
  }

  const profiles: string[] = [];
  for await (const page of paginateListInferenceProfiles(
    { client },
    { typeEquals: "SYSTEM_DEFINED" },
  )) {
    for (const profile of v.parse(profilesSchema, page).inferenceProfileSummaries) {
      if (profile.inferenceProfileId.includes("nova")) {
        profiles.push(profile.inferenceProfileId);
        console.log(`  profile ${profile.inferenceProfileId}  ${profile.status ?? "?"}`);
      }
    }
  }

  // #region compare
  const known = (novaModels as readonly NovaModel[]).flatMap((model) =>
    model.tokyo.map((route) => route.id),
  );
  // An in-Region route is a model ID. The others are profile IDs.
  const offered = new Set([...listed.map((model) => model.modelId), ...profiles]);
  const gone = known.filter((id) => !offered.has(id));
  const unlisted = [...offered].filter(
    (id) => !known.includes(id) && !listed.some((model) => model.modelId === id),
  );
  const revived = retiredNovaModels.filter((model) => offered.has(model.modelId));
  // #endregion compare

  console.log(`\nagainst src/catalog.ts (read ${CHECKED_AT}):`);
  console.log(
    `  routes the catalog has and the account does not list: ${gone.join(", ") || "none"}`,
  );
  console.log(
    `  profiles the account lists and the catalog lacks: ${unlisted.join(", ") || "none"}`,
  );
  console.log(
    `  retired models the account still lists: ${revived.map((model) => model.modelId).join(", ") || "none"}`,
  );
  if (gone.length > 0) {
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exit(1);
}
