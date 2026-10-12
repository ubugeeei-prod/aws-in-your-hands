// How large to draw the cloud. The picture is soft, so it is rendered small and enlarged;
// how small depends on how long the last frames took.

export type Size = { width: number; height: number };

/** Pixels the ray-marched image may have. A laptop's integrated GPU holds 60 fps near the start value. */
export const budget = { start: 380_000, min: 70_000, max: 900_000 } as const;

/** The canvas's backing store: CSS size times the display's pixel ratio, capped. */
export function canvasSize(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
  maxPixelRatio: number,
): Size {
  const ratio = Math.min(Math.max(pixelRatio, 1), maxPixelRatio);
  return {
    width: Math.max(1, Math.round(cssWidth * ratio)),
    height: Math.max(1, Math.round(cssHeight * ratio)),
  };
}

/** The ray-marched image: the canvas's shape, at most `pixels` in area, never larger than the canvas. */
export function sceneSize(canvas: Size, pixels: number): Size {
  const scale = Math.min(1, Math.sqrt(pixels / (canvas.width * canvas.height)));
  return {
    width: Math.max(16, Math.round(canvas.width * scale)),
    height: Math.max(16, Math.round(canvas.height * scale)),
  };
}

/** The fluid's grid: square cells, 144 of them up the screen. Coarse on purpose; the cloud supplies the detail. */
export function gridSize(canvas: Size): Size {
  const height = 144;
  const width = Math.round((height * canvas.width) / Math.max(1, canvas.height));
  return { width: Math.min(384, Math.max(48, width)), height };
}

/**
 * The next pixel budget, from the average frame time in milliseconds.
 * Slow frames shrink it quickly, fast frames grow it slowly, and the band
 * in between leaves it alone so the size does not flutter.
 */
export function nextBudget(pixels: number, frameMs: number): number {
  if (frameMs > 24) {
    return Math.max(budget.min, Math.round(pixels * 0.78));
  }
  if (frameMs < 13) {
    return Math.min(budget.max, Math.round(pixels * 1.08));
  }
  return pixels;
}

/** Whether to hold still: the reader's system setting, unless the caller decides. */
export function wantsStill(
  setting: "system" | "reduce" | "no-preference",
  systemReduces: boolean,
): boolean {
  return setting === "system" ? systemReduces : setting === "reduce";
}
