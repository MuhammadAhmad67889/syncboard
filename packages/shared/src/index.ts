// Shared types and constants for SyncBoard. This package has no
// dependencies, so the web app and the sync server can both use it
// without pulling in each other's code.

// The six sticky-note colors. The hex values are the note
// backgrounds; the names are what the color picker shows.
export const NOTE_COLORS = {
  yellow: "#fef08a",
  pink: "#fbcfe8",
  green: "#bbf7d0",
  blue: "#bfdbfe",
  purple: "#ddd6fe",
  orange: "#fed7aa",
} as const;

export type NoteColor = keyof typeof NOTE_COLORS;

// One sticky note on the board. Position and size are in board
// pixels; text is plain text here (the live document stores it
// as a Y.Text so two people can type in the same note).
export interface Note {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: NoteColor;
  text: string;
}

// One shape on the board: a rectangle, an ellipse, a line with an
// arrowhead, or a freehand pen stroke. Position and size are in
// board pixels, like a note. For a line, the endpoints are the
// opposite corners of its box — (x, y) to (x + w, y + h) — so a
// line is just a box with an arrow. For a pen stroke, points are
// the stroke in absolute board pixels, and x/y/w/h are the
// bounding box around them (kept in sync as the stroke grows).
export type ShapeKind = "rect" | "ellipse" | "line" | "pen";

export interface ShapePoint {
  x: number;
  y: number;
}

export interface Shape {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color: NoteColor;
  points: ShapePoint[];
}

// The default size for a newly drawn rectangle or ellipse.
export const DEFAULT_SHAPE_SIZE = { w: 160, h: 120 } as const;

// The smallest a shape can be drawn or resized to. Smaller than
// this, a shape is too small to grab or see.
export const MIN_SHAPE_SIZE = 20;

// The four shape kinds, in toolbar order.
export const SHAPE_KINDS: ShapeKind[] = ["rect", "ellipse", "line", "pen"];

// Reads a shape kind out of untrusted data (a shared document or
// a stored value). Anything unknown falls back to a rectangle
// instead of crashing the board.
export function asShapeKind(value: unknown): ShapeKind {
  return value === "rect" || value === "ellipse" || value === "line" || value === "pen"
    ? value
    : "rect";
}

// Builds a shape. Pen strokes start with their first point;
// other kinds start with no points.
export function createShape(
  id: string,
  kind: ShapeKind,
  x: number,
  y: number,
  w: number,
  h: number,
  color: NoteColor,
  points: ShapePoint[] = [],
): Shape {
  return { id, kind, x, y, w, h, color, points };
}

// Turns a drag's start and end points into a shape box. Dragging
// in any direction works — dragging up or left moves the origin
// and the size stays positive. The box is never smaller than the
// minimum shape size, so a click without a drag still makes a
// visible shape.
export function normalizeShapeBox(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    w: Math.max(MIN_SHAPE_SIZE, Math.abs(endX - startX)),
    h: Math.max(MIN_SHAPE_SIZE, Math.abs(endY - startY)),
  };
}

// The bounding box around a list of points. Returns null when
// there are no points, so the caller can keep the old box.
export function shapeBoxFromPoints(
  points: ShapePoint[],
): { x: number; y: number; w: number; h: number } | null {
  if (points.length === 0) return null;
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return {
    x: minX,
    y: minY,
    // A stroke drawn as a straight horizontal or vertical line
    // has a zero-size box in one direction; keep at least 1px so
    // the SVG that renders it still has a size.
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
  };
}

// The endpoints of a line shape, in board pixels: the opposite
// corners of its box.
export function lineEndpoints(shape: Shape): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  return { x1: shape.x, y1: shape.y, x2: shape.x + shape.w, y2: shape.y + shape.h };
}

