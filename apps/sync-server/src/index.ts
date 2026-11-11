import "dotenv/config";
import { Server } from "@hocuspocus/server";

// Reads the port from the environment, falling back to 1234 when
// the variable is missing or not a number.
function readPort(): number {
  const parsed = Number(process.env.SYNC_PORT);
  return Number.isFinite(parsed) ? parsed : 1234;
}

const port = readPort();

// Phase 0: the server accepts connections and keeps documents in
// memory only. Persistence (Phase 4) and JWT auth in the handshake
// (Phase 1) are not wired up yet:
// - No persistence: documents are lost when the server restarts.
//   Phase 4 adds debounced binary writes to SQLite.
// - No auth: every connection is accepted. Phase 1 verifies the
//   JWT in onConnect and rejects connections without one.
const server = Server.configure({ port });

server.listen();
console.log(`SyncBoard sync server listening on port ${port}`);
