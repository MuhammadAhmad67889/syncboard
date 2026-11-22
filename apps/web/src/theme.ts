/**
 * The theme system. A theme is a set of CSS variables in tokens.css,
 * selected by the `data-theme` attribute on <html>. This module is
 * the one place that knows the theme names, the storage key, and how
 * a stored value is validated — index.html carries a tiny inline
 * copy of the read-and-apply logic so the right theme is on <html>
 * before first paint (no flash of the wrong theme). Keep the names
 * here and in index.html in sync.
 */

export type ThemeName = "dark" | "light" | "dose";

/** Every theme the picker offers, in display order. */
export const THEMES: { name: ThemeName; label: string }[] = [
  { name: "dark", label: "Dark" },
  { name: "light", label: "Light" },
  { name: "dose", label: "Dose" },
];

/** What a first visit (or a broken stored value) gets. */
export const DEFAULT_THEME: ThemeName = "dark";

/** localStorage key the choice is saved under. */
export const THEME_STORAGE_KEY = "syncboard-theme";

/** True when the value is one of the known theme names. */
export function isThemeName(value: unknown): value is ThemeName {
  return value === "dark" || value === "light" || value === "dose";
}

/**
 * Turns whatever was stored (possibly nothing, possibly junk from an
 * older build) into a theme we can actually apply. Older builds
 * stored the Dark and Light themes under longer names ending in
 * "-dark" / "-light"; those map to the current names so existing
 * users keep the theme they picked.
 */
export function resolveTheme(stored: string | null | undefined): ThemeName {
  if (isThemeName(stored)) return stored;
  if (typeof stored === "string" && stored.endsWith("-dark")) return "dark";
  if (typeof stored === "string" && stored.endsWith("-light")) return "light";
  return DEFAULT_THEME;
}

/** Reads the saved theme; falls back to the default when storage is unavailable. */
export function getStoredTheme(): ThemeName {
  try {
    return resolveTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Applies a theme: puts it on <html> so the CSS variables switch,
 * and saves it so the next visit starts with it. Safe to call
 * outside a browser (tests) — it just does nothing there.
 */
export function applyTheme(theme: ThemeName): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (privacy mode) — the theme still
    // applies for this visit, it just won't be remembered.
  }
}
