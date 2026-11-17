import { describe, expect, it } from "vitest";
import type { Frame, PresenceUser } from "@syncboard/shared";
import {
  findPresenter,
  fitFrameView,
  interpolateView,
  sortFramesForPresentation,
  stepSlideIndex,
} from "./present";

function frame(overrides: Partial<Frame> = {}): Frame {
  return {
    id: "frame-1",
    x: 0,
    y: 0,
    w: 480,
    h: 320,
    color: "yellow",
    title: "Frame",
    ...overrides,
  };
}

function person(overrides: Partial<PresenceUser> = {}): PresenceUser {
  return {
    id: "user-1",
    name: "Sara",
    color: "#2563eb",
    cursor: null,
    selectedNoteIds: [],
    selectedShapeIds: [],
    selectedTextIds: [],
    presentingFrameId: null,
    ...overrides,
  };
}

describe("sortFramesForPresentation", () => {
  it("orders top-to-bottom, then left-to-right", () => {
    const bottomLeft = frame({ id: "bottom-left", x: 0, y: 500 });
    const topRight = frame({ id: "top-right", x: 600, y: 0 });
    const topLeft = frame({ id: "top-left", x: 0, y: 0 });
    const sorted = sortFramesForPresentation([bottomLeft, topRight, topLeft]);
    expect(sorted.map((f) => f.id)).toEqual(["top-left", "top-right", "bottom-left"]);
  });

  it("keeps creation order when two frames tie on both coordinates", () => {
    const first = frame({ id: "first", x: 100, y: 100 });
    const second = frame({ id: "second", x: 100, y: 100 });
    const sorted = sortFramesForPresentation([second, first]);
    expect(sorted.map((f) => f.id)).toEqual(["second", "first"]);
  });

  it("does not change the input order", () => {
    const a = frame({ id: "a", x: 0, y: 500 });
    const b = frame({ id: "b", x: 0, y: 0 });
    const input = [a, b];
    sortFramesForPresentation(input);
    expect(input.map((f) => f.id)).toEqual(["a", "b"]);
  });
});

describe("fitFrameView", () => {
  it("centres the frame and fits it with a margin", () => {
    const view = fitFrameView(frame({ x: 100, y: 100, w: 400, h: 300 }), 1280, 800, 0.25, 3);
    expect(view).not.toBeNull();
    // The limiting side is the height: (800 - 96) / 300 = 2.3467.
    expect(view?.zoom).toBeCloseTo(2.3467, 2);
    // The frame centre (300, 250) lands at the viewport centre.
    expect(view?.pan.x).toBeCloseTo(640 - 300 * 2.3467, 0);
    expect(view?.pan.y).toBeCloseTo(400 - 250 * 2.3467, 0);
  });

  it("clamps the zoom to the app range for a huge frame", () => {
    const view = fitFrameView(frame({ x: 0, y: 0, w: 10000, h: 8000 }), 1280, 800, 0.25, 3);
    expect(view?.zoom).toBe(0.25);
  });

  it("clamps the zoom to the app range for a tiny frame", () => {
    const view = fitFrameView(frame({ x: 0, y: 0, w: 20, h: 20 }), 1280, 800, 0.25, 3);
    expect(view?.zoom).toBe(3);
  });

  it("returns null for a zero-size frame or a zero-size viewport", () => {
    expect(fitFrameView(frame({ w: 0 }), 1280, 800, 0.25, 3)).toBeNull();
    expect(fitFrameView(frame(), 0, 800, 0.25, 3)).toBeNull();
  });
});

describe("stepSlideIndex", () => {
  it("steps forward and back inside the list", () => {
    expect(stepSlideIndex(1, 1, 5)).toBe(2);
    expect(stepSlideIndex(1, -1, 5)).toBe(0);
  });

  it("stays put at the ends instead of wrapping", () => {
    expect(stepSlideIndex(4, 1, 5)).toBe(4);
    expect(stepSlideIndex(0, -1, 5)).toBe(0);
  });

  it("returns 0 when there are no slides", () => {
    expect(stepSlideIndex(0, 1, 0)).toBe(0);
  });
});

describe("findPresenter", () => {
  it("returns null when nobody is presenting", () => {
    expect(findPresenter([person(), person({ id: "user-2", name: "Ali" })])).toBeNull();
  });

  it("returns the person broadcasting a frame", () => {
    const presenting = person({ id: "user-2", name: "Ali", presentingFrameId: "frame-9" });
    expect(findPresenter([person(), presenting])).toBe(presenting);
  });

  it("picks the first presenter when two present at once", () => {
    const first = person({ id: "user-2", name: "Ali", presentingFrameId: "frame-1" });
    const second = person({ id: "user-3", name: "Zoe", presentingFrameId: "frame-2" });
    expect(findPresenter([first, second])).toBe(first);
  });
});

describe("interpolateView", () => {
  const from = { zoom: 1, pan: { x: 0, y: 0 } };
  const to = { zoom: 2, pan: { x: 100, y: 50 } };

  it("returns the start view at t=0 and the end view at t=1", () => {
    expect(interpolateView(from, to, 0)).toEqual(from);
    expect(interpolateView(from, to, 1)).toEqual(to);
  });

  it("eases, so the midpoint is past halfway", () => {
    const mid = interpolateView(from, to, 0.5);
    expect(mid.zoom).toBeGreaterThan(1.5);
    expect(mid.pan.x).toBeGreaterThan(50);
  });

  it("clamps t outside 0..1", () => {
    expect(interpolateView(from, to, -1)).toEqual(from);
    expect(interpolateView(from, to, 2)).toEqual(to);
  });
});
