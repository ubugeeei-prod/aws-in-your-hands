// The reading pages' ground: the cover's cloud, thin and slow, fixed behind the text.
// Loaded on every page that is not the cover. Without WebGL2 the page keeps its flat ground.

import { createFluidCloud } from "./fluid-cloud.ts";
import { remember, stopped } from "./motion.ts";

const canvas = document.createElement("canvas");
canvas.className = "aih-ground";
canvas.setAttribute("aria-hidden", "true");
document.body.prepend(canvas);

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
  requestAnimationFrame(() => requestAnimationFrame(() => canvas.classList.add("is-live")));

  const english = document.documentElement.lang.startsWith("en");
  const labels = english
    ? { stop: "Stop the motion", start: "Start the motion", short: "Motion" }
    : { stop: "動きを止める", start: "動きを再開する", short: "動き" };
  const icons = {
    stop: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4v12M14 4v12" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    start:
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 4l9 6-9 6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  };

  // One in the header, and one in the bar a phone shows instead of it.
  const header = document.createElement("button");
  header.type = "button";
  header.className = "aih-motion";
  document.querySelector(".header-actions")?.append(header);

  const mobile = document.createElement("button");
  mobile.type = "button";
  mobile.className = "mobile-footer-btn aih-motion-mobile";
  document.querySelector(".mobile-footer")?.append(mobile);

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let stop = stopped();

  const show = (): void => {
    if (stop) {
      cloud.pause();
    } else {
      cloud.resume();
    }
    const label = stop ? labels.start : labels.stop;
    const icon = stop ? icons.start : icons.stop;
    header.innerHTML = icon;
    mobile.innerHTML = `${icon}<span class="mobile-footer-label">${labels.short}</span>`;
    for (const button of [header, mobile]) {
      // Nothing to stop for a reader whose system already holds the picture still.
      button.hidden = reduce.matches;
      button.setAttribute("aria-label", label);
      button.title = label;
    }
  };
  const flip = (): void => {
    stop = !stop;
    remember(stop);
    show();
  };
  header.addEventListener("click", flip);
  mobile.addEventListener("click", flip);
  reduce.addEventListener("change", show);
  show();
}
