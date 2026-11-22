import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  NOTE_COLORS,
  asShapeKind,
  createShape,
  flatPoints,
  lineEndpoints,
  normalizeShapeBox,
  penPathFromPoints,
  pointsFromFlat,
  shapeBoxFromPoints,
  shapePolygonPoints,
  type Shape,
} from "@syncboard/shared";
import { appendPenPoint, buildShapeMap, readShape } from "./shapes";

describe("asShapeKind", () => {
  it("accepts the seven known kinds", () => {
    expect(asShapeKind("rect")).toBe("rect");
    expect(asShapeKind("ellipse")).toBe("ellipse");
    expect(asShapeKind("diamond")).toBe("diamond");
    expect(asShapeKind("triangle")).toBe("triangle");
    expect(asShapeKind("star")).toBe("star");
    expect(asShapeKind("line")).toBe("line");
    expect(asShapeKind("pen")).toBe("pen");
  });

  it("falls back to rect for anything unknown", () => {
    expect(asShapeKind("circle")).toBe("rect");
    expect(asShapeKind(undefined)).toBe("rect");
    expect(asShapeKind(42)).toBe("rect");
  });
});

describe("createShape", () => {
  it("builds a rectangle with no points", () => {
    const shape = createShape("s1", "rect", 10, 20, 160, 120, "blue");
    expect(shape).toEqual({
      id: "s1",
      kind: "rect",
      x: 10,
      y: 20,
      w: 160,
      h: 120,
      color: "blue",
      points: [],
    });
  });

  it("keeps the pen points it is given", () => {
    const shape = createShape("s2", "pen", 0, 0, 50, 40, "pink", [
      { x: 0, y: 0 },
      { x: 50, y: 40 },
    ]);
    expect(shape.points).toHaveLength(2);
  });
});

describe("normalizeShapeBox", () => {
  it("keeps a normal drag as-is", () => {
    expect(normalizeShapeBox(10, 20, 110, 90)).toEqual({ x: 10, y: 20, w: 100, h: 70 });
  });

  it("flips the box when dragging up or left", () => {
    expect(normalizeShapeBox(110, 90, 10, 20)).toEqual({ x: 10, y: 20, w: 100, h: 70 });
  });

  it("enforces the minimum size on a click without a drag", () => {
    const box = normalizeShapeBox(50, 50, 50, 50);
    expect(box).toEqual({ x: 50, y: 50, w: 20, h: 20 });
  });
});

describe("shapeBoxFromPoints", () => {
  it("returns null with no points", () => {
    expect(shapeBoxFromPoints([])).toBeNull();
  });

  it("bounds the points", () => {
    expect(
      shapeBoxFromPoints([
        { x: 30, y: 10 },
        { x: 80, y: 60 },
        { x: 50, y: 40 },
      ]),
    ).toEqual({ x: 30, y: 10, w: 50, h: 50 });
  });

  it("keeps at least 1px in each direction for a straight line", () => {
    expect(
      shapeBoxFromPoints([
        { x: 0, y: 5 },
        { x: 100, y: 5 },
      ]),
    ).toEqual({ x: 0, y: 5, w: 100, h: 1 });
  });
});

describe("lineEndpoints", () => {
  it("uses the opposite corners of the box", () => {
    const shape: Shape = {
      id: "l1",
      kind: "line",
      x: 10,
      y: 20,
      w: 100,
      h: 50,
      color: "green",
      points: [],
    };
    expect(lineEndpoints(shape)).toEqual({ x1: 10, y1: 20, x2: 110, y2: 70 });
  });
});

describe("penPathFromPoints", () => {
  it("returns an empty path with no points", () => {
    expect(penPathFromPoints([])).toBe("");
  });

  it("joins points with M then L commands", () => {
    expect(
      penPathFromPoints([
        { x: 10, y: 20 },
        { x: 30, y: 40 },
        { x: 50, y: 20 },
      ]),
    ).toBe("M 10 20 L 30 40 L 50 20");
  });

  it("shifts points by the offsets", () => {
    expect(
      penPathFromPoints(
        [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
        ],
        10,
        20,
      ),
    ).toBe("M 0 0 L 20 20");
  });
});

