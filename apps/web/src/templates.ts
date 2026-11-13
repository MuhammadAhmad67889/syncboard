import type { NoteColor } from "@syncboard/shared";

// One frame in a template: its title, its position and size
// relative to the template's top-left corner, and its color.
// A template frame is plain data — the board builds the real
// frame from it with createFrame when the template is inserted.
export interface TemplateFrame {
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: NoteColor;
}

// One note in a template: its text, its position and size
// relative to the template's top-left corner, and its color.
// The text is a short generic prompt, never invented content
// about a real project or task.
export interface TemplateNote {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: NoteColor;
}

// One template: an id, the name the picker shows, one line
// saying what it is for, and the frames and notes it inserts.
// All positions are relative to the template's top-left corner,
// so the board can drop the whole template anywhere by shifting
// every frame and note by the same amount.
export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  frames: TemplateFrame[];
  notes: TemplateNote[];
}

// Three columns side by side, the same width and gap in every
// template that uses columns, so the templates line up with
// each other on the board.
const COLUMN_W = 320;
const COLUMN_H = 360;
const COLUMN_GAP = 24;

// The starter note inside a column: wide enough to write in,
// short enough to leave room below it for the user's own notes.
const NOTE_W = 200;
const NOTE_H = 120;

// The x of the right-hand column: two column widths plus
// two gaps from the left edge.
const RIGHT_X = (COLUMN_W + COLUMN_GAP) * 2;

// A note sits this far inside its frame's top-left corner —
// below the title pill, with a margin on the left.
const NOTE_INSET_X = 24;
const NOTE_INSET_Y = 56;

// One column frame plus the starter note inside it. The note
// is placed from the frame's own position, so a column can
// move without its note being left behind.
function column(
  index: number,
  title: string,
  color: NoteColor,
  noteText: string,
  y = 0,
  h = COLUMN_H,
): { frame: TemplateFrame; note: TemplateNote } {
  const x = index * (COLUMN_W + COLUMN_GAP);
  return {
    frame: { title, x, y, w: COLUMN_W, h, color },
    note: {
      text: noteText,
      x: x + NOTE_INSET_X,
      y: y + NOTE_INSET_Y,
      w: NOTE_W,
      h: NOTE_H,
      color: "yellow",
    },
  };
}

// Builds a three-column template from its column titles and
// colors. Kanban, Retro, and the lower half of Sprint planning
// are all three columns — only the titles, colors, and note
// prompts differ.
function threeColumns(
  id: string,
  name: string,
  description: string,
  titles: [string, string, string],
  colors: [NoteColor, NoteColor, NoteColor],
  noteText: string,
): BoardTemplate {
  const frames: TemplateFrame[] = [];
  const notes: TemplateNote[] = [];
  for (let i = 0; i < titles.length; i += 1) {
    const part = column(i, titles[i], colors[i], noteText);
    frames.push(part.frame);
    notes.push(part.note);
  }
  return { id, name, description, frames, notes };
}

