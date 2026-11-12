import { DEFAULT_BOARD_ID, type BoardMeta } from "@syncboard/shared";

export type { BoardMeta };

// The boards API lives on the same server as the sync websocket,
// so its base URL is passed in by the caller (the app derives it
// from the sync URL).

// Lists every board, oldest first. Throws with a plain message
// when the server cannot be reached, so the UI can show it.
export async function fetchBoards(baseUrl: string): Promise<BoardMeta[]> {
  const response = await fetch(`${baseUrl}/boards`);
  if (!response.ok) {
    throw new Error(`Could not load boards (${response.status}).`);
  }
  const data = (await response.json()) as { boards?: unknown };
  if (!Array.isArray(data.boards)) return [];
  return data.boards.filter(
    (board): board is BoardMeta =>
      typeof board === "object" &&
      board !== null &&
      typeof (board as BoardMeta).id === "string" &&
      typeof (board as BoardMeta).name === "string" &&
      typeof (board as BoardMeta).createdAt === "string",
  );
}

// Creates a board and returns it. The server picks the id.
export async function createBoard(baseUrl: string, name: string): Promise<BoardMeta> {
  const response = await fetch(`${baseUrl}/boards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = (await response.json()) as { board?: BoardMeta; error?: string };
  if (!response.ok || !data.board) {
    throw new Error(data.error ?? `Could not create board (${response.status}).`);
  }
  return data.board;
}

// Deletes a board. Throws when the server refuses (the default
// board) or the board is already gone.
export async function deleteBoard(baseUrl: string, id: string): Promise<void> {
  const response = await fetch(`${baseUrl}/boards/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Could not delete board (${response.status}).`);
  }
}

// The default board can never be deleted — the switcher hides
// its delete button, and the server refuses it too.
export function canDeleteBoard(id: string): boolean {
  return id !== DEFAULT_BOARD_ID;
}

// Picks the board to show after the list changes: the current
// board when it still exists, the default board when it does
// not — for example when someone else deleted the board this
// client was on. Pure, so it is easy to test.
export function resolveCurrentBoard(boards: BoardMeta[], currentId: string): string {
  if (boards.some((board) => board.id === currentId)) return currentId;
  return DEFAULT_BOARD_ID;
}
