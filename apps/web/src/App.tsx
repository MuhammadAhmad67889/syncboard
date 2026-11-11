import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  DEFAULT_NOTE_SIZE,
  DEMO_USERS,
  NOTE_COLORS,
  type DemoUser,
  type Note,
  type NoteColor,
} from "@syncboard/shared";

// The room every demo client joins. One room = one shared board.
const ROOM_NAME = "syncboard-demo";

// The sync server address, from the environment.
const SYNC_URL = import.meta.env.VITE_SYNC_URL ?? "ws://localhost:1234";

// One note inside the shared document: a Y.Map whose fields are
// numbers (x, y, w, h), a color name, and a Y.Text for the text.
type NoteMap = Y.Map<unknown>;

// The three starter notes, seeded when a board is first opened.
// The ids are fixed, so two tabs seeding at the same time still
// end up with exactly one copy of each note.
const SEED_NOTES: Array<{ id: string; x: number; y: number; color: NoteColor; text: string }> = [
  { id: "seed-1", x: 80, y: 120, color: "yellow", text: "Ship Phase 1\nby Friday" },
  { id: "seed-2", x: 380, y: 220, color: "pink", text: "Ask Sara to\nreview the API" },
  { id: "seed-3", x: 700, y: 120, color: "green", text: "Demo on\nMonday 10am" },
];

