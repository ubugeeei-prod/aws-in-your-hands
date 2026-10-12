// The same function bundled five ways. One of them is what the stack deploys.

import type { BuildOptions } from "esbuild";

// #region shared
// The bundled AWS SDK still calls require(); an ESM bundle has none unless we provide it.
export const REQUIRE_BANNER =
  "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);";

/** The options every variant has, as `nodejs.NodejsFunction` passes them to esbuild. */
export const shared = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  banner: { js: REQUIRE_BANNER },
} as const satisfies BuildOptions;

/**
 * Which entry of a package's package.json to follow. For Node.js esbuild looks at `main`
 * first, and for the AWS SDK that is its CommonJS build, which cannot be tree-shaken.
 */
export const MODULE_FIRST = ["module", "main"];
// #endregion shared

// #region variants
export type Variant = {
  entry: string;
  mainFields: string[] | undefined;
  minify: boolean;
  external: string[];
  what: string;
};

export const variants = {
  "as-chapter-05": {
    entry: "src/lambda.ts",
    mainFields: undefined,
    minify: false,
    external: [],
    what: "the settings chapters 05 and 19 deploy with: the SDK bundled, nothing else chosen",
  },
  "module-first": {
    entry: "src/lambda.ts",
    mainFields: MODULE_FIRST,
    minify: false,
    external: [],
    what: "the ES module builds of the dependencies, so unused code can be dropped",
  },
  minified: {
    entry: "src/lambda.ts",
    mainFields: MODULE_FIRST,
    minify: true,
    external: [],
    what: "also minified: what this chapter's stack deploys",
  },
  "aggregated-client": {
    entry: "measure/aggregated.ts",
    mainFields: MODULE_FIRST,
    minify: true,
    external: [],
    what: "the deployed settings, with the code written against the DynamoDB and DynamoDBDocument classes",
  },
  "sdk-external": {
    entry: "src/lambda.ts",
    mainFields: MODULE_FIRST,
    minify: true,
    // NodejsFunction's default when `externalModules` is not given.
    external: ["@aws-sdk/*"],
    what: "the SDK left out, to be loaded from the Lambda runtime (here: from node_modules)",
  },
} as const satisfies Record<string, Variant>;

export type VariantName = keyof typeof variants;
export const variantNames = Object.keys(variants) as VariantName[];

/** The variant the CDK stack's bundling options correspond to. */
export const DEPLOYED: VariantName = "minified";
// #endregion variants
