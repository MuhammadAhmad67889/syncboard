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
});
