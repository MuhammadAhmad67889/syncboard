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
  shared data model, placeholder web app. This page is all there is
  so far.
- **Phase 1 — Real-time core:** Yjs document, Hocuspocus server,
  React canvas rendering notes from the shared map; two browser
  tabs sync text, position, and color live.
- **Phase 2 — Presence:** Awareness-driven cursors, user list,
  presence dots, selection highlighting.
- **Phase 3 — Editing UX:** create, drag, resize, and delete notes,
  color picker, inline text editing, per-user undo/redo.
- **Phase 4 — Persistence + reconnect:** debounced binary
  persistence to SQLite, reload restores the board, offline edits
  merge on reconnect.
- **Phase 5 — Polish + demo:** toolbar, zoom controls, shareable
  demo, a documented two-user test, final README.

## License

MIT — see [LICENSE](LICENSE).
