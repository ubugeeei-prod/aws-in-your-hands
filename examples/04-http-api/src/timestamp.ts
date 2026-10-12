import * as v from "valibot";

// #region timestamp
const UTC = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/;

const daysIn = (year: number, month: number): number => {
  if (month === 2) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

/**
 * A moment in UTC, as `Date.prototype.toISOString()` writes it. v.isoTimestamp() also takes
 * an offset ("+09:00"), a space where the T goes, and February 30. What is stored is read back
 * long after it was written, compared, and subtracted, so one spelling is accepted and the
 * day has to exist.
 */
export const utcTimestamp = v.pipe(
  v.string(),
  v.check((value) => {
    const [, year, month, day] = UTC.exec(value) ?? [];
    return (
      Number(month) >= 1 &&
      Number(month) <= 12 &&
      Number(day) >= 1 &&
      Number(day) <= daysIn(Number(year), Number(month))
    );
  }, "Must be a UTC timestamp such as 2026-10-12T09:00:00.000Z."),
);
// #endregion timestamp
