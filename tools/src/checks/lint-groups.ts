/** Keep each chapter's TypeScript backends within one lint process. */
export function lintGroups(paths: string[]): { name: string; paths: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const path of new Set(paths)) {
    const parts = path.split("/");
    const name =
      parts.length === 1
        ? "."
        : parts[0] === "examples" && parts.length > 2
          ? parts.slice(0, 2).join("/")
          : (parts[0] ?? ".");
    const group = groups.get(name) ?? [];
    group.push(path);
    groups.set(name, group);
  }
  return [...groups].map(([name, files]) => ({ name, paths: files.toSorted() }));
}
