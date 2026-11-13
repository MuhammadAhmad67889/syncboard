# SyncBoard — Miro phases plan (phases 2–7)

Phases 2–7, built one by one, in order, on top of Phase 1 (frames +
connectors, live on main HEAD 0710a84, confirmed present in this tree).
Local work only: no commit, push, upload, or PR until the user says so.

## Where things live

- `apps/web/src/App.tsx` (3437 lines) — the whole app: header, boards bar,
  toolbar, canvas, panels, and all pointer handling. Zoom and pan are
  per-user local state (`zoom` 25–300%, `pan` x/y, `zoomBy`, `resetView`).
- `apps/web/src/App.css` (1020 lines) — all board styling. Dose tokens live
  in `tokens.css`; shared resets in `base.css`. Restyle, never redesign.
- `packages/shared/src/index.ts` (435 lines) — shared types and pure helpers
  (`createFrame`, `createConnector`, `boxCentreInFrame`, `connectorEndpoints`,
  `SEED_NOTES`, `BoardMeta`, `DEFAULT_BOARD_ID`). New synced types go here.
- `apps/web/src/frames.ts` / `connectors.ts` (+ `.test.ts`) — the Phase 1
  pattern to copy: a small module with `build*Map` / `read*` Yjs helpers and
  a vitest file for the pure logic.
- `apps/web/src/boards.ts` — the boards API client: `fetchBoards`,
  `createBoard`, `deleteBoard`, `canDeleteBoard`, `resolveCurrentBoard`.
- `apps/sync-server/` — OFF LIMITS. No change to the server, the boards API,
  auth, or deployment config in any phase.

## Shared rules for every phase

