// A finished CLI command says the API accepted the change. These checks say it arrived.

import { IMMUTABLE, REVALIDATE } from "./plan.ts";
import { REVISION_KEY } from "./revision.ts";

export type Observed = { status: number; headers: Record<string, string>; body: string };

export type Check = {
  name: string;
  /** Path on the site, or an absolute URL. */
  path: string;
  /** Returns null when the response is acceptable, otherwise what is wrong. */
  verify: (observed: Observed) => string | null;
};

export const PROFILES = ["book", "spa"] as const;
export type Profile = (typeof PROFILES)[number];

const status = (expected: number) => (observed: Observed) =>
  observed.status === expected ? null : `expected status ${expected}, got ${observed.status}`;

const all =
  (...verifiers: Check["verify"][]): Check["verify"] =>
  (observed) => {
    for (const verify of verifiers) {
      const problem = verify(observed);
      if (problem !== null) {
        return problem;
      }
    }
    return null;
  };

const header = (name: string, expected: string) => (observed: Observed) =>
  observed.headers[name] === expected
    ? null
    : `expected ${name}: ${expected}, got ${observed.headers[name] ?? "(none)"}`;

const html = (observed: Observed) =>
  (observed.headers["content-type"] ?? "").startsWith("text/html")
    ? null
    : `expected HTML, got ${observed.headers["content-type"] ?? "(none)"}`;

const contains = (text: string) => (observed: Observed) =>
  observed.body.includes(text) ? null : `body does not contain ${JSON.stringify(text)}`;

const page = (...extra: Check["verify"][]) =>
  all(status(200), html, header("cache-control", REVALIDATE), ...extra);

export function revisionCheck(expectedRevision: string): Check {
  return {
    name: `serves revision ${expectedRevision}`,
    path: `/${REVISION_KEY}`,
    verify: all(status(200), (observed) => {
      try {
        const revision = (JSON.parse(observed.body) as { revision?: unknown }).revision;
        return revision === expectedRevision ? null : `site serves revision ${String(revision)}`;
      } catch {
        return "revision file is not JSON";
      }
    }),
  };
}

export function httpsRedirectCheck(host: string): Check {
  return {
    name: "redirects plain HTTP to HTTPS",
    path: `http://${host}/`,
    verify: (observed) =>
      [301, 308].includes(observed.status) &&
      (observed.headers["location"] ?? "").startsWith("https://")
        ? null
        : `expected a redirect to https, got ${observed.status} ${observed.headers["location"] ?? ""}`,
  };
}

/** Found from a page, because the name changes with every build. */
export function assetCheckFrom(pageBody: string): Check | string {
  const match = /(?:href|src)="(\/assets\/[^"]+)"/.exec(pageBody);
  if (match?.[1] === undefined) {
    return "the page links to no /assets/ file";
  }
  return {
    name: "serves a hashed asset as immutable",
    path: match[1],
    verify: all(status(200), header("cache-control", IMMUTABLE)),
  };
}

export function checksFor(profile: Profile): { checks: Check[]; assetSourcePath: string } {
  if (profile === "book") {
    return {
      assetSourcePath: "/ja/",
      checks: [
        { name: "language chooser at the root", path: "/", verify: page() },
        { name: "Japanese home", path: "/ja/", verify: page(contains('<html lang="ja"')) },
        { name: "English home", path: "/en/", verify: page(contains('<html lang="en"')) },
        {
          name: "Japanese deep link",
          path: "/ja/chapters/00-welcome/",
          verify: page(contains('<html lang="ja"')),
        },
        {
          name: "English deep link",
          path: "/en/chapters/00-welcome/",
          verify: page(contains('<html lang="en"')),
        },
        {
          name: "adds the trailing slash with a redirect",
          path: "/ja/chapters/00-welcome",
          verify: all(status(301), header("location", "/ja/chapters/00-welcome/")),
        },
        {
          name: "unknown page is a real 404, not the home page",
          path: "/ja/aih-smoke-missing/",
          verify: all(status(404), html),
        },
        {
          name: "search index",
          path: "/search-index.json",
          verify: all(status(200), header("cache-control", REVALIDATE)),
        },
      ],
    };
  }
  return {
    assetSourcePath: "/",
    checks: [
      { name: "application shell", path: "/", verify: page(contains('<div id="app"')) },
      {
        // The client-side router owns this path; no object exists for it.
        name: "deep link falls back to the application shell",
        path: "/notes/aih-smoke-deep-link",
        verify: page(contains('<div id="app"')),
      },
      {
        // HTML with a 200 here would be run as JavaScript by the browser.
        name: "missing asset is a 404, not the application shell",
        path: "/assets/aih-smoke-missing.js",
        verify: status(404),
      },
    ],
  };
}
