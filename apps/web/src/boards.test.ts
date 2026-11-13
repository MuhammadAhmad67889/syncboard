import { describe, expect, it } from "vitest";
import { DEFAULT_BOARD_ID } from "@syncboard/shared";
import { canDeleteBoard, resolveCurrentBoard, type BoardMeta } from "./boards";

function board(id: string, name: string): BoardMeta {
  return { id, name, createdAt: "2026-11-12T00:00:00.000Z" };
}

describe("canDeleteBoard", () => {
  it("protects the default board", () => {
    expect(canDeleteBoard(DEFAULT_BOARD_ID)).toBe(false);
  });

  it("allows any other board", () => {
    expect(canDeleteBoard("board-design-abc123")).toBe(true);
  });
});

describe("resolveCurrentBoard", () => {
  it("keeps the current board when it still exists", () => {
    const boards = [board(DEFAULT_BOARD_ID, "Main board"), board("board-design-abc123", "Design")];
    expect(resolveCurrentBoard(boards, "board-design-abc123")).toBe("board-design-abc123");
  });
  it("falls back to the default board when the current one is gone", () => {
    const boards = [board(DEFAULT_BOARD_ID, "Main board")];
    expect(resolveCurrentBoard(boards, "board-design-abc123")).toBe(DEFAULT_BOARD_ID);
  });

  it("falls back to the default board when the list is empty", () => {
    expect(resolveCurrentBoard([], "board-design-abc123")).toBe(DEFAULT_BOARD_ID);
  });

  it("keeps the default board when it is the current one", () => {
    const boards = [board(DEFAULT_BOARD_ID, "Main board")];
    expect(resolveCurrentBoard(boards, DEFAULT_BOARD_ID)).toBe(DEFAULT_BOARD_ID);
  });
});

// The rules the board sidebar (Phase 3) leans on: switching
// keeps the open board, deleting the open board sends the user
// back to the default board, and the default board is never
// deletable — not even while it is open.
describe("sidebar board rules", () => {
  it("deleting the open board resolves back to the default board", () => {
    const boards = [board(DEFAULT_BOARD_ID, "Main board")];
    expect(resolveCurrentBoard(boards, "board-design-abc123")).toBe(DEFAULT_BOARD_ID);
    expect(canDeleteBoard(DEFAULT_BOARD_ID)).toBe(false);
  });

  it("deleting another board leaves the open board alone", () => {
    const boards = [board(DEFAULT_BOARD_ID, "Main board"), board("board-design-abc123", "Design")];
    expect(resolveCurrentBoard(boards, "board-design-abc123")).toBe("board-design-abc123");
    expect(canDeleteBoard("board-design-abc123")).toBe(true);
  });

  it("the default board has no delete button even when it is open", () => {
    expect(canDeleteBoard(DEFAULT_BOARD_ID)).toBe(false);
    expect(resolveCurrentBoard([board(DEFAULT_BOARD_ID, "Main board")], DEFAULT_BOARD_ID)).toBe(
      DEFAULT_BOARD_ID,
    );
  });
});
