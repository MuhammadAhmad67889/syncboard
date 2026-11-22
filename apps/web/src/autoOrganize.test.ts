import { describe, expect, it } from "vitest";
import type { Frame, Note } from "@syncboard/shared";
import {
  boundingBox,
  extractKeywords,
  freeNotes,
  groupFreeNotes,
  planAutoOrganize,
  titleCaseKeyword,
} from "./autoOrganize";
import { boxesOverlap } from "./templates";

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    color: "yellow",
    text: "",
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
    title: "Frame",
    ...overrides,
  };
}

describe("extractKeywords", () => {
  it("lowercases and splits on punctuation", () => {
    expect(extractKeywords("Launch the NEW landing-page!")).toEqual([
      "launch",
      "new",
      "landing",
      "page",
    ]);
  });

  it("drops stop words", () => {
    expect(extractKeywords("Design the settings for our team")).toEqual([
      "design",
      "settings",
      "team",
    ]);
  });

  it("drops words shorter than three letters", () => {
    expect(extractKeywords("API v2 QA go live")).toEqual(["api", "live"]);
  });

  it("dedupes, keeping first-seen order", () => {
    expect(extractKeywords("Launch launch LAUNCH day")).toEqual(["launch", "day"]);
  });

  it("returns nothing for a note made only of stop words", () => {
    expect(extractKeywords("the and to of a")).toEqual([]);
  });
});

describe("titleCaseKeyword", () => {
  it("uppercases the first letter", () => {
    expect(titleCaseKeyword("launch")).toBe("Launch");
  });

  it("leaves an empty keyword alone", () => {
    expect(titleCaseKeyword("")).toBe("");
  });
});

describe("freeNotes", () => {
  it("keeps notes whose centre is outside every frame", () => {
    const inside = note({ id: "in", x: 100, y: 100 });
    const outside = note({ id: "out", x: 1000, y: 1000 });
    const result = freeNotes([inside, outside], [frame({ x: 0, y: 0, w: 480, h: 320 })]);
    expect(result.map((n) => n.id)).toEqual(["out"]);
  });

  it("counts a note as inside when its centre is in the frame, even if its edges stick out", () => {
    const edge = note({ id: "edge", x: 350, y: 200, w: 200, h: 200 });
    const result = freeNotes([edge], [frame({ x: 0, y: 0, w: 480, h: 320 })]);
    expect(result).toEqual([]);
  });
});

describe("groupFreeNotes", () => {
  it("groups notes that share a word", () => {
    const groups = groupFreeNotes([
      note({ id: "a", text: "Launch the landing page" }),
      note({ id: "b", text: "Launch checklist" }),
      note({ id: "c", text: "Design the settings screen" }),
    ]);
    expect(groups).toEqual([{ keyword: "launch", noteIds: ["a", "b"] }]);
  });

  it("leaves a note with no shared word ungrouped", () => {
    const groups = groupFreeNotes([
      note({ id: "a", text: "Launch the landing page" }),
      note({ id: "b", text: "Launch checklist" }),
      note({ id: "c", text: "Quantum banana orbit" }),
    ]);
    expect(groups).toEqual([{ keyword: "launch", noteIds: ["a", "b"] }]);
  });

  it("sends a note to its strongest group", () => {
    // "c" shares "launch" with one note and "design" with two:
    // design is its strongest topic.
    const groups = groupFreeNotes([
      note({ id: "a", text: "Launch the landing page" }),
      note({ id: "b", text: "Design the settings screen" }),
      note({ id: "c", text: "Launch and design review" }),
      note({ id: "d", text: "Design the empty state" }),
    ]);
    expect(groups).toEqual([
      { keyword: "design", noteIds: ["b", "c", "d"] },
    ]);
  });

  it("drops a group that falls below two notes after reassignment", () => {
    // "a" shares "launch" with "b" and "design" with "c" and
    // "d" — it goes to design, so "launch" is left with one
    // note and is not a group at all.
    const groups = groupFreeNotes([
      note({ id: "a", text: "Launch and design review" }),
      note({ id: "b", text: "Launch checklist" }),
      note({ id: "c", text: "Design the settings screen" }),
      note({ id: "d", text: "Design the empty state" }),
    ]);
    expect(groups).toEqual([
      { keyword: "design", noteIds: ["a", "c", "d"] },
    ]);
  });

  it("orders groups biggest first, then alphabetically", () => {
    const groups = groupFreeNotes([
      note({ id: "a", text: "Zebra crossing rules" }),
      note({ id: "b", text: "Zebra safety memo" }),
      note({ id: "c", text: "Apple launch event" }),
      note({ id: "d", text: "Apple design review" }),
      note({ id: "e", text: "Apple pricing draft" }),
    ]);
    expect(groups.map((g) => g.keyword)).toEqual(["apple", "zebra"]);
  });
});

