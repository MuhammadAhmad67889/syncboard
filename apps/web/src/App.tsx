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
  type PresenceUser,
} from "@syncboard/shared";

// The room every demo client joins. One room = one shared board.
const ROOM_NAME = "syncboard-demo";

// The sync server address, from the environment.
const SYNC_URL = import.meta.env.VITE_SYNC_URL ?? "ws://localhost:1234";

// One note inside the shared document: a Y.Map whose fields are
// numbers (x, y, w, h), a color name, and a Y.Text for the text.
type NoteMap = Y.Map<unknown>;

// Throttle: about 30 cursor updates per second. Pointermove
// fires far more often than that, and every update is a message
// to the server.
const CURSOR_THROTTLE_MS = 33;

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

// Updates a Y.Text to match the textarea, changing only the part
// that actually differs. A whole-string replace would delete text
// another user typed at the same time; a prefix/suffix diff keeps
// both people's typing. The change runs under `origin` so the
// local UndoManager can track it (and only it).
function updateNoteText(doc: Y.Doc, text: Y.Text, next: string, origin: unknown): void {
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
  }, origin);
}

// Reads a cursor out of an Awareness state. Anything malformed
// is not a cursor.
function asCursor(value: unknown): { x: number; y: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as { x: unknown; y: unknown };
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

// Reads a remote user's presence out of an Awareness state.
// Remote states are untrusted data, so anything malformed is
// ignored instead of crashing the board.
function asPresenceUser(state: unknown): PresenceUser | null {
  if (typeof state !== "object" || state === null) return null;
  const record = state as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.color !== "string"
  ) {
    return null;
  }
  const selected = record.selectedNoteIds;
  return {
    id: record.id,
    name: record.name,
    color: record.color,
    cursor: asCursor(record.cursor),
    selectedNoteIds: Array.isArray(selected)
      ? selected.filter((id): id is string => typeof id === "string")
      : [],
  };
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
  // Everyone else on the board, from Awareness. Our own presence
  // lives in localPresenceRef — the bar and cursors only show
  // other people.
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  // The note this user clicked. null means nothing selected.
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  // The color new notes get, and the color the picker shows as
  // active. Picking a color also recolors the selected note.
  const [pickedColor, setPickedColor] = useState<NoteColor>("yellow");
  // Whether the local UndoManager has anything to undo or redo.
  // Updated whenever the undo stack changes.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // The origin stamped on every local change. The UndoManager
  // only tracks this origin, so undo never reverts another
  // user's edits — their changes arrive with a different origin.
  const localOrigin = `local-user-${user.id}`;
  const docRef = useRef<Y.Doc | null>(null);
  const notesMapRef = useRef<Y.Map<NoteMap> | null>(null);
  // The provider's Awareness instance (null only if the provider
  // was created with awareness disabled — we never do that).
  const awarenessRef = useRef<HocuspocusProvider["awareness"]>(null);
  // Our own presence: cursor position and selected notes. Kept in
  // a ref because it changes on every mouse move and must not
  // re-render the board each time.
  const localPresenceRef = useRef<PresenceUser>({
    id: user.id,
    name: user.name,
    color: user.color,
    cursor: null,
    selectedNoteIds: [],
  });
  // When the last cursor position was sent, for the ~30/s throttle.
  const lastCursorSentRef = useRef(0);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    noteX: number;
    noteY: number;
  } | null>(null);
  // The resize in progress, if any — same shape as the drag.
  const resizeRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    noteW: number;
    noteH: number;
  } | null>(null);
  // The per-user UndoManager: it tracks only changes stamped
  // with localOrigin, on the shared notes map and its children
  // (nested note maps and their Y.Text).
  const undoManagerRef = useRef<Y.UndoManager | null>(null);

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
      onAuthenticationFailed: ({ reason }) => setAuthError(reason),
    });
    const notesMap = doc.getMap<NoteMap>("notes");
    docRef.current = doc;
    notesMapRef.current = notesMap;

    // Per-user undo: the manager only tracks transactions stamped
    // with our own origin, so another user's edits never land on
    // our undo stack. Drags and typing batch into one step while
    // they keep coming within the capture timeout (500 ms).
    const undoManager = new Y.UndoManager(notesMap, {
      trackedOrigins: new Set([localOrigin]),
    });
    undoManagerRef.current = undoManager;
    function refreshUndoState(): void {
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    }
    undoManager.on("stack-item-added", refreshUndoState);
    undoManager.on("stack-item-popped", refreshUndoState);
    undoManager.on("stack-cleared", refreshUndoState);
    refreshUndoState();

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

    // Presence: this client publishes its own cursor and selection
    // through Awareness, and reads everyone else's from the same
    // Awareness instance. Awareness is ephemeral — the server
    // stores nothing, and a disconnected client's state disappears
    // on its own.
    const awareness = provider.awareness;
    awarenessRef.current = awareness;
    awareness?.setLocalState({ ...localPresenceRef.current });

    // Re-reads every other user's presence into React state.
    // Our own state is skipped — it already lives in
    // localPresenceRef, and the bar/cursors only show other people.
    function refreshPresence(): void {
      if (!awareness) return;
      const others: PresenceUser[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const person = asPresenceUser(state);
        if (person) others.push(person);
      });
      // Stable order so the presence bar doesn't jump around as
      // states update.
      others.sort((a, b) => a.name.localeCompare(b.name));
      setPresence(others);
    }

    awareness?.on("change", refreshPresence);
    refreshPresence();

    return () => {
      undoManager.off("stack-item-added", refreshUndoState);
      undoManager.off("stack-item-popped", refreshUndoState);
      undoManager.off("stack-cleared", refreshUndoState);
      undoManager.destroy();
      undoManagerRef.current = null;
      awareness?.off("change", refreshPresence);
      awarenessRef.current = null;
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
    // Stamped with our origin so undo can revert this move — and
    // only this user's moves. Pointermove fires faster than the
    // capture timeout, so the whole drag lands on one undo step.
    doc.transact(() => {
      noteMap.set("x", Math.round(nextX));
      noteMap.set("y", Math.round(nextY));
    }, localOrigin);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      // The next change starts a fresh undo step instead of
      // joining the drag we just finished.
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Publishes the local user's current presence (cursor +
  // selection) to everyone else. Called after any local change.
  function publishPresence(): void {
    awarenessRef.current?.setLocalState({ ...localPresenceRef.current });
  }

  // Sends the pointer position (in board pixels) to everyone
  // else, at most once per throttle window.
  function trackCursor(event: React.PointerEvent<HTMLDivElement>): void {
    const board = boardRef.current;
    if (!board || !awarenessRef.current) return;
    const now = performance.now();
    if (now - lastCursorSentRef.current < CURSOR_THROTTLE_MS) return;
    lastCursorSentRef.current = now;
    const rect = board.getBoundingClientRect();
    localPresenceRef.current.cursor = {
      x: Math.round(event.clientX - rect.left),
      y: Math.round(event.clientY - rect.top),
    };
    publishPresence();
  }

  // The pointer left the board, so other users should stop
  // seeing a cursor from us.
  function clearCursor(): void {
    if (localPresenceRef.current.cursor === null) return;
    localPresenceRef.current.cursor = null;
    publishPresence();
  }

  // Sets the selection in state and in Awareness at once, so
  // the outline, the presence bar, and other users stay in sync.
  function setSelection(noteId: string | null): void {
    setSelectedNoteId(noteId);
    localPresenceRef.current.selectedNoteIds = noteId ? [noteId] : [];
    publishPresence();
  }

  // Clicking a note selects it, and tells everyone else.
  function selectNote(noteId: string): void {
    if (selectedNoteId === noteId) return;
    setSelection(noteId);
  }

  // Clicking empty board clears the selection.
  function clearSelection(): void {
    if (localPresenceRef.current.selectedNoteIds.length === 0) return;
    setSelection(null);
  }

  function changeNoteText(noteId: string, next: string): void {
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    if (!doc || !notesMap) return;
    const noteMap = notesMap.get(noteId);
    const text = noteMap?.get("text");
    if (!noteMap || !(text instanceof Y.Text)) return;
    updateNoteText(doc, text, next, localOrigin);
  }

  // Creates a note at the given board position, in the picked
  // color, and selects it so the user can type or recolor it
  // right away. The new note is empty — the user types into it.
  function createNote(x: number, y: number): void {
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    if (!doc || !notesMap) return;
    const id = crypto.randomUUID();
    doc.transact(() => {
      const note = new Y.Map<unknown>();
      note.set("x", Math.round(x));
      note.set("y", Math.round(y));
      note.set("w", DEFAULT_NOTE_SIZE.w);
      note.set("h", DEFAULT_NOTE_SIZE.h);
      note.set("color", pickedColor);
      note.set("text", new Y.Text(""));
      notesMap.set(id, note);
    }, localOrigin);
    selectNote(id);
  }

  // Creates a note in the middle of the visible board.
  function createNoteAtCenter(): void {
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    createNote(
      Math.max(0, rect.width / 2 - DEFAULT_NOTE_SIZE.w / 2),
      Math.max(0, rect.height / 2 - DEFAULT_NOTE_SIZE.h / 2),
    );
  }

  // Double-clicking empty canvas creates a note centered on the
  // click. A double-click on a note does nothing — its target is
  // the note, not the board.
  function createNoteAtPoint(event: React.MouseEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) return;
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    createNote(
      Math.max(0, event.clientX - rect.left - DEFAULT_NOTE_SIZE.w / 2),
      Math.max(0, event.clientY - rect.top - DEFAULT_NOTE_SIZE.h / 2),
    );
  }

  // Recolors one note. The change syncs to every tab like any
  // other edit, and undo reverts it.
  function recolorNote(noteId: string, color: NoteColor): void {
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    if (!doc || !notesMap) return;
    const noteMap = notesMap.get(noteId);
    if (!noteMap) return;
    doc.transact(() => {
      noteMap.set("color", color);
    }, localOrigin);
  }

  // Picks the color for new notes — and recolors the selected
  // note right away, if there is one.
  function pickColor(color: NoteColor): void {
    setPickedColor(color);
    if (selectedNoteId) recolorNote(selectedNoteId, color);
  }

  // Removes a note from the shared map, so it disappears in every
  // tab. If it was the selected note, the selection clears too.
  function deleteNote(noteId: string): void {
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    if (!doc || !notesMap || !notesMap.has(noteId)) return;
    doc.transact(() => {
      notesMap.delete(noteId);
    }, localOrigin);
    if (localPresenceRef.current.selectedNoteIds.includes(noteId)) {
      setSelection(null);
    }
  }

  // The smallest a note can be resized to — smaller than this,
  // the text is unreadable.
  const MIN_NOTE_SIZE = 120;

  // Starts a resize from the note's bottom-right handle.
  function startResize(event: React.PointerEvent<HTMLDivElement>, note: Note): void {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      id: note.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      noteW: note.w,
      noteH: note.h,
    };
  }

  function moveResize(event: React.PointerEvent<HTMLDivElement>): void {
    const resize = resizeRef.current;
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    if (!resize || !doc || !notesMap || event.pointerId !== resize.pointerId) return;
    const noteMap = notesMap.get(resize.id);
    if (!noteMap) return;
    const nextW = Math.max(MIN_NOTE_SIZE, resize.noteW + event.clientX - resize.startX);
    const nextH = Math.max(MIN_NOTE_SIZE, resize.noteH + event.clientY - resize.startY);
    // Same batching as a drag: rapid moves merge into one undo step.
    doc.transact(() => {
      noteMap.set("w", Math.round(nextW));
      noteMap.set("h", Math.round(nextH));
    }, localOrigin);
  }

  function endResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (resizeRef.current?.pointerId === event.pointerId) {
      resizeRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Reverts the last local change only. Remote edits are not on
  // this stack (they arrive with a different origin), so undo
  // never touches another user's work.
  function undo(): void {
    const manager = undoManagerRef.current;
    if (!manager || !manager.canUndo()) return;
    manager.undo();
  }

  function redo(): void {
    const manager = undoManagerRef.current;
    if (!manager || !manager.canRedo()) return;
    manager.redo();
  }

  // Keyboard shortcuts: Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo,
  // Delete / Backspace deletes the selected note. Delete only
  // fires when the user is not typing in a note's textarea.
  // Ctrl+Z is caught even while typing: the textarea is controlled
  // by the shared document, so the browser's native text undo
  // would fight React — the UndoManager is the one that works.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const editingText =
        target !== null &&
        (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable);
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && !event.shiftKey && key === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (mod && (key === "y" || (event.shiftKey && key === "z"))) {
        event.preventDefault();
        redo();
        return;
      }
      if (!editingText && (event.key === "Delete" || event.key === "Backspace")) {
        const selectedId = localPresenceRef.current.selectedNoteIds[0];
        if (selectedId) {
          event.preventDefault();
          deleteNote(selectedId);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // The handlers only touch refs and state setters, so binding
    // once is safe — the selection is read from the presence ref,
    // not from state, so it is never stale.
  }, []);

  // Who selected each note, local user included, so the outline
  // and label can show every selector at once.
  const selectorsByNote = new Map<string, PresenceUser[]>();
  function addSelector(noteId: string, person: PresenceUser): void {
    const list = selectorsByNote.get(noteId) ?? [];
    list.push(person);
    selectorsByNote.set(noteId, list);
  }
  if (selectedNoteId) {
    addSelector(selectedNoteId, {
      id: user.id,
      name: user.name,
      color: user.color,
      cursor: null,
      selectedNoteIds: [selectedNoteId],
    });
  }
  for (const person of presence) {
    for (const noteId of person.selectedNoteIds) addSelector(noteId, person);
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
      <div className="presence-bar" aria-label="People on this board">
        <span className="presence-count">{presence.length + 1} online</span>
        <PresenceChip person={user} you />
        {presence.map((person) => (
          <PresenceChip key={person.id} person={person} />
        ))}
      </div>
      <div className="toolbar" aria-label="Board tools">
        <button type="button" className="toolbar-button" onClick={createNoteAtCenter}>
          + Note
        </button>
        <span className="toolbar-divider" aria-hidden="true" />
        <div className="color-picker" role="group" aria-label="Note color">
          {(Object.keys(NOTE_COLORS) as NoteColor[]).map((color) => (
            <button
              key={color}
              type="button"
              className={`color-dot${color === pickedColor ? " active" : ""}`}
              style={{ background: NOTE_COLORS[color] }}
              onClick={() => pickColor(color)}
              aria-label={`${color} note`}
              aria-pressed={color === pickedColor}
            />
          ))}
        </div>
        <span className="toolbar-divider" aria-hidden="true" />
        <button
          type="button"
          className="toolbar-button"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          Redo
        </button>
      </div>
      <div
        className="board"
        ref={boardRef}
        onPointerMove={trackCursor}
        onPointerLeave={clearCursor}
        onPointerDown={(event) => {
          // A click on empty board (not on a note) clears the selection.
          if (event.target === event.currentTarget) clearSelection();
        }}
        onDoubleClick={createNoteAtPoint}
      >
        {notes.map((note) => {
          const selectors = selectorsByNote.get(note.id) ?? [];
          return (
            <div
              key={note.id}
              className="note"
              onPointerDown={(event) => {
                if (event.button === 0) selectNote(note.id);
              }}
              style={{
                left: note.x,
                top: note.y,
                width: note.w,
                height: note.h,
                background: NOTE_COLORS[note.color],
                // A selected note gets an outline in the first
                // selector's color, on top of the usual shadow.
                ...(selectors.length > 0
                  ? {
                      boxShadow: `0 0 0 2px ${selectors[0].color}, 0 2px 8px rgb(15 23 42 / 0.15)`,
                    }
                  : undefined),
              }}
            >
              {selectors.length > 0 && (
                <span
                  className="note-selector"
                  style={{ background: selectors[0].color }}
                >
                  {selectors.map((person) => person.name).join(", ")}
                </span>
              )}
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
                onBlur={() => undoManagerRef.current?.stopCapturing()}
                placeholder="New note"
                aria-label="Note text"
              />
              {selectedNoteId === note.id && (
                <>
                  <button
                    type="button"
                    className="note-delete"
                    onClick={() => deleteNote(note.id)}
                    aria-label="Delete note"
                    title="Delete note (Delete key)"
                  >
                    ×
                  </button>
                  <div
                    className="note-resize"
                    onPointerDown={(event) => startResize(event, note)}
                    onPointerMove={moveResize}
                    onPointerUp={endResize}
                    aria-label="Resize note"
                  />
                </>
              )}
            </div>
          );
        })}
        {presence.map((person) =>
          person.cursor ? (
            <div
              key={person.id}
              className="remote-cursor"
              style={{ left: person.cursor.x, top: person.cursor.y }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M3 2 L3 19 L7.5 14.5 L10.5 21 L13 20 L10 13.5 L16 13.5 Z"
                  fill={person.color}
                  stroke="#fff"
                  strokeWidth="1"
                />
              </svg>
              <span
                className="remote-cursor-name"
                style={{ background: person.color }}
              >
                {person.name}
              </span>
            </div>
          ) : null,
        )}
        {notes.length === 0 && <p className="board-empty">Loading notes…</p>}
      </div>
    </div>
  );
}

// One person in the presence bar: an avatar circle with their
// initial, their name, and a green dot while they are online.
function PresenceChip({
  person,
  you = false,
}: {
  person: Pick<PresenceUser, "id" | "name" | "color">;
  you?: boolean;
}) {
  return (
    <span className="presence-user">
      <span className="presence-avatar" style={{ background: person.color }}>
        {person.name[0]}
        <span className="presence-dot" />
      </span>
      <span className="presence-name">
        {person.name}
        {you ? " (you)" : ""}
      </span>
    </span>
  );
}
