// How a chapter's title is taken apart. Shared by the page heading and the sidebar.

/** "03 SPA を公開する: private S3 origin と CloudFront" as its number, its name, and what it is about. */
export function chapterTitle(
  text: string,
): { number: string; name: string; about?: string } | undefined {
  const match = /^(\d{2})\s+(.+)$/.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, number = "", rest = ""] = match;
  // Either colon: the Japanese chapters use the ASCII one too.
  const colon = rest.search(/[:：]\s/);
  return colon === -1
    ? { number, name: rest }
    : { number, name: rest.slice(0, colon), about: rest.slice(colon + 1).trim() };
}

/** The pages a chapter can have after its opening page, in reading order, with their names. */
export const chapterParts = [
  ["build", { ja: "しくみと実装", en: "Design and Build" }],
  ["more", { ja: "実装のつづき", en: "Build, Continued" }],
  ["local", { ja: "手元で動かす", en: "Run It Locally" }],
  ["deploy", { ja: "デプロイ", en: "Deploy" }],
  ["wrap", { ja: "費用、注意点、片付け", en: "Costs, Pitfalls, and Cleanup" }],
] as const;

/** What a chapter's opening page is called in the list of its pages. */
export const openingPage = { ja: "概要", en: "Overview" } as const;
