# SyncBoard — Mobile + touch support

Touch input for the board, built on the pointer events that are already
there. Local work only: no commit, push, upload, or PR until the user
says so. No change to the sync server, the boards API, auth, or
deployment config.

## Where things live

- `apps/web/src/App.tsx` — the whole app. All board interaction is
  pointer events with pointerId tracking and `setPointerCapture`.
  Zoom and pan are per-user local state (`zoom` 25–300%, `pan` x/y,
  `zoomBy`, `resetView`).
- `apps/web/src/App.css` — all board styling. Dose tokens live in
  `tokens.css`. The phone rules live in the `@media (max-width: 40rem)`
  block at the end; the minimap is already hidden there.
- `apps/web/src/pinch.ts` (+ `pinch.test.ts`) — the new module for
  this work: pure pinch geometry, following the `minimap.ts` /
  `shapes.ts` pattern (small module, vitest file for the pure logic).
- `apps/web/src/shapes.ts`, `frames.ts`, `minimap.ts` — existing
  pure-logic modules to copy the style from.

## What already works for touch (verified by reading the code)

- `.board` has `touch-action: none`, so one-finger pointer events
  reach the app instead of scrolling the page. Touch drawing
  (pen/shapes), note/shape/text/frame dragging, and one-finger pan
  in select mode all go through the existing pointer handlers.
- The minimap has `touch-action: none` too.
- The phone media query already makes the tool rail icon-only and
  hides the minimap.
- The viewport meta is set (`width=device-width, initial-scale=1.0`).

## What is missing (this work)

1. **Pinch-to-zoom: not implemented.** Zoom is buttons-only
   (`zoomBy`). Worse, a second finger landing mid-gesture fires
   the same handlers again and overwrites the single-pointer drag
   refs (`panRef`, `drawRef`, `frameDrawRef`, ...), corrupting the
   gesture in progress.
2. **Touch targets are small.** Rail/header buttons are 36px
   min-height, color dots 24px, zoom buttons ~36px, board tabs
   36px — below the 44px a finger reliably hits.

## What this builds

1. **Pinch-to-zoom** (`pinch.ts` + App.tsx wiring):
   - Pure geometry: given the pinch start state (zoom, pan,
     midpoint, distance) and the current midpoint/distance, return
     the new zoom (clamped 25–300%) and pan, so the board point
     under the midpoint stays put. One formula covers zoom and
     two-finger pan together.
   - The board tracks its active pointers. When a second pointer
     lands, whatever single-pointer gesture is in progress is
     cancelled and a pinch starts. While a pinch is active, no
     other board gesture starts. When a pointer lifts, the pinch
     ends; the remaining finger does not resume the old gesture.
   - Cancelling a shape/frame draw removes the just-created
     shape/frame, so no 1px dot is left behind. Cancelling a
     drag or a pan only clears the ref — a partial move the user
     already made stays, because it is real work.
2. **One-finger pan**: no new code. The select-mode pan and
   `touch-action: none` already do it; the pinch guards keep a
   second finger from breaking it. Verified in a real browser
   with touch emulation.
3. **Phone-friendly toolbar** (App.css, inside the existing
   ≤40rem media query only):
   - Rail and header buttons: 44px min-height.
   - Color dots: 32px (still two to a row in the rail).
   - Zoom buttons: 44px min-height.
   - Board tabs: 44px min-height.

## Deliberately left out

- Double-tap to create a note (the board already has
  `onDoubleClick`; touch double-tap behaviour is left as is).
- Touch-specific tool switching, long-press menus, or haptics.
- Any change to mouse behaviour, the sync server, or the live
  Main board's content.

## Shared rules

- Humanized code (the user's permanent rule): small functions
  with clear names, comments ONLY where they explain WHY, plain
  wording, no clever one-liners, structure that makes a bug easy
  to trace. Applies to every line.
- Minimal changes, existing style. No invented metrics,
  testimonials, logos, or features beyond this spec.
- Tests for the new pure logic and for the pinch guards where
  they can be tested without a browser; real-browser check with
  Playwright Firefox at a 390px viewport.
