import { describe, expect, it } from "vitest";
import {
  MINIMAP_HEIGHT,
  MINIMAP_WIDTH,
  boardToMinimap,
  contentBounds,
  itemRect,
  minimapBounds,
  minimapScale,
  minimapToBoard,
  panToCentreBoardPoint,
  viewportRect,
} from "./minimap";

const items = [
  { x: 80, y: 120, w: 200, h: 200 },
  { x: 380, y: 220, w: 200, h: 200 },
  { x: 700, y: 120, w: 160, h: 120 },
];

describe("contentBounds", () => {
  it("returns null with no items", () => {
    expect(contentBounds([])).toBeNull();
  });

  it("bounds every item, grown by the padding", () => {
    // Items span x 80–860 and y 120–420; the padding is 80.
    expect(contentBounds(items)).toEqual({ x: 0, y: 40, w: 940, h: 460 });
  });

  it("bounds a single item", () => {
    expect(contentBounds([{ x: 10, y: 20, w: 30, h: 40 }])).toEqual({
      x: -70,
      y: -60,
      w: 190,
      h: 200,
    });
  });
});

describe("minimapBounds", () => {
  it("is the viewport itself on an empty board", () => {
    const viewport = { x: 0, y: 0, w: 800, h: 600 };
    expect(minimapBounds([], viewport)).toEqual(viewport);
  });

  it("is the content bounds when the viewport fits inside them", () => {
    const viewport = { x: 100, y: 100, w: 400, h: 300 };
    expect(minimapBounds(items, viewport)).toEqual({ x: 0, y: 40, w: 940, h: 460 });
  });

  it("grows to include a viewport larger than the content", () => {
    // A viewport from -500 to 1500 in both directions swallows
    // the content bounds (0–940 by 40–500).
    const viewport = { x: -500, y: -500, w: 2000, h: 2000 };
    expect(minimapBounds(items, viewport)).toEqual({ x: -500, y: -500, w: 2000, h: 2000 });
  });

  it("grows on one side when the viewport only sticks out there", () => {
    // The viewport starts left of the content but ends inside it.
    const viewport = { x: -200, y: 100, w: 400, h: 300 };
    expect(minimapBounds(items, viewport)).toEqual({ x: -200, y: 40, w: 1140, h: 460 });
  });
});

describe("minimapScale", () => {
  it("fits the wider side exactly", () => {
    // 940 wide against a 180px minimap: the width binds.
    expect(minimapScale({ x: 0, y: 40, w: 940, h: 460 }, MINIMAP_WIDTH, MINIMAP_HEIGHT)).toBeCloseTo(
      180 / 940,
      10,
    );
  });

  it("fits the taller side exactly when height binds", () => {
    expect(minimapScale({ x: 0, y: 0, w: 100, h: 1000 }, MINIMAP_WIDTH, MINIMAP_HEIGHT)).toBeCloseTo(
      120 / 1000,
      10,
    );
  });

  it("maps one to one for a zero-size bounds box", () => {
    expect(minimapScale({ x: 0, y: 0, w: 0, h: 0 }, MINIMAP_WIDTH, MINIMAP_HEIGHT)).toBe(1);
  });
});

