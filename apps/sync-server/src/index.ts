import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import { Server } from "@hocuspocus/server";
import {
  DEFAULT_BOARD_ID,
  DEFAULT_NOTE_SIZE,
  SEED_NOTES,
  type BoardMeta,
  type SessionUser,
} from "@syncboard/shared";
import { createBoardStore, resolveDatabasePath } from "./persistence.js";
import {
  DEMO_ACCOUNT,
  colorForUsername,
  hashPassword,
  signToken,
  validatePassword,
  validateUsername,
  verifyPassword,
  verifyToken,
} from "./auth.js";

// dotenv only reads .env from the working directory, but `npm run
// dev` runs this server from apps/sync-server while the .env lives
// at the repo root. Load the working directory's .env first, then
// fill in anything missing from the repo root's .env.
dotenv.config();
dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    ".env",
  ),
});

// Reads the port from the environment, falling back to 1234 when
// the variable is missing or not a number.
function readPort(): number {
  const parsed = Number(process.env.SYNC_PORT);
  return Number.isFinite(parsed) ? parsed : 1234;
}

// The JWT secret signs and verifies tokens. The server refuses to
// start without one, because auth would silently accept nothing.
function readJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set — copy .env.example to .env first.");
  }
  return secret;
}

const port = readPort();
const jwtSecret = readJwtSecret();

if (jwtSecret === "change-me-in-production") {
  console.warn(
    "[warn] JWT_SECRET is still the example value. Change it before any shared deployment.",
  );
}

// The user store lives in the same SQLite file as the boards.
// The path comes from DATABASE_URL (file:./data/syncboard.db by
// default, relative to the repo root). The database file is
// gitignored — deleting it resets every board to the starter
// notes and every account to nothing.
const dbPath = resolveDatabasePath(process.env.DATABASE_URL);
const boardStore = createBoardStore(dbPath);
console.log(`[persist] board state in ${dbPath}`);

// Fills a fresh document with the starter notes. Only called
// from onLoadDocument, when the board has no saved state at all.
function seedBoard(document: Y.Doc): void {
  document.transact(() => {
    const notes = document.getMap<Y.Map<unknown>>("notes");
    for (const seed of SEED_NOTES) {
      if (notes.has(seed.id)) continue;
      const note = new Y.Map<unknown>();
      note.set("x", seed.x);
      note.set("y", seed.y);
      note.set("w", DEFAULT_NOTE_SIZE.w);
      note.set("h", DEFAULT_NOTE_SIZE.h);
      note.set("color", seed.color);
      note.set("text", new Y.Text(seed.text));
      notes.set(seed.id, note);
    }
  });
}

// The public shape of a signed-in user: id, display name, and
// presence color. The password hash never leaves the server.
function publicUser(user: { id: string; username: string; color: string }): SessionUser {
  return { id: user.id, name: user.username, color: user.color };
}

// Auth API: POST /auth/signup creates an account,
// POST /auth/login signs into one, and POST /auth/demo signs in
// as the built-in demo account with no password. Every success
// answers { token, user } — the client stores the token and
// sends it in the Hocuspocus Auth message. Same CORS approach
// as /boards below: the web app runs on another origin in dev,
// so these endpoints answer "*" — they are dev-grade auth (see
// the README), and must never be exposed on a shared deployment
// without rate limiting and a strong JWT secret.
// Returns true when the request was answered here.
async function handleAuthRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (
    url.pathname !== "/auth/signup" &&
    url.pathname !== "/auth/login" &&
    url.pathname !== "/auth/demo"
  ) {
    return false;
  }
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (request.method === "OPTIONS") {
    response.writeHead(204, cors);
    response.end();
    return true;
  }
  const json = (status: number, body: unknown): void => {
    response.writeHead(status, { "Content-Type": "application/json", ...cors });
    response.end(JSON.stringify(body));
  };
  if (request.method !== "POST") {
    json(405, { error: "Method not allowed." });
    return true;
  }
  // The demo login needs no body and no password — it signs a
  // token for the one built-in demo account.
  if (url.pathname === "/auth/demo") {
    console.log(`[auth] demo sign-in`);
    json(200, { token: signToken(DEMO_ACCOUNT, jwtSecret), user: DEMO_ACCOUNT });
    return true;
  }
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch {
    json(400, { error: "Request body is not valid JSON." });
    return true;
  }
  const username = (body as { username?: unknown } | null)?.username;
  const password = (body as { password?: unknown } | null)?.password;
  const usernameError = validateUsername(username);
  if (usernameError) {
    json(400, { error: usernameError });
    return true;
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    json(400, { error: passwordError });
    return true;
  }
  // Both checks passed, so these are strings — the casts below
  // just say so to TypeScript.
  const name = (username as string).trim();
  const secret = password as string;
  if (url.pathname === "/auth/signup") {
    if (boardStore.findUserByUsername(name)) {
      json(409, { error: "That username is already taken." });
      return true;
    }
    let created;
    try {
      created = boardStore.createUser({
        id: randomUUID(),
        username: name,
        passwordHash: hashPassword(secret),
        color: colorForUsername(name),
      });
    } catch (error) {
      json(409, {
        error: error instanceof Error ? error.message : "That username is already taken.",
      });
      return true;
    }
    const user = publicUser(created);
    console.log(`[auth] signed up "${user.name}" (${user.id})`);
    json(201, { token: signToken(user, jwtSecret), user });
    return true;
  }
  // Login: one message for an unknown username and a wrong
  // password alike, so the response never says which half was
  // wrong — that would let someone probe for real usernames.
  const stored = boardStore.findUserByUsername(name);
  if (!stored || !verifyPassword(secret, stored.passwordHash)) {
    json(401, { error: "Incorrect username or password." });
    return true;
  }
  const user = publicUser(stored);
  console.log(`[auth] logged in "${user.name}" (${user.id})`);
  json(200, { token: signToken(user, jwtSecret), user });
  return true;
}

