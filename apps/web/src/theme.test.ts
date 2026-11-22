import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEMES, isThemeName, resolveTheme } from "./theme";

describe("isThemeName", () => {
  it("accepts every theme the picker offers", () => {
    for (const theme of THEMES) {
      expect(isThemeName(theme.name)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isThemeName("solarized")).toBe(false);
    expect(isThemeName("")).toBe(false);
    expect(isThemeName(null)).toBe(false);
    expect(isThemeName(undefined)).toBe(false);
    expect(isThemeName(42)).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("keeps a valid stored theme", () => {
    expect(resolveTheme("dose")).toBe("dose");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("maps legacy longer names to the current themes", () => {
    expect(resolveTheme("old-dark")).toBe("dark");
    expect(resolveTheme("old-light")).toBe("light");
  });

  it("falls back to the default for missing or junk values", () => {
    expect(resolveTheme(null)).toBe(DEFAULT_THEME);
    expect(resolveTheme(undefined)).toBe(DEFAULT_THEME);
    expect(resolveTheme("solarized")).toBe(DEFAULT_THEME);
  });

  it("defaults to Dark", () => {
    expect(DEFAULT_THEME).toBe("dark");
  });
});
