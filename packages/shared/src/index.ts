// Shared types and constants for SyncBoard. This package has no
// dependencies, so the web app and the sync server can both use it
// without pulling in each other's code.

// The six sticky-note colors. The hex values are the note
// backgrounds; the names are what the color picker shows.
export const NOTE_COLORS = {
  yellow: "#fef08a",
  pink: "#fbcfe8",
  green: "#bbf7d0",
  blue: "#bfdbfe",
  purple: "#ddd6fe",
  orange: "#fed7aa",
} as const;

export type NoteColor = keyof typeof NOTE_COLORS;

// One sticky note on the board. Position and size are in board
// pixels; text is plain text here (the live document stores it
// as a Y.Text so two people can type in the same note).
export interface Note {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: NoteColor;
  text: string;
}

// The default size for a newly created note.
export const DEFAULT_NOTE_SIZE = { w: 200, h: 200 } as const;

// One connected user, as shared through the Awareness protocol.
// cursor is null when the pointer is off the board;
// selectedNoteIds lists the notes this user has selected right now.
export interface PresenceUser {
  id: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selectedNoteIds: string[];
}

// A demo user for the Phase 1 sign-in. These are hardcoded on
// purpose: there are no real accounts yet, and the demo just needs
// a few named people so two browser tabs can be two different
// users. The color is the user's cursor and presence color
// (Phase 2 reuses it).
export interface DemoUser {
  id: string;
  name: string;
  color: string;
}

export const DEMO_USERS: DemoUser[] = [
  { id: "ahmad", name: "Ahmad", color: "#2563eb" },
  { id: "sara", name: "Sara", color: "#db2777" },
  { id: "omar", name: "Omar", color: "#059669" },
];

// Environment variable names used across the repo, kept in one
// place so a rename only touches this file.
export const ENV_VARS = {
  // Web app: the websocket URL of the sync server.
  syncUrl: "VITE_SYNC_URL",
  // Sync server: the port it listens on.
  syncPort: "SYNC_PORT",
  // Sync server: the secret used to sign and verify JWTs.
  jwtSecret: "JWT_SECRET",
} as const;
