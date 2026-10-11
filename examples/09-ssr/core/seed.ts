// Checked against publicNoteSchema when the server starts.
export const seedNotes: unknown = [
  {
    id: "regional-not-edge",
    title: "This page was rendered in Tokyo",
    body: "The HTML you are reading came out of a Lambda function in ap-northeast-1. CloudFront carried it to you, and may have kept a copy for a minute.",
    updatedAt: "2026-10-09T03:00:00.000Z",
  },
  {
    id: "what-a-shared-cache-keeps",
    title: "What a shared cache keeps",
    body: "A CDN stores one response and hands it to many people. That is the whole point, and it is also how a page meant for one person reaches another.",
    updatedAt: "2026-10-10T03:00:00.000Z",
  },
  {
    id: "tokens-stay-on-the-server",
    title: "Tokens stay on the server",
    body: "The browser holds a cookie that means nothing by itself. The server looks up what it stands for.",
    updatedAt: "2026-10-11T03:00:00.000Z",
  },
];
