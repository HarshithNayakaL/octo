// Cards listed here get a soft light that follows the pointer (see showcase.css).
const selector = ".bento-tile, .workflow-card";

document.addEventListener(
  "pointermove",
  (event) => {
    if (event.pointerType !== "mouse") return;
    const card = (event.target as Element | null)?.closest<HTMLElement>(
      selector,
    );
    if (!card) return;
    const box = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${event.clientX - box.left}px`);
    card.style.setProperty("--my", `${event.clientY - box.top}px`);
  },
  { passive: true },
);
