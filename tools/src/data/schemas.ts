import * as v from "valibot";

const text = v.pipe(v.string(), v.minLength(1));
const isoDate = v.pipe(v.string(), v.isoDate());
const positiveInteger = v.pipe(v.number(), v.integer(), v.minValue(1));

const localized = v.object({ ja: text, en: text });
const localizedList = v.object({
  ja: v.pipe(v.array(text), v.minLength(1)),
  en: v.pipe(v.array(text), v.minLength(1)),
});
const chapterId = v.pipe(v.string(), v.regex(/^\d{2}$/));

/** How far the prose has come. Says nothing about whether the code was run. */
export const writingStates = ["planned", "draft", "complete"] as const;

const base = v.object({
  id: chapterId,
  slug: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)),
  title: localized,
  prerequisites: v.array(chapterId),
  services: v.array(v.string()),
  samplePath: v.nullable(v.string()),
  sourceIds: v.array(v.string()),
});

const written = v.object({
  ...base.entries,
  writing: v.object({
    ja: v.picklist(["draft", "complete"]),
    en: v.picklist(["draft", "complete"]),
  }),
  /** Bumped whenever the Japanese source text changes in meaning. */
  sourceRevision: positiveInteger,
  /** The source revision each translation was made from. */
  translatedRevision: v.object({ en: positiveInteger }),
  checkedAt: isoDate,
});

const planned = v.object({
  ...base.entries,
  writing: v.object({ ja: v.literal("planned"), en: v.literal("planned") }),
  outline: v.object({
    outcome: localized,
    architecture: localized,
    topics: localizedList,
    requiredSource: localizedList,
    distributed: localized,
  }),
});

export const chapterSchema = v.union([written, planned]);
export type Chapter = v.InferOutput<typeof chapterSchema>;
export type PlannedChapter = v.InferOutput<typeof planned>;
export type WrittenChapter = v.InferOutput<typeof written>;

export const manifestSchema = v.object({
  bookRevision: v.string(),
  paths: v.record(v.string(), v.array(chapterId)),
  chapters: v.array(chapterSchema),
});
export type Manifest = v.InferOutput<typeof manifestSchema>;

export const sourcesSchema = v.object({
  sources: v.array(
    v.object({
      id: v.string(),
      url: v.pipe(v.string(), v.url()),
      title: v.string(),
      /** null: listed for later use, not re-read while writing. */
      checkedAt: v.nullable(isoDate),
      supports: v.pipe(v.array(v.string()), v.minLength(1)),
      note: v.optional(v.string()),
    }),
  ),
});

export const glossarySchema = v.object({
  terms: v.array(
    v.object({
      id: v.string(),
      ja: v.string(),
      en: v.string(),
      firstUse: chapterId,
      definition: localized,
    }),
  ),
});

/** Whether the code was run, and where. Independent of the writing state. */
export const verificationStates = ["unverified", "local", "aws"] as const;

export const sectionMapSchema = v.looseObject({
  sections: v.array(
    v.object({
      /** Matches a `<!-- section: ID -->` marker present in both locales. */
      id: v.pipe(v.string(), v.regex(/^[a-z0-9]+\.[a-z0-9-]+$/)),
      /** Repository paths that the section explains, each at the book revision. */
      sources: v.array(v.string()),
      /** `vp run` tasks that start or check what the section explains. */
      tasks: v.array(v.string()),
      boundary: v.picklist(["none", "local", "cloud", "local+cloud"]),
      criteria: v.array(v.picklist(["type", "test", "local-dx", "drift", "distributed", "cost"])),
      verification: v.picklist(verificationStates),
    }),
  ),
});
export type SectionMap = v.InferOutput<typeof sectionMapSchema>;

export const validationSchema = v.object({
  environment: v.object({
    os: v.string(),
    cpu: v.string(),
    nix: v.string(),
    recordedAt: isoDate,
  }),
  records: v.array(
    v.object({
      scope: v.string(),
      command: v.string(),
      kind: v.picklist(["local", "aws"]),
      status: v.picklist(["passed", "failed", "not-run"]),
      ranAt: v.nullable(isoDate),
      note: localized,
    }),
  ),
  open: v.array(v.object({ id: v.string(), summary: localized, resume: localized })),
});

export const toolchainSchema = v.object({
  recordedAt: isoDate,
  verifiedPlatforms: v.array(v.string()),
  unverifiedPlatforms: v.array(v.string()),
  tools: v.array(
    v.object({
      name: v.string(),
      version: v.string(),
      providedBy: v.string(),
      pinnedIn: v.string(),
    }),
  ),
});
