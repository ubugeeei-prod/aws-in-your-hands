import { readonly, ref } from "vue";

import { parseRoute, pathFor, type Route } from "./route.ts";

const current = ref<Route>(parseRoute(window.location.pathname));

window.addEventListener("popstate", () => {
  current.value = parseRoute(window.location.pathname);
});

export function useRoute() {
  return {
    route: readonly(current),
    navigate(route: Exclude<Route, { name: "not-found" }>): void {
      window.history.pushState(null, "", pathFor(route));
      current.value = route;
    },
  };
}
