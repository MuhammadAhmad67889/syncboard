import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  boxCentreInFrame,
  createFrame,
  type Frame,
} from "@syncboard/shared";
import { buildFrameMap, readFrame } from "./frames";

describe("createFrame", () => {
  it("builds a frame with the title it is given", () => {
    const frame = createFrame("f1", 100, 80, 480, 320, "blue", "Sprint planning");
    expect(frame).toEqual({
      id: "f1",
      x: 100,
      y: 80,
      w: 480,
      h: 320,
      color: "blue",
      title: "Sprint planning",
    });
  });

  it("defaults the title to Frame", () => {
    expect(createFrame("f1", 0, 0, 200, 200, "green").title).toBe("Frame");
  });
});

describe("boxCentreInFrame", () => {
  const frame: Frame = { id: "f1", x: 100, y: 100, w: 400, h: 300, color: "blue", title: "F" };

  it("counts an item whose centre is inside", () => {
    expect(boxCentreInFrame(frame, { x: 150, y: 150, w: 200, h: 200 })).toBe(true);
  });

  it("counts an item whose centre is inside even when its edges stick out", () => {
    expect(boxCentreInFrame(frame, { x: 50, y: 50, w: 200, h: 200 })).toBe(true);
  });

  it("does not count an item whose centre is outside", () => {
    expect(boxCentreInFrame(frame, { x: 600, y: 150, w: 200, h: 200 })).toBe(false);
  });

  it("counts a centre exactly on the edge", () => {
    expect(boxCentreInFrame(frame, { x: 0, y: 150, w: 200, h: 200 })).toBe(true);
  });
});

describe("buildFrameMap / readFrame", () => {
  it("round-trips a frame through a Y.Doc", () => {
    const doc = new Y.Doc();
    const framesMap = doc.getMap<Y.Map<unknown>>("frames");
    const frame = createFrame("f1", 100, 80, 480, 320, "blue", "Sprint planning");
    doc.transact(() => {
      framesMap.set(frame.id, buildFrameMap(frame));
    });
    const stored = framesMap.get("f1");
    expect(stored).toBeDefined();
    expect(readFrame("f1", stored!)).toEqual(frame);
  });

  it("falls back to defaults for a malformed frame", () => {
    const doc = new Y.Doc();
    const frameMap = new Y.Map<unknown>();
    frameMap.set("x", "not a number");
    frameMap.set("color", "not-a-color");
    doc.transact(() => {
      doc.getMap("frames").set("bad", frameMap);
    });
    expect(readFrame("bad", frameMap)).toEqual({
      id: "bad",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      color: "yellow",
      title: "Frame",
    });
  });
});
