import { z } from "zod";

const localized = z.object({ ja: z.string().min(1), en: z.string().min(1) });
const localizedList = z.object({ ja: z.array(z.string().min(1)).min(1), en: z.array(z.string().min(1)).min(1) });
const chapterId = z.string().regex(/^\d{2}$/);

/** How far the prose has come. Says nothing about whether the code was run. */
export const writingStates = ["planned", "draft", "complete"] as const;

const base = z.object({
  id: chapterId,
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: localized,
  prerequisites: z.array(chapterId),
  services: z.array(z.string()),
  samplePath: z.string().nullable(),
  sourceIds: z.array(z.string()),
});

const written = base.extend({
  writing: z.object({ ja: z.enum(["draft", "complete"]), en: z.enum(["draft", "complete"]) }),
  /** Bumped whenever the Japanese source text changes in meaning. */
  sourceRevision: z.number().int().positive(),
  /** The source revision each translation was made from. */
  translatedRevision: z.object({ en: z.number().int().positive() }),
  checkedAt: z.iso.date(),
});

const planned = base.extend({
  writing: z.object({ ja: z.literal("planned"), en: z.literal("planned") }),
  outline: z.object({
    outcome: localized,
    architecture: localized,
    topics: localizedList,
    requiredSource: localizedList,
    distributed: localized,
  }),
});

export const chapterSchema = z.union([written, planned]);
export type Chapter = z.infer<typeof chapterSchema>;
export type PlannedChapter = z.infer<typeof planned>;
export type WrittenChapter = z.infer<typeof written>;

export const manifestSchema = z.object({
  bookRevision: z.string(),
  paths: z.record(z.string(), z.array(chapterId)),
  chapters: z.array(chapterSchema),
});
export type Manifest = z.infer<typeof manifestSchema>;

export const sourcesSchema = z.object({
  sources: z.array(
    z.object({
      id: z.string(),
      url: z.url(),
      title: z.string(),
      /** null: listed for later use, not re-read while writing. */
      checkedAt: z.iso.date().nullable(),
      supports: z.array(z.string()).min(1),
      note: z.string().optional(),
    }),
  ),
});

export const glossarySchema = z.object({
  terms: z.array(
    z.object({ id: z.string(), ja: z.string(), en: z.string(), firstUse: chapterId, definition: localized }),
  ),
});

/** Whether the code was run, and where. Independent of the writing state. */
export const verificationStates = ["unverified", "local", "aws"] as const;

export const sectionMapSchema = z.looseObject({
  sections: z.array(
    z.object({
      /** Matches a `<!-- section: ID -->` marker present in both locales. */
      id: z.string().regex(/^[a-z0-9]+\.[a-z0-9-]+$/),
      /** Repository paths that the section explains, each at the book revision. */
      sources: z.array(z.string()),
      /** `vp run` tasks that start or check what the section explains. */
      tasks: z.array(z.string()),
      boundary: z.enum(["none", "local", "cloud", "local+cloud"]),
      criteria: z.array(z.enum(["type", "test", "local-dx", "drift", "distributed", "cost"])),
      verification: z.enum(verificationStates),
    }),
  ),
});
export type SectionMap = z.infer<typeof sectionMapSchema>;

export const validationSchema = z.object({
  environment: z.object({ os: z.string(), cpu: z.string(), nix: z.string(), recordedAt: z.iso.date() }),
  records: z.array(
    z.object({
      scope: z.string(),
      command: z.string(),
      kind: z.enum(["local", "aws"]),
      status: z.enum(["passed", "failed", "not-run"]),
      ranAt: z.iso.date().nullable(),
      note: localized,
    }),
  ),
  open: z.array(z.object({ id: z.string(), summary: localized, resume: localized })),
});

export const toolchainSchema = z.object({
  recordedAt: z.iso.date(),
  verifiedPlatforms: z.array(z.string()),
  unverifiedPlatforms: z.array(z.string()),
  tools: z.array(z.object({ name: z.string(), version: z.string(), providedBy: z.string(), pinnedIn: z.string() })),
});
