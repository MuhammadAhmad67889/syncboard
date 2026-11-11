import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { IncomingMessage, ServerResponse } from "node:http";
import jwt from "jsonwebtoken";
import * as Y from "yjs";
import { Server } from "@hocuspocus/server";
import {
  DEFAULT_NOTE_SIZE,
  DEMO_USERS,
  SEED_NOTES,
  type DemoUser,
} from "@syncboard/shared";
import { createBoardStore, resolveDatabasePath } from "./persistence.js";

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

// The board store lives in SQLite. The path comes from
// DATABASE_URL (file:./data/syncboard.db by default, relative to
// the repo root). The database file is gitignored — deleting it
// resets every board to the starter notes.
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

// Signs a short-lived token for one of the hardcoded demo users.
// The payload carries who the user is, so onConnect can log it.
function signDemoToken(user: DemoUser): string {
  return jwt.sign(
    { sub: user.id, name: user.name, color: user.color },
    jwtSecret,
    { algorithm: "HS256", expiresIn: "8h" },
  );
}

// Verifies the token from the client's Auth message and returns
// who it belongs to. Throws when the token is missing or invalid —
// Hocuspocus answers a failed onAuthenticate with a
// permission-denied message instead of setting up the connection.
function verifyToken(token: string | null): { id: string; name: string } {
  if (!token) {
    throw new Error("Missing token");
  }
  try {
    const payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
    if (typeof payload !== "object" || payload === null || typeof payload.sub !== "string") {
      throw new Error("Token has no user id");
    }
    return {
      id: payload.sub,
      name: typeof payload.name === "string" ? payload.name : payload.sub,
    };
  } catch {
    throw new Error("Invalid token");
  }
}

// DEV ONLY: answers GET /token?user=<id> with a signed token for a
// hardcoded demo user: { token, user: { id, name, color } }.
// There are no real accounts yet; this endpoint exists so the demo
// can sign in without a login form. It must never be exposed on a
// shared deployment — real auth replaces it in a later phase.
// Returns true when the request was answered here.
function handleTokenRequest(request: IncomingMessage, response: ServerResponse): boolean {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/token") {
    return false;
  }
  // The web app runs on another origin in dev (localhost:5173 vs
  // localhost:1234), so a browser fetch of /token is cross-origin and
  // needs CORS headers — without them the browser blocks the response
  // even though curl works. "*" is fine here because this endpoint is
  // DEV ONLY: it hands out tokens for hardcoded demo users, no real
  // accounts, and must never be exposed on a shared deployment.
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (request.method === "OPTIONS") {
    response.writeHead(204, cors);
    response.end();
    return true;
  }
  const user = DEMO_USERS.find((candidate) => candidate.id === url.searchParams.get("user"));
  if (!user) {
    response.writeHead(400, { "Content-Type": "application/json", ...cors });
    response.end(
      JSON.stringify({
        error: `Unknown demo user. Try one of: ${DEMO_USERS.map((candidate) => candidate.id).join(", ")}`,
      }),
    );
    return true;
  }
  response.writeHead(200, { "Content-Type": "application/json", ...cors });
  response.end(JSON.stringify({ token: signDemoToken(user), user }));
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
    if (document.getMap("notes").size === 0) seedBoard(document);
    // Save right away, so a restart before the first edit still
    // comes back seeded.
    boardStore.save(documentName, Y.encodeStateAsUpdate(document));
    console.log(`[persist] seeded new board "${documentName}"`);
  },

  async onStoreDocument({ document, documentName }) {
    boardStore.save(documentName, Y.encodeStateAsUpdate(document));
  },

  async onAuthenticate({ token, documentName }) {
    const user = verifyToken(token);
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
    if (handleTokenRequest(request, response)) {
      // The response is already sent. Hocuspocus would otherwise
      // answer with its default "OK" — throwing an empty error
      // stops the default handler without logging anything.
      throw null;
    }
    // Any other path falls through to Hocuspocus' default "OK".
  },
});

server.listen();
console.log(`SyncBoard sync server listening on port ${port}`);
