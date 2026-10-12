// Folds long code blocks, so a page's length is set by its prose.
// A block over LONG lines shows its first SHOWN lines and a control that opens the rest.
// Without this script every block is simply shown in full.

const LONG = 40;
const SHOWN = 18;

const japanese = document.documentElement.lang.startsWith("ja");
const more = (lines: number): string =>
  japanese ? `残り ${lines} 行を表示` : `Show ${lines} more lines`;
const less = japanese ? "たたむ" : "Show less";

for (const block of document.querySelectorAll<HTMLElement>(".content .ox-code")) {
  const pre = block.querySelector("pre");
  const lines = pre?.querySelectorAll(".line").length ?? 0;
  if (pre === null || lines <= LONG) {
    continue;
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "aih-fold";
  pre.id ||= `code-${Math.random().toString(36).slice(2, 8)}`;
  toggle.setAttribute("aria-controls", pre.id);

  const set = (folded: boolean): void => {
    block.classList.toggle("is-folded", folded);
    block.style.setProperty("--aih-fold-lines", String(SHOWN));
    toggle.textContent = folded ? more(lines - SHOWN) : less;
    toggle.setAttribute("aria-expanded", String(!folded));
  };
  toggle.addEventListener("click", () => {
    const folding = !block.classList.contains("is-folded");
    set(folding);
    // Folding a block you have scrolled into would leave you far below it.
    if (folding) {
      block.scrollIntoView({ block: "nearest" });
    }
  });
  set(true);
  block.append(toggle);
}

// Paper cannot be clicked. Print every block in full.
window.addEventListener("beforeprint", () => {
  for (const block of document.querySelectorAll(".ox-code.is-folded")) {
    block.classList.remove("is-folded");
  }
});
