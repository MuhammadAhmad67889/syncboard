import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  asTextFontSize,
  createTextBox,
  FONT_SIZE_PX,
  type TextBox,
} from "@syncboard/shared";
import { buildTextMap, readTextBox, setTextFontSize } from "./texts";

describe("asTextFontSize", () => {
  it("accepts the three named sizes", () => {
    expect(asTextFontSize("small")).toBe("small");
    expect(asTextFontSize("medium")).toBe("medium");
    expect(asTextFontSize("large")).toBe("large");
  });

  it("falls back to medium for anything unknown", () => {
    expect(asTextFontSize("huge")).toBe("medium");
    expect(asTextFontSize(undefined)).toBe("medium");
    expect(asTextFontSize(18)).toBe("medium");
  });
});

describe("FONT_SIZE_PX", () => {
  it("grows from small to large", () => {
    expect(FONT_SIZE_PX.small).toBeLessThan(FONT_SIZE_PX.medium);
    expect(FONT_SIZE_PX.medium).toBeLessThan(FONT_SIZE_PX.large);
  });
});

describe("createTextBox", () => {
  it("builds an empty text box", () => {
    const box = createTextBox("t1", 10, 20, 240, 80, "medium", "blue");
    expect(box).toEqual({
      id: "t1",
      x: 10,
      y: 20,
      w: 240,
      h: 80,
      fontSize: "medium",
      color: "blue",
      text: "",
    });
  });

  it("keeps the text it is given", () => {
    const box = createTextBox("t2", 0, 0, 240, 80, "large", "pink", "Hello");
    expect(box.text).toBe("Hello");
  });
});

describe("buildTextMap / readTextBox", () => {
  it("round-trips a text box through a Y.Doc", () => {
    const doc = new Y.Doc();
    const textsMap = doc.getMap<Y.Map<unknown>>("texts");
    const box = createTextBox("t1", 10, 20, 240, 80, "large", "green", "Hello board");
    doc.transact(() => {
      textsMap.set(box.id, buildTextMap(box));
    });
    const stored = textsMap.get("t1");
    expect(stored).toBeDefined();
    expect(readTextBox("t1", stored!)).toEqual(box);
  });

  it("falls back to defaults for a malformed text box", () => {
    const textMap = new Y.Map<unknown>();
    textMap.set("fontSize", "huge");
    textMap.set("x", "not a number");
    expect(readTextBox("bad", textMap)).toEqual({
      id: "bad",
      x: 0,
      y: 0,
      w: 240,
      h: 80,
      fontSize: "medium",
      color: "yellow",
      text: "",
    });
  });

  it("changes the font size on the stored box", () => {
    const doc = new Y.Doc();
    const textsMap = doc.getMap<Y.Map<unknown>>("texts");
    const box: TextBox = {
      id: "t1",
      x: 0,
      y: 0,
      w: 240,
      h: 80,
      fontSize: "medium",
      color: "blue",
      text: "Hi",
    };
    doc.transact(() => {
      textsMap.set(box.id, buildTextMap(box));
    });
    const stored = textsMap.get("t1")!;
    doc.transact(() => {
      setTextFontSize(stored, "small");
    });
    expect(readTextBox("t1", stored).fontSize).toBe("small");
  });

  it("keeps typing live in the shared Y.Text", () => {
    const doc = new Y.Doc();
    const textsMap = doc.getMap<Y.Map<unknown>>("texts");
    const box = createTextBox("t1", 0, 0, 240, 80, "medium", "blue");
    doc.transact(() => {
      textsMap.set(box.id, buildTextMap(box));
    });
    const stored = textsMap.get("t1")!;
    const text = stored.get("text");
    expect(text).toBeInstanceOf(Y.Text);
    doc.transact(() => {
      (text as Y.Text).insert(0, "typed live");
    });
    expect(readTextBox("t1", stored).text).toBe("typed live");
  });
});
