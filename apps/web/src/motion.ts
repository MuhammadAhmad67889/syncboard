import gsap from "gsap";

/**
 * Chrome motion helpers.
 *
 * GSAP is used only for UI chrome (login entrance, panel and
 * dropdown entrances, the active-tool pop) — never inside the
 * canvas render loop or pointer handling, where the board's own
 * transform math must stay exact.
 *
 * Every helper checks prefers-reduced-motion first and does
 * nothing when the visitor asked for reduced motion. Animations
 * use gsap.from / fromTo ending at the element's natural state,
 * so skipping an animation always leaves the UI fully visible.
 */

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Fades and rises a list of elements in, one after another. */
export function staggerIn(elements: HTMLElement[]): void {
  if (prefersReducedMotion() || elements.length === 0) {
    return;
  }
  gsap.from(elements, {
    opacity: 0,
    y: 10,
    duration: 0.45,
    ease: "power3.out",
    stagger: 0.07,
    clearProps: "opacity,transform",
  });
}

/** Slides a panel in from the side it is attached to. */
export function slideInFromRight(element: HTMLElement): void {
  if (prefersReducedMotion()) {
    return;
  }
  gsap.fromTo(
    element,
    { opacity: 0, x: 14 },
    { opacity: 1, x: 0, duration: 0.3, ease: "power2.out", clearProps: "opacity,transform" },
  );
}

/** Pops a small dropdown in from its anchor corner. */
export function popIn(element: HTMLElement): void {
  if (prefersReducedMotion()) {
    return;
  }
  gsap.fromTo(
    element,
    { opacity: 0, scale: 0.97, y: -4 },
    { opacity: 1, scale: 1, y: 0, duration: 0.18, ease: "power2.out", clearProps: "opacity,transform" },
  );
}

/** A tiny settle on the button that just became the active tool. */
export function settlePop(element: HTMLElement): void {
  if (prefersReducedMotion()) {
    return;
  }
  gsap.fromTo(
    element,
    { scale: 0.96 },
    { scale: 1, duration: 0.16, ease: "power2.out", clearProps: "transform" },
  );
}
