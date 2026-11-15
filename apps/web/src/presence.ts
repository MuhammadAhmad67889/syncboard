import type { Frame, PresenceUser, SessionUser } from "@syncboard/shared";

// One row of the who's-here list: the person, whether it is the
// local user, and what they are doing — null when nothing is
// known (their pointer is off the board, or the row is your own).
export interface WhosHereRow {
  id: string;
  name: string;
  color: string;
  you: boolean;
  activity: string | null;
}

// The frame a board point sits in, if any. When frames overlap,
// the smallest containing frame wins — the most specific area
// the person is in. A point on a frame's edge counts as inside.
export function frameAtPoint(
  point: { x: number; y: number },
  frames: Frame[],
): Frame | null {
  let best: Frame | null = null;
  for (const frame of frames) {
    const inside =
      point.x >= frame.x &&
      point.x <= frame.x + frame.w &&
      point.y >= frame.y &&
      point.y <= frame.y + frame.h;
    if (!inside) continue;
    if (best === null || frame.w * frame.h < best.w * best.h) {
      best = frame;
    }
  }
  return best;
}

// What one other person is doing, from the Awareness state
// already flowing. Selection comes first — it is the most
// specific thing they are doing — then the frame their cursor
// sits in, then simply being on the board. A null cursor means
// their pointer is off the board, and nothing is claimed about
// where they are.
export function describePresenceActivity(
  person: PresenceUser,
  frames: Frame[],
): string | null {
  if (person.selectedNoteIds.length > 0) return "Selecting a note";
  if (person.selectedShapeIds.length > 0) return "Selecting a shape";
  if (person.selectedTextIds.length > 0) return "Selecting a text box";
  if (person.cursor === null) return null;
  const frame = frameAtPoint(person.cursor, frames);
  if (frame !== null) return `In ${frame.title}`;
  return "On the board";
}

// The rows the who's-here list renders: the local user first
// (marked "you", with no activity line — local cursor moves do
// not re-render, so a live line for yourself would go stale),
// then everyone else alphabetically, the same order the header
// chips already use.
export function buildWhosHereRows(
  self: SessionUser,
  others: PresenceUser[],
  frames: Frame[],
): WhosHereRow[] {
  const rows: WhosHereRow[] = [
    { id: self.id, name: self.name, color: self.color, you: true, activity: null },
  ];
  const sorted = [...others].sort((a, b) => a.name.localeCompare(b.name));
  for (const person of sorted) {
    rows.push({
      id: person.id,
      name: person.name,
      color: person.color,
      you: false,
      activity: describePresenceActivity(person, frames),
    });
  }
  return rows;
}