// Turns pen points into an SVG path ("M x y L x y ..."). The
// offsets shift every point, so a path can be drawn inside an SVG
// whose origin is the shape's top-left corner instead of the
// board's origin.
export function penPathFromPoints(
  points: ShapePoint[],
  offsetX = 0,
  offsetY = 0,
): string {
  if (points.length === 0) return "";
  const parts = [`M ${points[0].x - offsetX} ${points[0].y - offsetY}`];
  for (let i = 1; i < points.length; i += 1) {
    parts.push(`L ${points[i].x - offsetX} ${points[i].y - offsetY}`);
  }
  return parts.join(" ");
}

// Pen points are stored flat in the shared document —
// [x1, y1, x2, y2, ...] — because a Y.Array of numbers is the
// simplest thing that grows live while drawing. These two
// helpers convert between that flat form and point objects.
export function flatPoints(points: ShapePoint[]): number[] {
  const flat: number[] = [];
  for (const point of points) {
    flat.push(point.x, point.y);
  }
  return flat;
}

export function pointsFromFlat(values: number[]): ShapePoint[] {
  const points: ShapePoint[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    points.push({ x: values[i], y: values[i + 1] });
  }
  return points;
}

// One free-floating text box on the board. Position and size
// are in board pixels, like a note — but a text box has no
// background, just text in a color, at a named font size. Text
// is plain text here (the live document stores it as a Y.Text
// so two people can type in the same box).
export type TextFontSize = "small" | "medium" | "large";

// The pixel size of each named font size.
export const FONT_SIZE_PX: Record<TextFontSize, number> = {
  small: 14,
  medium: 18,
  large: 24,
} as const;

export const TEXT_FONT_SIZES: TextFontSize[] = ["small", "medium", "large"];

export interface TextBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: TextFontSize;
  color: NoteColor;
  text: string;
}

// The default size for a newly placed text box.
export const DEFAULT_TEXT_SIZE = { w: 240, h: 80 } as const;

// The smallest a text box can be resized to. Smaller than this,
// the text is unreadable and the box is too small to grab.
export const MIN_TEXT_SIZE = { w: 100, h: 40 } as const;

// Reads a font size out of untrusted data. Anything unknown
// falls back to medium instead of crashing the board.
export function asTextFontSize(value: unknown): TextFontSize {
  return value === "small" || value === "medium" || value === "large" ? value : "medium";
}

// Builds a text box. New boxes start empty — the user types
// into them right after placing one.
export function createTextBox(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize: TextFontSize,
  color: NoteColor,
  text = "",
): TextBox {
  return { id, x, y, w, h, fontSize, color, text };
}

// A box, for the geometry helpers below: anything with a
// position and a size — a note, a shape, a text box, or a frame.
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// One named section on the board: a labeled rectangle that holds
// other items. A frame is only a container — it has no behaviour
// of its own. Dragging a frame moves everything whose centre is
// inside it; deleting a frame leaves its contents where they are.
export interface Frame {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: NoteColor;
  title: string;
}

// The default size for a newly drawn frame. Frames hold content,
// so they start big — a 20px frame would hold nothing.
export const DEFAULT_FRAME_SIZE = { w: 480, h: 320 } as const;

// The smallest a frame can be drawn or resized to. Same as a
// shape: smaller than this, a frame is too small to grab.
export const MIN_FRAME_SIZE = 20;

// Builds a frame. New frames start with the title "Frame" —
// the user renames it on the board.
export function createFrame(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: NoteColor,
  title = "Frame",
): Frame {
  return { id, x, y, w, h, color, title };
}

// Whether a box's centre is inside a frame. The centre is what
// counts: an item belongs to a frame when its middle is in it,
// even if its edges stick out — that is how dragging a frame
// decides what moves with it.
export function boxCentreInFrame(frame: Box, box: Box): boolean {
  const centreX = box.x + box.w / 2;
  const centreY = box.y + box.h / 2;
  return (
    centreX >= frame.x &&
    centreX <= frame.x + frame.w &&
    centreY >= frame.y &&
    centreY <= frame.y + frame.h
  );
}

