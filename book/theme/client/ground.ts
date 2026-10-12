// The reading pages' ground: the cover's cloud, thin and slow, fixed behind the text.
// Loaded on every page that is not the cover. Without WebGL2 the page keeps its flat navy.

import { createFluidCloud } from "./fluid-cloud.ts";

const canvas = document.createElement("canvas");
canvas.className = "aih-ground";
canvas.setAttribute("aria-hidden", "true");
document.body.prepend(canvas);

// The cloud is painted for the navy ground. On paper it stays off, and costs nothing.
const dark = (): boolean => document.documentElement.dataset["theme"] !== "light";

const cloud = createFluidCloud(canvas, {
  seed: 17,
  density: 0.8,
  speed: 0.35,
  reducedMotion: "system",
  // A quarter of the cover's budget: nobody looks at this one.
  maxPixels: 100_000,
  maxPixelRatio: 1,
  pointer: document.documentElement,
});

if (cloud === undefined) {
  canvas.remove();
} else {
  const follow = (): void => {
    if (dark()) {
      cloud.resume();
    } else {
      cloud.pause();
    }
    canvas.classList.toggle("is-live", dark());
  };
  new MutationObserver(follow).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  requestAnimationFrame(() => requestAnimationFrame(follow));
}
