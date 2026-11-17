import type { Frame, PresenceUser } from "@syncboard/shared";
import { panToCentreBoardPoint } from "./minimap";

// Present mode turns the board's frames into slides. This file
// holds the pure logic — ordering, camera maths, and the
// presenter lookup — so App.tsx stays a thin wiring layer and
// the rules are testable without a board.

// Slide order: top-to-bottom, then left-to-right, by the frame
// coordinates in the shared document. The input must already be
// in creation order — snapshotFrames reads the frames Y.Map in
// insertion order — and Array.sort is stable, so frames that tie
// on both coordinates keep creation order. A fresh array comes
// back, so the caller's order is untouched.
export function sortFramesForPresentation(frames: Frame[]): Frame[] {
  return [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
}

// One camera view: the zoom and pan the board renders with.
export interface CameraView {
  zoom: number;
  pan: { x: number; y: number };
}

// The margin kept around a frame when it fills the view, in
// screen pixels — the frame never touches the viewport edge.
export const PRESENT_FRAME_MARGIN_PX = 48;

// The camera that fits a frame in the viewport: the biggest zoom
// that still shows the whole frame with its margin, clamped to
// the app's zoom range, panned so the frame's centre is the
// view's centre. Null when the frame has no size to fit — a
// zero-size frame cannot be a slide.
export function fitFrameView(
  frame: Frame,
  viewportWidth: number,
  viewportHeight: number,
  minZoom: number,
  maxZoom: number,
): CameraView | null {
  if (frame.w <= 0 || frame.h <= 0) return null;
  if (viewportWidth <= 0 || viewportHeight <= 0) return null;
  const zoom = Math.min(
    Math.max(
      Math.min(
        (viewportWidth - PRESENT_FRAME_MARGIN_PX * 2) / frame.w,
        (viewportHeight - PRESENT_FRAME_MARGIN_PX * 2) / frame.h,
      ),
      minZoom,
    ),
    maxZoom,
  );
  return {
    zoom,
    pan: panToCentreBoardPoint(
      { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 },
      zoom,
      viewportWidth,
      viewportHeight,
    ),
  };
}

// The next slide index after stepping forward or back, clamped
// to the list — staying put at the ends instead of wrapping, so
// the presenter never jumps from the last slide back to the
// first by accident.
export function stepSlideIndex(current: number, step: 1 | -1, slideCount: number): number {
  if (slideCount <= 0) return 0;
  return Math.min(Math.max(current + step, 0), slideCount - 1);
}

// Who is presenting, if anyone: the first person broadcasting a
// frame. Presence arrives sorted by name, so two presenters at
// once still pick the same one on every viewer — everyone
// follows the same person.
export function findPresenter(others: PresenceUser[]): PresenceUser | null {
  for (const person of others) {
    if (person.presentingFrameId) return person;
  }
  return null;
}

// The camera view partway between two views: t runs 0 (start) to
// 1 (end), eased so the move starts fast and settles gently.
// Pure, so the animation loop in App.tsx stays thin — it just
// feeds t from requestAnimationFrame and applies the result.
export function interpolateView(from: CameraView, to: CameraView, t: number): CameraView {
  const clamped = Math.min(Math.max(t, 0), 1);
  const eased = 1 - Math.pow(1 - clamped, 3);
  return {
    zoom: from.zoom + (to.zoom - from.zoom) * eased,
    pan: {
      x: from.pan.x + (to.pan.x - from.pan.x) * eased,
      y: from.pan.y + (to.pan.y - from.pan.y) * eased,
    },
  };
}
