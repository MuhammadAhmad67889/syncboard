# Present mode — frames as slides

## What it is

A "Present" button in the header turns the board's frames into
slides. The presenter steps through them with Next / Previous
buttons or the arrow keys; every other viewer on the board
follows along — their camera moves to the frame the presenter
is showing, with a small banner saying who is presenting.

## Slide order

Frames sort top-to-bottom, then left-to-right, by their
coordinates in the shared document. When two frames tie on both
coordinates, creation order wins: the slide list is built from
the frames in Y.Map insertion order (the same order
snapshotFrames already reads them in), and the sort is stable.

## What the presenter sees

- A bar under the header: the current frame's title, "Slide N
  of M", Previous / Next buttons, and Exit.
- Right / Down moves to the next slide, Left / Up to the
  previous one. Escape leaves present mode. The first and last
  slides do not wrap — the buttons disable at the ends.
- The camera moves to fit the current frame in view, with a
  margin around it. The move is animated over about a third of
  a second; with reduced motion on, the camera jumps instantly.

## What viewers see

- The presenter broadcasts the current frame id through the
  Awareness state the app already publishes — no second
  channel, no server change.
- A viewer whose camera is not already on that frame animates
  to it (instant under reduced motion). A banner under the
  header says "<name> is presenting". When the presenter
  leaves, viewers stay where they are.
- If two people present at once, every viewer follows the same
  one: the first by name, since the presence list is already
  sorted that way. The presenter never follows anyone else.

## What it does NOT do

- No per-slide notes, no laser pointer, no presenter-only view.
- Presenting does not lock the board — the presenter can still
  edit, and viewers can still pan on their own; the next slide
  change (or the presenter's next move) re-centres the view.
- If the frame being shown is deleted mid-presentation, the
  presenter moves to the nearest remaining slide; with no
  frames left, present mode ends.

## Files

- `packages/shared/src/index.ts` — `PresenceUser` gains an
  optional `presentingFrameId` (null when not presenting).
- `apps/web/src/present.ts` (new) — pure helpers: slide
  order, the camera that fits a frame, slide stepping, finding
  the presenter, and easing between two camera views.
- `apps/web/src/present.test.ts` (new) — tests for those
  helpers.
- `apps/web/src/App.tsx` — the Present button, the present
  bar and viewer banner, the keyboard shortcuts, the Awareness
  publish, and the follow effect.
- `apps/web/src/App.css` — the present bar and banner styles.

## Verification

- Tests: full suite green (239 before, new present tests on
  top). Lint clean, typecheck clean.
- Real browser (Playwright Firefox, local dev servers, two
  signed-up users on a fresh test board, zero console/page
  errors): presenter enters present mode, steps to the next
  slide, exits; the second user's view follows the presenter's
  slide and shows the banner. Screenshot:
  `~/workspace/your_files/syncboard-present-mode.png`.
