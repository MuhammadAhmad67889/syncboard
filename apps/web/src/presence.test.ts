import { describe, expect, it } from "vitest";
import type { Frame, PresenceUser, SessionUser } from "@syncboard/shared";
import {
  buildWhosHereRows,
  describePresenceActivity,
  frameAtPoint,
} from "./presence";

function person(overrides: Partial<PresenceUser> = {}): PresenceUser {
  return {
    id: "user-1",
    name: "Sara",
    color: "#2563eb",
    cursor: { x: 100, y: 100 },
    selectedNoteIds: [],
    selectedShapeIds: [],
    selectedTextIds: [],
    ...overrides,
  };
}

function frame(overrides: Partial<Frame> = {}): Frame {
  return {
    id: "frame-1",
    x: 0,
    y: 0,
    w: 480,
    h: 320,
    color: "yellow",
    title: "Sprint planning",
    ...overrides,
  };
}

describe("frameAtPoint", () => {
  it("returns null when the point is in no frame", () => {
    expect(frameAtPoint({ x: 900, y: 900 }, [frame()])).toBeNull();
  });

  it("returns the frame the point sits in", () => {
    expect(frameAtPoint({ x: 100, y: 100 }, [frame()])?.title).toBe("Sprint planning");
  });

  it("counts a point on the edge as inside", () => {
    expect(frameAtPoint({ x: 480, y: 320 }, [frame()])?.title).toBe("Sprint planning");
  });

  it("picks the smallest frame when frames overlap", () => {
    const big = frame({ id: "big", title: "Big" });
    const small = frame({ id: "small", x: 50, y: 50, w: 100, h: 100, title: "Small" });
    expect(frameAtPoint({ x: 100, y: 100 }, [big, small])?.title).toBe("Small");
  });
});

describe("describePresenceActivity", () => {
  it("says selecting a note before anything else", () => {
    const p = person({ selectedNoteIds: ["note-1"], cursor: { x: 100, y: 100 } });
    expect(describePresenceActivity(p, [frame()])).toBe("Selecting a note");
  });

  it("says selecting a shape when only a shape is selected", () => {
    const p = person({ selectedShapeIds: ["shape-1"] });
    expect(describePresenceActivity(p, [])).toBe("Selecting a shape");
  });

  it("says selecting a text box when only a text box is selected", () => {
    const p = person({ selectedTextIds: ["text-1"] });
    expect(describePresenceActivity(p, [])).toBe("Selecting a text box");
  });

  it("names the frame the cursor sits in", () => {
    expect(describePresenceActivity(person(), [frame()])).toBe("In Sprint planning");
  });

  it("says on the board when the cursor is in no frame", () => {
    expect(describePresenceActivity(person(), [])).toBe("On the board");
  });

  it("says nothing when the pointer is off the board", () => {
    const p = person({ cursor: null });
    expect(describePresenceActivity(p, [frame()])).toBeNull();
  });

  it("still reports a selection when the pointer is off the board", () => {
    const p = person({ cursor: null, selectedNoteIds: ["note-1"] });
    expect(describePresenceActivity(p, [])).toBe("Selecting a note");
  });
});

describe("buildWhosHereRows", () => {
  const self: SessionUser = { id: "me", name: "Demo", color: "#16a34a" };

  it("lists the local user first, marked you, with no activity", () => {
    const rows = buildWhosHereRows(self, [], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: "me",
      name: "Demo",
      color: "#16a34a",
      you: true,
      activity: null,
    });
  });

  it("sorts other people by name and describes what they are doing", () => {
    const zoe = person({ id: "zoe", name: "Zoe" });
    const amy = person({ id: "amy", name: "Amy", cursor: null });
    const rows = buildWhosHereRows(self, [zoe, amy], []);
    expect(rows.map((row) => row.name)).toEqual(["Demo", "Amy", "Zoe"]);
    expect(rows[1].activity).toBeNull();
    expect(rows[2].activity).toBe("On the board");
  });

  it("does not change the order of the input list", () => {
    const zoe = person({ id: "zoe", name: "Zoe" });
    const amy = person({ id: "amy", name: "Amy" });
    const others = [zoe, amy];
    buildWhosHereRows(self, others, []);
    expect(others.map((p) => p.name)).toEqual(["Zoe", "Amy"]);
  });
});
