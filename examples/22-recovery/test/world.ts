export * from "../src/local.ts";

/** Throws on the nth call of one method, once. That is how a run is stopped halfway. */
export function failingOn<T extends object>(target: T, method: keyof T & string, nth: number): T {
  let calls = 0;
  return new Proxy(target, {
    get(inner, property) {
      const value: unknown = Reflect.get(inner, property, inner);
      if (property !== method || typeof value !== "function") {
        return typeof value === "function" ? value.bind(inner) : value;
      }
      return (...args: unknown[]) => {
        if (++calls === nth) {
          throw new Error(`injected failure in ${method}`);
        }
        return (value as (...rest: unknown[]) => unknown).apply(inner, args);
      };
    },
  });
}
