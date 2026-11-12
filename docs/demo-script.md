# SyncBoard demo script — a 2-user walkthrough

Run this with two browser windows (or two tabs) side by side. Both
point at the same board. Create a free account per window, or use
"Try the demo" in one of them — no setup beyond `npm run dev`.

## Setup

1. Start the app: `npm install`, `cp .env.example .env`, `npm run dev`.
2. Open http://localhost:5173 in two windows. In the left window
   create an account called **ahmad**, in the right window create
   one called **sara** (any password of 8 characters or more).
   Both windows show "Connected" and the same three starter notes.

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

### 7. Shapes draw live — including the pen

**Do:** In Ahmad's window, click **Rectangle** in the toolbar and
drag on empty canvas (not on a note — a press that starts on a note
draws nothing). Then click **Pen** and scribble a short stroke.
In Sara's window, click **Ellipse** and drag one out, then click
**Line** and drag a line.
**See:** Every shape appears in the other window as it is drawn —
the pen stroke grows while Ahmad is still drawing it. Click a
shape to select it: it gets a resize handle and a delete button,
and the toolbar color dots recolor it, just like a note.

### 8. A second board stays separate

**Do:** In Ahmad's window, click **+ New board**, name it
"Design", and click **Create board**. Type a note on it: "Only on
Design".
**See:** Sara's board list gains a "Design" tab, but she is still
on the Main board and does not see the "Only on Design" note —
boards are separate rooms. Now Sara clicks the **Design** tab.
**See:** She is on the Design board and sees the note. Switch both
windows back to **Main board** to continue.

### 9. Text boxes and export

**Do:** In Ahmad's window, click **Text** in the toolbar, click
empty canvas, and type "Launch plan". Click the **L** button in the
toolbar while the box is selected.
**See:** The text box appears in Sara's window in large text. Now
in Ahmad's window, click **Export PNG** — a PNG image of the board
downloads. Then click **Export JSON** — a JSON file with the
board's notes, shapes, and text boxes downloads.
**See (import):** In Ahmad's window, create another board, add a
throwaway note to it, then click **Import JSON** and pick the file
just exported. The confirm dialog asks first — accept it.
**See:** The throwaway note is gone and the board now holds the
exported content, including the "Launch plan" text box — and Sara
sees the same, because an import is a shared edit like any other.

### 10. Undo only reverts your own edits

**Do:** In Sara's window, type "SARA-ONLY" into any note. In
Ahmad's window, type "AHMAD-ONLY" into a different note, then
press **Ctrl+Z**.
**See:** Ahmad's "AHMAD-ONLY" disappears — but Sara's "SARA-ONLY"
is still there. Undo never touches another user's work.

### 11. Accounts: sign out, wrong password, demo

**Do:** In Ahmad's window, click **Sign out**, then log back in
with the same username and password.
**See:** Ahmad is back on the board, same name and color. Now sign
out again and try logging in with the wrong password.
**See:** "Incorrect username or password." — and the board stays
hidden. Finally, click **Try the demo**.
**See:** The board opens as the Demo user, no password needed.
Reload the window: the Demo session is still there, no login
screen.

### 12. The board survives a restart

**Do:** Stop the sync server (`Ctrl+C` in its terminal) and start
it again with `npm run dev:server`. Reload both windows.
**See:** Every note is still there, exactly as you left it. The
board is saved to SQLite on the server, not just in the browser.

### 13. A fresh user joins mid-session

**Do:** Open a third window and sign in as **Omar**.
**See:** Omar sees the whole current board — all the notes, all the
edits — and the presence bar in every window now says "3 online".
Ahmad and Sara's windows are not disturbed.

### 14. Zoom and pan are yours alone

**Do:** In Ahmad's window, click **+** in the toolbar twice, then
drag the empty canvas to pan.
**See:** Ahmad's view zooms to 156% and pans — but Sara's window
does not move at all. Click **Reset** in Ahmad's window to come
back to 100%. Pan and zoom are per-user; only the notes are shared.

## Resetting the board

To start the demo over from the three starter notes: stop the
server and delete `data/syncboard.db`, then start the server again.
The starter notes are seeded by the server when there is no saved
board. (Deleting the database also removes every account — you
will need to create them again.)
