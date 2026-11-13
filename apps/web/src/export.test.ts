import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  createConnector,
  createFrame,
  createShape,
  createTextBox,
  type Connector,
  type Frame,
  type Note,
  type Shape,
  type TextBox,
} from "@syncboard/shared";
import {
  applyBoardExport,
  boardExportToJson,
  exportDocToBoard,
  parseBoardExport,
  type BoardExport,
} from "./export";

const ORIGIN = "local-user-ahmad";

function sampleBoard(): BoardExport {
  const notes: Note[] = [
    { id: "n1", x: 80, y: 120, w: 200, h: 200, color: "yellow", text: "Ship Phase 1\nby Friday" },
    { id: "n2", x: 380, y: 220, w: 200, h: 200, color: "pink", text: "Ask Sara" },
  ];
  const shapes: Shape[] = [
    createShape("s1", "rect", 150, 400, 200, 120, "blue"),
    createShape("s2", "pen", 500, 400, 60, 40, "pink", [
      { x: 500, y: 400 },
      { x: 560, y: 440 },
    ]),
    createShape("s3", "line", 100, 600, 150, 80, "green"),
  ];
  const texts: TextBox[] = [
    createTextBox("t1", 700, 120, 240, 80, "large", "blue", "Hello board"),
    createTextBox("t2", 700, 300, 240, 80, "small", "purple", "Small print"),
  ];
  const frames: Frame[] = [
    createFrame("f1", 50, 100, 600, 400, "blue", "Sprint planning"),
  ];
  const connectors: Connector[] = [
    createConnector("c1", "n1", "n2", "green"),
    createConnector("c2", "s1", "f1", "blue"),
  ];
  return {
    version: 1,
    exportedAt: "2026-11-12T00:00:00.000Z",
    boardId: "syncboard-demo",
    notes,
    shapes,
    texts,
    frames,
    connectors,
  };
}

describe("boardExportToJson / parseBoardExport", () => {
  it("round-trips a full board through JSON", () => {
    const board = sampleBoard();
    const parsed = parseBoardExport(boardExportToJson(board));
    expect(parsed).toEqual(board);
  });

  it("rejects bad JSON", () => {
    expect(parseBoardExport("not json {")).toBeNull();
  });

  it("rejects a wrong version", () => {
    const board = { ...sampleBoard(), version: 2 };
    expect(parseBoardExport(JSON.stringify(board))).toBeNull();
  });

  it("rejects a file missing the lists", () => {
    expect(parseBoardExport(JSON.stringify({ version: 1, notes: [] }))).toBeNull();
  });

  it("drops entries without an id and defaults bad fields", () => {
    const parsed = parseBoardExport(
      JSON.stringify({
        version: 1,
        exportedAt: "2026-11-12T00:00:00.000Z",
        boardId: "x",
        notes: [{ id: "n1", x: "nope", color: "not-a-color", text: "kept" }, { x: 1 }],
        shapes: [],
        texts: [{ id: "t1", fontSize: "huge", text: "kept too" }],
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.notes).toEqual([
      { id: "n1", x: 0, y: 0, w: 200, h: 200, color: "yellow", text: "kept" },
    ]);
    expect(parsed!.texts).toEqual([
      { id: "t1", x: 0, y: 0, w: 240, h: 80, fontSize: "medium", color: "yellow", text: "kept too" },
    ]);
  });
});

describe("exportDocToBoard / applyBoardExport", () => {
  it("round-trips the doc state through JSON into a fresh doc", () => {
    const source = new Y.Doc();
    applyBoardExport(source, sampleBoard(), ORIGIN);
    const json = boardExportToJson(exportDocToBoard(source, "syncboard-demo"));

    const fresh = new Y.Doc();
    // A fresh board starts empty — nothing to wipe first.
    const parsed = parseBoardExport(json);
    expect(parsed).not.toBeNull();
    applyBoardExport(fresh, parsed!, ORIGIN);

    const restored = exportDocToBoard(fresh, "syncboard-demo");
    expect(restored.notes).toEqual(sampleBoard().notes);
    expect(restored.shapes).toEqual(sampleBoard().shapes);
    expect(restored.texts).toEqual(sampleBoard().texts);
    expect(restored.frames).toEqual(sampleBoard().frames);
    expect(restored.connectors).toEqual(sampleBoard().connectors);
  });

  it("imports an old export without frames or connectors", () => {
    // Exports made before frames and connectors existed have no
    // such lists. They must still import — with empty frames and
    // connectors — instead of being rejected.
    const old = {
      version: 1,
      exportedAt: "2026-11-12T00:00:00.000Z",
      boardId: "syncboard-demo",
      notes: [{ id: "n1", x: 0, y: 0, w: 200, h: 200, color: "yellow", text: "kept" }],
      shapes: [],
      texts: [],
    };
    const parsed = parseBoardExport(JSON.stringify(old));
    expect(parsed).not.toBeNull();
    expect(parsed!.frames).toEqual([]);
    expect(parsed!.connectors).toEqual([]);
  });

  it("replaces the board instead of merging with it", () => {
    const doc = new Y.Doc();
    applyBoardExport(doc, sampleBoard(), ORIGIN);
    // Import a smaller board over the top: the old notes must go.
    const smaller: BoardExport = {
      version: 1,
      exportedAt: "2026-11-12T00:00:00.000Z",
      boardId: "syncboard-demo",
      notes: [{ id: "only", x: 0, y: 0, w: 200, h: 200, color: "green", text: "Only me" }],
      shapes: [],
      texts: [],
      frames: [],
      connectors: [],
    };
    applyBoardExport(doc, smaller, ORIGIN);
    const restored = exportDocToBoard(doc, "syncboard-demo");
    expect(restored.notes).toEqual(smaller.notes);
    expect(restored.shapes).toEqual([]);
    expect(restored.texts).toEqual([]);
    expect(restored.frames).toEqual([]);
    expect(restored.connectors).toEqual([]);
  });

  it("keeps pen points through the round-trip", () => {
    const doc = new Y.Doc();
    applyBoardExport(doc, sampleBoard(), ORIGIN);
    const restored = exportDocToBoard(doc, "syncboard-demo");
    const pen = restored.shapes.find((shape) => shape.id === "s2");
    expect(pen?.points).toEqual([
      { x: 500, y: 400 },
      { x: 560, y: 440 },
    ]);
  });
});
