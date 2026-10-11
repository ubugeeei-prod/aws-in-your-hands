// #region route
// The server knows none of these paths. It only has index.html and hashed assets.
export type Route =
  | { name: "list" }
  | { name: "note"; id: string }
  | { name: "new" }
  | { name: "not-found"; path: string };

export function parseRoute(path: string): Route {
  const segments = path.split("/").filter((segment) => segment !== "");
  const [first, second, ...rest] = segments;
  if (first === undefined) {
    return { name: "list" };
  }
  if (first === "notes" && second !== undefined && rest.length === 0) {
    return second === "new" ? { name: "new" } : { name: "note", id: decodeURIComponent(second) };
  }
  return { name: "not-found", path };
}

export const pathFor = (route: Exclude<Route, { name: "not-found" }>): string =>
  route.name === "list" ? "/" : route.name === "new" ? "/notes/new" : `/notes/${encodeURIComponent(route.id)}`;
// #endregion route
