# Who's here — live presence list

## What it is

A small list of everyone on this board right now, opened from the
header's "N online" group. It reuses the Awareness presence data
the app already has — no second presence channel, no server change.

## What each row shows

- An avatar circle in the person's presence color, with their
  initial and a green dot while they are online.
- Their name. The local user is first and marked "(you)".
- An activity line for other people, derived only from the
  Awareness state already flowing:
  - Selecting something: "Selecting a note", "Selecting a shape",
    or "Selecting a text box" — the first non-empty selection.
    (Presence only tracks notes, shapes, and text boxes; frames,
    connectors, and images are local-only, so selecting one of
    those shows no activity line.)
  - Cursor inside a named frame: "In <frame title>". When frames
    overlap, the smallest containing frame wins — the most
    specific area.
  - Cursor on the board but in no frame: "On the board".
  - No cursor (pointer off the board): no activity line. Nothing
    is known, so nothing is claimed — "away" would be a guess.
- The local user has no activity line. Local cursor moves live in
  a ref and do not re-render, so a live line for yourself would go
  stale; your own selection is already visible on the board itself.

## Where it lives

The header presence group ("N online" plus the avatar chips)
becomes a button. Clicking it opens a small card under the header,
right-aligned — a dropdown, not a third side panel. The comments
and snapshots panels already crowd a phone; a dropdown does not
take a side-panel slot.

- Clicking the button again, pressing Escape, or clicking outside
  the card closes it.
- On a phone the card floats at the right edge under the header and
  is capped at the viewport width minus a margin, so it never
  covers the whole screen.
- The header itself is unchanged otherwise: the count and the
  avatar chips still show, and the button has an `aria-expanded`
  state and a "Who's here" label.

## Joining and leaving

Driven by the same Awareness `change` event that already updates
the presence state: a join or a leave re-renders the list with no
refresh. A disconnected client's Awareness state disappears on
its own. The list order is self first, then everyone else
alphabetically — the same order the header chips already use.

## What it does NOT do

- No follow mode (clicking a person does not jump to their view).
- No chat, no kicking, no permissions.
- No exact cursor coordinates, and no new data is published to
  Awareness — the list only reads what cursors and selections
  already carry.

## Files

- `apps/web/src/presence.ts` (new) — pure helpers: the activity
  line, the frame lookup, and the row list the component renders.
- `apps/web/src/presence.test.ts` (new) — tests for those helpers.
- `apps/web/src/App.tsx` — the header button, the dropdown, and
  the open/close state.
- `apps/web/src/App.css` — the dropdown and row styles.

## Verification

- Tests: 239/239 pass (57 server + 182 web, +14 new presence
  tests). Lint clean, typecheck clean, `vite build` succeeds
  (439.67 kB JS).
- Real browser (Playwright Firefox, local dev servers, two
  browser contexts, two signed-up users alice-who and bob-who on
  a fresh test board, zero console/page errors):
  - Both users see "2 online" and both appear in each other's
    list, self marked "(you)".
  - Bob moves his mouse onto the board: alice's list says
    "On the board".
  - Alice selects a starter note: bob's list says
    "Selecting a note".
  - Alice draws a frame, names it "Sprint planning", and moves
    her mouse inside it: bob's list says "In Sprint planning".
  - Screenshot: `~/workspace/your_files/syncboard-whos-here.png`.
  - Closing bob's context removes him from alice's list live,
    with no refresh; the count returns to "1 online".
  - Test board deleted; Main board verified unchanged (3 starter
    notes, 0 shapes, 0 images, 0 frames). Test users removed
    from the local dev database. Dev servers stopped.
  - Check script kept at `~/workspace/screenshot-tool/check-whos-here.mjs`.
- Two notes from verification:
  - Dragging a frame draw outside the visible board draws the
    frame in the wrong place (a pre-existing quirk, not this
    feature — the check keeps its drag inside the board).
  - A stray yellow rectangle was found on the local dev Main
    board (test debris from an earlier verification run, not
    user content); it was deleted via the UI and the board is
    back to the 3 starter notes and nothing else.
