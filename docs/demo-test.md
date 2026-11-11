# SyncBoard acceptance test — 2+ concurrent users

Run on 2026-11-11 against the Phase 5 build, with the app running
locally (`npm run dev`, web on :5173, sync server on :1234) and
Firefox driven by Playwright, two and three browser contexts at
once. The scripts live in the screenshot tooling as
`verify-syncboard-phase5-accept1.mjs` and
`verify-syncboard-phase5-accept2.mjs`; the zoom/pan checks are in
`verify-syncboard-phase5.mjs`. Every check passed, with zero console
errors in any tab.

## (a) Two clients editing the same note converge without conflicts — PASS

Ahmad typed `[A] ` at the start of the "Ship Phase 1" note while
Sara typed ` [B]` at the end of the same note, back to back. Both
tabs ended up with the identical text:

`"Ship Phase 1\n[A] by Friday [B]"`

Both people's typing survived; neither overwrote the other.

## (b) Cursors and selections render live and vanish on disconnect — PASS

- Omar joined: the presence bar in Ahmad's tab went to "3 online".
- Omar moved his mouse: Ahmad saw a green cursor labelled "Omar"
  following the same path.
- Omar clicked the "Demo on Monday 10am" note: Ahmad saw the note
  outlined in Omar's color with an "Omar" label.
- Omar closed his tab: Ahmad's presence bar dropped back to
  "2 online" and Omar's cursor and selection disappeared.

## (c) User A's undo never reverts User B's edits — PASS

Sara typed "SARA-ONLY" into the "Ask Sara" note. Ahmad typed
"AHMAD-ONLY" into the "Demo on Monday" note, then pressed Ctrl+Z.
Afterwards the "Ask Sara" note still read
"Ask Sara to\nreview the API SARA-ONLY", while the "Demo on" note
was back to "Demo on\nMonday 10am" — Ahmad's edit reverted, Sara's
untouched.

## (d) Board state survives a server restart — PASS

The server was stopped and started again between the two halves of
the test. After the restart, both tabs showed the same three notes
with all markers intact (`[A]`, `[B]`, "SARA-ONLY"), and the undone
"AHMAD-ONLY" was still gone.

## (e) A fresh client joining mid-session gets the current state — PASS

Omar opened a third window after the restart and saw the full
current board — the same three notes, markers included. The
presence bar read "3 online" in all three windows, and Ahmad's and
Sara's windows kept their exact state (nothing moved, nothing
re-rendered away).

## Zoom and pan (Phase 5, new in this phase) — PASS

- Zoom is per-user: Ahmad zoomed to 156% while Sara stayed at 100%,
  and Sara's view did not change.
- Pan is per-user: Ahmad dragged the empty canvas 100px right and
  50px down; his notes moved by exactly that, Sara's did not move.
- Cursors stay aligned at zoom: with Ahmad at 156%, his cursor
  over the "Ship Phase 1" note showed up inside that same note in
  Sara's tab.
- Dragging at zoom moves the right board distance: a 100px screen
  drag at 156% zoom moved the note exactly 64 board pixels
  (100 / 1.5625) in the other tab.
- Reset returns to 100% with the original view.
