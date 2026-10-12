import { describe, expect, it } from "vite-plus/test";

import { chapterTitle } from "./title.ts";
import { codeOrigins } from "./transform.ts";

describe("a chapter's opening heading", () => {
  it("separates the number, the name, and what the chapter is about", () => {
    expect(chapterTitle("03 SPA を公開する: private S3 origin と CloudFront")).toEqual({
      number: "03",
      name: "SPA を公開する",
      about: "private S3 origin と CloudFront",
    });
    expect(chapterTitle("24 celld")).toEqual({ number: "24", name: "celld" });
  });

  it("splits at the first colon only, and only at one followed by a space", () => {
    expect(chapterTitle("12 Containers: ECS Express Mode: the short way")?.name).toBe("Containers");
    expect(chapterTitle("10 Edge: s3:GetObject at the edge")?.about).toBe(
      "s3:GetObject at the edge",
    );
    expect(chapterTitle("09 SSR at 12:00")).toEqual({ number: "09", name: "SSR at 12:00" });
  });

  it("leaves pages that are not chapters alone", () => {
    expect(chapterTitle("この本について")).toBeUndefined();
    expect(chapterTitle("2026 年の料金")).toBeUndefined();
  });
});

describe("where a page's code blocks came from", () => {
  it("lists fences and imports in the order they appear", () => {
    const page = [
      "```ts",
      "const a = 1;",
      "```",
      "",
      "<<< @/examples/05-dynamodb/src/id.ts{id}",
      "",
      "<<< @/.env.example",
    ];
    expect(codeOrigins(page.join("\n"))).toEqual([
      undefined,
      { path: "examples/05-dynamodb/src/id.ts", region: "id" },
      { path: ".env.example" },
    ]);
  });

  // A page that shows how to write an import must not have its example taken for one.
  it("does not count an import written inside a fence", () => {
    const page = ["````md", "```ts", "<<< @/not/an/import.ts", "```", "````", "<<< @/real.ts"];
    expect(codeOrigins(page.join("\n"))).toEqual([undefined, { path: "real.ts" }]);
  });
});