// Reads a JSON request body. Rejects when the body is not
// valid JSON, so a malformed create request gets a 400 instead
// of crashing the handler. An empty body reads as null, so an
// endpoint that takes no body (like the demo login) does not
// have to send one.
function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim() === "") {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("Request body is not valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

// Boards API: GET /boards lists every board, POST /boards
// creates one, DELETE /boards/:id deletes one. Same CORS
// approach as /auth (see above) — the web app runs on another
// origin in dev, and these endpoints are dev-only alongside it.
// Returns true when the request was answered here.
async function handleBoardsRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/boards" && !url.pathname.startsWith("/boards/")) {
    return false;
  }
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (request.method === "OPTIONS") {
    response.writeHead(204, cors);
    response.end();
    return true;
  }
  const json = (status: number, body: unknown): void => {
    response.writeHead(status, { "Content-Type": "application/json", ...cors });
    response.end(JSON.stringify(body));
  };
  if (request.method === "GET" && url.pathname === "/boards") {
    json(200, { boards: boardStore.listBoards() });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/boards") {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch {
      json(400, { error: "Request body is not valid JSON." });
      return true;
    }
    const name = (body as { name?: unknown } | null)?.name;
    if (typeof name !== "string" || name.trim() === "") {
      json(400, { error: "A board name is required." });
      return true;
    }
    let created: BoardMeta;
    try {
      created = boardStore.createBoard(name);
    } catch (error) {
      json(400, { error: error instanceof Error ? error.message : "Could not create board." });
      return true;
    }
    console.log(`[boards] created "${created.name}" (${created.id})`);
    json(201, { board: created });
    return true;
  }
  if (request.method === "DELETE" && url.pathname.startsWith("/boards/")) {
    const id = decodeURIComponent(url.pathname.slice("/boards/".length));
    if (id === DEFAULT_BOARD_ID) {
      json(400, { error: "The default board cannot be deleted." });
      return true;
    }
    if (!boardStore.deleteBoard(id)) {
      json(404, { error: "Board not found." });
      return true;
    }
    console.log(`[boards] deleted "${id}"`);
    json(200, { deleted: true });
    return true;
  }
  json(405, { error: "Method not allowed." });
  return true;
}

// Phase 4: persistence. The server loads each board's saved
// state from SQLite in onLoadDocument and writes it back in
// onStoreDocument, which Hocuspocus calls debounced (2 s after
// the last change) so a drag writes once instead of once per
// pointermove. A board with no saved state is brand new and gets
// the starter notes here, on the server — clients never seed, so
// a board whose notes were all deleted can never re-seed.
//
// Auth flow: the client sends its token in an Auth message right
// after connecting, and onAuthenticate verifies it. A plain
// y-websocket client cannot talk to this server — Hocuspocus
// prefixes every message with the document name, so the client
// must be @hocuspocus/provider (see apps/web).
const server = Server.configure({
  port,
  // Debounces onStoreDocument: 2 s after the last change, and
  // at least every 10 s (maxDebounce) while changes keep coming.
  debounce: 2000,

  async onLoadDocument({ document, documentName }) {
    // A deleted board stays deleted: joining its room again
    // must not re-seed it, and nothing is saved for it.
    if (boardStore.isDeleted(documentName)) {
      console.log(`[persist] "${documentName}" was deleted — loading empty`);
      return;
    }
    const saved = boardStore.load(documentName);
    if (saved) {
      // A saved state exists, so this board is not new — even
      // when the saved notes map is empty (the user deleted every
      // note). Applying it here makes the server the source of
      // truth for "this board already has state".
      Y.applyUpdate(document, saved);
      console.log(`[persist] loaded "${documentName}" (${saved.length} bytes)`);
      return;
    }
    // A room joined directly (not created through POST /boards)
    // still gets a list entry, so the switcher can show it.
    boardStore.ensureBoardMeta(documentName);
    if (document.getMap("notes").size === 0) seedBoard(document);
    // Save right away, so a restart before the first edit still
    // comes back seeded.
    boardStore.save(documentName, Y.encodeStateAsUpdate(document));
    console.log(`[persist] seeded new board "${documentName}"`);
  },

  async onStoreDocument({ document, documentName }) {
    // The store itself drops saves for deleted boards; the
    // check here keeps the intent visible at the call site.
    if (boardStore.isDeleted(documentName)) return;
    boardStore.save(documentName, Y.encodeStateAsUpdate(document));
  },

  async onAuthenticate({ token, documentName }) {
    const user = verifyToken(token, jwtSecret);
    console.log(`[auth] ${user.name} (${user.id}) connected to "${documentName}"`);
    // Whatever onAuthenticate returns is merged into the
    // connection context, so later hooks (e.g. onDisconnect) can
    // see the user.
    return { user };
  },

  async onDisconnect({ context, documentName }) {
    const user = context?.user as { id: string; name: string } | undefined;
    if (user) {
      console.log(`[auth] ${user.name} (${user.id}) left "${documentName}"`);
    }
  },

  async onRequest({ request, response }) {
    if (await handleAuthRequest(request, response)) {
      // The response is already sent. Hocuspocus would otherwise
      // answer with its default "OK" — throwing an empty error
      // stops the default handler without logging anything.
      throw null;
    }
    if (await handleBoardsRequest(request, response)) {
      throw null;
    }
    // Any other path falls through to Hocuspocus' default "OK".
  },
});

server.listen();
console.log(`SyncBoard sync server listening on port ${port}`);
