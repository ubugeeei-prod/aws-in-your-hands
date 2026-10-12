import { type LakeObject, LocalDelivery } from "@aih/example-26-analytics/src/lake.ts";
import { type RequestRecord, toLine } from "@aih/example-26-analytics/src/record.ts";
import { sampleRecords } from "@aih/example-26-analytics/src/sample.ts";

// #region sample
export const SAMPLE_DAYS = ["2026-10-10", "2026-10-11"] as const;
const PER_DAY = 400;
const BUFFER_MS = 5 * 60 * 60 * 1000;

/**
 * Made-up raw files with the two things the job exists for: a record sent twice,
 * and records filed under a day other than the one they happened on. Chapter 26's
 * stand-in for Firehose does the filing. Seeded, so every run gives the same bytes.
 */
export function sampleLake(): { objects: LakeObject[]; records: RequestRecord[] } {
  const delivery = new LocalDelivery();
  const records = SAMPLE_DAYS.flatMap((day, index) => sampleRecords(PER_DAY, day, 43 + index));
  let opened: number | undefined;

  records.forEach((record, index) => {
    // Two seconds from the answer to Firehose.
    const arrived = Date.parse(record.at) + 2000;
    if (opened !== undefined && arrived - opened >= BUFFER_MS) {
      delivery.flush();
      opened = undefined;
    }
    opened ??= arrived;
    delivery.put(toLine(record), new Date(arrived));
    if (index % 50 === 0) {
      // The producer's retry after a lost answer: the same line, once more.
      delivery.put(toLine(record), new Date(arrived));
    }
  });
  delivery.flush();

  // One request answered just before midnight whose record reached Firehose twenty minutes late.
  const [late] = sampleRecords(1, SAMPLE_DAYS[0], 4300);
  if (late === undefined) {
    throw new Error("sampleRecords returned nothing");
  }
  const straggler = { ...late, at: `${SAMPLE_DAYS[0]}T23:59:59.500Z` };
  delivery.put(toLine(straggler), new Date(`${SAMPLE_DAYS[1]}T00:20:00.000Z`));
  delivery.flush();

  return { objects: delivery.objects, records: [...records, straggler] };
}
// #endregion sample
