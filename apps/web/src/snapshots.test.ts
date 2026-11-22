import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { applyBoardExport, exportDocToBoard, type BoardExport } from "./export";
import {
  defaultSnapshotName,
  formatSnapshotTime,
  snapshotCountsLabel,
  sortSnapshotsNewestFirst,
  type BoardSnapshotMeta,
  type SnapshotCounts,
} from "./snapshots";

function counts(partial: Partial<SnapshotCounts>): SnapshotCounts {
  return { notes: 0, shapes: 0, texts: 0, frames: 0, connectors: 0, images: 0, voiceNotes: 0, ...partial };
}

function meta(id: string, createdAt: string): BoardSnapshotMeta {
  return { id, boardId: "board-x", name: id, createdAt, counts: counts({}) };
}

describe("defaultSnapshotName", () => {
  it("names a snapshot with its date and time", () => {
    // Local components, so the result is the same in every
    // timezone the tests run in.
    expect(defaultSnapshotName(new Date(2026, 10, 15, 21, 40))).toBe(
      "Nov 15, 2026, 9:40 PM",
    );
  });

  it("uses 12-hour time with AM and PM", () => {
    expect(defaultSnapshotName(new Date(2026, 0, 2, 0, 5))).toBe("Jan 2, 2026, 12:05 AM");
    expect(defaultSnapshotName(new Date(2026, 0, 2, 12, 0))).toBe("Jan 2, 2026, 12:00 PM");
    expect(defaultSnapshotName(new Date(2026, 0, 2, 9, 3))).toBe("Jan 2, 2026, 9:03 AM");
  });
});

describe("formatSnapshotTime", () => {
  it("formats a stored timestamp like the default name", () => {
    const createdAt = new Date(2026, 10, 15, 21, 40).toISOString();
    expect(formatSnapshotTime(createdAt)).toBe("Nov 15, 2026, 9:40 PM");
  });

  it("returns a bad timestamp unchanged instead of crashing", () => {
    expect(formatSnapshotTime("not-a-date")).toBe("not-a-date");
  });
});

describe("snapshotCountsLabel", () => {
  it("lists only the kinds present", () => {
    expect(snapshotCountsLabel(counts({ notes: 3, shapes: 2, images: 1 }))).toBe(
      "3 notes · 2 shapes · 1 image",
    );
  });

  it("uses the singular for one item", () => {
    expect(
      snapshotCountsLabel(
        counts({ notes: 1, shapes: 1, texts: 1, frames: 1, connectors: 1, images: 1, voiceNotes: 1 }),
      ),
    ).toBe("1 note · 1 shape · 1 text box · 1 frame · 1 connector · 1 image · 1 voice note");
  });

  it("reads 'Empty board' for a snapshot with nothing in it", () => {
    expect(snapshotCountsLabel(counts({}))).toBe("Empty board");
  });
});

describe("sortSnapshotsNewestFirst", () => {
  it("puts the newest snapshot first", () => {
    const old = meta("old", "2026-11-14T10:00:00.000Z");
    const middle = meta("middle", "2026-11-15T10:00:00.000Z");
    const newest = meta("newest", "2026-11-15T11:00:00.000Z");
    expect(sortSnapshotsNewestFirst([old, newest, middle]).map((item) => item.id)).toEqual([
      "newest",
      "middle",
      "old",
    ]);
  });

  it("leaves the caller's order untouched", () => {
    const old = meta("old", "2026-11-14T10:00:00.000Z");
    const newest = meta("newest", "2026-11-15T11:00:00.000Z");
    const input = [old, newest];
    sortSnapshotsNewestFirst(input);
    expect(input.map((item) => item.id)).toEqual(["old", "newest"]);
  });
});

// A board with one of everything, as a snapshot would store it.
// The image is a 1x1 transparent PNG data URL.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function fullExport(): BoardExport {
  return {
    version: 1,
    exportedAt: "2026-11-15T00:00:00.000Z",
    boardId: "board-x",
    notes: [
      { id: "n1", x: 10, y: 20, w: 200, h: 200, color: "yellow", text: "hello" },
    ],
    shapes: [
      { id: "s1", kind: "rect", x: 30, y: 40, w: 100, h: 80, color: "blue", points: [] },
    ],
    texts: [
      { id: "t1", x: 50, y: 60, w: 240, h: 80, fontSize: "medium", color: "green", text: "hi" },
    ],
    frames: [{ id: "f1", x: 0, y: 0, w: 480, h: 320, color: "pink", title: "Frame" }],
    connectors: [
      { id: "c1", fromId: "n1", toId: "s1", color: "yellow", arrow: true, label: "" },
    ],
    images: [{ id: "i1", x: 70, y: 80, w: 400, h: 300, dataUrl: TINY_PNG }],
    voiceNotes: [
      { id: "v1", x: 90, y: 100, dataUrl: "data:audio/webm;base64,AAAA", durationSeconds: 8 },
    ],
  };
}

describe("snapshot capture and restore", () => {
  it("round-trips a board through capture and restore", () => {
    // Capture: a board's live document, read out as an export.
    const live = new Y.Doc();
    applyBoardExport(live, fullExport(), "test");
    const captured = exportDocToBoard(live, "board-x");
    expect(captured.notes).toHaveLength(1);
    expect(captured.shapes).toHaveLength(1);
    expect(captured.texts).toHaveLength(1);
    expect(captured.frames).toHaveLength(1);
    expect(captured.connectors).toHaveLength(1);
    expect(captured.images).toHaveLength(1);
    expect(captured.images[0].dataUrl).toBe(TINY_PNG);
    expect(captured.voiceNotes).toHaveLength(1);
    expect(captured.voiceNotes[0].durationSeconds).toBe(8);

    // Restore: the captured export, applied to a different
    // document, reads back identical.
    const restored = new Y.Doc();
    applyBoardExport(restored, captured, "test");
    const readBack = exportDocToBoard(restored, "board-x");
    expect(readBack.notes).toEqual(captured.notes);
    expect(readBack.shapes).toEqual(captured.shapes);
    expect(readBack.texts).toEqual(captured.texts);
    expect(readBack.frames).toEqual(captured.frames);
    expect(readBack.connectors).toEqual(captured.connectors);
    expect(readBack.images).toEqual(captured.images);
  });

  it("restoring replaces the board instead of adding to it", () => {
    const doc = new Y.Doc();
    applyBoardExport(doc, fullExport(), "test");
    expect(exportDocToBoard(doc, "board-x").notes).toHaveLength(1);
    // A restore of an empty snapshot leaves an empty board —
    // the old note is gone, not kept alongside.
    const empty: BoardExport = {
      version: 1,
      exportedAt: "2026-11-15T00:00:00.000Z",
      boardId: "board-x",
      notes: [],
      shapes: [],
      texts: [],
      frames: [],
      connectors: [],
      images: [],
      voiceNotes: [],
    };
    applyBoardExport(doc, empty, "test");
    const readBack = exportDocToBoard(doc, "board-x");
    expect(readBack.notes).toEqual([]);
    expect(readBack.shapes).toEqual([]);
    expect(readBack.images).toEqual([]);
    expect(readBack.voiceNotes).toEqual([]);
  });
});
