# Auto-organize — group scattered notes into labelled frames

## What it is

An "Auto-organize" button in the header groups the board's
scattered sticky notes into labelled frames by topic. The
clustering is keyword-based and runs entirely in the browser:
no API key, no server, no external service — the words in the
notes are all it needs.

## How grouping works

- Each note's topic words are extracted from its text:
  lowercased, split on anything that is not a letter, common
  stop words ("the", "and", "to") and words shorter than three
  letters dropped, each word counted once per note.
- A note joins the group for the keyword it shares with the
  most other notes — its strongest topic. Ties break
  alphabetically, so the same board always groups the same way.
- A group needs at least two notes. A keyword only one note
  has is not a topic, and a group that drops below two —
  because its other notes had a stronger topic — disappears
  and its notes stay where they are.

## What it does NOT do

- Notes with no shared keyword stay exactly where they are.
  There is no "Other" frame — forcing loners into a frame
  would be clutter, not organization.
- Notes already inside a frame are left alone. Only free
  notes on the canvas are organized.
- Only sticky notes are organized. Shapes, text boxes,
  images, and voice notes never move.

## Layout

- The new frames form a tidy row below everything already on
  the board — never on top of it. The row starts at the
  content's left edge.
- Each frame is labelled with its keyword, title-cased
  ("Launch", "Design"), and coloured in turn from the note
  palette. Notes inside sit in a grid of up to three across,
  each cell sized to the biggest note in the group, so notes
  never overlap.

## Safety

- A confirm dialog shows the plan first — "Group N notes
  into M frames?" — since it moves many notes at once.
- The whole organize runs as one Yjs transaction, so a single
  Ctrl+Z undoes it. The button is disabled when there is
  nothing to group.

## Files

- `apps/web/src/autoOrganize.ts` (new) — pure helpers:
  keyword extraction, grouping, frame layout, and the plan.
- `apps/web/src/autoOrganize.test.ts` (new) — tests for
  those helpers.
- `apps/web/src/App.tsx` — the Auto-organize button, the
  confirm step, and the transaction that creates the frames
  and moves the notes.

## Verification

- Tests: full suite green (296 before, new auto-organize
  tests on top). Lint clean, typecheck clean.
- Real browser (Playwright Firefox, local dev servers, one
  user on a fresh test board, zero console/page errors):
  notes on two topics plus one loner note; Auto-organize
  creates two labelled frames with the right notes inside,
  the loner does not move, and one Ctrl+Z undoes the whole
  organize. Screenshot:
  `~/workspace/your_files/syncboard-auto-organize.png`.
