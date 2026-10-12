// Puts back the imports a snippet needs.
//
// The book shows regions of real files. A region starts below the file's imports,
// so on its own it does not say where `s3.Bucket` or `z` came from. This reads the
// file's import statements and returns the ones the snippet uses, cut down to the
// names it uses.

type Named = { imported: string; local: string; typeOnly: boolean };
type Statement = {
  module: string;
  typeOnly: boolean;
  default?: string;
  namespace?: string;
  named: Named[];
};

const STATEMENT = /^import\s+(type\s+)?([^;]*?)\s+from\s+(["'])([^"']+)\3;?[ \t]*$/gm;

export function parseImports(source: string): Statement[] {
  const statements: Statement[] = [];
  for (const match of source.matchAll(STATEMENT)) {
    const [, typeOnly, clause = "", , module = ""] = match;
    const statement: Statement = { module, typeOnly: typeOnly !== undefined, named: [] };
    const braces = /\{([^}]*)\}/.exec(clause);
    const outside = clause
      .replace(/\{[^}]*\}/, "")
      .split(",")
      .map((part) => part.trim());
    for (const part of outside) {
      const namespace = /^\*\s+as\s+(\S+)$/.exec(part)?.[1];
      if (namespace !== undefined) {
        statement.namespace = namespace;
      } else if (part !== "") {
        statement.default = part;
      }
    }
    for (const part of (braces?.[1] ?? "").split(",").map((each) => each.trim())) {
      const named = /^(type\s+)?(\S+)(?:\s+as\s+(\S+))?$/.exec(part);
      if (named !== null) {
        const imported = named[2] ?? "";
        statement.named.push({
          imported,
          local: named[3] ?? imported,
          typeOnly: named[1] !== undefined,
        });
      }
    }
    statements.push(statement);
  }
  return statements;
}

/** Whether `name` is used as a name of its own: not as `x.name`, and not as part of a longer word. */
function uses(snippet: string, name: string): boolean {
  const escaped = name.replaceAll("$", "\\$");
  return new RegExp(`(?<![\\w$.])${escaped}(?![\\w$])(?!\\s*:(?!:))`).test(snippet);
}

function write(statement: Statement): string {
  const named = statement.named.map(
    (each) =>
      `${each.typeOnly ? "type " : ""}${each.imported}${each.local === each.imported ? "" : ` as ${each.local}`}`,
  );
  const parts = [
    ...(statement.default === undefined ? [] : [statement.default]),
    ...(statement.namespace === undefined ? [] : [`* as ${statement.namespace}`]),
    ...(named.length === 0 ? [] : [`{ ${named.join(", ")} }`]),
  ];
  return `import ${statement.typeOnly ? "type " : ""}${parts.join(", ")} from "${statement.module}";`;
}

/**
 * The import lines of `source` that `snippet` needs, in the file's order.
 * A module the snippet already imports itself is left to the snippet.
 */
export function importsFor(source: string, snippet: string): string[] {
  // Strings and comments mention names without using them.
  const code = snippet
    .replaceAll(/\/\/.*$/gm, "")
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');

  const lines: string[] = [];
  for (const statement of parseImports(source)) {
    if (
      new RegExp(
        `from\\s+["']${statement.module.replaceAll(/[.*+?^${}()|[\]\\/]/g, "\\$&")}["']`,
      ).test(snippet)
    ) {
      continue;
    }
    const kept: Statement = {
      module: statement.module,
      typeOnly: statement.typeOnly,
      named: statement.named.filter((each) => uses(code, each.local)),
      ...(statement.default !== undefined && uses(code, statement.default)
        ? { default: statement.default }
        : {}),
      ...(statement.namespace !== undefined &&
      new RegExp(`(?<![\\w$.])${statement.namespace}\\.`).test(code)
        ? { namespace: statement.namespace }
        : {}),
    };
    if (kept.default !== undefined || kept.namespace !== undefined || kept.named.length > 0) {
      lines.push(write(kept));
    }
  }
  return lines;
}
