import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { DEFAULT_BOARD_ID, DEFAULT_BOARD_NAME, type BoardMeta } from "@syncboard/shared";

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

// One row per board: the board id, its display name, and when it
// was created. The document table above holds the board's
// content; this table is the list the board switcher shows.
const CREATE_META_TABLE = `
  CREATE TABLE IF NOT EXISTS board_meta (
    board_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`;

// One row per deleted board. A deleted board must never come
// back: a late write for its id (the server debounces saves, so
// one can arrive after the delete) must be dropped, and joining
// the room again must not re-seed it. The tombstone is checked
// before every save, load, and meta write, and it is never
// removed.
const CREATE_DELETED_TABLE = `
  CREATE TABLE IF NOT EXISTS deleted_boards (
    board_id TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL
  )
`;

// One row per user account. username keeps the case the user
// typed (that is the name presence shows); username_lower is
// the unique key, so "Ana" and "ana" can never be two accounts.
// password_hash is the scrypt "salt:hash" value from auth.ts —
// the plain password is never stored.
const CREATE_USERS_TABLE = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    username_lower TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`;

// A user account as stored: the password hash is here because
// the server needs it to check logins, and it never leaves the
// server — the API only ever returns the id, name, and color.
export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  color: string;
  createdAt: string;
}

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

// Turns a board name into a short id suffix: lowercase, spaces
// and punctuation become dashes, anything else is dropped. An
// empty result falls back to "board", so every name yields a
// usable id.
export function slugFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "board" : slug;
}

export interface BoardStore {
  // The saved document bytes for a board, or null when the board
  // has never been saved (a brand-new board) or was deleted.
  load(boardId: string): Buffer | null;
  // Overwrites the saved document for a board. A save for a
  // deleted board is silently dropped — it must never resurrect
  // the board.
  save(boardId: string, state: Uint8Array): void;
  // Every board, oldest first, for the board switcher.
  listBoards(): BoardMeta[];
  // Creates a board with the given name and returns it. The
  // document itself is still empty here — the starter notes are
  // seeded on first load, by the existing load path.
  createBoard(name: string): BoardMeta;
  // Renames a board and returns it. Throws "Board name must
  // not be empty." for a blank name, like createBoard.
  // Returns null when the board does not exist or was deleted.
  // The default board renames like any other — only deleting
  // it is forbidden, because clients always need a board to
  // land on.
  renameBoard(boardId: string, name: string): BoardMeta | null;
  // Deletes a board's document and its list entry, and leaves a
  // tombstone so it can never be re-saved or re-seeded. Returns
  // false when the board does not exist. The default board is
  // never deleted — it returns false too.
  deleteBoard(boardId: string): boolean;
  // Whether the board was deleted. A deleted board stays deleted
  // even if a client rejoins its room.
  isDeleted(boardId: string): boolean;
  // Records a board in the list when it has none — used when a
  // client joins a room directly, without creating it through the
  // API first. Never overwrites an existing name, and never
  // revives a deleted board.
  ensureBoardMeta(boardId: string, name?: string): void;
  // Finds an account by username, ignoring case — "Ana" signs in
  // as the same account as "ana". Returns null when there is no
  // such account.
  findUserByUsername(username: string): StoredUser | null;
  // Creates an account. Throws "That username is already taken."
  // when the username (ignoring case) already exists.
  createUser(user: {
    id: string;
    username: string;
    passwordHash: string;
    color: string;
  }): StoredUser;
  close(): void;
}

// Opens the SQLite file and makes sure the tables exist.
// better-sqlite3 is synchronous, which fits a dev server: a
// debounced write is a single fast statement, never a pending
// promise the process can exit before.
export function createBoardStore(dbPath: string): BoardStore {
  const db = new Database(dbPath);
  db.exec(CREATE_TABLE);
  db.exec(CREATE_META_TABLE);
  db.exec(CREATE_DELETED_TABLE);
  db.exec(CREATE_USERS_TABLE);
  const loadStatement = db.prepare("SELECT ydoc_blob FROM boards WHERE board_id = ?");
  const saveStatement = db.prepare(
    `INSERT INTO boards (board_id, ydoc_blob, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(board_id) DO UPDATE SET
       ydoc_blob = excluded.ydoc_blob,
       updated_at = excluded.updated_at`,
  );
  const listStatement = db.prepare(
    // Oldest first. The tie-break is insertion order (rowid), not
    // the board id: two boards created in the same millisecond
    // share a created_at, and sorting those by id would list the
    // newer board first whenever its id sorts earlier.
    "SELECT board_id, name, created_at FROM board_meta ORDER BY created_at ASC, rowid ASC",
  );
  const metaStatement = db.prepare("SELECT board_id FROM board_meta WHERE board_id = ?");
  const selectMetaStatement = db.prepare(
    "SELECT board_id, name, created_at FROM board_meta WHERE board_id = ?",
  );
  const updateMetaStatement = db.prepare(
    "UPDATE board_meta SET name = ? WHERE board_id = ?",
  );
  const insertMetaStatement = db.prepare(
    "INSERT OR IGNORE INTO board_meta (board_id, name, created_at) VALUES (?, ?, ?)",
  );
  const deleteDocStatement = db.prepare("DELETE FROM boards WHERE board_id = ?");
  const deleteMetaStatement = db.prepare("DELETE FROM board_meta WHERE board_id = ?");
  const insertDeletedStatement = db.prepare(
    "INSERT OR IGNORE INTO deleted_boards (board_id, deleted_at) VALUES (?, ?)",
  );
  const isDeletedStatement = db.prepare(
    "SELECT board_id FROM deleted_boards WHERE board_id = ?",
  );
  const findUserStatement = db.prepare(
    "SELECT id, username, password_hash, color, created_at FROM users WHERE username_lower = ?",
  );
  const insertUserStatement = db.prepare(
    "INSERT INTO users (id, username, username_lower, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );

  function rowToUser(row: {
    id: string;
    username: string;
    password_hash: string;
    color: string;
    created_at: string;
  }): StoredUser {
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      color: row.color,
      createdAt: row.created_at,
    };
  }

  function isDeleted(boardId: string): boolean {
    return isDeletedStatement.get(boardId) !== undefined;
  }

  function rowToBoard(row: { board_id: string; name: string; created_at: string }): BoardMeta {
    return { id: row.board_id, name: row.name, createdAt: row.created_at };
  }

  // The default board gets its list entry on first use, so a
  // database created before board metadata existed still shows
  // it. INSERT OR IGNORE keeps an existing name untouched.
  insertMetaStatement.run(DEFAULT_BOARD_ID, DEFAULT_BOARD_NAME, new Date().toISOString());

  return {
    load(boardId: string): Buffer | null {
      if (isDeleted(boardId)) return null;
      const row = loadStatement.get(boardId) as { ydoc_blob: Buffer } | undefined;
      return row ? row.ydoc_blob : null;
    },
    save(boardId: string, state: Uint8Array): void {
      // A debounced save can arrive after the board was deleted.
      // Dropping it here is what keeps a deleted board deleted.
      if (isDeleted(boardId)) return;
      saveStatement.run(boardId, Buffer.from(state), new Date().toISOString());
    },
    listBoards(): BoardMeta[] {
      const rows = listStatement.all() as Array<{
        board_id: string;
        name: string;
        created_at: string;
      }>;
      return rows.map(rowToBoard);
    },
    createBoard(name: string): BoardMeta {
      const trimmed = name.trim();
      if (trimmed === "") {
        throw new Error("Board name must not be empty.");
      }
      // The id is a slug of the name plus a short random suffix,
      // so two boards called "Design" still get different ids.
      // A collision is near-impossible, but retry instead of
      // failing if one ever happens.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const id = `board-${slugFromName(trimmed)}-${randomUUID().slice(0, 6)}`;
        if (isDeleted(id) || metaStatement.get(id) !== undefined) continue;
        const createdAt = new Date().toISOString();
        insertMetaStatement.run(id, trimmed, createdAt);
        return { id, name: trimmed, createdAt };
      }
      throw new Error("Could not pick a free board id — try again.");
    },
    renameBoard(boardId: string, name: string): BoardMeta | null {
      const trimmed = name.trim();
      if (trimmed === "") {
        throw new Error("Board name must not be empty.");
      }
      // A deleted board stays deleted, and a board that never
      // existed has no row — both read as "not found" to the
      // caller, which answers 404.
      if (isDeleted(boardId)) return null;
      const row = selectMetaStatement.get(boardId) as
        | { board_id: string; name: string; created_at: string }
        | undefined;
      if (!row) return null;
      updateMetaStatement.run(trimmed, boardId);
      return { id: row.board_id, name: trimmed, createdAt: row.created_at };
    },
    deleteBoard(boardId: string): boolean {
      // The default board is the fallback every client lands on,
      // so deleting it would leave clients with nowhere to go.
      if (boardId === DEFAULT_BOARD_ID) return false;
      if (isDeleted(boardId)) return false;
      if (metaStatement.get(boardId) === undefined) return false;
      deleteDocStatement.run(boardId);
      deleteMetaStatement.run(boardId);
      insertDeletedStatement.run(boardId, new Date().toISOString());
      return true;
    },
    isDeleted(boardId: string): boolean {
      return isDeleted(boardId);
    },
    ensureBoardMeta(boardId: string, name?: string): void {
      if (isDeleted(boardId)) return;
      insertMetaStatement.run(boardId, name ?? boardId, new Date().toISOString());
    },
    findUserByUsername(username: string): StoredUser | null {
      const row = findUserStatement.get(username.toLowerCase()) as
        | {
            id: string;
            username: string;
            password_hash: string;
            color: string;
            created_at: string;
          }
        | undefined;
      return row ? rowToUser(row) : null;
    },
    createUser(user: {
      id: string;
      username: string;
      passwordHash: string;
      color: string;
    }): StoredUser {
      // Check first for a clear error, and still catch the unique
      // constraint below — two signups racing each other must not
      // slip a duplicate past the check.
      if (findUserStatement.get(user.username.toLowerCase()) !== undefined) {
        throw new Error("That username is already taken.");
      }
      const createdAt = new Date().toISOString();
      try {
        insertUserStatement.run(
          user.id,
          user.username,
          user.username.toLowerCase(),
          user.passwordHash,
          user.color,
          createdAt,
        );
      } catch {
        throw new Error("That username is already taken.");
      }
      return { ...user, createdAt };
    },
    close(): void {
      db.close();
    },
  };
}
