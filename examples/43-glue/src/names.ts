// #region names
// Athena writes these names in SQL, so they are lower case with underscores, and fixed.
export const DATABASE = "aih_glue";
/** The files Firehose wrote in chapter 26, as they are. */
export const RAW_TABLE = "requests_raw";
/** What the job writes from them. */
export const CURATED_TABLE = "requests_curated";
export const JOB_NAME = "aih-glue-curate";
// #endregion names
