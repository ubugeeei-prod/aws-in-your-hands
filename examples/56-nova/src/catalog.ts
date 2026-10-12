// The Amazon Nova family as Amazon Bedrock's model cards and lifecycle page listed it on
// CHECKED_AT. Every line here goes stale. `vp run nova:models` asks the account instead.

export const CHECKED_AT = "2026-10-13";
export const HOME_REGION = "ap-northeast-1";

// #region types
export type Modality = "text" | "image" | "video" | "audio" | "speech" | "embedding";
export type Api =
  | "Converse"
  | "InvokeModel"
  | "StartAsyncInvoke"
  | "InvokeModelWithBidirectionalStream";

/** One way to call a model from ap-northeast-1. `id` is what goes in `modelId`. */
export type Route =
  | { kind: "in-region"; id: string }
  /** An inference profile: the request is handled in one of `destinations`. */
  | { kind: "geo"; id: string; destinations: readonly string[] }
  /** An inference profile over every commercial Region. The list can grow. */
  | { kind: "global"; id: string };

export type NovaModel = {
  name: string;
  modelId: string;
  input: readonly Modality[];
  output: readonly Modality[];
  apis: readonly Api[];
  contextTokens?: number;
  maxOutputTokens?: number;
  launched: string;
  /** The card's "EOL no sooner than". Not an end date: a date before which there is none. */
  eolNoSoonerThan: string;
  /** Empty: the card lists no way to call it from ap-northeast-1. */
  tokyo: readonly Route[];
  /** List price for a call from ap-northeast-1, USD per 1,000 tokens. */
  usdPer1kTokens?: { input: number; output: number };
};
// #endregion types

const JP = ["ap-northeast-1", "ap-northeast-3"] as const;
// The APAC profiles' destinations for a request that starts in ap-northeast-1.
const APAC_FROM_TOKYO = [
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-south-1",
  "ap-southeast-1",
  "ap-southeast-2",
] as const;

// #region active
/** The models whose card said "Model lifecycle: Active". */
export const novaModels = [
  {
    name: "Nova 2 Lite",
    modelId: "amazon.nova-2-lite-v1:0",
    input: ["text", "image", "video"],
    output: ["text"],
    apis: ["Converse", "InvokeModel"],
    contextTokens: 1_000_000,
    maxOutputTokens: 64_000,
    launched: "2025-12-02",
    eolNoSoonerThan: "2026-12-02",
    // Not callable In-Region from Tokyo: the card marks Geo and Global only.
    tokyo: [
      { kind: "geo", id: "jp.amazon.nova-2-lite-v1:0", destinations: JP },
      { kind: "global", id: "global.amazon.nova-2-lite-v1:0" },
    ],
    usdPer1kTokens: { input: 0.000396, output: 0.003311 },
  },
  {
    name: "Nova Lite",
    modelId: "amazon.nova-lite-v1:0",
    input: ["text", "image", "video"],
    output: ["text"],
    apis: ["Converse", "InvokeModel"],
    contextTokens: 300_000,
    maxOutputTokens: 10_000,
    launched: "2024-12-05",
    eolNoSoonerThan: "2025-12-05",
    tokyo: [
      { kind: "in-region", id: "amazon.nova-lite-v1:0" },
      { kind: "geo", id: "apac.amazon.nova-lite-v1:0", destinations: APAC_FROM_TOKYO },
    ],
    usdPer1kTokens: { input: 0.000072, output: 0.000288 },
  },
  {
    name: "Nova Pro",
    modelId: "amazon.nova-pro-v1:0",
    input: ["text", "image", "video"],
    output: ["text"],
    apis: ["Converse", "InvokeModel"],
    contextTokens: 300_000,
    maxOutputTokens: 10_000,
    launched: "2024-12-05",
    eolNoSoonerThan: "2025-12-05",
    tokyo: [{ kind: "geo", id: "apac.amazon.nova-pro-v1:0", destinations: APAC_FROM_TOKYO }],
    usdPer1kTokens: { input: 0.00096, output: 0.00384 },
  },
  {
    name: "Nova Micro",
    modelId: "amazon.nova-micro-v1:0",
    input: ["text"],
    output: ["text"],
    apis: ["Converse", "InvokeModel"],
    contextTokens: 128_000,
    maxOutputTokens: 10_000,
    launched: "2024-12-05",
    eolNoSoonerThan: "2025-12-05",
    // The card marks Geo for Tokyo, but lists only us. and eu. profile IDs. No ID, no route.
    tokyo: [],
    usdPer1kTokens: { input: 0.000042, output: 0.000168 },
  },
  {
    name: "Nova 2 Sonic",
    modelId: "amazon.nova-2-sonic-v1:0",
    input: ["speech", "text"],
    output: ["speech", "text"],
    apis: ["InvokeModelWithBidirectionalStream"],
    contextTokens: 1_000_000,
    maxOutputTokens: 64_000,
    launched: "2025-12-02",
    eolNoSoonerThan: "2026-12-02",
    tokyo: [{ kind: "in-region", id: "amazon.nova-2-sonic-v1:0" }],
  },
  {
    name: "Nova Multimodal Embeddings",
    modelId: "amazon.nova-2-multimodal-embeddings-v1:0",
    input: ["text", "image", "video", "audio"],
    output: ["embedding"],
    // As the card marks it. The Nova 2 guide's own example also calls InvokeModel.
    apis: ["StartAsyncInvoke"],
    launched: "2025-10-28",
    eolNoSoonerThan: "2026-10-28",
    // us-east-1 and us-gov-west-1 only.
    tokyo: [],
  },
] as const satisfies readonly NovaModel[];
// #endregion active

