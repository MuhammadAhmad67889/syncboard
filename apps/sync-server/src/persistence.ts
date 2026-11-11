import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// One row per board: the board id, the serialized Yjs document,
// and when it was last written. The blob is the whole document,
// so Postgres can take over later with the same shape (a bytea
// column instead of a BLOB).
const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS boards (
    board_id TEXT PRIMARY KEY,
    ydoc_blob BLOB NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

// Turns a DATABASE_URL into a file path. The value looks like
// file:./data/syncboard.db — the file: prefix is stripped, and a
// relative path is resolved against the repo root (this file lives
// in apps/sync-server/src, three levels below the root). An
// absolute path is used as-is. The parent directory is created
// so the first run does not fail for a missing data/ folder.
export function resolveDatabasePath(databaseUrl: string | undefined): string {
  const raw = databaseUrl ?? "file:./data/syncboard.db";
  const withoutScheme = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const dbPath = path.isAbsolute(withoutScheme)
    ? withoutScheme
    : path.resolve(repoRoot, withoutScheme);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return dbPath;
}

export interface BoardStore {
  // The saved document bytes for a board, or null when the board
  // has never been saved (a brand-new board).
  load(boardId: string): Buffer | null;
  // Overwrites the saved document for a board.
  save(boardId: string, state: Uint8Array): void;
  close(): void;
}

// Opens the SQLite file and makes sure the boards table exists.
// better-sqlite3 is synchronous, which fits a dev server: a
// debounced write is a single fast statement, never a pending
// promise the process can exit before.
export function createBoardStore(dbPath: string): BoardStore {
  const db = new Database(dbPath);
  db.exec(CREATE_TABLE);
  const loadStatement = db.prepare("SELECT ydoc_blob FROM boards WHERE board_id = ?");
  const saveStatement = db.prepare(
    `INSERT INTO boards (board_id, ydoc_blob, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(board_id) DO UPDATE SET
       ydoc_blob = excluded.ydoc_blob,
       updated_at = excluded.updated_at`,
  );
  return {
    load(boardId: string): Buffer | null {
      const row = loadStatement.get(boardId) as { ydoc_blob: Buffer } | undefined;
      return row ? row.ydoc_blob : null;
    },
    save(boardId: string, state: Uint8Array): void {
      saveStatement.run(boardId, Buffer.from(state), new Date().toISOString());
    },
    close(): void {
      db.close();
    },
  };
}
