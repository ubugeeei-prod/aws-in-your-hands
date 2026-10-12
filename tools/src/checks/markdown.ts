// The small amount of Markdown structure the consistency checks rely on.

export type Page = {
  frontmatter: Record<string, string>;
  sections: string[];
  imports: { path: string; region: string | undefined }[];
  diagrams: string[];
  links: string[];
  headings: number;
  codeBlocks: number;
};

const FENCE = /^(`{3,})(\S*)\s*$/;

export function parsePage(markdown: string): Page {
  const lines = markdown.split("\n");
  const frontmatter: Record<string, string> = {};
  let start = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    for (const line of lines.slice(1, end)) {
      const match = /^([A-Za-z]+):\s*(.*)$/.exec(line);
      if (match?.[1] !== undefined) {
        frontmatter[match[1]] = (match[2] ?? "").replace(/^"(.*)"$/, "$1");
      }
    }
    start = end + 1;
  }

  const page: Page = {
    frontmatter,
    sections: [],
    imports: [],
    diagrams: [],
    links: [],
    headings: 0,
    codeBlocks: 0,
  };
  let fence: { marker: string; language: string; body: string[] } | undefined;

  for (const line of lines.slice(start)) {
    const fenceMatch = FENCE.exec(line);
    if (fence !== undefined) {
      if (fenceMatch?.[1] === fence.marker && fenceMatch[2] === "") {
        if (fence.language === "text") {
          page.diagrams.push(fence.body.join("\n"));
        }
        fence = undefined;
      } else {
        fence.body.push(line);
      }
      continue;
    }
    if (fenceMatch?.[1] !== undefined) {
      fence = { marker: fenceMatch[1], language: fenceMatch[2] ?? "", body: [] };
      page.codeBlocks++;
      continue;
    }

    const section = /^<!-- section: (\S+) -->$/.exec(line);
    if (section?.[1] !== undefined) {
      page.sections.push(section[1]);
    }
    const snippet = /^<<< @\/([^\s{]+)(?:\{([^}]+)\})?\s*$/.exec(line);
    if (snippet?.[1] !== undefined) {
      page.imports.push({ path: snippet[1], region: snippet[2] });
    }
    if (/^#{1,6} /.test(line)) {
      page.headings++;
    }
    for (const link of line.matchAll(/\]\((\/[^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (link[1] !== undefined) {
        page.links.push(link[1]);
      }
    }
  }
  return page;
}

/** Whether `source` declares `#region name` (as the snippet importer requires). */
export const hasRegion = (source: string, name: string): boolean =>
  new RegExp(`#region ${name.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(source);
