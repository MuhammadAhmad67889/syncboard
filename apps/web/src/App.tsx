import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  DEFAULT_BOARD_ID,
  DEFAULT_NOTE_SIZE,
  DEFAULT_TEXT_SIZE,
  FONT_SIZE_PX,
  MIN_FRAME_SIZE,
  MIN_SHAPE_SIZE,
  MIN_TEXT_SIZE,
  NOTE_COLORS,
  TEXT_FONT_SIZES,
  boxCentreInFrame,
  connectorEndpoints,
  createConnector,
  createFrame,
  createShape,
  createTextBox,
  normalizeShapeBox,
  penPathFromPoints,
  shapeBoxFromPoints,
  type BoardMeta,
  type Box,
  type Connector,
  type Frame,
  type Note,
  type NoteColor,
  type PresenceUser,
  type SessionUser,
  type Shape,
  type ShapeKind,
  type ShapePoint,
  type TextBox,
  type TextFontSize,
} from "@syncboard/shared";
import {
  canDeleteBoard,
  createBoard,
  deleteBoard,
  fetchBoards,
  resolveCurrentBoard,
} from "./boards";
import {
  SHAPE_STROKE_COLORS,
  appendPenPoint,
  buildShapeMap,
  readShape,
  type ShapeMap,
} from "./shapes";
import {
  TEXT_COLORS,
  buildTextMap,
  readTextBox,
  setTextFontSize,
  type TextMap,
} from "./texts";
import { buildFrameMap, readFrame, type FrameMap } from "./frames";
import {
  buildConnectorMap,
  deleteConnectorsReferencing,
  readConnector,
  type ConnectorMap,
} from "./connectors";
import {
  applyBoardExport,
  boardExportToJson,
  downloadBlob,
  parseBoardExport,
  renderBoardToCanvas,
  type BoardExport,
} from "./export";

// The sync server address, from the environment.
const SYNC_URL = import.meta.env.VITE_SYNC_URL ?? "ws://localhost:1234";

// One note inside the shared document: a Y.Map whose fields are
// numbers (x, y, w, h), a color name, and a Y.Text for the text.
type NoteMap = Y.Map<unknown>;

// The active board tool, from the toolbar. Select moves and edits
// things; Note drops a sticky note; Text drops a text box; the
// four shape tools draw shapes by dragging on empty canvas; Frame
// draws a named section the same way; Connector joins two items
// with an arrow.
type Tool = "select" | "note" | "text" | "frame" | "connector" | ShapeKind;

// One item a frame drag carries along: what it is, which one, and
// where it started. Pen shapes also carry their points, because a
// pen stroke lives in absolute board pixels — moving x/y alone
// would leave the stroke behind.
type FrameDragContent = {
  kind: "note" | "shape" | "text" | "frame";
  id: string;
  x: number;
  y: number;
  points?: ShapePoint[];
};

// The toolbar tools, in display order.
const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: "select", label: "Select" },
  { id: "note", label: "Note" },
  { id: "text", label: "Text" },
  { id: "rect", label: "Rectangle" },
  { id: "ellipse", label: "Ellipse" },
  { id: "line", label: "Line" },
  { id: "pen", label: "Pen" },
  { id: "connector", label: "Connector" },
  { id: "frame", label: "Frame" },
];

// Hand-drawn 16px stroke icons for the toolbar, in the button's
// own colour. No icon library: each icon is a few paths.
const TOOL_ICONS: Record<Tool, React.ReactNode> = {
  select: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4.5 2.5 L4.5 13 L7 10.6 L8.6 14 L10.2 13.2 L8.6 9.8 L12 9.8 Z" />
    </svg>
  ),
  note: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 2.5 h6.5 L13.5 5.5 v8 H4 Z" />
      <path d="M10.5 2.5 v3 h3" />
    </svg>
  ),
  text: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5 h10" />
      <path d="M8 4.5 v9" />
    </svg>
  ),
  rect: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="10" height="8" rx="1" />
    </svg>
  ),
  ellipse: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="8" cy="8" rx="5.5" ry="4" />
    </svg>
  ),
  line: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12 L12 4" />
      <path d="M12 4 L9 4 M12 4 L12 7" />
    </svg>
  ),
  pen: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.5 2.5 L13.5 4.5 L6.5 11.5 L3.5 12.5 L4.5 9.5 Z" />
    </svg>
  ),
  // A connector joins two items: a dot where it starts, a line,
  // and an arrowhead where it lands.
  connector: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="4" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M5.5 10.5 L11.5 4.5" />
      <path d="M11.5 4.5 L8.5 4.5 M11.5 4.5 L11.5 7.5" />
    </svg>
  ),
  // A frame is a section: a dashed rectangle, like the outline
  // the board draws around a group of items.
  frame: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="1" strokeDasharray="3 2" />
    </svg>
  ),
};

// The same hand-drawn style for the undo, redo, export, and
// import buttons.
const ACTION_ICONS = {
  undo: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.5 4 L3 7.5 L6.5 11" />
      <path d="M3 7.5 H10 a3 3 0 0 1 0 6 H8" />
    </svg>
  ),
  redo: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 4 L13 7.5 L9.5 11" />
      <path d="M13 7.5 H6 a3 3 0 0 0 0 6 H8" />
    </svg>
  ),
  download: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.5 v8" />
      <path d="M5 7.5 L8 10.5 L11 7.5" />
      <path d="M3 13.5 h10" />
    </svg>
  ),
  upload: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 10.5 v-8" />
      <path d="M5 5.5 L8 2.5 L11 5.5" />
      <path d="M3 13.5 h10" />
    </svg>
  ),
} as const;

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
  const selectedShapes = record.selectedShapeIds;
  const selectedTexts = record.selectedTextIds;
  return {
    id: record.id,
    name: record.name,
    color: record.color,
    cursor: asCursor(record.cursor),
    selectedNoteIds: Array.isArray(selected)
      ? selected.filter((id): id is string => typeof id === "string")
      : [],
    selectedShapeIds: Array.isArray(selectedShapes)
      ? selectedShapes.filter((id): id is string => typeof id === "string")
      : [],
    selectedTextIds: Array.isArray(selectedTexts)
      ? selectedTexts.filter((id): id is string => typeof id === "string")
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

// The localStorage key for the session: the token and the user
// it belongs to. The token is what the sync server verifies, so
// keeping it here is what keeps the user signed in across reloads.
const SESSION_KEY = "syncboard.session";

type Session = { user: SessionUser; token: string };

// Reads a saved session back. Anything malformed is not a
// session — the user just signs in again.
function loadStoredSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { token?: unknown }).token !== "string"
    ) {
      return null;
    }
    const user = (parsed as { user?: unknown }).user;
    if (
      typeof user !== "object" ||
      user === null ||
      typeof (user as SessionUser).id !== "string" ||
      typeof (user as SessionUser).name !== "string" ||
      typeof (user as SessionUser).color !== "string"
    ) {
      return null;
    }
    return parsed as Session;
  } catch {
    return null;
  }
}