// One connector on the board: an arrow joining two items. The
// endpoints are item ids — a note, shape, text box, or frame.
// The line itself stores no position: its ends are recomputed
// from the two items every render, so it follows them when
// either one moves. Deleting either endpoint deletes the
// connector too.
export interface Connector {
  id: string;
  fromId: string;
  toId: string;
  color: NoteColor;
}

// Builds a connector between two items.
export function createConnector(
  id: string,
  fromId: string,
  toId: string,
  color: NoteColor,
): Connector {
  return { id, fromId, toId, color };
}

// The middle of one edge of a box: top, bottom, left, right.
// A connector attaches to the nearest edge of each item, so the
// line starts and ends on an outline instead of crossing the item.
function edgeCentres(box: Box): Array<{ x: number; y: number }> {
  return [
    { x: box.x + box.w / 2, y: box.y },
    { x: box.x + box.w / 2, y: box.y + box.h },
    { x: box.x, y: box.y + box.h / 2 },
    { x: box.x + box.w, y: box.y + box.h / 2 },
  ];
}

// The two points a connector line runs between: the pair of edge
// centres — one on each item — that are closest together.
export function connectorEndpoints(
  from: Box,
  to: Box,
): { x1: number; y1: number; x2: number; y2: number } {
  const fromPoints = edgeCentres(from);
  const toPoints = edgeCentres(to);
  // The box centres are the fallback, so a connector never
  // disappears because of a zero-size item.
  let best = {
    x1: from.x + from.w / 2,
    y1: from.y + from.h / 2,
    x2: to.x + to.w / 2,
    y2: to.y + to.h / 2,
  };
  let bestDistance = Infinity;
  for (const a of fromPoints) {
    for (const b of toPoints) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      }
    }
  }
  return best;
}

