import * as v from "valibot";

// #region lsn
/**
 * A position in PostgreSQL's write-ahead log, as a number of bytes from its
 * start. PostgreSQL prints it as two hexadecimal halves, `16/B374D848`.
 */
export type Lsn = bigint;

const LSN_TEXT = /^([0-9A-F]{1,8})\/([0-9A-F]{1,8})$/i;

export function parseLsn(text: string): Lsn | undefined {
  const match = LSN_TEXT.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, high = "", low = ""] = match;
  return (BigInt(`0x${high}`) << 32n) | BigInt(`0x${low}`);
}

export const formatLsn = (lsn: Lsn): string =>
  `${(lsn >> 32n).toString(16).toUpperCase()}/${(lsn & 0xffff_ffffn).toString(16).toUpperCase()}`;

/** No replica has replayed this far, so a session holding it always reads the primary. */
export const LSN_MAX: Lsn = 0xffff_ffff_ffff_ffffn;

export const laterOf = (a: Lsn | undefined, b: Lsn | undefined): Lsn | undefined =>
  a === undefined ? b : b === undefined || a >= b ? a : b;
// #endregion lsn

/** A `pg_lsn` column read as text. NULL becomes `undefined`. */
export const lsnColumnSchema = v.pipe(
  v.nullable(v.string()),
  v.transform((text) => (text === null ? undefined : parseLsn(text))),
);
