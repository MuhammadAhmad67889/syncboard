import * as Y from "yjs";
import { type Frame, type NoteColor } from "@syncboard/shared";

// One frame inside the shared document: a Y.Map whose fields are
// plain values (x, y, w, h, a color name, a title string).
export type FrameMap = Y.Map<unknown>;

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

function asTitle(value: unknown): string {
  return typeof value === "string" ? value : "Frame";
}

// Reads one frame out of the shared document into a plain object
// React can render. Unknown or missing fields fall back to
// defaults instead of crashing the board.
export function readFrame(id: string, frameMap: FrameMap): Frame {
  return {
    id,
    x: asNumber(frameMap.get("x"), 0),
    y: asNumber(frameMap.get("y"), 0),
    w: asNumber(frameMap.get("w"), 0),
    h: asNumber(frameMap.get("h"), 0),
    color: asNoteColor(frameMap.get("color")),
    title: asTitle(frameMap.get("title")),
  };
}

// Builds the Y.Map for a frame, ready to be put into the shared
// "frames" map. The caller wraps the put in a transact stamped
// with the local origin, so undo can track it.
export function buildFrameMap(frame: Frame): FrameMap {
  const frameMap = new Y.Map<unknown>();
  frameMap.set("x", frame.x);
  frameMap.set("y", frame.y);
  frameMap.set("w", frame.w);
  frameMap.set("h", frame.h);
  frameMap.set("color", frame.color);
  frameMap.set("title", frame.title);
  return frameMap;
}