export default function App() {
  // Restored from localStorage when the page loads, so a reload
  // keeps the user on the board. A stored token is only trusted
  // once the sync server accepts it — if the server rejects it,
  // onAuthFailed below drops the session and the auth screen
  // comes back.
  const [session, setSession] = useState<Session | null>(loadStoredSession);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // Shown on the auth screen when a restored session turned out
  // to be expired or invalid.
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // Saves the session and opens the board. Called after a
  // successful login, signup, or demo sign-in.
  function openSession(next: Session): void {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setAuthError(null);
    setAuthNotice(null);
    setPassword("");
    setSession(next);
  }

  // Signs out: the stored token is dropped, so a reload after
  // this lands on the auth screen instead of the board. The
  // form goes back to login — signing up again is one link away.
  function signOut(): void {
    window.localStorage.removeItem(SESSION_KEY);
    setMode("login");
    setSession(null);
  }

  // The sync server rejected the stored token (it expired, or
  // the database was reset). Drop the session and show the auth
  // screen with a note, instead of sitting on a board that can
  // never connect. Wrapped in useCallback so the board's sync
  // effect keeps a stable reference — it lists this callback as
  // a dependency, and a fresh function every render would tear
  // the live connection down and rebuild it.
  const handleAuthFailed = useCallback((): void => {
    window.localStorage.removeItem(SESSION_KEY);
    setMode("login");
    setSession(null);
    setAuthNotice("Your session expired — please log in again.");
  }, []);

  // One auth request to the sync server. A non-2xx answer throws
  // with the server's plain message, so the form can show it.
  async function authRequest(path: string, body?: { username: string; password: string }): Promise<Session> {
    const response = await fetch(`${httpSyncUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(
        typeof data?.error === "string" ? data.error : `Sign-in failed (${response.status}).`,
      );
    }
    return data as Session;
  }

  // Logs in or signs up with the form's username and password.
  async function submitAuth(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      const next = await authRequest(
        mode === "login" ? "/auth/login" : "/auth/signup",
        { username, password },
      );
      openSession(next);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setAuthBusy(false);
    }
  }

  // Signs in as the built-in demo account — no username or
  // password needed. The demo is for trying the board, not for
  // keeping work: anyone can sign in as Demo.
  async function signInAsDemo(): Promise<void> {
    setAuthBusy(true);
    setAuthError(null);
    try {
      openSession(await authRequest("/auth/demo"));
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not start the demo.");
    } finally {
      setAuthBusy(false);
    }
  }

  // Switches between the login and signup forms, clearing the
  // last error so it does not follow the user across.
  function switchMode(next: "login" | "signup"): void {
    setMode(next);
    setAuthError(null);
  }

  if (!session) {
    return (
      <main className="picker">
        <h1>SyncBoard</h1>
        <p>
          {mode === "login"
            ? "Log in to join the board."
            : "Create an account to join the board."}
        </p>
        <form className="picker-form" onSubmit={(event) => void submitAuth(event)}>
          <label className="picker-field">
            Username
            <input
              className="picker-input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              maxLength={20}
              autoFocus
            />
          </label>
          <label className="picker-field">
            Password
            <input
              className="picker-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
          {/* Always rendered so the form never jumps when a
              sign-in fails; the line is reserved in CSS. */}
          <p className="picker-error" role="alert">
            {authError ?? ""}
          </p>
          <button type="submit" className="picker-submit" disabled={authBusy}>
            {mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>
        {mode === "login" ? (
          <button type="button" className="picker-switch" onClick={() => switchMode("signup")}>
            No account yet? Create one
          </button>
        ) : (
          <button type="button" className="picker-switch" onClick={() => switchMode("login")}>
            Already have an account? Log in
          </button>
        )}
        <button
          type="button"
          className="picker-user"
          disabled={authBusy}
          onClick={() => void signInAsDemo()}
        >
          Try the demo
        </button>
        {authNotice && <p className="picker-hint">{authNotice}</p>}
        <p className="picker-hint">
          Usernames are 3–20 characters, letters, numbers, underscores, and hyphens only;
          passwords are at least 8 characters. The demo needs no account. Open the board in two
          tabs, one signed in and one on the demo, to see live sync.
        </p>
      </main>
    );
  }

  return (
    <BoardsApp
      user={session.user}
      token={session.token}
      onSignOut={signOut}
      onAuthFailed={handleAuthFailed}
    />
  );
}

// Owns the board list and which board is open. The Board below
// is keyed by board id, so switching boards unmounts it and a
// fresh provider, document, undo stack, and presence join the
// new room — undo and presence are per-board, never shared.
function BoardsApp({
  user,
  token,
  onSignOut,
  onAuthFailed,
}: {
  user: SessionUser;
  token: string;
  onSignOut: () => void;
  onAuthFailed: () => void;
}) {
  const [boards, setBoards] = useState<BoardMeta[] | null>(null);
  const [boardsError, setBoardsError] = useState<string | null>(null);
  const [currentBoardId, setCurrentBoardId] = useState(DEFAULT_BOARD_ID);
  // A short note shown when the open board was deleted — by this
  // user or by someone else — and the app moved back to the
  // default board.
  const [notice, setNotice] = useState<string | null>(null);
  // Refs mirror the state above so the polling loop below always
  // sees the latest list and board without restarting.
  const boardsRef = useRef<BoardMeta[] | null>(null);
  const currentBoardRef = useRef(currentBoardId);
  useEffect(() => {
    boardsRef.current = boards;
  }, [boards]);
  useEffect(() => {
    currentBoardRef.current = currentBoardId;
  }, [currentBoardId]);

  // Loads the board list once, when the app opens.
  useEffect(() => {
    let stopped = false;
    void fetchBoards(httpSyncUrl())
      .then((next) => {
        if (!stopped) setBoards(next);
      })
      .catch((error: unknown) => {
        if (!stopped) {
          setBoardsError(error instanceof Error ? error.message : "Could not load boards.");
        }
      });
    return () => {
      stopped = true;
    };
  }, []);

  // Re-checks the list every few seconds. That is how a client
  // learns its board was deleted by someone else: the board
  // disappears from the list, and this client moves back to the
  // default board with a note instead of sitting on a dead board.
  // A failed poll is ignored — the last good list stays put.
  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchBoards(httpSyncUrl())
        .then((next) => {
          const before = boardsRef.current;
          const openId = currentBoardRef.current;
          setBoards(next);
          if (resolveCurrentBoard(next, openId) !== openId) {
            const name = before?.find((board) => board.id === openId)?.name ?? "That board";
            setCurrentBoardId(DEFAULT_BOARD_ID);
            setNotice(`"${name}" was deleted, so you're back on the Main board.`);
          }
        })
        .catch(() => {
          // Keep the last good list; the next poll retries.
        });
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  function switchBoard(boardId: string): void {
    setCurrentBoardId(boardId);
    setNotice(null);
  }

  // Creates a board and opens it. Returns false when the server
  // refused, so the form can stay open for another try.
  async function handleCreateBoard(name: string): Promise<boolean> {
    setBoardsError(null);
    try {
      const created = await createBoard(httpSyncUrl(), name);
      setBoards((prev) => (prev ? [...prev, created] : [created]));
      setCurrentBoardId(created.id);
      setNotice(null);
      return true;
    } catch (error) {
      setBoardsError(error instanceof Error ? error.message : "Could not create board.");
      return false;
    }
  }

  // Deletes a board after a confirm step. Deleting the open
  // board moves this client back to the default board; deleting
  // another board leaves the open one alone.
  async function handleDeleteBoard(board: BoardMeta): Promise<void> {
    if (
      !window.confirm(
        `Delete board "${board.name}"? Its notes and shapes will be gone for everyone.`,
      )
    ) {
      return;
    }
    setBoardsError(null);
    try {
      await deleteBoard(httpSyncUrl(), board.id);
      setBoards((prev) => (prev ?? []).filter((item) => item.id !== board.id));
      if (board.id === currentBoardRef.current) {
        setCurrentBoardId(DEFAULT_BOARD_ID);
        setNotice(`"${board.name}" was deleted. You're back on the Main board.`);
      }
    } catch (error) {
      setBoardsError(error instanceof Error ? error.message : "Could not delete board.");
    }
  }

  return (
    <Board
      key={currentBoardId}
      user={user}
      token={token}
      onSignOut={onSignOut}
      onAuthFailed={onAuthFailed}
      boardId={currentBoardId}
      boards={boards ?? []}
      boardsError={boardsError}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
      onSwitchBoard={switchBoard}
      onCreateBoard={handleCreateBoard}
      onDeleteBoard={handleDeleteBoard}
    />
  );
}

