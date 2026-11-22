// The keyboard shortcuts the board actually answers to, for the
// shortcuts panel. Every entry here is a real key handler in
// App.tsx — the panel lists what works, nothing more. When a
// handler is added or removed, this list changes with it.

export interface Shortcut {
  // The keys, as the panel shows them: "Ctrl / Cmd + Z".
  keys: string;
  // What the shortcut does, in plain words.
  action: string;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: "Ctrl / Cmd + Z", action: "Undo" },
  { keys: "Ctrl / Cmd + Shift + Z", action: "Redo" },
  { keys: "Ctrl + Y", action: "Redo" },
  { keys: "Delete / Backspace", action: "Delete the selected item" },
  {
    keys: "Escape",
    action: "Back to the Select tool (cancels a connector, comment, or recording)",
  },
  { keys: "?", action: "Show or hide this panel" },
  { keys: "→ / ↓ (presenting)", action: "Next slide" },
  { keys: "← / ↑ (presenting)", action: "Previous slide" },
  { keys: "Escape (presenting)", action: "Leave present mode" },
];
