// vp run links:check
//   node tools/src/checks/links.ts <built site directory>
//
// Follows every internal link and asset reference in the built HTML and
// fails when its target was not generated. It also confirms that each page
// exists at the object key the CloudFront function will ask S3 for.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "book/dist");
if (!existsSync(join(root, "index.html"))) {
  console.error(`${root} has no index.html. Build the site first.`);
  process.exit(1);
}

const walk = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const files = walk(root);
const pages = files.filter((file) => file.endsWith(".html"));
const broken: string[] = [];
let checked = 0;

for (const page of pages) {
  const html = readFileSync(page, "utf8");
  for (const match of html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
    const target = match[1];
    if (target === undefined || target.startsWith("//")) {
      continue;
    }
    checked++;
    // The same mapping as book/infra/functions/url-rewrite.js.
    const key = target.endsWith("/") ? `${target}index.html` : target;
    if (!existsSync(join(root, key))) {
      broken.push(`${relative(root, page)} -> ${target}`);
    }
  }
}

for (const required of ["404.html", "search-index.json", "ja/index.html", "en/index.html"]) {
  if (!existsSync(join(root, required))) {
    broken.push(`(site) -> /${required} was not generated`);
  }
}

if (broken.length > 0) {
  console.error(`${broken.length} broken internal reference(s):\n  ${[...new Set(broken)].slice(0, 50).join("\n  ")}`);
  process.exit(1);
}
console.log(`links check passed: ${pages.length} pages, ${checked} internal references`);
