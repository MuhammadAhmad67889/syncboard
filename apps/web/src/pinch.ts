import type { ShapePoint } from "@syncboard/shared";

// Pinch-to-zoom on the board: two fingers spread to zoom in,
// pinch to zoom out, and move together to pan. This module only
// holds the geometry — the board in App.tsx tracks the fingers
// and calls into here. It never touches the document.

// The pinch state at the moment the second finger lands.
export interface PinchStart {
  zoom: number;
  panX: number;
  panY: number;
  midX: number;
  midY: number;
  distance: number;
}

// The view a pinch should show: the zoom and the pan.
export interface PinchView {
  zoom: number;
  panX: number;
  panY: number;
}

// The straight-line distance between two fingers, in screen pixels.
export function distanceBetween(a: ShapePoint, b: ShapePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// The point halfway between two fingers, in screen pixels.
export function midpointOf(a: ShapePoint, b: ShapePoint): ShapePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// The view for a pinch in progress. The zoom follows the change
// in finger distance, clamped to the board's zoom limits, and the
// pan moves so the board point under the starting midpoint stays
// under the current midpoint — so a pinch zooms around the
// fingers, and moving both fingers together pans the board.
export function pinchView(
  start: PinchStart,
  currentMid: ShapePoint,
  currentDistance: number,
  minZoom: number,
  maxZoom: number,
): PinchView {
  // Two fingers on the same spot have no distance to measure
  // from, so there is nothing to zoom by — hold the view.
  if (start.distance <= 0 || currentDistance <= 0) {
    return { zoom: start.zoom, panX: start.panX, panY: start.panY };
  }
  const zoom = Math.min(
    maxZoom,
    Math.max(minZoom, start.zoom * (currentDistance / start.distance)),
  );
  // The board point under the starting midpoint, in board pixels.
  const boardX = (start.midX - start.panX) / start.zoom;
  const boardY = (start.midY - start.panY) / start.zoom;
  // Put that same board point under the current midpoint.
  return {
    zoom,
    panX: currentMid.x - boardX * zoom,
    panY: currentMid.y - boardY * zoom,
  };
}
