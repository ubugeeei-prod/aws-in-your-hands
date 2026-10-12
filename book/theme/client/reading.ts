// Marks, in the outline beside the text, the section being read.
// Loaded on every page that has an outline.

const links = new Map<string, HTMLAnchorElement>();
for (const link of document.querySelectorAll<HTMLAnchorElement>(".toc-link[href^='#']")) {
  links.set(decodeURIComponent(link.hash.slice(1)), link);
}

const headings = [...document.querySelectorAll<HTMLElement>(".content :is(h2, h3)[id]")].filter(
  (heading) => links.has(heading.id),
);

if (headings.length > 0) {
  let current: HTMLAnchorElement | undefined;

  const mark = (): void => {
    // The section being read is the last one whose heading has passed the top third of the window.
    const line = window.innerHeight / 3;
    let reading = headings[0];
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top > line) {
        break;
      }
      reading = heading;
    }
    const next = reading === undefined ? undefined : links.get(reading.id);
    if (next === current) {
      return;
    }
    current?.removeAttribute("aria-current");
    next?.setAttribute("aria-current", "location");
    // Keep the marker in view when the outline is longer than the window.
    next?.scrollIntoView({ block: "nearest" });
    current = next;
  };

  let queued = false;
  window.addEventListener(
    "scroll",
    () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          mark();
        });
      }
    },
    { passive: true },
  );
  mark();
}