// The token endpoint lives on the same server as the sync
// websocket, so the HTTP URL is the sync URL with ws -> http.
function httpSyncUrl(): string {
  return SYNC_URL.replace(/^ws/, "http");
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNoteColor(value: unknown): NoteColor {
  return typeof value === "string" && value in NOTE_COLORS ? (value as NoteColor) : "yellow";
}

// Reads one note out of the shared document into a plain object
// React can render. Unknown or missing fields fall back to
// defaults instead of crashing the board.
function readNote(id: string, noteMap: NoteMap): Note {
  const text = noteMap.get("text");
  return {
    id,
    x: asNumber(noteMap.get("x"), 0),
    y: asNumber(noteMap.get("y"), 0),
    w: asNumber(noteMap.get("w"), DEFAULT_NOTE_SIZE.w),
    h: asNumber(noteMap.get("h"), DEFAULT_NOTE_SIZE.h),
    color: asNoteColor(noteMap.get("color")),
    text: text instanceof Y.Text ? text.toString() : "",
  };
}

// Seeds the starter notes, but only the ones that are not already
// there. Safe to call on every reconnect: an existing note is
// never overwritten.
function seedNotes(doc: Y.Doc): void {
  doc.transact(() => {
    const notes = doc.getMap<NoteMap>("notes");
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

// Updates a Y.Text to match the textarea, changing only the part
// that actually differs. A whole-string replace would delete text
// another user typed at the same time; a prefix/suffix diff keeps
// both people's typing.
function updateNoteText(doc: Y.Doc, text: Y.Text, next: string): void {
  const current = text.toString();
  if (current === next) return;
  let start = 0;
  while (start < current.length && start < next.length && current[start] === next[start]) {
    start += 1;
  }
  let endCurrent = current.length;
  let endNext = next.length;
  while (
    endCurrent > start &&
    endNext > start &&
    current[endCurrent - 1] === next[endNext - 1]
  ) {
    endCurrent -= 1;
    endNext -= 1;
  }
  doc.transact(() => {
    if (endCurrent > start) text.delete(start, endCurrent - start);
    if (endNext > start) text.insert(start, next.slice(start, endNext));
  });
}

type ConnectionStatus = "connecting" | "connected" | "disconnected";

// The provider reports status as a string enum; this maps it onto
// the three states the header shows.
function toConnectionStatus(status: string): ConnectionStatus {
  if (status === "connected") return "connected";
  if (status === "connecting") return "connecting";
  return "disconnected";
}

export default function App() {
  const [session, setSession] = useState<{ user: DemoUser; token: string } | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  // Signs in as a demo user: the sync server issues a token for
  // the user picked here, and the board connects with that token.
  async function signIn(user: DemoUser): Promise<void> {
    setSigningIn(true);
    setSignInError(null);
    try {
      const response = await fetch(`${httpSyncUrl()}/token?user=${encodeURIComponent(user.id)}`);
      if (!response.ok) {
        throw new Error(`Token request failed (${response.status}) — is the sync server running?`);
      }
      const data = await response.json();
      setSession({ user, token: data.token });
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setSigningIn(false);
    }
  }

  if (!session) {
    return (
      <main className="picker">
        <h1>SyncBoard</h1>
        <p>Pick a demo user to join the board.</p>
        <div className="picker-users">
          {DEMO_USERS.map((user) => (
            <button
              key={user.id}
              type="button"
              className="picker-user"
              disabled={signingIn}
              onClick={() => void signIn(user)}
            >
              <span className="user-dot" style={{ background: user.color }} />
              {user.name}
            </button>
          ))}
        </div>
        {signInError && <p className="picker-error">{signInError}</p>}
        <p className="picker-hint">
          Demo sign-in only — the sync server issues a token for the user you pick. Open the board
          in two tabs as two different users to see live sync.
        </p>
      </main>
    );
  }

  return <Board user={session.user} token={session.token} onSignOut={() => setSession(null)} />;
}

function Board({
  user,
  token,
  onSignOut,
}: {
  user: DemoUser;
  token: string;
  onSignOut: () => void;
}) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [authError, setAuthError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const docRef = useRef<Y.Doc | null>(null);
  const notesMapRef = useRef<Y.Map<NoteMap> | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    noteX: number;
    noteY: number;
  } | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    // HocuspocusProvider, not plain y-websocket: the Hocuspocus
    // server prefixes every message with the document name, so a
    // plain y-websocket client is misread (its first message bytes
    // become a garbage document name). The provider also sends the
    // token in an Auth message, which the server verifies in
    // onAuthenticate.
    const provider = new HocuspocusProvider({
      url: SYNC_URL,
      name: ROOM_NAME,
      document: doc,
      token,
      // BroadcastChannel would sync tabs directly, bypassing the
      // server — disabled so the two-tab test proves server sync.
      broadcast: false,
      onStatus: ({ status: next }) => setStatus(toConnectionStatus(next)),
      onSynced: ({ state }) => {
        if (state && notesMap.size === 0) seedNotes(doc);
      },
      onAuthenticationFailed: ({ reason }) => setAuthError(reason),
    });
    const notesMap = doc.getMap<NoteMap>("notes");
    docRef.current = doc;
    notesMapRef.current = notesMap;

    // Re-reads every note from the shared document into React
    // state. observeDeep fires for note moves, resizes, color
    // changes, and text edits alike.
    function snapshot(): void {
      const next: Note[] = [];
      notesMap.forEach((noteMap, id) => next.push(readNote(id, noteMap)));
      setNotes(next);
    }

    notesMap.observeDeep(snapshot);
    snapshot();

    return () => {
      notesMap.unobserveDeep(snapshot);
      provider.destroy();
      doc.destroy();
      docRef.current = null;
      notesMapRef.current = null;
    };
  }, [token]);

  // Starts a drag from a note's handle. The textarea underneath
  // stays free for text editing — only the handle drags.
  function startDrag(event: React.PointerEvent<HTMLDivElement>, note: Note): void {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: note.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      noteX: note.x,
      noteY: note.y,
    };
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    if (!drag || !doc || !notesMap || event.pointerId !== drag.pointerId) return;
    const noteMap = notesMap.get(drag.id);
    if (!noteMap) return;
    const nextX = Math.max(0, drag.noteX + event.clientX - drag.startX);
    const nextY = Math.max(0, drag.noteY + event.clientY - drag.startY);
    doc.transact(() => {
      noteMap.set("x", Math.round(nextX));
      noteMap.set("y", Math.round(nextY));
    });
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function changeNoteText(noteId: string, next: string): void {
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    if (!doc || !notesMap) return;
    const noteMap = notesMap.get(noteId);
    const text = noteMap?.get("text");
    if (!noteMap || !(text instanceof Y.Text)) return;
    updateNoteText(doc, text, next);
  }

  return (
    <div className="board-page">
      <header className="board-header">
        <h1>SyncBoard</h1>
        <span className="user-chip">
          <span className="user-dot" style={{ background: user.color }} />
          {user.name}
        </span>
        <span className={`status status-${status}`}>
          {status === "connected"
            ? "Connected"
            : status === "connecting"
              ? "Connecting…"
              : "Disconnected"}
        </span>
        {authError && <span className="auth-error">Sign-in failed: {authError}</span>}
        <button type="button" className="sign-out" onClick={onSignOut}>
          Sign out
        </button>
      </header>
      <div className="board">
        {notes.map((note) => (
          <div
            key={note.id}
            className="note"
            style={{
              left: note.x,
              top: note.y,
              width: note.w,
              height: note.h,
              background: NOTE_COLORS[note.color],
            }}
          >
            <div
              className="note-handle"
              onPointerDown={(event) => startDrag(event, note)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
            />
            <textarea
              className="note-text"
              value={note.text}
              onChange={(event) => changeNoteText(note.id, event.target.value)}
              aria-label="Note text"
            />
          </div>
        ))}
        {notes.length === 0 && <p className="board-empty">Loading notes…</p>}
      </div>
    </div>
  );
}
