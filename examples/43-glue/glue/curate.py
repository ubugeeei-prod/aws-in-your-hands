# The one file in this book that is not TypeScript: AWS Glue runs Spark jobs
# written in Python or Scala. It is written to do what src/curate.ts specifies.
# It has not been run. The chapter's verification notes say how to check it.

import sys
from datetime import datetime, timedelta, timezone

from awsglue.context import GlueContext
from awsglue.dynamicframe import DynamicFrame
from awsglue.job import Job
from awsglue.transforms import SelectFromCollection
from awsglue.utils import getResolvedOptions
from awsgluedq.transforms import EvaluateDataQuality
from pyspark.context import SparkContext
from pyspark.sql import functions as F

# contract:begin (written by `vp run glue:contract`; a test fails when it is stale)
COLUMNS = "v INT, event_id STRING, at STRING, request_id STRING, method STRING, route STRING, status INT, duration_ms BIGINT, action STRING, note_id STRING"
RULESET = """Rules = [
    IsComplete "event_id",
    IsUnique "event_id",
    IsComplete "at",
    ColumnValues "v" = 1,
    ColumnValues "route" in ["/health", "/notes", "/notes/:id", "other"],
    ColumnValues "status" between 99 and 600,
    ColumnValues "duration_ms" >= 0
]"""
# contract:end

args = getResolvedOptions(sys.argv, ["JOB_NAME", "source", "target", "days"])
glue = GlueContext(SparkContext.getOrCreate())
spark = glue.spark_session
job = Job(glue)
job.init(args["JOB_NAME"], args)

DAY = "%Y-%m-%d"


def shift(day, days):
    return (datetime.strptime(day, DAY) + timedelta(days=days)).strftime(DAY)


if args["days"] == "auto":
    today = datetime.now(timezone.utc).strftime(DAY)
    days = [shift(today, -2), shift(today, -1)]
else:
    days = args["days"].split(",")

# dt is the folder a file sits in: the day its records arrived. FAILFAST stops
# the run at a line that cannot be read, instead of turning it into nulls.
raw = (
    spark.read.schema(COLUMNS + ", dt STRING")
    .option("mode", "FAILFAST")
    .json(args["source"])
)

for day in days:
    rows = (
        raw.where(F.col("dt").isin([shift(day, offset) for offset in (-1, 0, 1)]))
        .where(F.substring("at", 1, 10) == day)
        .drop("dt")
        .dropDuplicates(["event_id"])
        .cache()
    )
    if rows.isEmpty():
        continue

    outcomes = SelectFromCollection.apply(
        dfc=EvaluateDataQuality().process_rows(
            frame=DynamicFrame.fromDF(rows, glue, "rows"),
            ruleset=RULESET,
            publishing_options={
                "dataQualityEvaluationContext": "curate_" + day,
                "enableDataQualityCloudWatchMetrics": False,
                "enableDataQualityResultsPublishing": False,
            },
        ),
        key="ruleOutcomes",
    ).toDF()
    failed = outcomes.where(F.col("Outcome") == "Failed").collect()
    if failed:
        raise RuntimeError(
            day + ": " + "; ".join(f"{row['Rule']} ({row['FailureReason']})" for row in failed)
        )

    # Overwrite replaces this one folder. A second run of the same day leaves the same rows.
    rows.coalesce(1).write.mode("overwrite").parquet(f"{args['target']}dt={day}/")

job.commit()
