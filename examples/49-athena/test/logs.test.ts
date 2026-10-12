import { describe, expect, it } from "vite-plus/test";

import { LOG_KINDS, logTableDdl } from "../src/logs.ts";

const input = {
  bucket: "my-trail-bucket",
  prefix: "AWSLogs/111122223333/CloudTrail/ap-northeast-1",
  table: "cloudtrail_logs",
  since: "2026-10-01",
};

describe("the documented log tables", () => {
  it("fills every placeholder of every template and leaves none behind", () => {
    for (const kind of LOG_KINDS) {
      const ddl = logTableDdl(kind, { ...input, table: "logs" });
      expect(ddl.startsWith("CREATE EXTERNAL TABLE")).toBe(true);
      for (const placeholder of [
        "amzn-s3-demo-bucket",
        "bucket-name",
        "account-id",
        "aws-region",
        "mybucket_logs",
      ]) {
        expect(ddl).not.toContain(placeholder);
      }
      expect(ddl).toContain("s3://my-trail-bucket/AWSLogs/111122223333/CloudTrail/ap-northeast-1");
      // The provenance comments stay in the file, not in what is sent to Athena.
      expect(ddl).not.toContain("-- ");
    }
  });

  it("points the CloudTrail table and its projected partitions at the same folder", () => {
    const ddl = logTableDdl("cloudtrail", input);
    expect(ddl).toContain("CREATE EXTERNAL TABLE cloudtrail_logs(");
    expect(ddl).toContain(
      "LOCATION\n  's3://my-trail-bucket/AWSLogs/111122223333/CloudTrail/ap-northeast-1'",
    );
    expect(ddl).toContain(
      "'storage.location.template'='s3://my-trail-bucket/AWSLogs/111122223333/CloudTrail/ap-northeast-1/${timestamp}'",
    );
    expect(ddl).toContain("'projection.timestamp.range'='2026/10/01,NOW'");
  });

  it("keeps AWS's columns and SerDe as they were written", () => {
    expect(logTableDdl("cloudtrail", input)).toContain(
      "STORED AS INPUTFORMAT 'com.amazon.emr.cloudtrail.CloudTrailInputFormat'",
    );
    expect(logTableDdl("alb", input)).toContain("'org.apache.hadoop.hive.serde2.RegexSerDe'");
    expect(logTableDdl("cloudfront", input)).toContain("'skip.header.line.count'='2'");
    expect(logTableDdl("s3-access", input)).toContain("`aclrequired` STRING");
  });

  it("reads a bucket's root when there is no prefix", () => {
    expect(logTableDdl("cloudfront", { ...input, prefix: "" })).toContain(
      "LOCATION 's3://my-trail-bucket/'",
    );
  });

  it("refuses anything that could end the quoted location or name another table", () => {
    for (const bad of [
      { bucket: "bucket'/x" },
      { bucket: "Bucket" },
      { prefix: "logs' TBLPROPERTIES ('x'='y" },
      { prefix: "/logs" },
      { prefix: "logs/" },
      { table: "t; DROP TABLE requests" },
      { table: "db.t" },
      { since: "2026/10/01" },
    ]) {
      expect(() => logTableDdl("alb", { ...input, ...bad })).toThrow();
    }
  });
});