function Board({
  user,
  token,
  onSignOut,
  onAuthFailed,
  boardId,
  boards,
  boardsError,
  notice,
  onDismissNotice,
  onSwitchBoard,
  onCreateBoard,
  onDeleteBoard,
}: {
  user: SessionUser;
  token: string;
  onSignOut: () => void;
  onAuthFailed: () => void;
  boardId: string;
  boards: BoardMeta[];
  boardsError: string | null;
  notice: string | null;
  onDismissNotice: () => void;
  onSwitchBoard: (boardId: string) => void;
  onCreateBoard: (name: string) => Promise<boolean>;
  onDeleteBoard: (board: BoardMeta) => Promise<void>;
}) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [authError, setAuthError] = useState<string | null>(null);
  // The new-board form in the board switcher: whether it is
  // open, the name typed so far, and whether a create is in
  // flight. This is per-board view state, so it resets when the
  // board switches — the form never survives a switch.
  const [showNewBoardForm, setShowNewBoardForm] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  // The shapes on the board, from the shared "shapes" map —
  // rectangles, ellipses, lines, and pen strokes.
  const [shapes, setShapes] = useState<Shape[]>([]);
  // The text boxes on the board, from the shared "texts" map —
  // free-floating text with no background, unlike notes.
  const [texts, setTexts] = useState<TextBox[]>([]);
  // The frames on the board, from the shared "frames" map —
  // named sections that hold other items.
  const [frames, setFrames] = useState<Frame[]>([]);
  // The connectors on the board, from the shared "connectors"
  // map — arrows joining two items, recomputed from their
  // positions every render.
  const [connectors, setConnectors] = useState<Connector[]>([]);
  // The active tool. Select is the default; Escape returns here.
  const [tool, setTool] = useState<Tool>("select");
  // Everyone else on the board, from Awareness. Our own presence
  // lives in localPresenceRef — the bar and cursors only show
  // other people.
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  // The note this user clicked. null means nothing selected.
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  // The shape this user clicked. A note, a shape, and a text box
  // are never selected at the same time — selecting one clears
  // the others.
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  // The text box this user clicked.
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  // The frame this user clicked.
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  // The connector this user clicked.
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);
  // The first item of a connector being drawn: the user picked
  // this item with the Connector tool and is about to pick the
  // second one. Null when no connector is in progress.
  const [connectorPendingFromId, setConnectorPendingFromId] = useState<string | null>(null);
  // The frame title being typed right now, as a draft. The shared
  // title only changes on blur or Enter — typing straight into
  // the shared title would snap an emptied title back to "Frame"
  // on every keystroke.
  const [frameTitleDraft, setFrameTitleDraft] = useState<{ id: string; value: string } | null>(
    null,
  );
  // The color new notes get, and the color the picker shows as
  // active. Picking a color also recolors the selected note.
  const [pickedColor, setPickedColor] = useState<NoteColor>("yellow");
  // The font size new text boxes get. Picking a size also
  // resizes the text in the selected text box.
  const [pickedFontSize, setPickedFontSize] = useState<TextFontSize>("medium");
  // The text box to focus after it appears (a newly placed box
  // gets the keyboard right away, so the user can just type).
  const [focusTextId, setFocusTextId] = useState<string | null>(null);
  // Which text box the focus effect already focused. Remembering
  // it in a ref (instead of clearing focusTextId in the effect)
  // keeps later text edits from stealing focus back to the box.
  const focusedTextIdRef = useRef<string | null>(null);
  // The last import/export note for the user — an error when a
  // file could not be imported, a confirmation when one was.
  const [importMessage, setImportMessage] = useState<string | null>(null);
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
  const shapesMapRef = useRef<Y.Map<ShapeMap> | null>(null);
  const textsMapRef = useRef<Y.Map<TextMap> | null>(null);
  const framesMapRef = useRef<Y.Map<FrameMap> | null>(null);
  const connectorsMapRef = useRef<Y.Map<ConnectorMap> | null>(null);
  // The selected frame and connector, mirrored in refs so the
  // keyboard handler — bound once — can read them without going
  // stale. Frames and connectors are not published to Awareness
  // (presence only tracks notes, shapes, and text boxes), so the
  // presence ref cannot carry them.
  const selectedFrameRef = useRef<string | null>(null);
  const selectedConnectorRef = useRef<string | null>(null);
  // The hidden file input for Import JSON — the toolbar button
  // opens it, and the change handler reads the picked file.
  const importInputRef = useRef<HTMLInputElement | null>(null);
  // The provider's Awareness instance (null only if the provider
  // was created with awareness disabled — we never do that).
  const awarenessRef = useRef<HocuspocusProvider["awareness"]>(null);
  // Our own presence: cursor position and selected notes,
  // shapes, and text boxes. Kept in a ref because it changes on
  // every mouse move and must not re-render the board each time.
  const localPresenceRef = useRef<PresenceUser>({
    id: user.id,
    name: user.name,
    color: user.color,
    cursor: null,
    selectedNoteIds: [],
    selectedShapeIds: [],
    selectedTextIds: [],
  });
  // When the last cursor position was sent, for the ~30/s throttle.
  const lastCursorSentRef = useRef(0);
  const boardRef = useRef<HTMLDivElement | null>(null);
  // Zoom and pan are per-user view state: local only, never synced
  // and never persisted — the other tab keeps its own view.
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3;
  const ZOOM_STEP = 1.25;
  // A frame's title sits this far inside its top-left corner —
  // the same 12px as --space-sm in tokens.css.
  const FRAME_TITLE_INSET = 12;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // The transformed layer inside the board — the notes live in it.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  // The pan in progress, if any — same shape as a note drag.
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [panning, setPanning] = useState(false);
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
  // The shape drag in progress, if any — same shape as a note drag.
  const shapeDragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    shapeX: number;
    shapeY: number;
  } | null>(null);
  // The shape resize in progress, if any — same shape as the drag.
  const shapeResizeRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    shapeW: number;
    shapeH: number;
  } | null>(null);
  // The text-box drag in progress, if any — same shape as a
  // note drag.
  const textDragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    textX: number;
    textY: number;
  } | null>(null);
  // The text-box resize in progress, if any — same shape as the
  // drag.
  const textResizeRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    textW: number;
    textH: number;
  } | null>(null);
  // The shape being drawn on empty canvas, if any. For a pen
  // stroke, points holds every point so far, so the bounding box
  // can be recomputed as the stroke grows.
  const drawRef = useRef<{
    kind: ShapeKind;
    pointerId: number;
    startX: number;
    startY: number;
    shapeId: string;
    points: ShapePoint[];
  } | null>(null);
  // The frame being drawn on empty canvas, if any — same shape
  // as a shape draw, but the box becomes a frame.
  const frameDrawRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    frameId: string;
  } | null>(null);
  // The frame drag in progress, if any. contents holds every item
  // whose centre was inside the frame when the drag started —
  // each with the position it started at — so the whole group
  // moves by the same amount.
  const frameDragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    frameX: number;
    frameY: number;
    contents: FrameDragContent[];
  } | null>(null);
  // The frame resize in progress, if any — same shape as the drag.
  const frameResizeRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    frameW: number;
    frameH: number;
  } | null>(null);
  // The per-user UndoManager: it tracks only changes stamped
  // with localOrigin, on the shared notes and shapes maps and
  // their children (nested note maps and their Y.Text, shape maps
  // and their pen-point arrays).
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
      name: boardId,
      document: doc,
      token,
      // BroadcastChannel would sync tabs directly, bypassing the
      // server — disabled so the two-tab test proves server sync.
      broadcast: false,
      onStatus: ({ status: next }) => setStatus(toConnectionStatus(next)),
      // The server rejected the token — it expired, or the
      // database was reset. Drop the session and show the auth
      // screen, instead of sitting on a board that can never
      // connect.
      onAuthenticationFailed: ({ reason }) => {
        setAuthError(reason);
        onAuthFailed();
      },
    });
    const notesMap = doc.getMap<NoteMap>("notes");
    docRef.current = doc;
    notesMapRef.current = notesMap;
    const shapesMap = doc.getMap<ShapeMap>("shapes");
    shapesMapRef.current = shapesMap;
    const textsMap = doc.getMap<TextMap>("texts");
    textsMapRef.current = textsMap;
    const framesMap = doc.getMap<FrameMap>("frames");
    framesMapRef.current = framesMap;
    const connectorsMap = doc.getMap<ConnectorMap>("connectors");
    connectorsMapRef.current = connectorsMap;

    // Per-user undo: the manager only tracks transactions stamped
    // with our own origin, so another user's edits never land on
    // our undo stack. It watches all five shared roots — notes,
    // shapes, text boxes, frames, and connectors — so one undo
    // stack covers all of them. Drags and typing batch into one
    // step while they keep coming within the capture timeout (500 ms).
    const undoManager = new Y.UndoManager(
      [notesMap, shapesMap, textsMap, framesMap, connectorsMap],
      {
        trackedOrigins: new Set([localOrigin]),
      },
    );
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

    // Re-reads every shape from the shared document into React
    // state. observeDeep fires for shape moves, resizes, color
    // changes, and pen points alike.
    function snapshotShapes(): void {
      const next: Shape[] = [];
      shapesMap.forEach((shapeMap, id) => next.push(readShape(id, shapeMap)));
      setShapes(next);
    }

    shapesMap.observeDeep(snapshotShapes);
    snapshotShapes();

    // Re-reads every text box from the shared document into React
    // state. observeDeep fires for text-box moves, resizes, color
    // and size changes, and text edits alike.
    function snapshotTexts(): void {
      const next: TextBox[] = [];
      textsMap.forEach((textMap, id) => next.push(readTextBox(id, textMap)));
      setTexts(next);
    }

    textsMap.observeDeep(snapshotTexts);
    snapshotTexts();

    // Re-reads every frame from the shared document into React
    // state. observeDeep fires for frame moves, resizes, color
    // changes, and title edits alike.
    function snapshotFrames(): void {
      const next: Frame[] = [];
      framesMap.forEach((frameMap, id) => next.push(readFrame(id, frameMap)));
      setFrames(next);
    }

    framesMap.observeDeep(snapshotFrames);
    snapshotFrames();

    // Re-reads every connector from the shared document into
    // React state. observeDeep fires for new connectors and for
    // deletions when an endpoint goes away.
    function snapshotConnectors(): void {
      const next: Connector[] = [];
      connectorsMap.forEach((connectorMap, id) => next.push(readConnector(id, connectorMap)));
      setConnectors(next);
    }

    connectorsMap.observeDeep(snapshotConnectors);
    snapshotConnectors();

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
      shapesMap.unobserveDeep(snapshotShapes);
      textsMap.unobserveDeep(snapshotTexts);
      framesMap.unobserveDeep(snapshotFrames);
      connectorsMap.unobserveDeep(snapshotConnectors);
      provider.destroy();
      doc.destroy();
      docRef.current = null;
      notesMapRef.current = null;
      shapesMapRef.current = null;
      textsMapRef.current = null;
      framesMapRef.current = null;
      connectorsMapRef.current = null;
    };
  }, [token, boardId, localOrigin, onAuthFailed]);

  // Focuses a newly placed text box once it has rendered, so
  // the user can type straight away without clicking it first.
  // If the box has not rendered yet, the id stays pending and
  // the effect retries when the text boxes update — clearing it
  // early would lose the focus entirely. The focused id is
  // remembered in a ref, not cleared with setState, because
  // calling setState inside an effect causes a cascading render.
  useEffect(() => {
    if (!focusTextId || focusedTextIdRef.current === focusTextId) return;
    const box = document.querySelector(
      `.text-box[data-text-id="${focusTextId}"] textarea`,
    ) as HTMLTextAreaElement | null;
    if (!box) return;
    box.focus();
    focusedTextIdRef.current = focusTextId;
  }, [focusTextId, texts]);

  // Starts a drag from a note's handle. The textarea underneath
  // stays free for text editing — only the handle drags. With
  // the Connector tool, a press picks an endpoint instead, so
  // the handle does not drag.
  function startDrag(event: React.PointerEvent<HTMLDivElement>, note: Note): void {
    if (event.button !== 0 || tool === "connector") return;
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
    // Screen pixels become board pixels by dividing by the zoom —
    // at 200% a 20px mouse move is only 10 board pixels.
    const nextX = Math.max(0, drag.noteX + (event.clientX - drag.startX) / zoom);
    const nextY = Math.max(0, drag.noteY + (event.clientY - drag.startY) / zoom);
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

  // Converts a screen (client) point to board coordinates, undoing
  // the current pan and zoom. Every pointer handler that places or
  // moves something on the board goes through here, so a click,
  // a drag, and a cursor all agree on where things are.
  function toBoardCoords(clientX: number, clientY: number): { x: number; y: number } {
    const board = boardRef.current;
    if (!board) return { x: 0, y: 0 };
    const rect = board.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  }

  // A press on empty board — the board or canvas itself, or a
  // frame's background. A frame is a container, not a wall: the
  // creation tools work inside it exactly as they do on open
  // canvas, so notes, text, shapes, and nested frames can be
  // dropped where they belong. The canvas calls this when the
  // press lands on empty board; a frame calls it when the press
  // lands on the frame itself (its title, delete, and resize
  // controls stop the press before it gets here).
  function handleEmptyCanvasPress(event: React.PointerEvent<HTMLDivElement>): void {
    if (tool === "rect" || tool === "ellipse" || tool === "line" || tool === "pen") {
      startDraw(event);
    } else if (tool === "frame") {
      // Dragging empty canvas with the Frame tool draws
      // a named section.
      startFrameDraw(event);
    } else if (tool === "connector") {
      // Clicking empty canvas cancels a connector in
      // progress — there is nothing here to connect to.
      setConnectorPendingFromId(null);
    } else if (tool === "note") {
      // Clicking empty canvas with the Note tool drops a
      // note centered on the click.
      const point = toBoardCoords(event.clientX, event.clientY);
      createNote(
        Math.max(0, point.x - DEFAULT_NOTE_SIZE.w / 2),
        Math.max(0, point.y - DEFAULT_NOTE_SIZE.h / 2),
      );
    } else if (tool === "text") {
      // Clicking empty canvas with the Text tool drops a
      // text box centered on the click and focuses it.
      // Canceling the press keeps its default focus change
      // from blurring that textarea: the press lands on
      // empty canvas, so the browser would otherwise move
      // focus back to the board right after the box appears.
      event.preventDefault();
      const point = toBoardCoords(event.clientX, event.clientY);
      createTextBoxAtPoint(point.x, point.y);
    } else {
      // Select mode: the press clears the selection and
      // starts a pan.
      clearSelection();
      startPan(event);
    }
  }

  // Zooms by a factor around the center of the visible board, so
  // the middle of the view stays put. Zoom is clamped to 25–300%.
  function zoomBy(factor: number): void {
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    if (nextZoom === zoom) return;
    const scale = nextZoom / zoom;
    setZoom(nextZoom);
    // Keep the screen point under the board center fixed:
    // pan' = center - scale * (center - pan).
    setPan({
      x: centerX - scale * (centerX - pan.x),
      y: centerY - scale * (centerY - pan.y),
    });
  }

  // Back to 100% with no pan — the default view.
  function resetView(): void {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  // Dragging empty canvas pans the view (per user — never synced).
  // The pointer is captured on the board, so the pan keeps going
  // even if it slides off the edge.
  function startPan(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setPanning(true);
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>): void {
    const panDrag = panRef.current;
    if (!panDrag || event.pointerId !== panDrag.pointerId) return;
    setPan({
      x: panDrag.panX + event.clientX - panDrag.startX,
      y: panDrag.panY + event.clientY - panDrag.startY,
    });
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>): void {
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null;
      setPanning(false);
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
    if (!awarenessRef.current) return;
    // Reading the clock here is the cursor throttle, and this is
    // a pointer-event handler, not render — it only runs when the
    // pointer actually moves.
    // eslint-disable-next-line react-hooks/purity
    const now = performance.now();
    if (now - lastCursorSentRef.current < CURSOR_THROTTLE_MS) return;
    lastCursorSentRef.current = now;
    // Board pixels, not screen pixels: the cursor is published in
    // board coordinates so it lands on the same note in another
    // tab no matter what zoom or pan that tab is using.
    const point = toBoardCoords(event.clientX, event.clientY);
    localPresenceRef.current.cursor = {
      x: Math.round(point.x),
      y: Math.round(point.y),
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
  // Only one thing is selected at a time — a note, a shape, a
  // text box, a frame, or a connector. Frames and connectors are
  // local only: presence tracks notes, shapes, and text boxes,
  // so their selection lives in state and in the refs the
  // keyboard handler reads, not in Awareness.
  function setSelection(
    noteId: string | null,
    shapeId: string | null,
    textId: string | null = null,
    frameId: string | null = null,
    connectorId: string | null = null,
  ): void {
    setSelectedNoteId(noteId);
    setSelectedShapeId(shapeId);
    setSelectedTextId(textId);
    setSelectedFrameId(frameId);
    setSelectedConnectorId(connectorId);
    selectedFrameRef.current = frameId;
    selectedConnectorRef.current = connectorId;
    localPresenceRef.current.selectedNoteIds = noteId ? [noteId] : [];
    localPresenceRef.current.selectedShapeIds = shapeId ? [shapeId] : [];
    localPresenceRef.current.selectedTextIds = textId ? [textId] : [];
    publishPresence();
  }

  // Clicking a note selects it, and tells everyone else.
  function selectNote(noteId: string): void {
    if (selectedNoteId === noteId) return;
    setSelection(noteId, null);
  }

  // Clicking a shape selects it, and tells everyone else.
  function selectShape(shapeId: string): void {
    if (selectedShapeId === shapeId) return;
    setSelection(null, shapeId);
  }

  // Clicking a text box selects it, and tells everyone else.
  function selectTextBox(textId: string): void {
    if (selectedTextId === textId) return;
    setSelection(null, null, textId);
  }

  // Clicking a frame selects it. Frames are local-only selection,
  // so this does not publish to presence.
  function selectFrame(frameId: string): void {
    if (selectedFrameId === frameId) return;
    setSelection(null, null, null, frameId);
  }

  // Clicking a connector selects it, so it can be deleted. Like
  // frames, this is local-only selection.
  function selectConnector(connectorId: string): void {
    if (selectedConnectorId === connectorId) return;
    setSelection(null, null, null, null, connectorId);
  }

  // Clicking empty board clears the selection.
  function clearSelection(): void {
    if (
      localPresenceRef.current.selectedNoteIds.length === 0 &&
      localPresenceRef.current.selectedShapeIds.length === 0 &&
      localPresenceRef.current.selectedTextIds.length === 0 &&
      selectedFrameRef.current === null &&
      selectedConnectorRef.current === null
    ) {
      return;
    }
    setSelection(null, null);
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
    const center = toBoardCoords(rect.left + rect.width / 2, rect.top + rect.height / 2);
    createNote(
      Math.max(0, center.x - DEFAULT_NOTE_SIZE.w / 2),
      Math.max(0, center.y - DEFAULT_NOTE_SIZE.h / 2),
    );
  }

  // Double-clicking empty canvas creates a note centered on the
  // click — but only in Select mode. With a shape tool active, a
  // double-click is two draws, not a note; with the Note tool, a
  // single click already creates one.
  function createNoteAtPoint(event: React.MouseEvent<HTMLDivElement>): void {
    if (tool !== "select") return;
    if (event.target !== event.currentTarget && event.target !== canvasRef.current) return;
    const point = toBoardCoords(event.clientX, event.clientY);
    createNote(
      Math.max(0, point.x - DEFAULT_NOTE_SIZE.w / 2),
      Math.max(0, point.y - DEFAULT_NOTE_SIZE.h / 2),
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

  // Picks the color for new notes and shapes — and recolors the
  // selected note, shape, text box, frame, or connector right
  // away, if there is one.
  function pickColor(color: NoteColor): void {
    setPickedColor(color);
    if (selectedNoteId) recolorNote(selectedNoteId, color);
    if (selectedShapeId) recolorShape(selectedShapeId, color);
    if (selectedTextId) recolorTextBox(selectedTextId, color);
    if (selectedFrameId) recolorFrame(selectedFrameId, color);
    if (selectedConnectorId) recolorConnector(selectedConnectorId, color);
  }

  // Removes a note from the shared map, so it disappears in every
  // tab. Any connector attached to it goes in the same
  // transaction, so one undo brings both back. If it was the
  // selected note, the selection clears too.
  function deleteNote(noteId: string): void {
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !notesMap || !notesMap.has(noteId)) return;
    doc.transact(() => {
      notesMap.delete(noteId);
      if (connectorsMap) deleteConnectorsReferencing(connectorsMap, noteId);
    }, localOrigin);
    if (localPresenceRef.current.selectedNoteIds.includes(noteId)) {
      setSelection(null, null);
    }
  }

  // Creates a text box centered on the given board position, in
  // the picked color and size, selects it, and focuses it so the
  // user can type right away. The tool goes back to Select, so
  // the next click drags or edits instead of placing another box.
  function createTextBoxAtPoint(x: number, y: number): void {
    const doc = docRef.current;
    const textsMap = textsMapRef.current;
    if (!doc || !textsMap) return;
    const id = crypto.randomUUID();
    const textBox = createTextBox(
      id,
      Math.max(0, Math.round(x - DEFAULT_TEXT_SIZE.w / 2)),
      Math.max(0, Math.round(y - DEFAULT_TEXT_SIZE.h / 2)),
      DEFAULT_TEXT_SIZE.w,
      DEFAULT_TEXT_SIZE.h,
      pickedFontSize,
      pickedColor,
    );
    doc.transact(() => {
      textsMap.set(id, buildTextMap(textBox));
    }, localOrigin);
    selectTextBox(id);
    setFocusTextId(id);
    setTool("select");
  }

  function changeTextBoxText(textId: string, next: string): void {
    const doc = docRef.current;
    const textsMap = textsMapRef.current;
    if (!doc || !textsMap) return;
    const textMap = textsMap.get(textId);
    const text = textMap?.get("text");
    if (!textMap || !(text instanceof Y.Text)) return;
    // The same prefix/suffix diff as notes: only the changed part
    // is replaced, so two people typing at once keep each other's
    // words.
    updateNoteText(doc, text, next, localOrigin);
  }

  // Recolors one text box. The change syncs to every tab like
  // any other edit, and undo reverts it.
  function recolorTextBox(textId: string, color: NoteColor): void {
    const doc = docRef.current;
    const textsMap = textsMapRef.current;
    if (!doc || !textsMap) return;
    const textMap = textsMap.get(textId);
    if (!textMap) return;
    doc.transact(() => {
      textMap.set("color", color);
    }, localOrigin);
  }

  // Picks the font size for new text boxes — and resizes the text
  // in the selected text box right away, if there is one.
  function pickFontSize(fontSize: TextFontSize): void {
    setPickedFontSize(fontSize);
    if (!selectedTextId) return;
    const doc = docRef.current;
    const textsMap = textsMapRef.current;
    if (!doc || !textsMap) return;
    const textMap = textsMap.get(selectedTextId);
    if (!textMap) return;
    doc.transact(() => {
      setTextFontSize(textMap, fontSize);
    }, localOrigin);
  }

  // Removes a text box from the shared map, so it disappears in
  // every tab. Any connector attached to it goes in the same
  // transaction, so one undo brings both back. If it was the
  // selected text box, the selection clears too.
  function deleteTextBox(textId: string): void {
    const doc = docRef.current;
    const textsMap = textsMapRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !textsMap || !textsMap.has(textId)) return;
    doc.transact(() => {
      textsMap.delete(textId);
      if (connectorsMap) deleteConnectorsReferencing(connectorsMap, textId);
    }, localOrigin);
    if (localPresenceRef.current.selectedTextIds.includes(textId)) {
      setSelection(null, null);
    }
  }

  // Starts a drag from a text box's handle. The textarea
  // underneath stays free for text editing — only the handle drags.
  // With the Connector tool, a press picks an endpoint instead.
  function startTextDrag(event: React.PointerEvent<HTMLDivElement>, textBox: TextBox): void {
    if (event.button !== 0 || tool === "connector") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    textDragRef.current = {
      id: textBox.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      textX: textBox.x,
      textY: textBox.y,
    };
  }

  function moveTextDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = textDragRef.current;
    const doc = docRef.current;
    const textsMap = textsMapRef.current;
    if (!drag || !doc || !textsMap || event.pointerId !== drag.pointerId) return;
    const textMap = textsMap.get(drag.id);
    if (!textMap) return;
    // Screen pixels become board pixels by dividing by the zoom —
    // at 200% a 20px mouse move is only 10 board pixels.
    const nextX = Math.max(0, drag.textX + (event.clientX - drag.startX) / zoom);
    const nextY = Math.max(0, drag.textY + (event.clientY - drag.startY) / zoom);
    // Same batching as a note drag: the whole drag lands on one
    // undo step.
    doc.transact(() => {
      textMap.set("x", Math.round(nextX));
      textMap.set("y", Math.round(nextY));
    }, localOrigin);
  }

  function endTextDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (textDragRef.current?.pointerId === event.pointerId) {
      textDragRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Starts a resize from the text box's bottom-right handle.
  // With the Connector tool, a press picks an endpoint instead.
  function startTextResize(event: React.PointerEvent<HTMLDivElement>, textBox: TextBox): void {
    if (event.button !== 0 || tool === "connector") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    textResizeRef.current = {
      id: textBox.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      textW: textBox.w,
      textH: textBox.h,
    };
  }

  function moveTextResize(event: React.PointerEvent<HTMLDivElement>): void {
    const resize = textResizeRef.current;
    const doc = docRef.current;
    const textsMap = textsMapRef.current;
    if (!resize || !doc || !textsMap || event.pointerId !== resize.pointerId) return;
    const textMap = textsMap.get(resize.id);
    if (!textMap) return;
    const nextW = Math.max(
      MIN_TEXT_SIZE.w,
      resize.textW + (event.clientX - resize.startX) / zoom,
    );
    const nextH = Math.max(
      MIN_TEXT_SIZE.h,
      resize.textH + (event.clientY - resize.startY) / zoom,
    );
    // Same batching as a drag: rapid moves merge into one undo step.
    doc.transact(() => {
      textMap.set("w", Math.round(nextW));
      textMap.set("h", Math.round(nextH));
    }, localOrigin);
  }

  function endTextResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (textResizeRef.current?.pointerId === event.pointerId) {
      textResizeRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Creates a shape at the given board position, in the picked
  // color, and selects it so the user can drag or recolor it
  // right away. A pen stroke starts with one point at the click;
  // other shapes start at the minimum size and grow with the drag.
  function createShapeAtPoint(kind: ShapeKind, x: number, y: number): string {
    const doc = docRef.current;
    const shapesMap = shapesMapRef.current;
    if (!doc || !shapesMap) return "";
    const id = crypto.randomUUID();
    const shape = createShape(
      id,
      kind,
      Math.round(x),
      Math.round(y),
      kind === "pen" ? 1 : MIN_SHAPE_SIZE,
      kind === "pen" ? 1 : MIN_SHAPE_SIZE,
      pickedColor,
      kind === "pen" ? [{ x: Math.round(x), y: Math.round(y) }] : [],
    );
    doc.transact(() => {
      shapesMap.set(id, buildShapeMap(shape));
    }, localOrigin);
    selectShape(id);
    return id;
  }

  // Starts drawing a shape on empty canvas. The shape is created
  // right away, so the other tab sees it appear as soon as the
  // drag starts — and a pen stroke grows live as it is drawn.
  function startDraw(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    if (tool !== "rect" && tool !== "ellipse" && tool !== "line" && tool !== "pen") return;
    const point = toBoardCoords(event.clientX, event.clientY);
    const id = createShapeAtPoint(tool, point.x, point.y);
    if (!id) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawRef.current = {
      kind: tool,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      shapeId: id,
      points: tool === "pen" ? [{ x: Math.round(point.x), y: Math.round(point.y) }] : [],
    };
  }

  function moveDraw(event: React.PointerEvent<HTMLDivElement>): void {
    const draw = drawRef.current;
    const doc = docRef.current;
    const shapesMap = shapesMapRef.current;
    if (!draw || !doc || !shapesMap || event.pointerId !== draw.pointerId) return;
    const shapeMap = shapesMap.get(draw.shapeId);
    if (!shapeMap) return;
    const point = toBoardCoords(event.clientX, event.clientY);
    if (draw.kind === "pen") {
      // Skip a point identical to the last one — a pause mid-stroke
      // should not fill the stroke with duplicate points.
      const last = draw.points[draw.points.length - 1];
      const nextPoint = { x: Math.round(point.x), y: Math.round(point.y) };
      if (last && last.x === nextPoint.x && last.y === nextPoint.y) return;
      draw.points.push(nextPoint);
      const box = shapeBoxFromPoints(draw.points);
      if (!box) return;
      // Stamped with our origin so undo can revert this stroke —
      // and only this user's strokes. Pointermove fires faster
      // than the capture timeout, so the whole stroke lands on
      // one undo step.
      doc.transact(() => {
        appendPenPoint(shapeMap, nextPoint);
        shapeMap.set("x", box.x);
        shapeMap.set("y", box.y);
        shapeMap.set("w", box.w);
        shapeMap.set("h", box.h);
      }, localOrigin);
      return;
    }
    // A drag in any direction defines the box, so dragging up or
    // left grows the shape the other way instead of shrinking it.
    const box = normalizeShapeBox(draw.startX, draw.startY, point.x, point.y);
    doc.transact(() => {
      shapeMap.set("x", box.x);
      shapeMap.set("y", box.y);
      shapeMap.set("w", box.w);
      shapeMap.set("h", box.h);
    }, localOrigin);
  }

  function endDraw(event: React.PointerEvent<HTMLDivElement>): void {
    if (drawRef.current?.pointerId === event.pointerId) {
      drawRef.current = null;
      // The next change starts a fresh undo step instead of
      // joining the shape we just drew.
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Recolors one shape. The change syncs to every tab like any
  // other edit, and undo reverts it.
  function recolorShape(shapeId: string, color: NoteColor): void {
    const doc = docRef.current;
    const shapesMap = shapesMapRef.current;
    if (!doc || !shapesMap) return;
    const shapeMap = shapesMap.get(shapeId);
    if (!shapeMap) return;
    doc.transact(() => {
      shapeMap.set("color", color);
    }, localOrigin);
  }

  // Removes a shape from the shared map, so it disappears in every
  // tab. Any connector attached to it goes in the same
  // transaction, so one undo brings both back. If it was the
  // selected shape, the selection clears too.
  function deleteShape(shapeId: string): void {
    const doc = docRef.current;
    const shapesMap = shapesMapRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !shapesMap || !shapesMap.has(shapeId)) return;
    doc.transact(() => {
      shapesMap.delete(shapeId);
      if (connectorsMap) deleteConnectorsReferencing(connectorsMap, shapeId);
    }, localOrigin);
    if (localPresenceRef.current.selectedShapeIds.includes(shapeId)) {
      setSelection(null, null);
    }
  }

  // Removes a frame from the shared map, so it disappears in
  // every tab. The items inside it stay exactly where they are —
  // a frame is only a container, not their owner. Any connector
  // attached to the frame goes in the same transaction. If it
  // was the selected frame, the selection clears too.
  function deleteFrame(frameId: string): void {
    const doc = docRef.current;
    const framesMap = framesMapRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !framesMap || !framesMap.has(frameId)) return;
    doc.transact(() => {
      framesMap.delete(frameId);
      if (connectorsMap) deleteConnectorsReferencing(connectorsMap, frameId);
    }, localOrigin);
    if (selectedFrameRef.current === frameId) {
      setSelection(null, null);
    }
  }

  // Removes a connector from the shared map, so it disappears in
  // every tab. The two items it joined stay where they are. If
  // it was the selected connector, the selection clears too.
  function deleteConnector(connectorId: string): void {
    const doc = docRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !connectorsMap || !connectorsMap.has(connectorId)) return;
    doc.transact(() => {
      connectorsMap.delete(connectorId);
    }, localOrigin);
    if (selectedConnectorRef.current === connectorId) {
      setSelection(null, null);
    }
  }

  // Recolors one frame. The change syncs to every tab like any
  // other edit, and undo reverts it.
  function recolorFrame(frameId: string, color: NoteColor): void {
    const doc = docRef.current;
    const framesMap = framesMapRef.current;
    if (!doc || !framesMap) return;
    const frameMap = framesMap.get(frameId);
    if (!frameMap) return;
    doc.transact(() => {
      frameMap.set("color", color);
    }, localOrigin);
  }

  // Recolors one connector. The change syncs to every tab like
  // any other edit, and undo reverts it.
  function recolorConnector(connectorId: string, color: NoteColor): void {
    const doc = docRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !connectorsMap) return;
    const connectorMap = connectorsMap.get(connectorId);
    if (!connectorMap) return;
    doc.transact(() => {
      connectorMap.set("color", color);
    }, localOrigin);
  }

  // Starts a drag from a shape. The whole shape is the handle —
  // there is no text to edit, so the entire shape grabs. With
  // the Connector tool, a press picks an endpoint instead.
  function startShapeDrag(event: React.PointerEvent<HTMLDivElement>, shape: Shape): void {
    if (event.button !== 0 || tool === "connector") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    shapeDragRef.current = {
      id: shape.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      shapeX: shape.x,
      shapeY: shape.y,
    };
  }

  function moveShapeDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = shapeDragRef.current;
    const doc = docRef.current;
    const shapesMap = shapesMapRef.current;
    if (!drag || !doc || !shapesMap || event.pointerId !== drag.pointerId) return;
    const shapeMap = shapesMap.get(drag.id);
    if (!shapeMap) return;
    // Screen pixels become board pixels by dividing by the zoom —
    // at 200% a 20px mouse move is only 10 board pixels.
    const nextX = Math.max(0, drag.shapeX + (event.clientX - drag.startX) / zoom);
    const nextY = Math.max(0, drag.shapeY + (event.clientY - drag.startY) / zoom);
    // Same batching as a note drag: the whole drag lands on one
    // undo step.
    doc.transact(() => {
      shapeMap.set("x", Math.round(nextX));
      shapeMap.set("y", Math.round(nextY));
    }, localOrigin);
  }

  function endShapeDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (shapeDragRef.current?.pointerId === event.pointerId) {
      shapeDragRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Starts a resize from the shape's bottom-right handle. Pen
  // strokes have no handle — resizing one would stretch its
  // points out of shape, so pen shapes move and delete but do
  // not resize. With the Connector tool, a press picks an
  // endpoint instead.
  function startShapeResize(event: React.PointerEvent<HTMLDivElement>, shape: Shape): void {
    if (event.button !== 0 || tool === "connector") return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    shapeResizeRef.current = {
      id: shape.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      shapeW: shape.w,
      shapeH: shape.h,
    };
  }

  function moveShapeResize(event: React.PointerEvent<HTMLDivElement>): void {
    const resize = shapeResizeRef.current;
    const doc = docRef.current;
    const shapesMap = shapesMapRef.current;
    if (!resize || !doc || !shapesMap || event.pointerId !== resize.pointerId) return;
    const shapeMap = shapesMap.get(resize.id);
    if (!shapeMap) return;
    const nextW = Math.max(
      MIN_SHAPE_SIZE,
      resize.shapeW + (event.clientX - resize.startX) / zoom,
    );
    const nextH = Math.max(
      MIN_SHAPE_SIZE,
      resize.shapeH + (event.clientY - resize.startY) / zoom,
    );
    // Same batching as a drag: rapid moves merge into one undo step.
    doc.transact(() => {
      shapeMap.set("w", Math.round(nextW));
      shapeMap.set("h", Math.round(nextH));
    }, localOrigin);
  }

  function endShapeResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (shapeResizeRef.current?.pointerId === event.pointerId) {
      shapeResizeRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Creates a frame at the given board position, in the picked
  // color, and selects it so the user can drag or rename it right
  // away. A frame starts at the minimum size and grows with the drag.
  function createFrameAtPoint(x: number, y: number): string {
    const doc = docRef.current;
    const framesMap = framesMapRef.current;
    if (!doc || !framesMap) return "";
    const id = crypto.randomUUID();
    const frame = createFrame(
      id,
      Math.round(x),
      Math.round(y),
      MIN_FRAME_SIZE,
      MIN_FRAME_SIZE,
      pickedColor,
    );
    doc.transact(() => {
      framesMap.set(id, buildFrameMap(frame));
    }, localOrigin);
    selectFrame(id);
    return id;
  }

  // Starts drawing a frame on empty canvas. The frame is created
  // right away, so the other tab sees it appear as soon as the
  // drag starts.
  function startFrameDraw(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    if (tool !== "frame") return;
    const point = toBoardCoords(event.clientX, event.clientY);
    const id = createFrameAtPoint(point.x, point.y);
    if (!id) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    frameDrawRef.current = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      frameId: id,
    };
  }

  function moveFrameDraw(event: React.PointerEvent<HTMLDivElement>): void {
    const draw = frameDrawRef.current;
    const doc = docRef.current;
    const framesMap = framesMapRef.current;
    if (!draw || !doc || !framesMap || event.pointerId !== draw.pointerId) return;
    const frameMap = framesMap.get(draw.frameId);
    if (!frameMap) return;
    const point = toBoardCoords(event.clientX, event.clientY);
    // A drag in any direction defines the box, so dragging up or
    // left grows the frame the other way instead of shrinking it.
    const box = normalizeShapeBox(draw.startX, draw.startY, point.x, point.y);
    doc.transact(() => {
      frameMap.set("x", box.x);
      frameMap.set("y", box.y);
      frameMap.set("w", box.w);
      frameMap.set("h", box.h);
    }, localOrigin);
  }

  function endFrameDraw(event: React.PointerEvent<HTMLDivElement>): void {
    if (frameDrawRef.current?.pointerId === event.pointerId) {
      frameDrawRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // The items whose centres are inside a frame, with the position
  // each one starts at. A frame drag moves all of them by the same
  // amount as the frame. A frame inside the frame moves too —
  // its contents are inside the outer frame as well, so they are
  // listed directly and move in the same step.
  function frameContents(frame: Frame): FrameDragContent[] {
    const contents: FrameDragContent[] = [];
    for (const note of notes) {
      if (boxCentreInFrame(frame, note)) {
        contents.push({ kind: "note", id: note.id, x: note.x, y: note.y });
      }
    }
    for (const shape of shapes) {
      if (boxCentreInFrame(frame, shape)) {
        contents.push({
          kind: "shape",
          id: shape.id,
          x: shape.x,
          y: shape.y,
          points: shape.kind === "pen" ? shape.points : undefined,
        });
      }
    }
    for (const textBox of texts) {
      if (boxCentreInFrame(frame, textBox)) {
        contents.push({ kind: "text", id: textBox.id, x: textBox.x, y: textBox.y });
      }
    }
    for (const other of frames) {
      if (other.id !== frame.id && boxCentreInFrame(frame, other)) {
        contents.push({ kind: "frame", id: other.id, x: other.x, y: other.y });
      }
    }
    return contents;
  }

  // Starts a drag from a frame. The whole frame is the handle —
  // there is no text to edit, so the entire frame grabs, except
  // the title input (which stops the press so the frame does not
  // move while the user is renaming it). With the Connector tool,
  // a press picks an endpoint instead.
  function startFrameDrag(event: React.PointerEvent<HTMLDivElement>, frame: Frame): void {
    if (event.button !== 0 || tool === "connector") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    frameDragRef.current = {
      id: frame.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      frameX: frame.x,
      frameY: frame.y,
      contents: frameContents(frame),
    };
  }

  function moveFrameDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = frameDragRef.current;
    const doc = docRef.current;
    if (!drag || !doc || event.pointerId !== drag.pointerId) return;
    const notesMap = notesMapRef.current;
    const shapesMap = shapesMapRef.current;
    const textsMap = textsMapRef.current;
    const framesMap = framesMapRef.current;
    if (!notesMap || !shapesMap || !textsMap || !framesMap) return;
    const frameMap = framesMap.get(drag.id);
    if (!frameMap) return;
    // Screen pixels become board pixels by dividing by the zoom —
    // at 200% a 20px mouse move is only 10 board pixels.
    const deltaX = (event.clientX - drag.startX) / zoom;
    const deltaY = (event.clientY - drag.startY) / zoom;
    const nextX = Math.max(0, drag.frameX + deltaX);
    const nextY = Math.max(0, drag.frameY + deltaY);
    // The frame cannot move past the top-left corner, so the
    // contents move by the frame's actual move, not the raw
    // mouse delta — otherwise the group would drift apart.
    const moveX = nextX - drag.frameX;
    const moveY = nextY - drag.frameY;
    // One transaction, so the frame and its contents move together
    // and one undo step reverts the whole drag.
    doc.transact(() => {
      frameMap.set("x", Math.round(nextX));
      frameMap.set("y", Math.round(nextY));
      for (const item of drag.contents) {
        if (item.kind === "note") {
          notesMap.get(item.id)?.set("x", Math.round(item.x + moveX));
          notesMap.get(item.id)?.set("y", Math.round(item.y + moveY));
        } else if (item.kind === "shape") {
          const shapeMap = shapesMap.get(item.id);
          if (!shapeMap) continue;
          shapeMap.set("x", Math.round(item.x + moveX));
          shapeMap.set("y", Math.round(item.y + moveY));
          // A pen stroke lives in absolute board pixels: the
          // points move with the box, or the stroke stays behind.
          if (item.points) {
            const points = shapeMap.get("points");
            if (points instanceof Y.Array) {
              const shifted: number[] = [];
              for (const point of item.points) {
                shifted.push(Math.round(point.x + moveX), Math.round(point.y + moveY));
              }
              points.delete(0, points.length);
              points.push(shifted);
            }
          }
        } else if (item.kind === "text") {
          textsMap.get(item.id)?.set("x", Math.round(item.x + moveX));
          textsMap.get(item.id)?.set("y", Math.round(item.y + moveY));
        } else {
          framesMap.get(item.id)?.set("x", Math.round(item.x + moveX));
          framesMap.get(item.id)?.set("y", Math.round(item.y + moveY));
        }
      }
    }, localOrigin);
  }

  function endFrameDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (frameDragRef.current?.pointerId === event.pointerId) {
      frameDragRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Starts a resize from the frame's bottom-right handle.
  // Resizing a frame does not move its contents — they stay where
  // they are, and anything that ends up outside the frame simply
  // stops being inside it. With the Connector tool, a press picks
  // an endpoint instead.
  function startFrameResize(event: React.PointerEvent<HTMLDivElement>, frame: Frame): void {
    if (event.button !== 0 || tool === "connector") return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    frameResizeRef.current = {
      id: frame.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      frameW: frame.w,
      frameH: frame.h,
    };
  }

  function moveFrameResize(event: React.PointerEvent<HTMLDivElement>): void {
    const resize = frameResizeRef.current;
    const doc = docRef.current;
    const framesMap = framesMapRef.current;
    if (!resize || !doc || !framesMap || event.pointerId !== resize.pointerId) return;
    const frameMap = framesMap.get(resize.id);
    if (!frameMap) return;
    const nextW = Math.max(
      MIN_FRAME_SIZE,
      resize.frameW + (event.clientX - resize.startX) / zoom,
    );
    const nextH = Math.max(
      MIN_FRAME_SIZE,
      resize.frameH + (event.clientY - resize.startY) / zoom,
    );
    // Same batching as a drag: rapid moves merge into one undo step.
    doc.transact(() => {
      frameMap.set("w", Math.round(nextW));
      frameMap.set("h", Math.round(nextH));
    }, localOrigin);
  }

  function endFrameResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (frameResizeRef.current?.pointerId === event.pointerId) {
      frameResizeRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Renames a frame. An empty title falls back to "Frame", so a
  // frame always has a name to show.
  function renameFrame(frameId: string, next: string): void {
    const doc = docRef.current;
    const framesMap = framesMapRef.current;
    if (!doc || !framesMap) return;
    const frameMap = framesMap.get(frameId);
    if (!frameMap) return;
    const title = next.trim() === "" ? "Frame" : next;
    doc.transact(() => {
      frameMap.set("title", title);
    }, localOrigin);
  }

  // Picks an endpoint for a connector. The first click arms the
  // connector on that item; the second click on a different item
  // creates it. Clicking the same item again cancels it.
  function pickConnectorEndpoint(itemId: string): void {
    if (!connectorPendingFromId) {
      setConnectorPendingFromId(itemId);
      return;
    }
    if (connectorPendingFromId === itemId) {
      setConnectorPendingFromId(null);
      return;
    }
    createConnectorBetween(connectorPendingFromId, itemId);
    setConnectorPendingFromId(null);
  }

  // Creates a connector between two items, in the picked color,
  // and selects it so the user can recolor or delete it right
  // away. The connector tool stays active, so the next click
  // starts another connector.
  function createConnectorBetween(fromId: string, toId: string): void {
    const doc = docRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !connectorsMap) return;
    const id = crypto.randomUUID();
    const connector = createConnector(id, fromId, toId, pickedColor);
    doc.transact(() => {
      connectorsMap.set(id, buildConnectorMap(connector));
    }, localOrigin);
    selectConnector(id);
  }

  // The smallest a note can be resized to — smaller than this,
  // the text is unreadable.
  const MIN_NOTE_SIZE = 120;

  // Starts a resize from the note's bottom-right handle. With
  // the Connector tool, a press picks an endpoint instead.
  function startResize(event: React.PointerEvent<HTMLDivElement>, note: Note): void {
    if (event.button !== 0 || tool === "connector") return;
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
    const nextW = Math.max(
      MIN_NOTE_SIZE,
      resize.noteW + (event.clientX - resize.startX) / zoom,
    );
    const nextH = Math.max(
      MIN_NOTE_SIZE,
      resize.noteH + (event.clientY - resize.startY) / zoom,
    );
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

  // Downloads the board as a PNG image, rendered from the synced
  // board state (see export.ts for why it is drawn, not screenshotted).
  function exportPng(): void {
    const canvas = renderBoardToCanvas(notes, shapes, texts, frames, connectors);
    canvas.toBlob((blob) => {
      if (!blob) {
        setImportMessage("Could not make a PNG from this board.");
        return;
      }
      downloadBlob(`syncboard-${boardId}.png`, blob);
      setImportMessage(null);
    }, "image/png");
  }

  // Downloads the whole board — notes, shapes, text boxes,
  // frames, and connectors — as a JSON file, so it can be saved
  // or moved to another board.
  function exportJson(): void {
    const data: BoardExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      boardId,
      notes,
      shapes,
      texts,
      frames,
      connectors,
    };
    downloadBlob(
      `syncboard-${boardId}.json`,
      new Blob([boardExportToJson(data)], { type: "application/json" }),
    );
    setImportMessage(null);
  }

  // Reads a picked JSON file and replaces the board with it. The
  // confirm step comes first: replacing wipes the board (one undo
  // brings it all back, and the change syncs to everyone).
  async function importJsonFile(file: File): Promise<void> {
    let json: string;
    try {
      json = await file.text();
    } catch {
      setImportMessage("Could not read that file — nothing was changed.");
      return;
    }
    const parsed = parseBoardExport(json);
    if (!parsed) {
      setImportMessage("That file is not a SyncBoard export — nothing was changed.");
      return;
    }
    if (
      !window.confirm(
        `Replace this board with "${file.name}"? It has ${parsed.notes.length} notes, ` +
          `${parsed.shapes.length} shapes, ${parsed.texts.length} text boxes, ` +
          `${parsed.frames.length} frames, and ${parsed.connectors.length} connectors. ` +
          `Everything on this board now will be gone — press Ctrl+Z to undo the import.`,
      )
    ) {
      return;
    }
    const doc = docRef.current;
    if (!doc) return;
    applyBoardExport(doc, parsed, localOrigin);
    setSelection(null, null);
    setImportMessage(
      `Imported ${parsed.notes.length} notes, ${parsed.shapes.length} shapes, ` +
        `${parsed.texts.length} text boxes, ${parsed.frames.length} frames, and ` +
        `${parsed.connectors.length} connectors from "${file.name}".`,
    );
  }

  // Creates the board from the switcher form and opens it. The
  // form only closes on success, so a failed create leaves the
  // typed name in place for another try.
  async function submitNewBoard(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const name = newBoardName.trim();
    if (!name) return;
    setCreatingBoard(true);
    try {
      const created = await onCreateBoard(name);
      if (created) {
        setNewBoardName("");
        setShowNewBoardForm(false);
      }
    } finally {
      setCreatingBoard(false);
    }
  }

  // Keyboard shortcuts: Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo,
  // Delete / Backspace deletes the selected note, shape, text
  // box, frame, or connector, Escape returns to the Select tool
  // and cancels a connector in progress. Delete only fires when
  // the user is not typing in a note's textarea.
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
      if (event.key === "Escape") {
        setTool("select");
        setConnectorPendingFromId(null);
        return;
      }
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
        const selectedNote = localPresenceRef.current.selectedNoteIds[0];
        const selectedShape = localPresenceRef.current.selectedShapeIds[0];
        const selectedText = localPresenceRef.current.selectedTextIds[0];
        const selectedFrame = selectedFrameRef.current;
        const selectedConnector = selectedConnectorRef.current;
        if (selectedNote) {
          event.preventDefault();
          deleteNote(selectedNote);
        } else if (selectedShape) {
          event.preventDefault();
          deleteShape(selectedShape);
        } else if (selectedText) {
          event.preventDefault();
          deleteTextBox(selectedText);
        } else if (selectedFrame) {
          event.preventDefault();
          deleteFrame(selectedFrame);
        } else if (selectedConnector) {
          event.preventDefault();
          deleteConnector(selectedConnector);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // The handlers only touch refs and state setters, so binding
    // once is safe — the selection is read from the presence ref,
    // not from state, so it is never stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      selectedShapeIds: [],
      selectedTextIds: [],
    });
  }
  for (const person of presence) {
    for (const noteId of person.selectedNoteIds) addSelector(noteId, person);
  }

  // Who selected each shape, local user included, so the outline
  // and label can show every selector at once — same as notes.
  const selectorsByShape = new Map<string, PresenceUser[]>();
  function addShapeSelector(shapeId: string, person: PresenceUser): void {
    const list = selectorsByShape.get(shapeId) ?? [];
    list.push(person);
    selectorsByShape.set(shapeId, list);
  }
  if (selectedShapeId) {
    addShapeSelector(selectedShapeId, {
      id: user.id,
      name: user.name,
      color: user.color,
      cursor: null,
      selectedNoteIds: [],
      selectedShapeIds: [selectedShapeId],
      selectedTextIds: [],
    });
  }
  for (const person of presence) {
    for (const shapeId of person.selectedShapeIds) addShapeSelector(shapeId, person);
  }

  // Who selected each text box, local user included — same as
  // notes and shapes.
  const selectorsByText = new Map<string, PresenceUser[]>();
  function addTextSelector(textId: string, person: PresenceUser): void {
    const list = selectorsByText.get(textId) ?? [];
    list.push(person);
    selectorsByText.set(textId, list);
  }
  if (selectedTextId) {
    addTextSelector(selectedTextId, {
      id: user.id,
      name: user.name,
      color: user.color,
      cursor: null,
      selectedNoteIds: [],
      selectedShapeIds: [],
      selectedTextIds: [selectedTextId],
    });
  }
  for (const person of presence) {
    for (const textId of person.selectedTextIds) addTextSelector(textId, person);
  }

  // The boxes of every item on the board, by id. A connector's
  // endpoints are resolved through this map, so a connector
  // follows whichever item it points at.
  const boxesById = new Map<string, Box>();
  for (const note of notes) boxesById.set(note.id, note);
  for (const shape of shapes) boxesById.set(shape.id, shape);
  for (const textBox of texts) boxesById.set(textBox.id, textBox);
  for (const frame of frames) boxesById.set(frame.id, frame);

  // The midpoint of the selected connector, where its delete
  // button sits. Null when nothing is selected or an endpoint
  // is gone.
  let selectedConnectorMid: { x: number; y: number } | null = null;
  const selectedConnector = connectors.find((item) => item.id === selectedConnectorId);
  if (selectedConnector) {
    const from = boxesById.get(selectedConnector.fromId);
    const to = boxesById.get(selectedConnector.toId);
    if (from && to) {
      const ends = connectorEndpoints(from, to);
      selectedConnectorMid = { x: (ends.x1 + ends.x2) / 2, y: (ends.y1 + ends.y2) / 2 };
    }
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
      <div className="boards-bar" aria-label="Boards">
        {boards.map((board) => (
          <span
            key={board.id}
            className={`board-tab${board.id === boardId ? " active" : ""}`}
          >
            <button
              type="button"
              className="board-tab-button"
              onClick={() => onSwitchBoard(board.id)}
              aria-current={board.id === boardId ? "true" : undefined}
            >
              {board.name}
            </button>
            {canDeleteBoard(board.id) && (
              <button
                type="button"
                className="board-tab-delete"
                onClick={() => void onDeleteBoard(board)}
                aria-label={`Delete board ${board.name}`}
                title={`Delete ${board.name}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {showNewBoardForm ? (
          <form className="board-new-form" onSubmit={(event) => void submitNewBoard(event)}>
            <input
              aria-label="New board name"
              value={newBoardName}
              onChange={(event) => setNewBoardName(event.target.value)}
              placeholder="Board name"
              autoFocus
              maxLength={100}
            />
            <button type="submit" disabled={creatingBoard || newBoardName.trim() === ""}>
              Create board
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNewBoardForm(false);
                setNewBoardName("");
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="board-new-button"
            onClick={() => setShowNewBoardForm(true)}
          >
            + New board
          </button>
        )}
      </div>
      {notice && (
        <p className="board-notice" role="status">
          {notice}{" "}
          <button type="button" onClick={onDismissNotice}>
            Dismiss
          </button>
        </p>
      )}
      {boardsError && (
        <p className="board-error" role="alert">
          {boardsError}
        </p>
      )}
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
        <div className="tool-picker" role="group" aria-label="Drawing tools">
          {TOOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`toolbar-button tool-button${tool === item.id ? " active" : ""}`}
              onClick={() => setTool(item.id)}
              aria-pressed={tool === item.id}
              title={
                item.id === "select"
                  ? "Select and move things (Escape)"
                  : item.id === "note"
                    ? "Click empty canvas to add a note"
                    : item.id === "text"
                      ? "Click empty canvas to add a text box"
                      : item.id === "connector"
                        ? "Click one item, then another, to connect them with an arrow"
                        : `Drag on empty canvas to draw a ${item.label.toLowerCase()}`
              }
            >
              {TOOL_ICONS[item.id]}
              {item.label}
            </button>
          ))}
        </div>
        <span className="toolbar-divider" aria-hidden="true" />
        <div className="color-picker" role="group" aria-label="Note and shape color">
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
        <div className="font-size-picker" role="group" aria-label="Text size">
          {TEXT_FONT_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={`toolbar-button font-size-button${pickedFontSize === size ? " active" : ""}`}
              onClick={() => pickFontSize(size)}
              aria-pressed={pickedFontSize === size}
              aria-label={`${size} text`}
              title={`${size[0].toUpperCase()}${size.slice(1)} text (${FONT_SIZE_PX[size]}px)`}
            >
              {size === "small" ? "S" : size === "medium" ? "M" : "L"}
            </button>
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
          {ACTION_ICONS.undo}
          Undo
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          {ACTION_ICONS.redo}
          Redo
        </button>
        <span className="toolbar-divider" aria-hidden="true" />
        <div className="export-controls" role="group" aria-label="Export and import">
          <button
            type="button"
            className="toolbar-button"
            onClick={exportPng}
            title="Download the board as a PNG image"
          >
            {ACTION_ICONS.download}
            Export PNG
          </button>
          <button
            type="button"
            className="toolbar-button"
            onClick={exportJson}
            title="Download the board as a JSON file"
          >
            {ACTION_ICONS.download}
            Export JSON
          </button>
          <button
            type="button"
            className="toolbar-button"
            onClick={() => importInputRef.current?.click()}
            title="Replace this board with a board from a JSON file"
          >
            {ACTION_ICONS.upload}
            Import JSON
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            aria-label="Import a board JSON file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset so picking the same file again still fires.
              event.target.value = "";
              if (file) void importJsonFile(file);
            }}
          />
        </div>
        <span className="toolbar-divider" aria-hidden="true" />
        <div className="zoom-controls" role="group" aria-label="Zoom">
          <button
            type="button"
            className="toolbar-button zoom-button"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <span className="zoom-label" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="toolbar-button zoom-button"
            onClick={() => zoomBy(ZOOM_STEP)}
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="toolbar-button"
            onClick={resetView}
            disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
            title="Reset view to 100%"
          >
            Reset
          </button>
        </div>
      </div>
      {importMessage && (
        <p className="board-notice" role="status">
          {importMessage}{" "}
          <button type="button" onClick={() => setImportMessage(null)}>
            Dismiss
          </button>
        </p>
      )}
      {connectorPendingFromId && (
        <p className="board-notice" role="status">
          Connector started: click another note, shape, text box, or frame to connect to it.{" "}
          <button type="button" onClick={() => setConnectorPendingFromId(null)}>
            Cancel
          </button>
        </p>
      )}
      <div
        className={`board${panning ? " panning" : ""}${tool !== "select" ? " drawing" : ""}`}
        ref={boardRef}
        onPointerMove={(event) => {
          trackCursor(event);
          movePan(event);
          moveDraw(event);
          moveFrameDraw(event);
          moveTextDrag(event);
        }}
        onPointerLeave={clearCursor}
        onPointerDown={(event) => {
          // A press on empty board (not on a note, shape, or frame).
          if (event.target === event.currentTarget || event.target === canvasRef.current) {
            handleEmptyCanvasPress(event);
          }
        }}
        onPointerUp={(event) => {
          endPan(event);
          endDraw(event);
          endFrameDraw(event);
          endTextDrag(event);
        }}
        onPointerCancel={(event) => {
          endPan(event);
          endDraw(event);
          endFrameDraw(event);
          endTextDrag(event);
        }}
        onDoubleClick={createNoteAtPoint}
      >
        <div
          className="board-canvas"
          ref={canvasRef}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          {frames.map((frame) => {
            const isConnectorSource = connectorPendingFromId === frame.id;
            const isSelected = selectedFrameId === frame.id;
            const stroke = SHAPE_STROKE_COLORS[frame.color];
            return (
              <div
                key={frame.id}
                className="frame"
                data-frame-id={frame.id}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  if (tool === "connector") {
                    event.preventDefault();
                    pickConnectorEndpoint(frame.id);
                    return;
                  }
                  if (tool !== "select") {
                    // A creation tool pressed on the frame: the
                    // frame is empty board for this purpose, so
                    // the press creates or draws inside it.
                    handleEmptyCanvasPress(event);
                    return;
                  }
                  selectFrame(frame.id);
                  startFrameDrag(event, frame);
                }}
                onPointerMove={(event) => {
                  moveFrameDrag(event);
                  // A shape or frame draw started inside this
                  // frame captures the pointer here, so its moves
                  // arrive on the frame, not the board.
                  moveDraw(event);
                  moveFrameDraw(event);
                }}
                onPointerUp={(event) => {
                  endFrameDrag(event);
                  endDraw(event);
                  endFrameDraw(event);
                }}
                onPointerCancel={(event) => {
                  endFrameDrag(event);
                  endDraw(event);
                  endFrameDraw(event);
                }}
                style={{
                  left: frame.x,
                  top: frame.y,
                  width: frame.w,
                  height: frame.h,
                  border: `2px solid ${stroke}`,
                  // A selected frame — or the pending source of a
                  // connector — gets an accent outline.
                  ...(isSelected || isConnectorSource
                    ? { boxShadow: "0 0 0 2px var(--color-accent)" }
                    : undefined),
                }}
              >
                {isSelected && (
                  <>
                    <button
                      type="button"
                      className="note-delete"
                      onClick={() => deleteFrame(frame.id)}
                      onPointerDown={(event) => event.stopPropagation()}
                      aria-label="Delete frame"
                      title="Delete frame (Delete key)"
                    >
                      ×
                    </button>
                    <div
                      className="note-resize"
                      onPointerDown={(event) => startFrameResize(event, frame)}
                      onPointerMove={moveFrameResize}
                      onPointerUp={endFrameResize}
                      aria-label="Resize frame"
                    />
                  </>
                )}
              </div>
            );
          })}
          <svg className="connector-svg" aria-hidden="true">
            <defs>
              {(Object.keys(NOTE_COLORS) as NoteColor[]).map((color) => (
                <marker
                  key={color}
                  id={`connector-arrow-${color}`}
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L7,3 z" fill={SHAPE_STROKE_COLORS[color]} />
                </marker>
              ))}
            </defs>
            {connectors.map((connector) => {
              const from = boxesById.get(connector.fromId);
              const to = boxesById.get(connector.toId);
              // An endpoint that is gone (a stale import) draws
              // nothing — a connector never points at nowhere.
              if (!from || !to) return null;
              const ends = connectorEndpoints(from, to);
              const stroke = SHAPE_STROKE_COLORS[connector.color];
              const isSelected = selectedConnectorId === connector.id;
              return (
                <g key={connector.id}>
                  {/* A wide transparent line, so the thin visible
                      line is easy to click. */}
                  <line
                    className="connector-hit"
                    x1={ends.x1}
                    y1={ends.y1}
                    x2={ends.x2}
                    y2={ends.y2}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || tool === "connector") return;
                      selectConnector(connector.id);
                    }}
                  />
                  <line
                    className="connector-line"
                    x1={ends.x1}
                    y1={ends.y1}
                    x2={ends.x2}
                    y2={ends.y2}
                    stroke={stroke}
                    strokeWidth={isSelected ? 4 : 2.5}
                    markerEnd={`url(#connector-arrow-${connector.color})`}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || tool === "connector") return;
                      selectConnector(connector.id);
                    }}
                  />
                </g>
              );
            })}
          </svg>
          {selectedConnectorMid && selectedConnector && (
            <button
              type="button"
              className="connector-delete"
              style={{ left: selectedConnectorMid.x, top: selectedConnectorMid.y }}
              onClick={() => deleteConnector(selectedConnector.id)}
              onPointerDown={(event) => event.stopPropagation()}
              aria-label="Delete connector"
              title="Delete connector (Delete key)"
            >
              ×
            </button>
          )}
          {shapes.map((shape) => {
            const selectors = selectorsByShape.get(shape.id) ?? [];
            const stroke = SHAPE_STROKE_COLORS[shape.color];
            // The outline for a selected shape: a selector's color,
            // or the accent when it is the pending source of a
            // connector being drawn.
            const isConnectorSource = connectorPendingFromId === shape.id;
            const outline = isConnectorSource
              ? "0 0 0 2px var(--color-accent)"
              : selectors.length > 0
                ? `0 0 0 2px ${selectors[0].color}`
                : null;
            // A zero-size box would collapse the SVG, so the
            // rendered box is at least 1px in each direction.
            const boxW = Math.max(1, shape.w);
            const boxH = Math.max(1, shape.h);
            return (
              <div
                key={shape.id}
                className="shape"
                data-shape-id={shape.id}
                data-shape-kind={shape.kind}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  if (tool === "connector") {
                    event.preventDefault();
                    pickConnectorEndpoint(shape.id);
                    return;
                  }
                  if (tool !== "select") return;
                  selectShape(shape.id);
                  startShapeDrag(event, shape);
                }}
                onPointerMove={moveShapeDrag}
                onPointerUp={endShapeDrag}
                style={{
                  left: shape.x,
                  top: shape.y,
                  width: boxW,
                  height: boxH,
                  // A selected shape gets an outline in the first
                  // selector's color, like a selected note.
                  ...(outline ? { boxShadow: outline } : undefined),
                  ...(shape.kind === "rect" || shape.kind === "ellipse"
                    ? {
                        background: NOTE_COLORS[shape.color],
                        border: `2px solid ${stroke}`,
                        borderRadius: shape.kind === "ellipse" ? "50%" : "var(--radius-input)",
                      }
                    : undefined),
                }}
              >
                {selectors.length > 0 && (
                  <span
                    className="shape-selector"
                    style={{ background: selectors[0].color }}
                  >
                    {selectors.map((person) => person.name).join(", ")}
                  </span>
                )}
                {shape.kind === "line" && (
                  <svg
                    className="shape-svg"
                    width="100%"
                    height="100%"
                    viewBox={`0 0 ${boxW} ${boxH}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <defs>
                      <marker
                        id={`arrow-${shape.id}`}
                        markerWidth="8"
                        markerHeight="8"
                        refX="6"
                        refY="3"
                        orient="auto"
                      >
                        <path d="M0,0 L0,6 L7,3 z" fill={stroke} />
                      </marker>
                    </defs>
                    <line
                      x1="2"
                      y1="2"
                      x2={boxW - 2}
                      y2={boxH - 2}
                      stroke={stroke}
                      strokeWidth="3"
                      markerEnd={`url(#arrow-${shape.id})`}
                    />
                  </svg>
                )}
                {shape.kind === "pen" && (
                  <svg
                    className="shape-svg"
                    width="100%"
                    height="100%"
                    viewBox={`0 0 ${boxW} ${boxH}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      d={penPathFromPoints(shape.points, shape.x, shape.y)}
                      stroke={stroke}
                      strokeWidth="3"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
                {selectedShapeId === shape.id && (
                  <>
                    <button
                      type="button"
                      className="note-delete"
                      onClick={() => deleteShape(shape.id)}
                      onPointerDown={(event) => event.stopPropagation()}
                      aria-label="Delete shape"
                      title="Delete shape (Delete key)"
                    >
                      ×
                    </button>
                    {shape.kind !== "pen" && (
                      <div
                        className="note-resize"
                        onPointerDown={(event) => startShapeResize(event, shape)}
                        onPointerMove={moveShapeResize}
                        onPointerUp={endShapeResize}
                        aria-label="Resize shape"
                      />
                    )}
                  </>
                )}
              </div>
            );
          })}
          {notes.map((note) => {
          const selectors = selectorsByNote.get(note.id) ?? [];
          // The outline for a selected note: a selector's color,
          // or the accent when it is the pending source of a
          // connector being drawn.
          const isConnectorSource = connectorPendingFromId === note.id;
          const outline = isConnectorSource
            ? "0 0 0 2px var(--color-accent)"
            : selectors.length > 0
              ? `0 0 0 2px ${selectors[0].color}`
              : null;
          return (
            <div
              key={note.id}
              className="note"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                if (tool === "connector") {
                  // Picking an endpoint, not editing: keep the
                  // press from focusing the textarea.
                  event.preventDefault();
                  pickConnectorEndpoint(note.id);
                  return;
                }
                selectNote(note.id);
              }}
              style={{
                left: note.x,
                top: note.y,
                width: note.w,
                height: note.h,
                background: NOTE_COLORS[note.color],
                // A selected note gets an outline in the first
                // selector's color, on top of the usual shadow.
                ...(outline
                  ? {
                      boxShadow: `${outline}, var(--shadow-card)`,
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
        {texts.map((textBox) => {
          const selectors = selectorsByText.get(textBox.id) ?? [];
          // The outline for a selected text box: a selector's
          // color, or the accent when it is the pending source
          // of a connector being drawn.
          const isConnectorSource = connectorPendingFromId === textBox.id;
          const outline = isConnectorSource
            ? "0 0 0 2px var(--color-accent)"
            : selectors.length > 0
              ? `0 0 0 2px ${selectors[0].color}`
              : null;
          return (
            <div
              key={textBox.id}
              className="text-box"
              data-text-id={textBox.id}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                if (tool === "connector") {
                  // Picking an endpoint, not editing: keep the
                  // press from focusing the textarea.
                  event.preventDefault();
                  pickConnectorEndpoint(textBox.id);
                  return;
                }
                selectTextBox(textBox.id);
              }}
              style={{
                left: textBox.x,
                top: textBox.y,
                width: textBox.w,
                height: textBox.h,
                color: TEXT_COLORS[textBox.color],
                fontSize: FONT_SIZE_PX[textBox.fontSize],
                // A selected text box gets an outline in the
                // first selector's color, like a selected note.
                ...(outline ? { boxShadow: outline } : undefined),
              }}
            >
              {selectors.length > 0 && (
                <span
                  className="text-selector"
                  style={{ background: selectors[0].color }}
                >
                  {selectors.map((person) => person.name).join(", ")}
                </span>
              )}
              <div
                className="text-handle"
                onPointerDown={(event) => startTextDrag(event, textBox)}
                onPointerMove={moveTextDrag}
                onPointerUp={endTextDrag}
              />
              <textarea
                className="text-box-text"
                value={textBox.text}
                onChange={(event) => changeTextBoxText(textBox.id, event.target.value)}
                onBlur={() => undoManagerRef.current?.stopCapturing()}
                placeholder="Type something"
                aria-label="Text box text"
              />
              {selectedTextId === textBox.id && (
                <>
                  <button
                    type="button"
                    className="note-delete"
                    onClick={() => deleteTextBox(textBox.id)}
                    aria-label="Delete text box"
                    title="Delete text box (Delete key)"
                  >
                    ×
                  </button>
                  <div
                    className="note-resize"
                    onPointerDown={(event) => startTextResize(event, textBox)}
                    onPointerMove={moveTextResize}
                    onPointerUp={endTextResize}
                    aria-label="Resize text box"
                  />
                </>
              )}
            </div>
          );
        })}
        {/* Frame titles live in their own layer above the items, so
            a note placed over a frame's top-left corner never hides
            its name. Each title sits at its frame's top-left, inset
            by FRAME_TITLE_INSET, and never runs past the frame's far
            edge. The title is still an input — click it to rename. */}
        {frames.map((frame) => {
          // The title on screen: the draft while the user is
          // typing, the shared title otherwise.
          const titleShown =
            frameTitleDraft?.id === frame.id ? frameTitleDraft.value : frame.title;
          return (
            <input
              key={frame.id}
              className="frame-title"
              value={titleShown}
              style={{
                left: frame.x + FRAME_TITLE_INSET,
                top: frame.y + FRAME_TITLE_INSET,
                maxWidth: Math.max(60, frame.w - 2 * FRAME_TITLE_INSET),
                background: NOTE_COLORS[frame.color],
              }}
              onChange={(event) =>
                setFrameTitleDraft({ id: frame.id, value: event.target.value })
              }
              onBlur={() => {
                if (frameTitleDraft?.id === frame.id) {
                  renameFrame(frame.id, frameTitleDraft.value);
                  setFrameTitleDraft(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  // Cancel the edit, not the title: the draft
                  // is dropped, so the blur below commits
                  // nothing.
                  setFrameTitleDraft(null);
                  event.currentTarget.blur();
                }
              }}
              onFocus={() => selectFrame(frame.id)}
              onPointerDown={(event) => event.stopPropagation()}
              aria-label="Frame title"
              maxLength={60}
              size={Math.max(4, titleShown.length + 1)}
            />
          );
        })}
        </div>
        {/* The empty state sits on the viewport, not the canvas
            layer, so it stays centred no matter where the board
            is panned or how far it is zoomed. */}
        {notes.length === 0 && shapes.length === 0 && texts.length === 0 && frames.length === 0 && (
          <div className="board-empty">
            {status === "connected" ? (
              <>
                <p className="board-empty-title">This board is empty.</p>
                <p className="board-empty-line">
                  Add a note, draw a shape, or write some text to start.
                </p>
              </>
            ) : status === "disconnected" ? (
              <>
                <p className="board-empty-title">Can&rsquo;t reach the board.</p>
                <p className="board-empty-line">
                  Check your connection. The board will load when it reconnects.
                </p>
              </>
            ) : (
              <p className="board-empty-line">Loading notes…</p>
            )}
          </div>
        )}
        {presence.map((person) =>
          person.cursor ? (
            <div
              key={person.id}
              className="remote-cursor"
              // Screen space, not board space: the cursor keeps a
              // constant size and lands on the same note in this
              // tab no matter what zoom or pan this tab is using.
              style={{
                left: pan.x + zoom * person.cursor.x,
                top: pan.y + zoom * person.cursor.y,
              }}
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
