import { describe, expect, it } from "vite-plus/test";

import { breakEvenIoMillions, monthlyCost, type StoragePrices } from "../src/cost.ts";

// AWS Price List, AmazonRDS, ap-northeast-1, publication 2026-10-06, Aurora PostgreSQL.
const standard: StoragePrices = { acuHour: 0.15, storageGbMonth: 0.12, ioPerMillion: 0.24 };
const ioOptimized: StoragePrices = { acuHour: 0.2, storageGbMonth: 0.27, ioPerMillion: 0 };

describe("Aurora Standard against Aurora I/O-Optimized", () => {
  // One ACU for 730 hours and 100 GB.
  const usage = { acuHours: 730, storageGb: 100 };

  it("breaks even where the I/O charge equals the premium on compute and storage", () => {
    const ioMillions = breakEvenIoMillions(usage, standard, ioOptimized);

    expect(ioMillions).toBeCloseTo(214.58, 2);
    expect(monthlyCost({ ...usage, ioMillions }, standard)).toBeCloseTo(
      monthlyCost({ ...usage, ioMillions }, ioOptimized),
      9,
    );
  });

  it("costs less on Standard below that, and less on I/O-Optimized above it", () => {
    expect(monthlyCost({ ...usage, ioMillions: 100 }, standard)).toBeCloseTo(145.5, 9);
    expect(monthlyCost({ ...usage, ioMillions: 300 }, standard)).toBeCloseTo(193.5, 9);
    expect(monthlyCost({ ...usage, ioMillions: 300 }, ioOptimized)).toBeCloseTo(173, 9);
  });

  it("puts the I/O share of the Standard bill at the break-even near 30 percent", () => {
    const ioMillions = breakEvenIoMillions(usage, standard, ioOptimized);
    const share =
      (ioMillions * standard.ioPerMillion) / monthlyCost({ ...usage, ioMillions }, standard);

    expect(share).toBeCloseTo(0.2977, 4);
  });
});
