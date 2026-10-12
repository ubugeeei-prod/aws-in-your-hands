export type Route =
  | { name: "list" }
  | { name: "note"; id: string }
  | { name: "new" }
  | { name: "callback" }
  | { name: "not-found"; path: string };

export function parseRoute(path: string): Route {
  const [first, second, ...rest] = path.split("/").filter((segment) => segment !== "");
  if (first === undefined) {
    return { name: "list" };
  }
  if (first === "callback" && second === undefined) {
    return { name: "callback" };
  }
  if (first === "notes" && second !== undefined && rest.length === 0) {
    return second === "new" ? { name: "new" } : { name: "note", id: decodeURIComponent(second) };
  }
  return { name: "not-found", path };
}

export const pathFor = (
  route: { name: "list" } | { name: "new" } | { name: "note"; id: string },
): string =>
  route.name === "list"
    ? "/"
    : route.name === "new"
      ? "/notes/new"
      : `/notes/${encodeURIComponent(route.id)}`;
