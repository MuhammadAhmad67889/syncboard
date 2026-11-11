# SyncBoard

I built SyncBoard because I wanted a shared whiteboard I could actually
run myself: open a board, drop sticky notes on it, and watch other
people's cursors move around in real time — no account on someone
else's cloud, no per-seat price.

It is a real-time collaborative workplace in the style of Miro and
FigJam: many people editing the same board at once, live cursors,
presence, and shared sticky notes that converge without conflicts.

## How it works

- **Real-time engine:** Yjs (a CRDT) keeps every client's copy of the
  board in sync. Two people editing the same note converge; nobody's
  typing overwrites anyone else's.
- **Sync server:** Hocuspocus (Node + TypeScript) relays Yjs updates
  between clients over WebSockets and verifies a JWT in the handshake.
  The client must be `@hocuspocus/provider`, not plain y-websocket:
  Hocuspocus prefixes every message with the document name, so a
  plain y-websocket client's first message bytes get misread as a
  garbage document name.
- **Presence:** the Yjs Awareness protocol shares live cursors, names,
  colors, and selections. They are ephemeral — they vanish when a
  user disconnects.
- **Persistence:** the server stores the serialized Yjs document
  binary in SQLite (debounced writes), so a board survives a server
  restart. The schema is written so Postgres can replace SQLite later.
- **Undo/redo:** each user can only undo their own edits, because
  every local mutation is tagged with that user's origin.

## Monorepo layout

```
syncboard/
  apps/web            Vite + React 19 + TypeScript — the board UI
  apps/sync-server    Hocuspocus sync server (Node + TypeScript)
  packages/shared     Dependency-free types and constants both apps use
```

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

- Web app: http://localhost:5173
- Sync server: ws://localhost:1234

Other useful commands: `npm run build`, `npm run typecheck`,
`npm run test`, `npm run lint`. Run `npm run dev:web` or
`npm run dev:server` to start one side only.

## Phases

- **Phase 0 — Setup (done):** monorepo, sync server skeleton,
  shared data model, placeholder web app.
- **Phase 1 — Real-time core (done):** Yjs document, Hocuspocus
  server with JWT auth in the handshake, React canvas rendering
  notes from the shared map. Pick a demo user (Ahmad, Sara, or
  Omar) to sign in — the server issues a token for them at
  `GET /token?user=<id>` (dev only, no real accounts yet). Open
  the board in two tabs as two different users: editing a note's
  text or dragging it in one tab shows up live in the other.
  Pan and zoom are per user and land in Phase 5; for now the
  board is one fixed view.
- **Phase 2 — Presence (done):** Awareness-driven cursors, user
  list, presence dots, selection highlighting.
- **Phase 3 — Editing UX (done):** double-click empty canvas (or
  the + Note button) creates a note; color picker in the toolbar
  sets the color for new notes and recolors the selected one; the
  selected note has a resize handle and a delete button, and the
  Delete key deletes it too. Per-user undo/redo: every local
  change runs under the origin `local-user-<id>`, and the
  UndoManager only tracks that origin, so your Ctrl+Z never
  reverts another user's edits. Drags and typing batch into one
  undo step.
- **Phase 4 — Persistence + reconnect:** debounced binary
  persistence to SQLite, reload restores the board, offline edits
  merge on reconnect.
- **Phase 5 — Polish + demo:** toolbar, zoom controls, shareable
  demo, a documented two-user test, final README.

## License

MIT — see [LICENSE](LICENSE).
