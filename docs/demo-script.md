# SyncBoard demo script — a 2-user walkthrough

Run this with two browser windows (or two tabs) side by side. Both
point at the same board. No accounts, no setup beyond `npm run dev`.

## Setup

1. Start the app: `npm install`, `cp .env.example .env`, `npm run dev`.
2. Open http://localhost:5173 in two windows. In the left window pick
   **Ahmad**, in the right window pick **Sara**. Both windows show
   "Connected" and the same three starter notes.

## The walkthrough

### 1. Two people, one board

**Do:** Nothing yet — just look at both windows.
**See:** The same three notes in both windows, and the presence bar
says "2 online" with Ahmad and Sara listed.

### 2. A note appears live

**Do:** In Ahmad's window, click **+ Note** in the toolbar and type
"Ship the demo on Friday".
**See:** The new yellow note appears in Sara's window a moment later,
without her doing anything.

### 3. Two people type in the same note

**Do:** In Ahmad's window, click into the "Ship Phase 1" note and
type at the start. At the same time, in Sara's window, click into
the same note and type at the end.
**See:** Both windows end up with the same text — both people's
typing is in there. Nobody's words overwrite anyone else's.

### 4. Live cursors

**Do:** Move the mouse around the board in Ahmad's window.
**See:** In Sara's window, a blue cursor labelled "Ahmad" follows
the same path. Move the mouse in Sara's window and Ahmad sees a
pink cursor labelled "Sara".

### 5. Selection

**Do:** Click the pink "Ask Sara to review the API" note in Sara's
window.
**See:** In Ahmad's window the same note gets a pink outline with a
"Sara" label. Click empty canvas to clear it.

### 6. Drag and recolor

**Do:** In Ahmad's window, drag the green "Demo on Monday 10am"
note by its top strip to a new spot, then pick the blue dot in the
toolbar while it is selected.
**See:** In Sara's window the note moves and turns blue.

### 7. Undo only reverts your own edits

**Do:** In Sara's window, type "SARA-ONLY" into any note. In
Ahmad's window, type "AHMAD-ONLY" into a different note, then
press **Ctrl+Z**.
**See:** Ahmad's "AHMAD-ONLY" disappears — but Sara's "SARA-ONLY"
is still there. Undo never touches another user's work.

### 8. The board survives a restart

**Do:** Stop the sync server (`Ctrl+C` in its terminal) and start
it again with `npm run dev:server`. Reload both windows.
**See:** Every note is still there, exactly as you left it. The
board is saved to SQLite on the server, not just in the browser.

### 9. A fresh user joins mid-session

**Do:** Open a third window and sign in as **Omar**.
**See:** Omar sees the whole current board — all the notes, all the
edits — and the presence bar in every window now says "3 online".
Ahmad and Sara's windows are not disturbed.

### 10. Zoom and pan are yours alone

**Do:** In Ahmad's window, click **+** in the toolbar twice, then
drag the empty canvas to pan.
**See:** Ahmad's view zooms to 156% and pans — but Sara's window
does not move at all. Click **Reset** in Ahmad's window to come
back to 100%. Pan and zoom are per-user; only the notes are shared.

## Resetting the board

To start the demo over from the three starter notes: stop the
server and delete `data/syncboard.db`, then start the server again.
The starter notes are seeded by the server when there is no saved
board.