// The four templates, in picker order.
export const TEMPLATES: BoardTemplate[] = [
  threeColumns(
    "kanban",
    "Kanban board",
    "Three columns to move work through",
    ["To do", "Doing", "Done"],
    ["blue", "yellow", "green"],
    "Add a card here",
  ),
  threeColumns(
    "retro",
    "Retro",
    "Three prompts for a team retrospective",
    ["What went well", "What to improve", "What to try next"],
    ["green", "orange", "blue"],
    "Add a note here",
  ),
  {
    id: "mind-map",
    name: "Mind map",
    description: "One main idea with four branches",
    frames: [
      { title: "Branch one", x: 0, y: 0, w: COLUMN_W, h: 200, color: "blue" },
      { title: "Branch two", x: RIGHT_X, y: 0, w: COLUMN_W, h: 200, color: "green" },
      { title: "Main idea", x: COLUMN_W + COLUMN_GAP, y: 180, w: COLUMN_W, h: 240, color: "purple" },
      { title: "Branch three", x: 0, y: 420, w: COLUMN_W, h: 200, color: "yellow" },
      { title: "Branch four", x: RIGHT_X, y: 420, w: COLUMN_W, h: 200, color: "orange" },
    ],
    notes: [
      { text: "Add an idea here", x: NOTE_INSET_X, y: NOTE_INSET_Y, w: NOTE_W, h: NOTE_H, color: "yellow" },
      { text: "Add an idea here", x: RIGHT_X + NOTE_INSET_X, y: NOTE_INSET_Y, w: NOTE_W, h: NOTE_H, color: "yellow" },
      { text: "Add the main idea here", x: COLUMN_W + COLUMN_GAP + NOTE_INSET_X, y: 180 + NOTE_INSET_Y, w: NOTE_W, h: NOTE_H, color: "yellow" },
      { text: "Add an idea here", x: NOTE_INSET_X, y: 420 + NOTE_INSET_Y, w: NOTE_W, h: NOTE_H, color: "yellow" },
      { text: "Add an idea here", x: RIGHT_X + NOTE_INSET_X, y: 420 + NOTE_INSET_Y, w: NOTE_W, h: NOTE_H, color: "yellow" },
    ],
  },
  // Sprint planning is built from the same column helper as
  // Kanban and Retro, with a wide goal frame on top and the
  // three columns shifted down below it.
  (() => {
    const goalFrame: TemplateFrame = {
      title: "Sprint goal",
      x: 0,
      y: 0,
      w: COLUMN_W * 3 + COLUMN_GAP * 2,
      h: 200,
      color: "blue",
    };
    const goalNote: TemplateNote = {
      text: "Add the goal for this sprint",
      x: NOTE_INSET_X,
      y: NOTE_INSET_Y,
      w: NOTE_W,
      h: NOTE_H,
      color: "yellow",
    };
    const columns = [
      column(0, "To do", "blue", "Add a card here", 224, 320),
      column(1, "Doing", "yellow", "Add a card here", 224, 320),
      column(2, "Done", "green", "Add a card here", 224, 320),
    ];
    return {
      id: "sprint-planning",
      name: "Sprint planning",
      description: "A goal on top, three columns below it",
      frames: [goalFrame, ...columns.map((part) => part.frame)],
      notes: [goalNote, ...columns.map((part) => part.note)],
    };
  })(),
];

// Finds a template by id. Undefined when there is no template
// with that id, so the caller can ignore a bad pick instead of
// inserting nothing and crashing.
export function templateById(id: string): BoardTemplate | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

// The box a template covers, relative to its own top-left
// corner: the smallest rectangle holding every frame and note.
// The board centres this box on the visible view when it
// inserts the template.
export function templateBounds(template: BoardTemplate): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const frame of template.frames) {
    if (frame.x < minX) minX = frame.x;
    if (frame.y < minY) minY = frame.y;
    if (frame.x + frame.w > maxX) maxX = frame.x + frame.w;
    if (frame.y + frame.h > maxY) maxY = frame.y + frame.h;
  }
  for (const note of template.notes) {
    if (note.x < minX) minX = note.x;
    if (note.y < minY) minY = note.y;
    if (note.x + note.w > maxX) maxX = note.x + note.w;
    if (note.y + note.h > maxY) maxY = note.y + note.h;
  }
  // Every template has at least one frame, so the bounds are
  // always finite — the fallbacks are only here so an empty
  // template still returns a usable box.
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Shifts a template so its top-left corner lands at
// (originX, originY). Every frame and note moves by the same
// amount, so the layout inside the template never changes.
// The caller passes ids in when it builds the real frames and
// notes — this stays pure, with no ids of its own.
export function placeTemplate(
  template: BoardTemplate,
  originX: number,
  originY: number,
): { frames: TemplateFrame[]; notes: TemplateNote[] } {
  return {
    frames: template.frames.map((frame) => ({
      ...frame,
      x: frame.x + originX,
      y: frame.y + originY,
    })),
    notes: template.notes.map((note) => ({
      ...note,
      x: note.x + originX,
      y: note.y + originY,
    })),
  };
}

// Whether two boxes overlap. Touching edges do not count —
// frames that sit side by side share an edge only when there
// is no gap, and these templates always leave a gap.
export function boxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
