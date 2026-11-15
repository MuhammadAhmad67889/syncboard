import { describe, expect, it } from "vitest";
import {
  distanceBetween,
  midpointOf,
  pinchView,
  type PinchStart,
} from "./pinch";

describe("distanceBetween", () => {
  it("is zero for the same point", () => {
    expect(distanceBetween({ x: 10, y: 20 }, { x: 10, y: 20 })).toBe(0);
  });

  it("measures a 3-4-5 triangle", () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("midpointOf", () => {
  it("is halfway between the two fingers", () => {
    expect(
      midpointOf({ x: 100, y: 100 }, { x: 200, y: 300 }),
    ).toEqual({ x: 150, y: 200 });
  });
});

describe("pinchView", () => {
  const start: PinchStart = {
    zoom: 1,
    panX: 0,
    panY: 0,
    midX: 200,
    midY: 150,
    distance: 100,
  };

  it("holds the view when the fingers start on the same spot", () => {
    const zeroDistance: PinchStart = { ...start, distance: 0 };
    expect(pinchView(zeroDistance, { x: 200, y: 150 }, 100, 0.25, 3)).toEqual({
      zoom: 1,
      panX: 0,
      panY: 0,
    });
  });

  it("doubles the zoom when the fingers spread to twice the distance", () => {
    const view = pinchView(start, { x: 200, y: 150 }, 200, 0.25, 3);
    expect(view.zoom).toBe(2);
    // The board point under the midpoint (200, 150) stays put.
    expect(view.panX).toBeCloseTo(-200);
    expect(view.panY).toBeCloseTo(-150);
  });

  it("halves the zoom when the fingers pinch to half the distance", () => {
    const view = pinchView(start, { x: 200, y: 150 }, 50, 0.25, 3);
    expect(view.zoom).toBe(0.5);
    expect(view.panX).toBeCloseTo(100);
    expect(view.panY).toBeCloseTo(75);
  });

  it("clamps the zoom at the maximum", () => {
    const view = pinchView(start, { x: 200, y: 150 }, 1000, 0.25, 3);
    expect(view.zoom).toBe(3);
  });

  it("clamps the zoom at the minimum", () => {
    const view = pinchView(start, { x: 200, y: 150 }, 1, 0.25, 3);
    expect(view.zoom).toBe(0.25);
  });

  it("pans with the fingers when the distance does not change", () => {
    // Both fingers move 40px right and 20px down, same spread:
    // zoom stays 1, and the board follows the midpoint.
    const view = pinchView(start, { x: 240, y: 170 }, 100, 0.25, 3);
    expect(view.zoom).toBe(1);
    expect(view.panX).toBe(40);
    expect(view.panY).toBe(20);
  });

  it("zooms around the midpoint, not the board centre", () => {
    // The pinch starts away from the centre, at (400, 100), with
    // the board already panned. Spreading the fingers doubles the
    // zoom, and the board point under (400, 100) stays there.
    const offset: PinchStart = {
      zoom: 1,
      panX: 50,
      panY: -30,
      midX: 400,
      midY: 100,
      distance: 80,
    };
    const view = pinchView(offset, { x: 400, y: 100 }, 160, 0.25, 3);
    expect(view.zoom).toBe(2);
    expect(view.panX).toBeCloseTo(-300);
    expect(view.panY).toBeCloseTo(-160);
  });
});
