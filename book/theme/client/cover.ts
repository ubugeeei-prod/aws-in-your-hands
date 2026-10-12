// Wires the cover page: starts the cloud behind the title and gives the reader a way to stop it.
// Loaded only on the page that has a cover.

import { createFluidCloud } from "./fluid-cloud.ts";
import { remember, stopped } from "./motion.ts";

const cover = document.querySelector<HTMLElement>("[data-aih-cover]");
const canvas = cover?.querySelector("canvas");
const toggle = cover?.querySelector<HTMLButtonElement>("[data-aih-motion]");

if (cover && canvas) {
  const cloud = createFluidCloud(canvas, { seed: 17, reducedMotion: "system", pointer: cover });

  if (cloud !== undefined) {
    // The canvas fades in over the still background once there is something on it.
    requestAnimationFrame(() => requestAnimationFrame(() => cover.classList.add("is-live")));

    if (toggle) {
      const labels = {
        pause: toggle.dataset["pause"] ?? "Pause motion",
        play: toggle.dataset["play"] ?? "Play motion",
      };
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
      let paused = stopped();
      if (paused) {
        cloud.pause();
      }

      const show = (): void => {
        // Nothing to pause for a reader whose system already holds the picture still.
        toggle.hidden = reduce.matches;
        toggle.textContent = paused ? labels.play : labels.pause;
        toggle.setAttribute("aria-pressed", String(paused));
      };
      toggle.addEventListener("click", () => {
        paused = !paused;
        remember(paused);
        if (paused) {
          cloud.pause();
        } else {
          cloud.resume();
        }
        show();
      });
      reduce.addEventListener("change", show);
      show();
    }
  }
}
