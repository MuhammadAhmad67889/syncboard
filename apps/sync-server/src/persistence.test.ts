import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { DEFAULT_BOARD_ID, DEFAULT_BOARD_NAME } from "@syncboard/shared";
import { createBoardStore, slugFromName, type BoardStore } from "./persistence.js";

// Each test gets its own throwaway database file, so tests never
// touch the real dev database and never see each other's boards.
let dbPath: string;
let store: BoardStore;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `syncboard-test-${Date.now()}-${Math.random()}.db`);
  store = createBoardStore(dbPath);
});

afterEach(() => {
  store.close();
  fs.rmSync(dbPath, { force: true });
});

// Encodes a tiny document, so a test can save real board state
// instead of arbitrary bytes.
function encodeDoc(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap("notes").set("n1", text);
  return Y.encodeStateAsUpdate(doc);
}

describe("default board", () => {
  it("lists the default board on a fresh database", () => {
    expect(store.listBoards()).toEqual([
      { id: DEFAULT_BOARD_ID, name: DEFAULT_BOARD_NAME, createdAt: expect.any(String) },
    ]);
  });

  it("refuses to delete the default board", () => {
    expect(store.deleteBoard(DEFAULT_BOARD_ID)).toBe(false);
    expect(store.isDeleted(DEFAULT_BOARD_ID)).toBe(false);
    expect(store.listBoards().map((board) => board.id)).toContain(DEFAULT_BOARD_ID);
  });
});

describe("slugFromName", () => {
  it("lowercases and dashes a plain name", () => {
    expect(slugFromName("Design Review")).toBe("design-review");
  });

  it("drops punctuation and trims stray dashes", () => {
    expect(slugFromName("  Q3: Plans! ")).toBe("q3-plans");
  });

  it("falls back to board for a name with no letters or digits", () => {
    expect(slugFromName("!!!")).toBe("board");
  });
});

describe("createBoard / listBoards", () => {
  it("creates a board and lists it after the default board", () => {
    const created = store.createBoard("Design");
    expect(created.id.startsWith("board-design-")).toBe(true);
    expect(created.name).toBe("Design");
    expect(created.createdAt).toEqual(expect.any(String));
    const listed = store.listBoards();
    expect(listed.map((board) => board.id)).toEqual([DEFAULT_BOARD_ID, created.id]);
  });

  it("trims the name it stores", () => {
    expect(store.createBoard("  Design  ").name).toBe("Design");
  });

  it("rejects a blank name", () => {
    expect(() => store.createBoard("   ")).toThrow("Board name must not be empty.");
    expect(() => store.createBoard("")).toThrow("Board name must not be empty.");
  });

  it("gives two boards with the same name different ids", () => {
    const first = store.createBoard("Design");
    const second = store.createBoard("Design");
    expect(first.id).not.toBe(second.id);
    expect(store.listBoards()).toHaveLength(3);
  });
});

describe("renameBoard", () => {
  it("renames a board and keeps its id and created date", () => {
    const created = store.createBoard("Design");
    const renamed = store.renameBoard(created.id, "Redesign");
    expect(renamed).toEqual({ id: created.id, name: "Redesign", createdAt: created.createdAt });
    expect(store.listBoards().find((board) => board.id === created.id)?.name).toBe("Redesign");
  });

  it("trims the name it stores", () => {
    const created = store.createBoard("Design");
    expect(store.renameBoard(created.id, "  Redesign  ")?.name).toBe("Redesign");
  });

  it("rejects a blank name", () => {
    const created = store.createBoard("Design");
    expect(() => store.renameBoard(created.id, "   ")).toThrow("Board name must not be empty.");
    expect(() => store.renameBoard(created.id, "")).toThrow("Board name must not be empty.");
  });

  it("returns null for a board that does not exist", () => {
    expect(store.renameBoard("board-nope-123456", "Redesign")).toBeNull();
  });

  it("returns null for a board that was deleted", () => {
    const created = store.createBoard("Design");
    expect(store.deleteBoard(created.id)).toBe(true);
    expect(store.renameBoard(created.id, "Redesign")).toBeNull();
  });

  it("renames the default board like any other", () => {
    const renamed = store.renameBoard(DEFAULT_BOARD_ID, "Home");
    expect(renamed).toEqual({
      id: DEFAULT_BOARD_ID,
      name: "Home",
      createdAt: expect.any(String),
    });
    expect(store.listBoards()[0].name).toBe("Home");
  });
});

describe("save / load", () => {
  it("round-trips a saved document", () => {
    const board = store.createBoard("Design");
    const state = encodeDoc("hello");
    store.save(board.id, state);
    expect(store.load(board.id)).toEqual(Buffer.from(state));
  });

  it("returns null for a board that was never saved", () => {
    const board = store.createBoard("Design");
    expect(store.load(board.id)).toBeNull();
  });
});

describe("deleteBoard", () => {
  it("deletes the document and the list entry", () => {
    const board = store.createBoard("Design");
    store.save(board.id, encodeDoc("hello"));
    expect(store.deleteBoard(board.id)).toBe(true);
    expect(store.load(board.id)).toBeNull();
    expect(store.listBoards().map((item) => item.id)).toEqual([DEFAULT_BOARD_ID]);
  });

  it("returns false for a board that does not exist", () => {
    expect(store.deleteBoard("board-nope-123456")).toBe(false);
  });

  it("returns false the second time a board is deleted", () => {
    const board = store.createBoard("Design");
    expect(store.deleteBoard(board.id)).toBe(true);
    expect(store.deleteBoard(board.id)).toBe(false);
  });

  it("never resurrects: a save after delete is dropped", () => {
    const board = store.createBoard("Design");
    store.save(board.id, encodeDoc("before"));
    expect(store.deleteBoard(board.id)).toBe(true);
    // A debounced save from the server can arrive after the
    // delete — it must not bring the board back.
    store.save(board.id, encodeDoc("after"));
    expect(store.load(board.id)).toBeNull();
    expect(store.listBoards().map((item) => item.id)).toEqual([DEFAULT_BOARD_ID]);
    expect(store.isDeleted(board.id)).toBe(true);
  });

  it("never resurrects: ensuring meta after delete does nothing", () => {
    const board = store.createBoard("Design");
    expect(store.deleteBoard(board.id)).toBe(true);
    store.ensureBoardMeta(board.id, "Design");
    expect(store.listBoards().map((item) => item.id)).toEqual([DEFAULT_BOARD_ID]);
    expect(store.isDeleted(board.id)).toBe(true);
  });
});

describe("ensureBoardMeta", () => {
  it("records a board joined directly, without the API", () => {
    store.ensureBoardMeta("board-direct-abc", "Direct");
    expect(store.listBoards().map((item) => item.id)).toContain("board-direct-abc");
  });

  it("never overwrites an existing name", () => {
    store.ensureBoardMeta(DEFAULT_BOARD_ID, "Something else");
    const found = store.listBoards().find((item) => item.id === DEFAULT_BOARD_ID);
    expect(found?.name).toBe(DEFAULT_BOARD_NAME);
  });
});