describe("flatPoints / pointsFromFlat", () => {
  it("round-trips points through the flat form", () => {
    const points = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];
    expect(pointsFromFlat(flatPoints(points))).toEqual(points);
  });

  it("drops a trailing unpaired number", () => {
    expect(pointsFromFlat([1, 2, 3])).toEqual([{ x: 1, y: 2 }]);
  });
});

describe("buildShapeMap / readShape", () => {
  it("round-trips a shape through a Y.Doc", () => {
    const doc = new Y.Doc();
    const shapesMap = doc.getMap<Y.Map<unknown>>("shapes");
    const shape = createShape("s1", "pen", 10, 20, 50, 40, "blue", [
      { x: 10, y: 20 },
      { x: 60, y: 60 },
    ]);
    doc.transact(() => {
      shapesMap.set(shape.id, buildShapeMap(shape));
    });
    const stored = shapesMap.get("s1");
    expect(stored).toBeDefined();
    expect(readShape("s1", stored!)).toEqual(shape);
  });

  it("falls back to defaults for a malformed shape", () => {
    const doc = new Y.Doc();
    const shapeMap = new Y.Map<unknown>();
    shapeMap.set("kind", "hexagon");
    shapeMap.set("x", "not a number");
    doc.transact(() => {
      doc.getMap("shapes").set("bad", shapeMap);
    });
    expect(readShape("bad", shapeMap)).toEqual({
      id: "bad",
      kind: "rect",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      color: "yellow",
      points: [],
    });
  });

  it("grows a pen stroke point by point", () => {
    const doc = new Y.Doc();
    const shapesMap = doc.getMap<Y.Map<unknown>>("shapes");
    const shape = createShape("s1", "pen", 0, 0, 1, 1, "pink", [{ x: 0, y: 0 }]);
    doc.transact(() => {
      shapesMap.set(shape.id, buildShapeMap(shape));
    });
    const stored = shapesMap.get("s1")!;
    doc.transact(() => {
      appendPenPoint(stored, { x: 10, y: 10 });
      appendPenPoint(stored, { x: 20, y: 5 });
    });
    expect(readShape("s1", stored).points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 5 },
    ]);
  });

  it("round-trips the polygon kinds and the newer colors", () => {
    const doc = new Y.Doc();
    const shapesMap = doc.getMap<Y.Map<unknown>>("shapes");
    const kinds = ["diamond", "triangle", "star"] as const;
    const colors = ["teal", "red", "gray"] as const;
    doc.transact(() => {
      kinds.forEach((kind, index) => {
        const shape = createShape(`s${index}`, kind, 10, 20, 160, 120, colors[index]);
        shapesMap.set(shape.id, buildShapeMap(shape));
      });
    });
    kinds.forEach((kind, index) => {
      const read = readShape(`s${index}`, shapesMap.get(`s${index}`)!);
      expect(read.kind).toBe(kind);
      expect(read.color).toBe(colors[index]);
    });
  });
});

describe("NOTE_COLORS", () => {
  it("has the nine note colors", () => {
    expect(Object.keys(NOTE_COLORS)).toEqual([
      "yellow",
      "pink",
      "green",
      "blue",
      "purple",
      "orange",
      "teal",
      "red",
      "gray",
    ]);
  });
});

describe("shapePolygonPoints", () => {
  it("draws a diamond from the middles of the four edges", () => {
    expect(shapePolygonPoints("diamond", 100, 80)).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 40 },
      { x: 50, y: 80 },
      { x: 0, y: 40 },
    ]);
  });

  it("draws a triangle with its apex at the top centre", () => {
    expect(shapePolygonPoints("triangle", 100, 80)).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ]);
  });

  it("draws a ten-point star inside the box, starting at the top", () => {
    const points = shapePolygonPoints("star", 100, 100);
    expect(points).toHaveLength(10);
    expect(points[0].x).toBeCloseTo(50);
    expect(points[0].y).toBeCloseTo(0);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(100);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(100);
    }
  });

  it("keeps the star inside a wide box", () => {
    const points = shapePolygonPoints("star", 200, 60);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(200);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(60);
    }
  });

  it("returns no points for the non-polygon kinds", () => {
    expect(shapePolygonPoints("rect", 100, 80)).toEqual([]);
    expect(shapePolygonPoints("ellipse", 100, 80)).toEqual([]);
    expect(shapePolygonPoints("line", 100, 80)).toEqual([]);
    expect(shapePolygonPoints("pen", 100, 80)).toEqual([]);
  });
});
