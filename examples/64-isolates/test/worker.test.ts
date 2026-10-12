import { describe, expect, it } from "vite-plus/test";

import { composeApp } from "@aih/example-04-http-api/src/compose.ts";

import entry from "../src/entry.ts";
import { asWorker, textBindings } from "../src/worker.ts";

const bindings = { ALLOWED_ORIGIN: "http://localhost:5173", STAGE: "test" };
const url = (path: string) => `http://worker.test${path}`;

describe("chapter 04's app as a worker", () => {
  it("is the default export workerd calls, answering from the bindings", async () => {
    const response = await entry.fetch(new Request(url("/health")), bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", stage: "test" });
  });

  it("composes the app once, with the bindings of the first request", async () => {
    let composed = 0;
    const worker = asWorker((source) => {
      composed += 1;
      return composeApp(source);
    });
    await worker.fetch(new Request(url("/health")), bindings);
    const second = await worker.fetch(new Request(url("/health")), { ...bindings, STAGE: "other" });
    expect(composed).toBe(1);
    expect(await second.json()).toEqual({ status: "ok", stage: "test" });
  });

  // #region shared
  it("keeps one store for every request the isolate serves", async () => {
    const worker = asWorker(composeApp);
    const created = await worker.fetch(
      new Request(url("/notes"), { method: "POST", body: '{"title":"kept","body":""}' }),
      bindings,
    );
    const { id } = (await created.json()) as { id: string };
    // A different request, the same module scope: the Map is still there.
    expect((await worker.fetch(new Request(url(`/notes/${id}`)), bindings)).status).toBe(200);
    // Another worker object stands for another isolate: its Map is its own.
    expect(
      (await asWorker(composeApp).fetch(new Request(url(`/notes/${id}`)), bindings)).status,
    ).toBe(404);
  });
  // #endregion shared

  it("fails every request, not only the first, while a required binding is missing", async () => {
    const worker = asWorker(composeApp);
    await expect(worker.fetch(new Request(url("/health")), {})).rejects.toThrow("ALLOWED_ORIGIN");
    await expect(worker.fetch(new Request(url("/health")), {})).rejects.toThrow("ALLOWED_ORIGIN");
    // Once the binding is there, the same worker recovers.
    expect((await worker.fetch(new Request(url("/health")), bindings)).status).toBe(200);
  });

  it("passes on text bindings only", () => {
    expect(
      textBindings({ STAGE: "dev", UNSET: null, NOTES_KV: { get: () => null }, COUNT: 3 }),
    ).toEqual({ STAGE: "dev" });
    expect(textBindings(undefined)).toEqual({});
  });
});
