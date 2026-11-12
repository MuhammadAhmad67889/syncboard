import * as Y from "yjs";
import {
  FONT_SIZE_PX,
  NOTE_COLORS,
  asShapeKind,
  asTextFontSize,
  type Note,
  type NoteColor,
  type Shape,
  type TextBox,
} from "@syncboard/shared";
import { buildShapeMap, readShape, SHAPE_STROKE_COLORS } from "./shapes";
import { buildTextMap, readTextBox, TEXT_COLORS } from "./texts";

// ---------------------------------------------------------------------------
// JSON export / import
// ---------------------------------------------------------------------------

// The whole board as a plain JSON object: every note, shape, and
// text box with all of its fields. version lets a future format
// change be detected instead of silently misread.
export interface BoardExport {
  version: 1;
  exportedAt: string;
  boardId: string;
  notes: Note[];
  shapes: Shape[];
  texts: TextBox[];
}

// Serializes a board to a JSON string, ready to download.
export function boardExportToJson(board: BoardExport): string {
  return JSON.stringify(board, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNoteColor(value: unknown): NoteColor {
  return typeof value === "string" && value in NOTE_COLORS ? (value as NoteColor) : "yellow";
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseNote(value: unknown): Note | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    x: asNumber(value.x, 0),
    y: asNumber(value.y, 0),
    w: asNumber(value.w, 200),
    h: asNumber(value.h, 200),
    color: asNoteColor(value.color),
    text: asString(value.text),
  };
}

function parseShape(value: unknown): Shape | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const rawPoints = Array.isArray(value.points) ? value.points : [];
  const points: Shape["points"] = [];
  for (const point of rawPoints) {
    if (isRecord(point)) {
      points.push({ x: asNumber(point.x, 0), y: asNumber(point.y, 0) });
    }
  }
  return {
    id: value.id,
    kind: asShapeKind(value.kind),
    x: asNumber(value.x, 0),
    y: asNumber(value.y, 0),
    w: asNumber(value.w, 0),
    h: asNumber(value.h, 0),
    color: asNoteColor(value.color),
    points,
  };
}

function parseTextBox(value: unknown): TextBox | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    x: asNumber(value.x, 0),
    y: asNumber(value.y, 0),
    w: asNumber(value.w, 240),
    h: asNumber(value.h, 80),
    fontSize: asTextFontSize(value.fontSize),
    color: asNoteColor(value.color),
    text: asString(value.text),
  };
}

// Parses an imported JSON string into a board. Returns null when
// the file is not a SyncBoard export at all (bad JSON, wrong
// version, missing lists) — the caller shows an error instead of
// wiping the board. Individual bad entries are dropped; a bad
// field inside a good entry falls back to a default.
export function parseBoardExport(json: string): BoardExport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== 1) return null;
  if (!Array.isArray(parsed.notes) || !Array.isArray(parsed.shapes) || !Array.isArray(parsed.texts)) {
    return null;
  }
  const notes: Note[] = [];
  for (const entry of parsed.notes) {
    const note = parseNote(entry);
    if (note) notes.push(note);
  }
  const shapes: Shape[] = [];
  for (const entry of parsed.shapes) {
    const shape = parseShape(entry);
    if (shape) shapes.push(shape);
  }
  const texts: TextBox[] = [];
  for (const entry of parsed.texts) {
    const textBox = parseTextBox(entry);
    if (textBox) texts.push(textBox);
  }
  return {
    version: 1,
    exportedAt: asString(parsed.exportedAt, new Date().toISOString()),
    boardId: asString(parsed.boardId, ""),
    notes,
    shapes,
    texts,
  };
}

// Builds the Y.Map for a note, ready to be put into the shared
// "notes" map. Mirrors how the board creates notes live.
export function buildNoteMap(note: Note): Y.Map<unknown> {
  const noteMap = new Y.Map<unknown>();
  noteMap.set("x", note.x);
  noteMap.set("y", note.y);
  noteMap.set("w", note.w);
  noteMap.set("h", note.h);
  noteMap.set("color", note.color);
  noteMap.set("text", new Y.Text(note.text));
  return noteMap;
}

