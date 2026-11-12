import * as Y from "yjs";
import {
  asShapeKind,
  flatPoints,
  pointsFromFlat,
  type NoteColor,
  type Shape,
  type ShapePoint,
} from "@syncboard/shared";

// One shape inside the shared document: a Y.Map whose fields are
// plain values (kind, x, y, w, h, a color name) plus a Y.Array of
// flat numbers for pen points — [x1, y1, x2, y2, ...] — so a
// stroke can grow live while the user draws.
export type ShapeMap = Y.Map<unknown>;

// The stroke/border color for each note color. Note colors are
// pale fills, made for sticky-note backgrounds — a pen stroke or
// a shape border in the same pale hex would be nearly invisible
// on a white board, so shapes get a stronger shade of the same
// color for their outline, and the pale color stays as the fill.
export const SHAPE_STROKE_COLORS: Record<NoteColor, string> = {
  yellow: "#ca8a04",
  pink: "#db2777",
  green: "#16a34a",
  blue: "#2563eb",
  purple: "#7c3aed",
  orange: "#ea580c",
};

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNoteColor(value: unknown): NoteColor {
  return typeof value === "string" &&
    (value === "yellow" ||
      value === "pink" ||
      value === "green" ||
      value === "blue" ||
      value === "purple" ||
      value === "orange")
    ? value
    : "yellow";
}

// Reads one shape out of the shared document into a plain object
// React can render. Unknown or missing fields fall back to
// defaults instead of crashing the board.
export function readShape(id: string, shapeMap: ShapeMap): Shape {
  const pointsValue = shapeMap.get("points");
  const flat: number[] =
    pointsValue instanceof Y.Array
      ? pointsValue
          .toArray()
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      : [];
  return {
    id,
    kind: asShapeKind(shapeMap.get("kind")),
    x: asNumber(shapeMap.get("x"), 0),
    y: asNumber(shapeMap.get("y"), 0),
    w: asNumber(shapeMap.get("w"), 0),
    h: asNumber(shapeMap.get("h"), 0),
    color: asNoteColor(shapeMap.get("color")),
    points: pointsFromFlat(flat),
  };
}

// Builds the Y.Map for a shape, ready to be put into the shared
// "shapes" map. The caller wraps the put in a transact stamped
// with the local origin, so undo can track it.
export function buildShapeMap(shape: Shape): ShapeMap {
  const shapeMap = new Y.Map<unknown>();
  shapeMap.set("kind", shape.kind);
  shapeMap.set("x", shape.x);
  shapeMap.set("y", shape.y);
  shapeMap.set("w", shape.w);
  shapeMap.set("h", shape.h);
  shapeMap.set("color", shape.color);
  const points = new Y.Array<number>();
  points.push(flatPoints(shape.points));
  shapeMap.set("points", points);
  return shapeMap;
}

// Appends one point to a pen stroke's Y.Array, so the stroke
// grows live for everyone watching. The caller wraps this in a
// transact stamped with the local origin.
export function appendPenPoint(shapeMap: ShapeMap, point: ShapePoint): void {
  const points = shapeMap.get("points");
  if (points instanceof Y.Array) {
    points.push([point.x, point.y]);
  }
}
