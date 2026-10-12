import { describe, expect, it } from "vite-plus/test";

import { importsFor } from "./imports.ts";

const file = `import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { z } from "zod";

import handler, { type Options, retry as again } from "./handler.ts";
`;

describe("the imports a shown region needs", () => {
  it("keeps the statements it uses, cut down to the names it uses, in the file's order", () => {
    const snippet = `const bucket = new s3.Bucket(this, "Notes", { versioned: true });
new CfnOutput(this, "BucketName", { value: bucket.bucketName });`;
    expect(importsFor(file, snippet)).toEqual([
      'import { CfnOutput } from "aws-cdk-lib";',
      'import * as s3 from "aws-cdk-lib/aws-s3";',
    ]);
  });

  it("keeps type-only imports as type-only, whichever way the file wrote them", () => {
    const snippet = "constructor(scope: Construct, id: string, props: StackProps) {}";
    expect(importsFor(file, snippet)).toEqual([
      'import { type StackProps } from "aws-cdk-lib";',
      'import type { Construct } from "constructs";',
    ]);
  });

  it("keeps a default import, and a renamed one under the name the code uses", () => {
    expect(importsFor(file, "await again(() => handler(event));")).toEqual([
      'import handler, { retry as again } from "./handler.ts";',
    ]);
  });

  // `iam` in "iam:PassRole", `Stack` in a comment, `z` in `x.z`: none of these is a use.
  it("is not fooled by a name inside a string, a comment, or after a dot", () => {
    const snippet = `// The Stack owns it.
const action = "iam:PassRole";
const depth = point.z;
const options = { Duration: 3 };`;
    expect(importsFor(file, snippet)).toEqual([]);
  });

  it("leaves a module alone when the region imports it itself", () => {
    const snippet = `import { z } from "zod";
export const schema = z.object({ ttl: z.number() });
export const wait = Duration.seconds(3);`;
    expect(importsFor(file, snippet)).toEqual(['import { Duration } from "aws-cdk-lib";']);
  });

  it("reads an import that runs over several lines", () => {
    const wrapped = 'import {\n  GetCommand,\n  PutCommand,\n} from "@aws-sdk/lib-dynamodb";\n';
    expect(importsFor(wrapped, "await client.send(new PutCommand(input));")).toEqual([
      'import { PutCommand } from "@aws-sdk/lib-dynamodb";',
    ]);
  });
});