// #region retired
export type RetiredModel = { name: string; modelId: string; legacySince: string; eol: string };

/** "Models that have reached EOL": removed from every Region listed, and requests fail. */
export const retiredNovaModels = [
  {
    name: "Nova Canvas",
    modelId: "amazon.nova-canvas-v1:0",
    legacySince: "2026-03-30",
    eol: "2026-09-30",
  },
  {
    name: "Nova Reel",
    modelId: "amazon.nova-reel-v1:0",
    legacySince: "2026-03-30",
    eol: "2026-09-30",
  },
  {
    name: "Nova Reel",
    modelId: "amazon.nova-reel-v1:1",
    legacySince: "2026-03-30",
    eol: "2026-09-30",
  },
  {
    name: "Nova Sonic",
    modelId: "amazon.nova-sonic-v1:0",
    legacySince: "2026-03-13",
    eol: "2026-09-14",
  },
] as const satisfies readonly RetiredModel[];
// #endregion retired

// #region lookup
export type Resolved = { model: NovaModel; route: Route };

/** The model and the route behind a `modelId` value, for a caller in ap-northeast-1. */
export function resolveRoute(id: string): Resolved | undefined {
  for (const model of novaModels as readonly NovaModel[]) {
    const route = model.tokyo.find((candidate) => candidate.id === id);
    if (route !== undefined) {
      return { model, route };
    }
  }
  return undefined;
}

export type Need = { input: readonly Modality[]; output: Modality; api: Api };

/** Every route from Tokyo to a model that takes all of `input`, returns `output`, and speaks `api`. */
export function routesFor(need: Need): Resolved[] {
  return (novaModels as readonly NovaModel[])
    .filter(
      (model) =>
        need.input.every((modality) => model.input.includes(modality)) &&
        model.output.includes(need.output) &&
        model.apis.includes(need.api),
    )
    .flatMap((model) => model.tokyo.map((route) => ({ model, route })));
}

/** Why an ID cannot be used, in words for the person who typed it. */
export function explainUnknown(id: string): string {
  const retired = retiredNovaModels.find((model) => id.endsWith(model.modelId));
  if (retired !== undefined) {
    return `${retired.name} (${retired.modelId}) reached end of life on ${retired.eol}: requests to it fail`;
  }
  const model = (novaModels as readonly NovaModel[]).find((entry) => id.endsWith(entry.modelId));
  if (model !== undefined) {
    const ids = model.tokyo.map((route) => route.id);
    return ids.length === 0
      ? `${model.name} has no route from ${HOME_REGION} that was confirmed on ${CHECKED_AT}`
      : `${model.name} is called from ${HOME_REGION} as ${ids.join(" or ")}, not as "${id}"`;
  }
  return `"${id}" is not in src/catalog.ts (checked ${CHECKED_AT})`;
}
// #endregion lookup

// #region lifecycle
const DAY_MS = 86_400_000;
const utcDay = (date: string): number => Date.parse(`${date}T00:00:00Z`);

export type LifecycleView =
  /** Still protected: the card promises no end of life before `eolNoSoonerThan`. */
  | { phase: "protected"; days: number }
  /** Past that date. Legacy can be announced any day; from then, at least six months remain. */
  | { phase: "unprotected"; days: number };

/** Where `today` falls against the one date the card commits to. */
export function lifecycleOn(model: Pick<NovaModel, "eolNoSoonerThan">, today: Date): LifecycleView {
  const days = Math.floor((utcDay(model.eolNoSoonerThan) - today.getTime()) / DAY_MS);
  return days > 0 ? { phase: "protected", days } : { phase: "unprotected", days: -days };
}
// #endregion lifecycle

// #region arns
export type IamResources = {
  /** Absent for an In-Region call: there is no profile, only the model. */
  profileArn?: string;
  modelArns: string[];
};

/** What an IAM policy must name before `route` can be called from `scope.region`. */
export function iamResources(
  { model, route }: Resolved,
  scope: { partition: string; region: string; account: string },
): IamResources {
  const modelArn = (region: string): string =>
    `arn:${scope.partition}:bedrock:${region}::foundation-model/${model.modelId}`;
  if (route.kind === "in-region") {
    return { modelArns: [modelArn(scope.region)] };
  }
  return {
    profileArn: `arn:${scope.partition}:bedrock:${scope.region}:${scope.account}:inference-profile/${route.id}`,
    modelArns:
      route.kind === "global"
        ? // The form the user guide gives for a global profile: the source Region, and no Region.
          [modelArn(scope.region), modelArn("")]
        : route.destinations.map(modelArn),
  };
}
// #endregion arns
