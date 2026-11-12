import * as Y from "yjs";
import {
  asTextFontSize,
  type NoteColor,
  type TextBox,
  type TextFontSize,
} from "@syncboard/shared";

// One text box inside the shared document: a Y.Map whose fields
// are plain values (x, y, w, h, a font-size name, a color name)
// plus a Y.Text for the text, so two people can type in the same
// box at once — the same shape as a note, minus the background.
export type TextMap = Y.Map<unknown>;

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNoteColor(value: unknown): NoteColor {
  return typeof value === "string" &&
    (value === "yellow" ||
      value === "pink" ||
      value === "green" ||
      value === "blue" ||
      value === "purple" ||
      value === "orange")
    ? value
    : "yellow";
}

// Reads one text box out of the shared document into a plain
// object React can render. Unknown or missing fields fall back
// to defaults instead of crashing the board.
export function readTextBox(id: string, textMap: TextMap): TextBox {
  const text = textMap.get("text");
  return {
    id,
    x: asNumber(textMap.get("x"), 0),
    y: asNumber(textMap.get("y"), 0),
    w: asNumber(textMap.get("w"), 240),
    h: asNumber(textMap.get("h"), 80),
    fontSize: asTextFontSize(textMap.get("fontSize")),
    color: asNoteColor(textMap.get("color")),
    text: text instanceof Y.Text ? text.toString() : "",
  };
}

// Builds the Y.Map for a text box, ready to be put into the
// shared "texts" map. The caller wraps the put in a transact
// stamped with the local origin, so undo can track it.
export function buildTextMap(textBox: TextBox): TextMap {
  const textMap = new Y.Map<unknown>();
  textMap.set("x", textBox.x);
  textMap.set("y", textBox.y);
  textMap.set("w", textBox.w);
  textMap.set("h", textBox.h);
  textMap.set("fontSize", textBox.fontSize);
  textMap.set("color", textBox.color);
  textMap.set("text", new Y.Text(textBox.text));
  return textMap;
}

// The text color for each note color. Note colors are pale fills,
// made for sticky-note backgrounds — text in the same pale hex
// would be nearly invisible on a white board, so text boxes get
// a stronger shade of the same color, like shape outlines.
export const TEXT_COLORS: Record<NoteColor, string> = {
  yellow: "#854d0e",
  pink: "#be185d",
  green: "#15803d",
  blue: "#1d4ed8",
  purple: "#6d28d9",
  orange: "#c2410c",
};

// Updates a text box's font size. The caller wraps this in a
// transact stamped with the local origin.
export function setTextFontSize(textMap: TextMap, fontSize: TextFontSize): void {
  textMap.set("fontSize", fontSize);
}