describe("boardToMinimap / minimapToBoard", () => {
  it("maps the bounds corners to the minimap corners", () => {
    // A square 400x400 bounds box in a 180x120 minimap: the
    // height binds (scale 0.3), so the box is 120 wide and
    // centred with 30px spare on each side.
    const bounds = { x: 0, y: 0, w: 400, h: 400 };
    const scale = minimapScale(bounds, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    expect(scale).toBeCloseTo(0.3, 10);
    expect(boardToMinimap({ x: 0, y: 0 }, bounds, scale, MINIMAP_WIDTH, MINIMAP_HEIGHT)).toEqual({
      x: 30,
      y: 0,
    });
    expect(
      boardToMinimap({ x: 400, y: 400 }, bounds, scale, MINIMAP_WIDTH, MINIMAP_HEIGHT),
    ).toEqual({ x: 150, y: 120 });
  });

  it("round-trips a point through the minimap and back", () => {
    const bounds = { x: 0, y: 40, w: 940, h: 460 };
    const scale = minimapScale(bounds, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    const point = { x: 380, y: 220 };
    const mapped = boardToMinimap(point, bounds, scale, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    const back = minimapToBoard(mapped, bounds, scale, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    expect(back.x).toBeCloseTo(point.x, 10);
    expect(back.y).toBeCloseTo(point.y, 10);
  });
});

describe("itemRect", () => {
  it("maps an item into minimap pixels", () => {
    const bounds = { x: 0, y: 40, w: 940, h: 460 };
    const scale = minimapScale(bounds, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    const rect = itemRect(items[0], bounds, scale, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    expect(rect.x).toBeCloseTo((80 * 180) / 940, 10);
    expect(rect.w).toBeCloseTo((200 * 180) / 940, 10);
  });

  it("never draws an item smaller than 2px", () => {
    // A 1px item at a tiny scale would vanish without the floor.
    const bounds = { x: 0, y: 0, w: 10000, h: 10000 };
    const scale = minimapScale(bounds, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    const rect = itemRect({ x: 0, y: 0, w: 1, h: 1 }, bounds, scale, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    expect(rect.w).toBe(2);
    expect(rect.h).toBe(2);
  });
});

describe("viewportRect", () => {
  it("maps the visible area onto the minimap", () => {
    const bounds = { x: 0, y: 40, w: 940, h: 460 };
    const scale = minimapScale(bounds, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    const rect = viewportRect(
      { x: 0, y: 0, w: 800, h: 600 },
      bounds,
      scale,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
    );
    // The viewport starts at the bounds' left edge, so its
    // rectangle starts at the minimap's left edge too. It is
    // narrower than the bounds (800 of 940 board pixels), so it
    // covers most of the width; it is taller than the bounds,
    // so its height clamps to the minimap.
    expect(rect.x).toBe(0);
    expect(rect.w).toBeCloseTo((800 * 180) / 940, 10);
    expect(rect.h).toBeLessThanOrEqual(MINIMAP_HEIGHT);
    expect(rect.y + rect.h).toBeCloseTo(MINIMAP_HEIGHT, 10);
  });

  it("fills the minimap on an empty board", () => {
    // No items: the bounds are the viewport itself, so the
    // viewport rectangle is the whole bounds box — 160x120,
    // centred in the 180px-wide minimap.
    const viewport = { x: 0, y: 0, w: 800, h: 600 };
    const bounds = minimapBounds([], viewport);
    const scale = minimapScale(bounds, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    const rect = viewportRect(viewport, bounds, scale, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    expect(rect).toEqual({ x: 10, y: 0, w: 160, h: MINIMAP_HEIGHT });
  });

  it("moves when the view pans", () => {
    const bounds = { x: 0, y: 40, w: 940, h: 460 };
    const scale = minimapScale(bounds, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    const before = viewportRect(
      { x: 0, y: 0, w: 400, h: 300 },
      bounds,
      scale,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
    );
    const after = viewportRect(
      { x: 200, y: 100, w: 400, h: 300 },
      bounds,
      scale,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
    );
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
    expect(after.w).toBeCloseTo(before.w, 10);
    expect(after.h).toBeCloseTo(before.h, 10);
  });
});

describe("panToCentreBoardPoint", () => {
  it("centres the clicked point in the view", () => {
    // A 800x600 view at 100% zoom: the point (400, 300) is
    // already centred, so the pan is zero.
    expect(panToCentreBoardPoint({ x: 400, y: 300 }, 1, 800, 600)).toEqual({ x: 0, y: 0 });
  });

  it("shifts the pan so the point lands in the middle", () => {
    // The point (100, 50) at 100% zoom needs the board shifted
    // right and down to bring it to the centre.
    expect(panToCentreBoardPoint({ x: 100, y: 50 }, 1, 800, 600)).toEqual({ x: 300, y: 250 });
  });

  it("accounts for the zoom", () => {
    // At 200% zoom a board point sits twice as far from the
    // origin on screen, so the pan doubles too.
    expect(panToCentreBoardPoint({ x: 100, y: 50 }, 2, 800, 600)).toEqual({ x: 200, y: 200 });
  });
});

describe("click-to-pan end to end", () => {
  it("clicking the minimap centre pans the canvas to the board centre", () => {
    const bounds = minimapBounds(items, { x: 0, y: 0, w: 800, h: 600 });
    const scale = minimapScale(bounds, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    // The middle of the minimap maps back to the middle of the
    // bounds box, and centring on it puts the view there.
    const boardPoint = minimapToBoard(
      { x: MINIMAP_WIDTH / 2, y: MINIMAP_HEIGHT / 2 },
      bounds,
      scale,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
    );
    expect(boardPoint.x).toBeCloseTo(bounds.x + bounds.w / 2, 10);
    expect(boardPoint.y).toBeCloseTo(bounds.y + bounds.h / 2, 10);
    const pan = panToCentreBoardPoint(boardPoint, 1, 800, 600);
    // Panning to the board centre means the board centre is at
    // the middle of the screen: pan + point = half the view.
    expect(pan.x + boardPoint.x).toBeCloseTo(400, 10);
    expect(pan.y + boardPoint.y).toBeCloseTo(300, 10);
  });
});
