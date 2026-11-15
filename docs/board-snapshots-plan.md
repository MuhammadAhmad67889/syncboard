# SyncBoard — Board snapshots / version history

Save a named copy of a board's state, list the copies, restore one,
delete one. Local work only: no commit, push, upload, or PR until the
user says so. No change to the live Main board's content.

## Where things live

- `packages/shared/src/index.ts` — shared types: `BoardSnapshotMeta`,
  `BoardSnapshot`, `MAX_SNAPSHOTS_PER_BOARD`.
- `apps/sync-server/src/persistence.ts` (+ `persistence.test.ts`) —
  a `board_snapshots` table in the same SQLite file as the boards,
  and store methods for it. Snapshots live with the board data, so
  they survive a server restart and are shared by every collaborator.
- `apps/sync-server/src/index.ts` — snapshot endpoints under
  `/boards/:id/snapshots`, following the `/boards` handler pattern.
- `apps/web/src/snapshots.ts` (+ `snapshots.test.ts`) — the new
  module for this work: the API client (mirroring `boards.ts`) and
  the pure helpers (default name, counts label, newest-first sort).
- `apps/web/src/export.ts` — reused, not changed: a snapshot IS a
  `BoardExport` (the same object the JSON export produces), captured
  with `exportDocToBoard` and restored with `applyBoardExport`.
- `apps/web/src/App.tsx` — a Snapshots button in the header and a
  Snapshots panel, mirroring the comments panel.
- `apps/web/src/App.css` — `.snapshots-panel` styles, mirroring the
  comments panel.

## Storage decision (the important one)

A snapshot is a full `BoardExport` — notes, shapes, text boxes,
frames, connectors, and images — stored as JSON text in a new
`board_snapshots` table (snapshot_id, board_id, name, created_at,
state). Server-side storage was chosen over local-only because:

- Snapshots survive a browser restart and a server restart.
- Every collaborator sees the same snapshots and can restore one.
- Deleting a board deletes its snapshots with it, so no orphaned
  copies linger.

The client captures the snapshot from its live document (via
`exportDocToBoard`), not from the server's saved copy: the server
only persists the board every 2 seconds (debounced), so a
server-side capture could miss the last few seconds of edits. The
client sends the full export JSON in the POST body; the server
stores it after a light shape check (an object with `version: 1`
and notes/shapes/texts arrays). The client validates fully on
restore with `parseBoardExport` before applying anything — a
corrupt stored snapshot restores nothing.

The cost is size: a snapshot holds the whole board, including
downscaled image data URLs. That is why there is a cap (below).

## What this builds

1. **Save a snapshot, by hand.** A "Snapshots" button in the header
   opens the panel. The panel has a name field (default: the date
   and time, e.g. "Nov 15, 2026, 9:40 PM") and a Save button.
   Saving captures the board exactly as it is right now.
   - No automatic snapshots on a schedule, and none before a big
     change — manual only, so the list stays meaningful.
   - At most 20 snapshots per board. Saving a 21st is refused with
     a clear message ("Delete an old snapshot first"). Twenty full
     board copies is already a lot of stored state.
2. **List snapshots, newest first.** Each row shows the name, the
   date and time it was saved, and what it holds ("3 notes ·
   2 shapes · 1 image"). The list endpoint returns only this
   metadata — no state bytes — so listing stays cheap.
3. **Restore a snapshot, with a safety net.** Restore is the one
   destructive step, so it has two guards:
   - A confirm dialog first, showing what the snapshot holds:
     "Restore 'Before the redesign'? It has 3 notes, 2 shapes,
     1 text box, 0 frames, 0 connectors, and 1 image. Everything
     on this board now will be replaced."
   - Before applying it, the client saves the board's CURRENT
     state as an automatic snapshot named "Before restore —
     <date/time>". A restore can never silently lose work: the
     old state is one click away in the list.
   - The restore itself is one `applyBoardExport` transaction
     stamped with the local origin — the same as an import — so
     it syncs to everyone and one undo (Ctrl+Z) reverts it.
   - If the safety copy cannot be saved (the board is already at
     20 snapshots), the restore stops with a message telling the
     user to delete an old snapshot first. Undo still exists as a
     fallback for the person who restores, but the safety copy is
     the one that protects everyone else.
4. **Delete a snapshot.** A Delete button on each row, with a
   confirm step. Deleting a snapshot never touches the board.
   Deleting a board deletes its snapshots with it.

## Deliberately left out

- Automatic snapshots (on a timer, on join, or before edits).
- A diff view between snapshots, or between a snapshot and the
  current board.
- Restoring a snapshot onto a different board (cross-board restore).
- Renaming a snapshot after saving it.
- Exporting or downloading a single snapshot as a file — the JSON
  export already covers getting board state out.

## Things that need a decision before going live

1. The 20-snapshot cap is a guess. If boards with many images hit
   it often, the cap should move — or snapshots should store a
   reference to shared image bytes instead of a copy each time.
2. A restored snapshot keeps the original item ids, so a restore
   never duplicates items — but it also means a restore cannot be
   told apart from the original in the document history. That is
   fine for now; a "restored from" marker is a later addition.
3. The snapshots panel sits beside the comments panel. On a narrow
   screen both panels start collapsed, like the comments panel
   already does — but two panels on a phone is still cramped, and
   a real phone check after deploy is worth doing.

## Verification

- Tests: **225/225 pass** (server 57, incl. 13 new snapshot store
  tests; web 168, incl. 11 new snapshot tests) — server store tests
  cover create/list/get/delete, the 20-snapshot cap, deleted boards,
  and board-delete cascade; web tests cover the default name,
  counts label, newest-first sort, and a capture/restore round-trip
  on a real Y.Doc.
- Lint clean, typecheck clean (all workspaces), vite build succeeds
  (437.74 kB JS).
- Real-browser check (Playwright Firefox, local dev servers,
  script `~/workspace/screenshot-tool/check-snapshots.mjs`): on a
  fresh test board — saved a snapshot named "First version" (row
  showed "4 notes"), edited a note and drew a rectangle, restored
  the snapshot and confirmed the note text came back and the
  rectangle was gone, confirmed the automatic "Before restore"
  safety snapshot appeared, deleted both snapshots, deleted the
  test board. Zero console/page errors. The Main board was verified
  afterwards — 3 starter notes, 0 shapes, 0 images — and the local
  dev database holds only the Main board and 0 snapshots.
  Screenshot: [syncboard-snapshots-panel.png](sandbox://workspace/your_files/syncboard-snapshots-panel.png)
- One layout fix made during verification: long snapshot names
  ("Before restore — Nov 15, 2026, 4:53 PM") wrapped badly beside
  the time, so the row head now stacks name over time.