// One comment thread pinned to the board: who wrote it, what
// it says, when it was written (an ISO timestamp), where its pin
// sits in board pixels, and whether it has been resolved. A
// thread holds one comment — there are no replies. Resolved
// threads stay in the panel; only their pins leave the canvas.
export interface Comment {
  id: string;
  x: number;
  y: number;
  author: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

// Builds a comment thread. The timestamp defaults to now, so
// the caller only passes one when it already has it.
export function createComment(
  id: string,
  x: number,
  y: number,
  author: string,
  text: string,
  createdAt: string = new Date().toISOString(),
  resolved = false,
): Comment {
  return { id, x, y, author, text, createdAt, resolved };
}

// The threads newest first, for the comments panel. A fresh
// array, so the caller's order is untouched.
export function sortCommentsNewestFirst(comments: Comment[]): Comment[] {
  return [...comments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// One dot vote on a board item: which item it sits on, and
// who placed it. A vote has its own id, so one person can put
// several dots on the same item — each click is one vote — up
// to the dots the session allows them. The session is the
// voting session the dot was placed in (0 for dots placed
// before sessions were numbered): old dots stay visible on the
// items, but only the current session's dots count toward a
// person's allocation.
export interface Vote {
  id: string;
  itemId: string;
  userId: string;
  userName: string;
  session: number;
}

// Builds a vote. The caller picks the id, so the same vote is
// never built twice with different ids.
export function createVote(
  id: string,
  itemId: string,
  userId: string,
  userName: string,
  session: number,
): Vote {
  return { id, itemId, userId, userName, session };
}

// One dot-voting session on a board: whether it is open, how
// many dots each person gets, and who started it. Ending a
// session closes it but leaves the votes where they are —
// frozen, visible, and clearable. The session number counts
// up from 1 each time a session starts, so a vote knows which
// session it belongs to.
export interface VotingSession {
  active: boolean;
  dotsPerPerson: number;
  startedBy: string;
  startedByName: string;
  session: number;
}

// The dots each person gets when a session starts, unless the
// starter picks another number.
export const DEFAULT_DOTS_PER_PERSON = 3;

// The numbers the starter can pick from.
export const DOTS_PER_PERSON_OPTIONS = [1, 2, 3, 5, 10] as const;

// The dots placed in one session only. The caller passes the
// session number, so old dots — from an earlier session, or
// from before sessions were numbered — never eat into the
// current session's allocation.
export function votesInSession(votes: Vote[], session: number): Vote[] {
  return votes.filter((vote) => vote.session === session);
}

// How many dots one person has placed in this session's votes.
// The caller passes only the current session's votes (see
// votesInSession), so the count is per session, not all time.
export function countUserVotes(votes: Vote[], userId: string): number {
  let count = 0;
  for (const vote of votes) {
    if (vote.userId === userId) count += 1;
  }
  return count;
}

// How many dots sit on one item, from everyone.
export function countItemVotes(votes: Vote[], itemId: string): number {
  let count = 0;
  for (const vote of votes) {
    if (vote.itemId === itemId) count += 1;
  }
  return count;
}

// How many dots one person still has to place. Never below
// zero, so a stale count cannot grant an extra dot.
export function remainingDots(votes: Vote[], userId: string, dotsPerPerson: number): number {
  return Math.max(0, dotsPerPerson - countUserVotes(votes, userId));
}

// Whether one person may place another dot: they still have
// dots left. The caller checks the session is open — this only
// counts dots.
export function canPlaceVote(votes: Vote[], userId: string, dotsPerPerson: number): boolean {
  return remainingDots(votes, userId, dotsPerPerson) > 0;
}

// The default size for a newly created note.
export const DEFAULT_NOTE_SIZE = { w: 200, h: 200 } as const;

// The board everyone lands on first. Its id never changes, so
// old links and saved state keep working when new boards are
// added. It cannot be deleted.
export const DEFAULT_BOARD_ID = "syncboard-demo";
export const DEFAULT_BOARD_NAME = "Main board";

// One board in the board list: its id (also the sync room name),
// its display name, and when it was created (an ISO timestamp).
export interface BoardMeta {
  id: string;
  name: string;
  createdAt: string;
}

// The three starter notes for a brand-new board. The ids are
// fixed, so seeding twice still ends up with exactly one copy
// of each note. The sync server seeds these (Phase 4) — the
// server is the source of truth for whether a board already has
// state, so clients never seed: a board whose notes were all
// deleted must never get its starter notes back.
export const SEED_NOTES: Array<{
  id: string;
  x: number;
  y: number;
  color: NoteColor;
  text: string;
}> = [
  { id: "seed-1", x: 80, y: 120, color: "yellow", text: "Ship Phase 1\nby Friday" },
  { id: "seed-2", x: 380, y: 220, color: "pink", text: "Ask Sara to\nreview the API" },
  { id: "seed-3", x: 700, y: 120, color: "green", text: "Demo on\nMonday 10am" },
];

// One connected user, as shared through the Awareness protocol.
// cursor is null when the pointer is off the board;
// selectedNoteIds lists the notes this user has selected right now,
// selectedShapeIds lists their selected shapes, and
// selectedTextIds lists their selected text boxes.
export interface PresenceUser {
  id: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selectedNoteIds: string[];
  selectedShapeIds: string[];
  selectedTextIds: string[];
}

// A signed-in user, as the auth endpoints return them and the
// board shows them: their id, the name presence shows (their
// username, as they typed it), and their presence color. The
// server picks the color from the username, so the same user
// always gets the same color.
export interface SessionUser {
  id: string;
  name: string;
  color: string;
}

// Environment variable names used across the repo, kept in one
// place so a rename only touches this file.
export const ENV_VARS = {
  // Web app: the websocket URL of the sync server.
  syncUrl: "VITE_SYNC_URL",
  // Sync server: the port it listens on.
  syncPort: "SYNC_PORT",
  // Sync server: the secret used to sign and verify JWTs.
  jwtSecret: "JWT_SECRET",
} as const;