// Replaces the board's content with an imported export, in one
// transaction stamped with the local origin — so the import syncs
// to every other client, and one undo reverts the whole import.
// The caller confirms with the user first: this wipes the board.
export function applyBoardExport(doc: Y.Doc, data: BoardExport, origin: unknown): void {
  doc.transact(() => {
    const notesMap = doc.getMap<Y.Map<unknown>>("notes");
    const shapesMap = doc.getMap<Y.Map<unknown>>("shapes");
    const textsMap = doc.getMap<Y.Map<unknown>>("texts");
    notesMap.clear();
    shapesMap.clear();
    textsMap.clear();
    for (const note of data.notes) {
      notesMap.set(note.id, buildNoteMap(note));
    }
    for (const shape of data.shapes) {
      shapesMap.set(shape.id, buildShapeMap(shape));
    }
    for (const textBox of data.texts) {
      textsMap.set(textBox.id, buildTextMap(textBox));
    }
  }, origin);
}

// Reads the whole board out of a live document into an export.
// Used by the round-trip test; the app itself exports from its
// React state, which already holds the same plain objects.
export function exportDocToBoard(doc: Y.Doc, boardId: string): BoardExport {
  const notes: Note[] = [];
  const notesMap = doc.getMap<Y.Map<unknown>>("notes");
  notesMap.forEach((noteMap, id) => {
    const text = noteMap.get("text");
    notes.push({
      id,
      x: asNumber(noteMap.get("x"), 0),
      y: asNumber(noteMap.get("y"), 0),
      w: asNumber(noteMap.get("w"), 200),
      h: asNumber(noteMap.get("h"), 200),
      color: asNoteColor(noteMap.get("color")),
      text: text instanceof Y.Text ? text.toString() : "",
    });
  });
  const shapes: Shape[] = [];
  doc.getMap<Y.Map<unknown>>("shapes").forEach((shapeMap, id) => {
    shapes.push(readShape(id, shapeMap));
  });
  const texts: TextBox[] = [];
  doc.getMap<Y.Map<unknown>>("texts").forEach((textMap, id) => {
    texts.push(readTextBox(id, textMap));
  });
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    boardId,
    notes,
    shapes,
    texts,
  };
}

// ---------------------------------------------------------------------------
// PNG export (rendered from document state onto a canvas)
// ---------------------------------------------------------------------------

