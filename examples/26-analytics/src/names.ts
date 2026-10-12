// #region names
// Athena writes these names in SQL, so they are lower case with underscores, and fixed.
export const DATABASE = "aih_analytics";
export const TABLE = "requests";
/** The table as a query names it. */
export const QUALIFIED_TABLE = `"${DATABASE}"."${TABLE}"`;
export const WORKGROUP = "aih-analytics";
// #endregion names