- Humanized code (the user's permanent rule): small functions with clear
  names, comments ONLY where they explain WHY, plain wording, no clever
  one-liners, structure that makes a bug easy to trace. Applies to every line.
- Minimal changes, existing style. No invented metrics, testimonials, logos,
  or fake data. No new backend features where none exists.
- Tests for each phase, following the existing pattern (pure-function tests
  plus Yjs map round-trips, e.g. `frames.test.ts`). After EACH phase run:
  `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` — all must
  pass — and `node ~/workspace/custom-skills/hallmark/scripts/sloplint.mjs`
  on the changed files, 0/0/0 (static gates only; the render tier is
  unavailable, never claim a render pass).
- Browser verification per phase with Playwright
  (`~/workspace/screenshot-tool/`, following `verify-syncboard-phase1.mjs`):
  on a THROWAWAY board, never the Main board, and delete the throwaway board
  afterwards. Re-read the board's notes after every run — never leave a board
  dirtier than you found it. Screenshots to `/tmp/syncboard-phaseN/`.
- Local dev needs `VITE_SYNC_URL` set to the Replit wss URL, otherwise demo
  login fails. The sync server sleeps when idle; wake/restart it before
  verifying. Stop dev servers with `process.kill` on the session id, never
  with a `pkill` pattern that matches your own shell.

## Phase 2 — Left toolbar / Miro-style chrome

What it adds: the tool palette moves from the top horizontal bar to a left
vertical tool rail. The rail holds Select, Note, Text, the four shapes,
Frame, Connector, and later tools plug into the same list (the `TOOLS` array
and `TOOL_ICONS` map in App.tsx already centralise this). The top bar keeps
the board name, presence avatars, Share, and Export. Zoom controls move out
of the toolbar to the bottom-right, next to the minimap's future home.

Where it lives: `App.tsx` (toolbar JSX ~2638, header JSX ~2540) and `App.css`
(`.toolbar`, `.board-header`, `.zoom-controls`). New CSS: a `.tool-rail`
vertical variant reusing the existing `.toolbar-button` recipe.

What it does NOT touch: the tools themselves, their pointer handling, the
canvas, the boards bar, the sync server, or the Dose tokens.

Note: no Share control exists yet. Phase 2 adds one that copies the current
board's link to the clipboard — no backend, no invented invite system.

## Phase 3 — Board sidebar navigation

What it adds: a sidebar panel listing all boards from the existing
`GET /boards` API, with switch, create, and delete (confirm first). It
replaces the horizontal board tabs (`.boards-bar`); the create form and the
delete rules (`canDeleteBoard`, default board undeletable) carry over
unchanged. The current board still resolves with `resolveCurrentBoard`.

Where it lives: `App.tsx` (boards state ~552, `switchBoard`, `createBoard`,
`deleteBoard` handlers, boards-bar JSX ~2559) and `App.css` (`.boards-bar`,
`.board-tab`). `boards.ts` is reused as-is.

What it does NOT touch: the boards API, the sync server, the board document,
or the toolbar.

BLOCKER — rename: the brief asks for rename, but no rename exists anywhere.
The boards API is GET/POST/DELETE only and the store has no rename method,
so rename cannot be built without a server change, which this plan forbids.
Phase 3 ships switch / create / delete only. Rename needs a user decision:
a small `PATCH /boards/:id` endpoint on the sync server, in a later step.

## Phase 4 — Comments

What it adds: a Comment tool (joins the `TOOLS` list with its own hand-drawn
icon) that pins a comment anywhere on the canvas. Each comment is a thread:
author, text, timestamp, resolved flag. Threads can be resolved and deleted.
Unresolved comments show a pin on the canvas; a panel lists the threads.

Where it lives: new `apps/web/src/comments.ts` (+ `comments.test.ts`) for the
Yjs helpers, new `Comment` type + `createComment` in `packages/shared`, and
App.tsx for the tool, pins, and panel. A new Yjs map `"comments"` in the doc;
the UndoManager watches it (roots list ~980), with a snapshot observer like
frames/connectors.

What it does NOT touch: the sync server, the boards API, the other item
types, or the export format (comments are not exported).

## Phase 5 — Dot voting

What it adds: start a voting session (the starter picks how many dots each
person gets), click an item to place a dot, dots shown on the items, end the
session, and clear all votes. One vote per click per person; the session
state and the votes are shared, so everyone sees the same dots.

Where it lives: new `apps/web/src/votes.ts` (+ `votes.test.ts`), new `Vote`
type + helpers in `packages/shared`, and App.tsx for the session controls and
the dot rendering. A new Yjs map `"votes"` in the doc; the UndoManager
watches it.

What it does NOT touch: the sync server, the boards API, the items
themselves (votes reference item ids, they never rewrite items), or export.

## Phase 6 — Templates

What it adds: a template picker with four templates — Kanban board, Retro,
Mind map, Sprint planning — that inserts a pre-built set of frames + notes
onto the board in one click. It builds on Phase 1 frames: each template is
plain data (frame titles, positions, note text) assembled with `createFrame`
and the existing note creation, in one undoable transaction.

Where it lives: new `apps/web/src/templates.ts` (+ `templates.test.ts`) for
the four template definitions, and App.tsx for the picker. Template content
uses only plain, generic labels (e.g. "To do", "Doing", "Done") — no
invented project content.

What it does NOT touch: the sync server, the boards API, the frame/note
code itself, or export.

## Phase 7 — Minimap

What it adds: a small overview in the bottom-right of the canvas showing
frames, notes, and shapes as rectangles, with the current viewport drawn as
a rectangle. Click or drag on the minimap to pan the canvas. It reads the
doc state (frames, notes, shapes) and the local zoom/pan — it never writes
to the doc.

Where it lives: new `apps/web/src/minimap.ts` (+ `minimap.test.ts`) for the
pure maths (board bounds, scale, viewport rectangle, click-to-pan), and
App.tsx + App.css for the minimap box and its pointer handling. It sits next
to the zoom controls moved there in Phase 2.

What it does NOT touch: the sync server, the boards API, the doc, the
toolbar, or the export format.
