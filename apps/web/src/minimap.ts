import type { Box } from "@syncboard/shared";

// The minimap is the small overview in the bottom-right of the
// board. It shows frames, notes, and shapes as small rectangles,
// with the current viewport drawn as a rectangle on top. Clicking
// or dragging on it pans the canvas. It only reads board state —
// it never writes to the document.

// The minimap's size on screen, in pixels. Fixed, so the maths
// below always maps the same board area onto the same box.
export const MINIMAP_WIDTH = 180;
export const MINIMAP_HEIGHT = 120;

// The margin around the content, in board pixels. Without it,
// an item sitting at the edge of the content would touch the
// minimap's own edge and read as clipped.
export const MINIMAP_PADDING = 80;

// The smallest an item rectangle draws at, in minimap pixels.
// A far-zoomed-out board can shrink a note below a pixel, and
// a zero-size rectangle is invisible — this keeps every item
// findable on the minimap.
export const MINIMAP_MIN_ITEM_SIZE = 2;

// One rectangle in the minimap, in minimap pixels: its position
// from the minimap's top-left corner, and its size.
export interface MinimapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The smallest box holding every item, grown by the padding on
// every side. Null when there are no items, so the caller can
// fall back to the viewport instead of drawing nothing.
export function contentBounds(items: Box[]): Box | null {
  if (items.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    if (item.x < minX) minX = item.x;
    if (item.y < minY) minY = item.y;
    if (item.x + item.w > maxX) maxX = item.x + item.w;
    if (item.y + item.h > maxY) maxY = item.y + item.h;
  }
  return {
    x: minX - MINIMAP_PADDING,
    y: minY - MINIMAP_PADDING,
    w: maxX - minX + MINIMAP_PADDING * 2,
    h: maxY - minY + MINIMAP_PADDING * 2,
  };
}

// The box the minimap shows: the content bounds, widened to
// include the viewport when the viewport sticks out past the
// content. The viewport rectangle then always fits inside the
// minimap instead of spilling over its edge. With no items,
// the viewport is the whole content — the minimap shows just
// the viewport rectangle.
export function minimapBounds(items: Box[], viewport: Box): Box {
  const content = contentBounds(items);
  if (!content) return { ...viewport };
  return {
    x: Math.min(content.x, viewport.x),
    y: Math.min(content.y, viewport.y),
    w:
      Math.max(content.x + content.w, viewport.x + viewport.w) -
      Math.min(content.x, viewport.x),
    h:
      Math.max(content.y + content.h, viewport.y + viewport.h) -
      Math.min(content.y, viewport.y),
  };
}

// How many minimap pixels one board pixel is: the scale that
// fits the whole bounds box into the minimap. A zero-size
// bounds box has no scale of its own, so it maps one to one.
export function minimapScale(bounds: Box, width: number, height: number): number {
  if (bounds.w <= 0 || bounds.h <= 0) return 1;
  return Math.min(width / bounds.w, height / bounds.h);
}

// The offset that centres the scaled bounds inside the minimap.
// The bounds are usually wider than they are tall (or the other
// way round), so one side has spare space — the offset puts
// that space evenly on both sides instead of pinning the
// content to a corner.
export function minimapOffset(
  bounds: Box,
  scale: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: (width - bounds.w * scale) / 2,
    y: (height - bounds.h * scale) / 2,
  };
}

// A board point mapped onto the minimap.
export function boardToMinimap(
  point: { x: number; y: number },
  bounds: Box,
  scale: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const offset = minimapOffset(bounds, scale, width, height);
  return {
    x: offset.x + (point.x - bounds.x) * scale,
    y: offset.y + (point.y - bounds.y) * scale,
  };
}

// A minimap point mapped back onto the board: the inverse of
// boardToMinimap, so a click on the minimap lands on the board
// point under the pointer.
export function minimapToBoard(
  point: { x: number; y: number },
  bounds: Box,
  scale: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const offset = minimapOffset(bounds, scale, width, height);
  return {
    x: bounds.x + (point.x - offset.x) / scale,
    y: bounds.y + (point.y - offset.y) / scale,
  };
}

// One item drawn on the minimap: its box mapped into minimap
// pixels, never smaller than the minimum size, so a tiny or
// far-away item still shows.
export function itemRect(
  item: Box,
  bounds: Box,
  scale: number,
  width: number,
  height: number,
): MinimapRect {
  const topLeft = boardToMinimap({ x: item.x, y: item.y }, bounds, scale, width, height);
  return {
    x: topLeft.x,
    y: topLeft.y,
    w: Math.max(MINIMAP_MIN_ITEM_SIZE, item.w * scale),
    h: Math.max(MINIMAP_MIN_ITEM_SIZE, item.h * scale),
  };
}

// The viewport rectangle: the visible board area mapped onto
// the minimap, then clamped to the minimap's own edges. The
// clamp matters when the viewport is bigger than the content —
// without it the rectangle would hang off the minimap.
export function viewportRect(
  viewport: Box,
  bounds: Box,
  scale: number,
  width: number,
  height: number,
): MinimapRect {
  const rect = itemRect(viewport, bounds, scale, width, height);
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(width, rect.x + rect.w);
  const bottom = Math.min(height, rect.y + rect.h);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

// The pan that puts a board point at the centre of the visible
// view. The board draws an item at screen position
// pan + zoom * board, so centring a point means solving for the
// pan that puts it at half the viewport size.
export function panToCentreBoardPoint(
  point: { x: number; y: number },
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  return {
    x: viewportWidth / 2 - point.x * zoom,
    y: viewportHeight / 2 - point.y * zoom,
  };
}