describe("boundingBox", () => {
  it("returns null for an empty board", () => {
    expect(boundingBox([])).toBeNull();
  });

  it("holds every box in the list", () => {
    expect(
      boundingBox([
        { x: 100, y: 50, w: 200, h: 200 },
        { x: 500, y: 300, w: 100, h: 100 },
      ]),
    ).toEqual({ x: 100, y: 50, w: 500, h: 350 });
  });
});

describe("planAutoOrganize", () => {
  const launchNotes = [
    note({ id: "l1", x: 100, y: 100, text: "Launch the landing page" }),
    note({ id: "l2", x: 400, y: 100, text: "Launch checklist" }),
    note({ id: "l3", x: 700, y: 100, text: "Launch email draft" }),
  ];
  const designNotes = [
    note({ id: "d1", x: 100, y: 400, text: "Design the settings screen" }),
    note({ id: "d2", x: 400, y: 400, text: "Design review" }),
  ];
  const loner = note({ id: "loner", x: 700, y: 400, text: "Quantum banana orbit" });

  it("returns null when no two free notes share a word", () => {
    expect(planAutoOrganize([loner], [], [loner])).toBeNull();
  });

  it("returns null when every note is already inside a frame", () => {
    const plan = planAutoOrganize(
      launchNotes,
      [frame({ x: 0, y: 0, w: 1000, h: 320 })],
      launchNotes,
    );
    expect(plan).toBeNull();
  });

  it("creates one labelled frame per group, below the content", () => {
    const all = [...launchNotes, ...designNotes, loner];
    const plan = planAutoOrganize(all, [], all);
    expect(plan).not.toBeNull();
    expect(plan?.frameCount).toBe(2);
    expect(plan?.noteCount).toBe(5);
    expect(plan?.groups.map((g) => g.title)).toEqual(["Launch", "Design"]);
    // The content bottom is 600; the frames start 80 below it.
    for (const group of plan?.groups ?? []) {
      expect(group.frame.y).toBe(680);
    }
    // The frames sit side by side, left to right.
    expect(plan?.groups[0].frame.x).toBe(100);
    expect(plan?.groups[1].frame.x).toBeGreaterThan(plan?.groups[0].frame.x ?? 0);
  });

  it("places every grouped note inside its own frame", () => {
    const all = [...launchNotes, ...designNotes, loner];
    const plan = planAutoOrganize(all, [], all);
    for (const group of plan?.groups ?? []) {
      for (const placement of group.placements) {
        const placedNote = all.find((n) => n.id === placement.noteId);
        expect(placedNote).toBeDefined();
        expect(placement.x).toBeGreaterThanOrEqual(group.frame.x);
        expect(placement.y).toBeGreaterThanOrEqual(group.frame.y);
        expect(placement.x + (placedNote?.w ?? 0)).toBeLessThanOrEqual(
          group.frame.x + group.frame.w,
        );
        expect(placement.y + (placedNote?.h ?? 0)).toBeLessThanOrEqual(
          group.frame.y + group.frame.h,
        );
      }
    }
  });

  it("does not move the loner note", () => {
    const all = [...launchNotes, ...designNotes, loner];
    const plan = planAutoOrganize(all, [], all);
    const placedIds = (plan?.groups ?? []).flatMap((g) =>
      g.placements.map((p) => p.noteId),
    );
    expect(placedIds).not.toContain("loner");
  });

  it("does not move notes already inside a frame", () => {
    const framed = frame({ x: 0, y: 0, w: 1000, h: 300 });
    const plan = planAutoOrganize([...launchNotes, ...designNotes], [framed], [
      ...launchNotes,
      ...designNotes,
      framed,
    ]);
    // The launch notes sit inside the frame; only the design
    // notes are free, and they form the single group.
    expect(plan?.frameCount).toBe(1);
    expect(plan?.groups[0].title).toBe("Design");
    expect(plan?.noteCount).toBe(2);
  });

  it("lays out a clean grid on a messy board: overlapping notes, mixed sizes, existing content", () => {
    // A frame that already holds two notes — they stay put.
    const oldFrame = frame({ id: "old", x: 0, y: 0, w: 480, h: 320 });
    const inFrame = [
      note({ id: "in1", x: 50, y: 80, w: 200, h: 200, text: "Launch retro notes" }),
      note({ id: "in2", x: 280, y: 80, w: 150, h: 150, text: "Design tokens" }),
    ];
    // Free notes piled on top of each other at mixed sizes.
    const messy = [
      note({ id: "l1", x: 600, y: 50, w: 200, h: 200, text: "Launch the landing page" }),
      note({ id: "l2", x: 650, y: 120, w: 320, h: 180, text: "Launch checklist" }),
      note({ id: "l3", x: 620, y: 300, w: 150, h: 300, text: "Launch email draft" }),
      note({ id: "d1", x: 100, y: 500, w: 240, h: 160, text: "Design the settings screen" }),
      note({ id: "d2", x: 200, y: 550, w: 200, h: 200, text: "Design review" }),
      note({ id: "d3", x: 450, y: 520, w: 180, h: 240, text: "Design the empty state" }),
      note({ id: "b1", x: 800, y: 500, w: 200, h: 200, text: "Budget for the venue" }),
      note({ id: "b2", x: 850, y: 560, w: 260, h: 140, text: "Budget spreadsheet" }),
      note({ id: "x1", x: 1100, y: 100, w: 200, h: 200, text: "Quantum banana orbit" }),
      note({ id: "x2", x: 1150, y: 150, w: 200, h: 200, text: "Zebra crossing" }),
    ];
    // Shapes already on the board count as content too.
    const shapeBoxes = [
      { x: 0, y: 900, w: 300, h: 100 },
      { x: 1400, y: 0, w: 120, h: 400 },
    ];
    const allNotes = [...inFrame, ...messy];
    const content = [...allNotes, oldFrame, ...shapeBoxes];
    const plan = planAutoOrganize(allNotes, [oldFrame], content);
    expect(plan).not.toBeNull();
    expect(plan?.frameCount).toBe(3);
    expect(plan?.noteCount).toBe(8);
    expect(plan?.groups.map((g) => g.title)).toEqual(["Design", "Launch", "Budget"]);

    const notesById = new Map(allNotes.map((n) => [n.id, n]));
    const placedBoxes = (plan?.groups ?? []).flatMap((group) =>
      group.placements.map((placement) => {
        const placed = notesById.get(placement.noteId)!;
        return { x: placement.x, y: placement.y, w: placed.w, h: placed.h };
      }),
    );

    // No two moved notes overlap each other after the move,
    // whatever sizes they started at.
    for (let i = 0; i < placedBoxes.length; i += 1) {
      for (let j = i + 1; j < placedBoxes.length; j += 1) {
        expect(boxesOverlap(placedBoxes[i], placedBoxes[j])).toBe(false);
      }
    }

    // Every moved note lands fully inside its own frame.
    for (const group of plan?.groups ?? []) {
      for (const placement of group.placements) {
        const placed = notesById.get(placement.noteId)!;
        expect(placement.x).toBeGreaterThanOrEqual(group.frame.x);
        expect(placement.y).toBeGreaterThanOrEqual(group.frame.y);
        expect(placement.x + placed.w).toBeLessThanOrEqual(group.frame.x + group.frame.w);
        expect(placement.y + placed.h).toBeLessThanOrEqual(group.frame.y + group.frame.h);
      }
    }

    // The new frames do not overlap each other, the old frame,
    // the shapes, or any note that stays where it is.
    const newFrames = (plan?.groups ?? []).map((g) => g.frame);
    const unmoved = [oldFrame, ...shapeBoxes, ...inFrame, messy[8], messy[9]];
    for (let i = 0; i < newFrames.length; i += 1) {
      for (let j = i + 1; j < newFrames.length; j += 1) {
        expect(boxesOverlap(newFrames[i], newFrames[j])).toBe(false);
      }
      for (const box of unmoved) {
        expect(boxesOverlap(newFrames[i], box)).toBe(false);
      }
    }

    // The row of new frames starts below everything that was
    // already on the board (content bottom is 1000).
    for (const newFrame of newFrames) {
      expect(newFrame.y).toBeGreaterThanOrEqual(1000);
    }

    // Notes already framed and loners are not moved.
    const placedIds = (plan?.groups ?? []).flatMap((g) =>
      g.placements.map((p) => p.noteId),
    );
    expect(placedIds).not.toContain("in1");
    expect(placedIds).not.toContain("in2");
    expect(placedIds).not.toContain("x1");
    expect(placedIds).not.toContain("x2");
  });
});