// The PNG is drawn from the board state, not from the DOM: the
// DOM route (html2canvas and friends) cannot see textarea
// contents reliably, trips over the transformed canvas layer and
// SVG arrow markers, and renders differently per browser. Drawing
// from state always matches what is synced, and the same code
// draws every item type the board can hold.
const EXPORT_PADDING = 40;
const EXPORT_MAX_SIZE = 2000;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function contentBounds(notes: Note[], shapes: Shape[], texts: TextBox[]): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  function include(box: Box): void {
    if (box.x < minX) minX = box.x;
    if (box.y < minY) minY = box.y;
    if (box.x + box.w > maxX) maxX = box.x + box.w;
    if (box.y + box.h > maxY) maxY = box.y + box.h;
  }
  for (const note of notes) include(note);
  for (const shape of shapes) include(shape);
  for (const textBox of texts) include(textBox);
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Wraps text to fit a width, keeping explicit line breaks. Each
// returned line fits within maxWidth at the canvas's current font.
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ").filter((word) => word.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const next = `${line} ${words[i]}`;
      if (ctx.measureText(next).width <= maxWidth) {
        line = next;
      } else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawNote(ctx: CanvasRenderingContext2D, note: Note, offsetX: number, offsetY: number): void {
  const x = note.x - offsetX;
  const y = note.y - offsetY;
  drawRoundRect(ctx, x, y, note.w, note.h, 8);
  ctx.fillStyle = NOTE_COLORS[note.color];
  ctx.fill();
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillStyle = "#0f172a";
  ctx.textBaseline = "top";
  const lines = wrapText(ctx, note.text, note.w - 24);
  let lineY = y + 36;
  for (const line of lines) {
    ctx.fillText(line, x + 12, lineY);
    lineY += 22;
  }
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 10;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - 0.4), y2 - size * Math.sin(angle - 0.4));
  ctx.lineTo(x2 - size * Math.cos(angle + 0.4), y2 - size * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, offsetX: number, offsetY: number): void {
  const x = shape.x - offsetX;
  const y = shape.y - offsetY;
  const stroke = SHAPE_STROKE_COLORS[shape.color];
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  if (shape.kind === "rect") {
    drawRoundRect(ctx, x, y, shape.w, shape.h, 8);
    ctx.fillStyle = NOTE_COLORS[shape.color];
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
    return;
  }
  if (shape.kind === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(x + shape.w / 2, y + shape.h / 2, shape.w / 2, shape.h / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = NOTE_COLORS[shape.color];
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
    return;
  }
  if (shape.kind === "line") {
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 2);
    ctx.lineTo(x + shape.w - 2, y + shape.h - 2);
    ctx.lineWidth = 3;
    ctx.stroke();
    drawArrowHead(ctx, x + 2, y + 2, x + shape.w - 2, y + shape.h - 2);
    return;
  }
  // Pen: a polyline through the stored points.
  if (shape.points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(shape.points[0].x - offsetX, shape.points[0].y - offsetY);
  for (let i = 1; i < shape.points.length; i += 1) {
    ctx.lineTo(shape.points[i].x - offsetX, shape.points[i].y - offsetY);
  }
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function drawTextBox(
  ctx: CanvasRenderingContext2D,
  textBox: TextBox,
  offsetX: number,
  offsetY: number,
): void {
  const x = textBox.x - offsetX;
  const y = textBox.y - offsetY;
  const size = FONT_SIZE_PX[textBox.fontSize];
  ctx.font = `${size}px system-ui, sans-serif`;
  ctx.fillStyle = TEXT_COLORS[textBox.color];
  ctx.textBaseline = "top";
  const lines = wrapText(ctx, textBox.text, textBox.w);
  let lineY = y;
  for (const line of lines) {
    ctx.fillText(line, x, lineY);
    lineY += Math.round(size * 1.4);
  }
}

// Renders the board onto a canvas, sized to fit the content with
// a margin. The canvas is returned, not downloaded — the caller
// turns it into a PNG blob and triggers the download.
export function renderBoardToCanvas(
  notes: Note[],
  shapes: Shape[],
  texts: TextBox[],
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const bounds = contentBounds(notes, shapes, texts);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  if (!bounds) {
    // An empty board still exports: a plain canvas that says so,
    // instead of a 0x0 image no viewer can open.
    canvas.width = 800;
    canvas.height = 600;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.textBaseline = "middle";
    ctx.fillText("SyncBoard — empty board", 40, 300);
    return canvas;
  }
  const contentW = bounds.w + EXPORT_PADDING * 2;
  const contentH = bounds.h + EXPORT_PADDING * 2;
  const scale = Math.min(2, EXPORT_MAX_SIZE / contentW, EXPORT_MAX_SIZE / contentH);
  canvas.width = Math.max(1, Math.round(contentW * scale));
  canvas.height = Math.max(1, Math.round(contentH * scale));
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, contentW, contentH);
  const offsetX = bounds.x - EXPORT_PADDING;
  const offsetY = bounds.y - EXPORT_PADDING;
  for (const shape of shapes) drawShape(ctx, shape, offsetX, offsetY);
  for (const note of notes) drawNote(ctx, note, offsetX, offsetY);
  for (const textBox of texts) drawTextBox(ctx, textBox, offsetX, offsetY);
  return canvas;
}

// Downloads a blob as a file in the browser.
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
