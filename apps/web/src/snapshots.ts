import {
  type BoardSnapshot,
  type BoardSnapshotMeta,
  type SnapshotCounts,
} from "@syncboard/shared";
import { boardExportToJson, type BoardExport } from "./export";

export type { BoardSnapshot, BoardSnapshotMeta, SnapshotCounts };

// The snapshots API lives on the same server as the sync
// websocket, so its base URL is passed in by the caller (the app
// derives it from the sync URL). The routes mirror /boards:
// GET /boards/:id/snapshots lists, POST saves one, GET
// /boards/:id/snapshots/:snapshotId returns one with its state,
// DELETE removes one.

// Lists a board's snapshots, newest first. The list carries
// metadata only — no state bytes — so it stays cheap. Throws
// with a plain message when the server cannot be reached, so
// the UI can show it.
export async function fetchSnapshots(
  baseUrl: string,
  boardId: string,
): Promise<BoardSnapshotMeta[]> {
  const response = await fetch(`${baseUrl}/boards/${encodeURIComponent(boardId)}/snapshots`);
  if (!response.ok) {
    throw new Error(`Could not load snapshots (${response.status}).`);
  }
  const data = (await response.json()) as { snapshots?: unknown };
  if (!Array.isArray(data.snapshots)) return [];
  return data.snapshots.filter(
    (snapshot): snapshot is BoardSnapshotMeta =>
      typeof snapshot === "object" &&
      snapshot !== null &&
      typeof (snapshot as BoardSnapshotMeta).id === "string" &&
      typeof (snapshot as BoardSnapshotMeta).boardId === "string" &&
      typeof (snapshot as BoardSnapshotMeta).name === "string" &&
      typeof (snapshot as BoardSnapshotMeta).createdAt === "string" &&
      isSnapshotCounts((snapshot as BoardSnapshotMeta).counts),
  );
}

function isSnapshotCounts(value: unknown): value is SnapshotCounts {
  if (typeof value !== "object" || value === null) return false;
  const counts = value as Record<string, unknown>;
  return (
    typeof counts.notes === "number" &&
    typeof counts.shapes === "number" &&
    typeof counts.texts === "number" &&
    typeof counts.frames === "number" &&
    typeof counts.connectors === "number" &&
    typeof counts.images === "number"
  );
}

// Saves a snapshot of the board's current state and returns it.
// The state is the full board export the client captured from
// its live document. Throws when the server refuses (a blank
// name, a bad state, or the 20-snapshot cap) or the board is
// gone.
export async function createSnapshot(
  baseUrl: string,
  boardId: string,
  name: string,
  state: BoardExport,
): Promise<BoardSnapshotMeta> {
  const response = await fetch(`${baseUrl}/boards/${encodeURIComponent(boardId)}/snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, state: boardExportToJson(state) }),
  });
  const data = (await response.json()) as { snapshot?: BoardSnapshotMeta; error?: string };
  if (!response.ok || !data.snapshot) {
    throw new Error(data.error ?? `Could not save snapshot (${response.status}).`);
  }
  return data.snapshot;
}

// Fetches one snapshot, with its state, for a restore. The
// state is untrusted JSON — the caller validates it with
// parseBoardExport before applying anything.
export async function fetchSnapshot(
  baseUrl: string,
  boardId: string,
  snapshotId: string,
): Promise<BoardSnapshot> {
  const response = await fetch(
    `${baseUrl}/boards/${encodeURIComponent(boardId)}/snapshots/${encodeURIComponent(snapshotId)}`,
  );
  const data = (await response.json()) as { snapshot?: BoardSnapshot; error?: string };
  if (!response.ok || !data.snapshot) {
    throw new Error(data.error ?? `Could not load snapshot (${response.status}).`);
  }
  return data.snapshot;
}

// Deletes a snapshot. Throws when the server refuses or the
// snapshot is already gone.
export async function deleteSnapshot(
  baseUrl: string,
  boardId: string,
  snapshotId: string,
): Promise<void> {
  const response = await fetch(
    `${baseUrl}/boards/${encodeURIComponent(boardId)}/snapshots/${encodeURIComponent(snapshotId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Could not delete snapshot (${response.status}).`);
  }
}

// The month names for the default snapshot name. Written out
// instead of toLocaleString, so the name is the same in every
// locale and timezone the app runs in.
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

// The default name for a new snapshot: the date and time it was
// saved, e.g. "Nov 15, 2026, 9:40 PM". The caller passes a date
// only in tests — in the app it defaults to now.
export function defaultSnapshotName(date: Date = new Date()): string {
  const month = MONTH_NAMES[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  let hour = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${month} ${day}, ${year}, ${hour}:${minutes} ${period}`;
}

// The short time a snapshot row shows, e.g. "Nov 15, 2026,
// 9:40 PM" — the same shape as the default name, so a
// user-named snapshot and an auto-named one read the same.
export function formatSnapshotTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return defaultSnapshotName(date);
}

// What a snapshot holds, in one line: "3 notes · 2 shapes ·
// 1 image". Only the kinds that are present are listed, so a
// snapshot with just notes reads "3 notes". An empty board reads
// "Empty board".
export function snapshotCountsLabel(counts: SnapshotCounts): string {
  const parts: string[] = [];
  function add(count: number, singular: string, plural: string): void {
    if (count > 0) parts.push(`${count} ${count === 1 ? singular : plural}`);
  }
  add(counts.notes, "note", "notes");
  add(counts.shapes, "shape", "shapes");
  add(counts.texts, "text box", "text boxes");
  add(counts.frames, "frame", "frames");
  add(counts.connectors, "connector", "connectors");
  add(counts.images, "image", "images");
  return parts.length === 0 ? "Empty board" : parts.join(" · ");
}

// The snapshots newest first, for the panel. A fresh array, so
// the caller's order is untouched. The server already lists
// newest first; this is for a list built locally (after saving
// one) and for the tests.
export function sortSnapshotsNewestFirst(
  snapshots: BoardSnapshotMeta[],
): BoardSnapshotMeta[] {
  return [...snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
