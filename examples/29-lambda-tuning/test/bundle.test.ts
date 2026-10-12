import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { BUDGET, overBudget } from "../src/bundle/budget.ts";
import { type Built, buildVariant, ownerOf } from "../src/bundle/build.ts";
import { invoke, median } from "../src/bundle/measure.ts";
import { DEPLOYED, type VariantName, variantNames } from "../src/bundle/variants.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const built = new Map<VariantName, Built>();
const get = (name: VariantName): Built => {
  const bundle = built.get(name);
  if (bundle === undefined) {
    throw new Error(`${name} was not built`);
  }
  return bundle;
};
const bytesFrom = (bundle: Built, prefix: string) =>
  bundle.packages
    .filter((owner) => owner.name.startsWith(prefix))
    .reduce((sum, owner) => sum + owner.bytes, 0);

beforeAll(async () => {
  for (const name of variantNames) {
    built.set(name, await buildVariant(name, root));
  }
});

describe("the bundle that is deployed", () => {
  it("stays within its budget", () => {
    // Fails when a new dependency, or a wider import, makes the bundle grow.
    expect(overBudget(get(DEPLOYED))).toEqual([]);
  });

  it("has a budget that would notice the settings of chapter 05", () => {
    expect(overBudget(get("as-chapter-05"))).toHaveLength(2);
    expect(overBudget(get("module-first"))).toHaveLength(2);
    // Less than a third of headroom, or the budget stops meaning anything.
    expect(get(DEPLOYED).bytes).toBeGreaterThan(BUDGET.bytes * 0.7);
    expect(get(DEPLOYED).gzipBytes).toBeGreaterThan(BUDGET.gzipBytes * 0.7);
  });
});

describe("the deployed bundle in plain Node.js", () => {
  // vitest supplies its own module loader. Lambda does not, so these run a new process.
  let directory = "";
  let file = "";
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "aih-tune-"));
    file = join(directory, "index.mjs");
    writeFileSync(file, get(DEPLOYED).code);
  });
  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("loads and answers a request", async () => {
    const result = await invoke(file, "/health");
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ status: "ok" });
  });

  it("still speaks to DynamoDB after tree shaking and minifying", async () => {
    // A stand-in that answers every call the way DynamoDB answers a GetItem that finds nothing.
    const calls: { target: string | undefined; body: unknown }[] = [];
    const table = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        calls.push({
          target: request.headers["x-amz-target"]?.toString(),
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
        response.writeHead(200, { "content-type": "application/x-amz-json-1.0" });
        response.end("{}");
      });
    });
    await new Promise<void>((resolve) => table.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = table.address() as AddressInfo;
      const result = await invoke(file, "/notes/n1", {
        NOTES_STORE: "dynamodb",
        TABLE_NAME: "notes",
        DYNAMODB_ENDPOINT: `http://127.0.0.1:${port}`,
      });

      expect(result.statusCode).toBe(404);
      expect(calls).toEqual([
        {
          target: "DynamoDB_20120810.GetItem",
          body: expect.objectContaining({ TableName: "notes" }),
        },
      ]);
    } finally {
      table.close();
    }
  });
});

describe("what changes the bytes", () => {
  it("following `module` instead of `main` drops what is never called", () => {
    expect(get("module-first").bytes).toBeLessThan(get("as-chapter-05").bytes * 0.75);
  });

  it("minifying removes more than half of what is left", () => {
    expect(get("minified").bytes).toBeLessThan(get("module-first").bytes / 2);
  });

  it("the aggregated clients bring operations nobody calls", () => {
    const modular = bytesFrom(get("minified"), "@aws-sdk/client-dynamodb");
    const aggregated = bytesFrom(get("aggregated-client"), "@aws-sdk/client-dynamodb");
    expect(aggregated).toBeGreaterThan(modular * 2);
    expect(overBudget(get("aggregated-client"))).not.toEqual([]);
  });

  it("the SDK is most of the bundle, and leaving it out leaves the app", () => {
    const whole = get("minified");
    const sdk = bytesFrom(whole, "@aws-sdk/") + bytesFrom(whole, "@smithy/");
    expect(sdk).toBeGreaterThan(whole.bytes * 0.8);

    const without = get("sdk-external");
    expect(bytesFrom(without, "@aws-sdk/")).toBe(0);
    expect(without.bytes).toBeLessThan(whole.bytes / 10);
    // The imports are still there, for the runtime to resolve.
    expect(new TextDecoder().decode(without.code)).toContain("@aws-sdk/client-dynamodb");
  });
});

describe("the report's helpers", () => {
  it("name the package a bundled file came from", () => {
    expect(
      ownerOf(
        "../../node_modules/.pnpm/@smithy+core@3.35.2/node_modules/@smithy/core/dist-es/index.js",
      ),
    ).toBe("@smithy/core");
    expect(
      ownerOf("../../node_modules/.pnpm/valibot@1.5.0/node_modules/valibot/dist/index.mjs"),
    ).toBe("valibot");
    expect(ownerOf("../05-dynamodb/src/app.ts")).toBe("examples/05-dynamodb");
    expect(ownerOf("src/lambda.ts")).toBe("this example");
  });

  it("say by how much a bundle is over", () => {
    expect(overBudget({ bytes: 100, gzipBytes: 10 }, { bytes: 100, gzipBytes: 10 })).toEqual([]);
    expect(overBudget({ bytes: 130, gzipBytes: 12 }, { bytes: 100, gzipBytes: 10 })).toEqual([
      "130 bytes, 30 over the budget",
      "12 bytes gzipped, 2 over the budget",
    ]);
  });

  it("take the middle of an odd or an even number of runs", () => {
    expect(median([9, 1, 5])).toBe(5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
