import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "./shortcuts";

describe("SHORTCUTS", () => {
  it("lists the board's real shortcuts", () => {
    const keys = SHORTCUTS.map((shortcut) => shortcut.keys);
    expect(keys).toContain("Ctrl / Cmd + Z");
    expect(keys).toContain("Delete / Backspace");
    expect(keys).toContain("Escape");
    expect(keys).toContain("?");
  });

  it("has no duplicate keys and no empty rows", () => {
    const keys = SHORTCUTS.map((shortcut) => shortcut.keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.trim().length).toBeGreaterThan(0);
      expect(shortcut.action.trim().length).toBeGreaterThan(0);
    }
  });
});
