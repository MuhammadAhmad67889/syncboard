import {
  boxCentreInFrame,
  type Box,
  type Frame,
  type Note,
  type NoteColor,
} from "@syncboard/shared";

// Auto-organize groups the board's free sticky notes into
// labelled frames by topic. The clustering is keyword-based
// and runs entirely in the browser: no API key, no server, no
// external service — the words in the notes are all it needs.

// Words too common to say anything about a note's topic. A
// note made only of these has no topic at all.
export const STOP_WORDS: ReadonlySet<string> = new Set([
  "a",
  "about",
  "after",
  "all",
  "also",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "before",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "me",
  "more",
  "most",
  "my",
  "no",
  "not",
  "of",
  "on",
  "or",
  "our",
  "over",
  "per",
  "she",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "too",
  "under",
  "very",
  "via",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

// The shortest word that can carry a topic. One- and
// two-letter words are mostly initials and abbreviations, and
// they collide across unrelated notes.
export const MIN_KEYWORD_LENGTH = 3;

// The words in a note's text that carry its topic:
// lowercased, split on anything that is not a letter, stop
// words and words shorter than three letters dropped, each
// word once, in the order it first appears.
export function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().split(/[^a-z]+/);
  const keywords: string[] = [];
  for (const word of words) {
    if (word.length < MIN_KEYWORD_LENGTH) continue;
    if (STOP_WORDS.has(word)) continue;
    if (keywords.includes(word)) continue;
    keywords.push(word);
  }
  return keywords;
}

// The label a frame gets for a keyword: the keyword with its
// first letter uppercased, the rest as written.
export function titleCaseKeyword(keyword: string): string {
  if (keyword.length === 0) return keyword;
  return keyword[0].toUpperCase() + keyword.slice(1);
}

// The notes that are not inside any frame yet: a note belongs
// to a frame when its centre is in it — the same rule a frame
// drag uses — so only the notes whose centre is outside every
// frame are free to organize.
export function freeNotes(notes: Note[], frames: Frame[]): Note[] {
  return notes.filter(
    (note) => !frames.some((frame) => boxCentreInFrame(frame, note)),
  );
}

// One topic group: the keyword the notes share, and the notes
// in it. Groups are ordered biggest first, then by keyword,
// so the frame layout is stable from run to run.
export interface TopicGroup {
  keyword: string;
  noteIds: string[];
}

// Groups the free notes by shared keyword. A note joins the
// group for the keyword it shares with the most other notes —
// its strongest topic. A group needs at least two notes: a
// keyword only one note has is not a topic, and a note whose
// group drops below two — because its other notes had a
// stronger topic — stays where it is instead of joining a
// one-note group.
export function groupFreeNotes(notes: Note[]): TopicGroup[] {
  const keywordsByNote = new Map<string, string[]>();
  const noteCountByKeyword = new Map<string, number>();
  for (const note of notes) {
    const keywords = extractKeywords(note.text);
    keywordsByNote.set(note.id, keywords);
    for (const keyword of keywords) {
      noteCountByKeyword.set(keyword, (noteCountByKeyword.get(keyword) ?? 0) + 1);
    }
  }
  const noteIdsByKeyword = new Map<string, string[]>();
  for (const note of notes) {
    const keywords = keywordsByNote.get(note.id) ?? [];
    let best: string | null = null;
    for (const keyword of keywords) {
      const count = noteCountByKeyword.get(keyword) ?? 0;
      if (count < 2) continue;
      if (best === null) {
        best = keyword;
        continue;
      }
      const bestCount = noteCountByKeyword.get(best) ?? 0;
      // Ties break alphabetically, so the same board always
      // groups the same way.
      if (count > bestCount || (count === bestCount && keyword < best)) {
        best = keyword;
      }
    }
    if (best === null) continue;
    const group = noteIdsByKeyword.get(best) ?? [];
    group.push(note.id);
    noteIdsByKeyword.set(best, group);
  }
  const groups: TopicGroup[] = [];
  for (const [keyword, noteIds] of noteIdsByKeyword) {
    if (noteIds.length < 2) continue;
    groups.push({ keyword, noteIds });
  }
  groups.sort(
    (a, b) =>
      b.noteIds.length - a.noteIds.length ||
      (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0),
  );
  return groups;
}

// The smallest box holding every box in the list, or null when
// there is nothing on the board.
export function boundingBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  let minX = boxes[0].x;
  let minY = boxes[0].y;
  let maxX = boxes[0].x + boxes[0].w;
  let maxY = boxes[0].y + boxes[0].h;
  for (const box of boxes) {
    if (box.x < minX) minX = box.x;
    if (box.y < minY) minY = box.y;
    if (box.x + box.w > maxX) maxX = box.x + box.w;
    if (box.y + box.h > maxY) maxY = box.y + box.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// One frame the organize will create, with the notes that go
// in it and where each one lands inside the frame.
export interface OrganizeGroup {
  keyword: string;
  title: string;
  color: NoteColor;
  frame: Box;
  placements: Array<{ noteId: string; x: number; y: number }>;
}

// The whole organize: the frames to create and the notes to
// move, or null when there is nothing to group.
export interface OrganizePlan {
  groups: OrganizeGroup[];
  noteCount: number;
  frameCount: number;
}

// The space inside a frame: a title strip at the top, then
// padding around the notes.
const FRAME_PADDING_PX = 24;
const FRAME_TITLE_HEIGHT_PX = 48;
const NOTE_GAP_PX = 24;

// The gap between two frames in the row, and between the
// row and the content already on the board.
const FRAME_GAP_PX = 32;
const ROW_GAP_PX = 80;

// The most notes across in one frame. More than three, and
// the frame gets wider than the board is tall — a taller grid
// reads better.
const MAX_COLUMNS = 3;

// The frame colors, in order: the first group is yellow, the
// second green, and so on, wrapping when there are more
// groups than colors.
const FRAME_COLORS: NoteColor[] = [
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
  "orange",
];

// Plans the organize for the board right now: the free notes
// grouped by topic, laid out as a tidy row of frames below
// everything already on the board — never on top of it. The
// row starts at the content's left edge, so the frames sit
// under what they came from. Returns null when no two free
// notes share a word: there is nothing to group.
export function planAutoOrganize(
  notes: Note[],
  frames: Frame[],
  content: Box[],
): OrganizePlan | null {
  const groups = groupFreeNotes(freeNotes(notes, frames));
  if (groups.length === 0) return null;
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const bounds = boundingBox(content);
  const rowX = Math.max(0, bounds ? bounds.x : 0);
  const rowY = bounds ? bounds.y + bounds.h + ROW_GAP_PX : ROW_GAP_PX;
  const placed: OrganizeGroup[] = [];
  let noteCount = 0;
  let cursorX = rowX;
  groups.forEach((group, index) => {
    const groupNotes = group.noteIds
      .map((id) => notesById.get(id))
      .filter((note): note is Note => note !== undefined);
    if (groupNotes.length < 2) return;
    // The grid cell fits the biggest note in the group, so no
    // two notes in the frame can overlap.
    const maxW = Math.max(...groupNotes.map((note) => note.w));
    const maxH = Math.max(...groupNotes.map((note) => note.h));
    const cols = Math.min(MAX_COLUMNS, groupNotes.length);
    const rows = Math.ceil(groupNotes.length / cols);
    const frameW =
      FRAME_PADDING_PX * 2 + cols * maxW + (cols - 1) * NOTE_GAP_PX;
    const frameH =
      FRAME_TITLE_HEIGHT_PX +
      FRAME_PADDING_PX * 2 +
      rows * maxH +
      (rows - 1) * NOTE_GAP_PX;
    const frameX = cursorX;
    const frameY = rowY;
    const placements = groupNotes.map((note, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      return {
        noteId: note.id,
        x: Math.round(frameX + FRAME_PADDING_PX + col * (maxW + NOTE_GAP_PX)),
        y: Math.round(
          frameY + FRAME_TITLE_HEIGHT_PX + FRAME_PADDING_PX + row * (maxH + NOTE_GAP_PX),
        ),
      };
    });
    placed.push({
      keyword: group.keyword,
      title: titleCaseKeyword(group.keyword),
      color: FRAME_COLORS[index % FRAME_COLORS.length],
      frame: {
        x: Math.round(frameX),
        y: Math.round(frameY),
        w: Math.round(frameW),
        h: Math.round(frameH),
      },
      placements,
    });
    noteCount += groupNotes.length;
    cursorX = frameX + frameW + FRAME_GAP_PX;
  });
  if (placed.length === 0) return null;
  return { groups: placed, noteCount, frameCount: placed.length };
}
