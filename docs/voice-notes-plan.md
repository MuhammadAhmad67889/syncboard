# Voice notes — recordings pinned to the board

## What it is

A "Voice" button in the left tool rail, next to Image. Click
it, then click anywhere on the board: a pin drops there and
recording starts right away. The pin shows a pulsing red dot
and a running timer while recording, with Stop to save the
clip and × to throw it away. Anyone on the board can play a
saved note — a play button and its duration, "0:12" — and it
syncs to everyone like any other item.

## Recording

- The browser MediaRecorder API, with the microphone the
  user already allowed. The format is the first the browser
  offers: opus in WebM, then plain WebM, then mp4 (Safari).
- Each note is capped at 60 seconds: the recorder stops by
  itself, and the pin's timer counts up to it. Escape cancels
  a recording in progress.
- If the microphone is denied or unavailable, the pin goes
  away and a plain message says so — no broken pin is left
  behind. Cancelling also leaves nothing behind: the pin is
  local until a finished clip is saved.
- A clip over ~2 MB is rejected with a message instead of
  landing on the board. Sixty seconds of opus audio is a few
  hundred kilobytes, so the cap is a safety net, not a normal
  limit.

## Storage

- Audio lives in the shared document in a new root map
  "voiceNotes", as a data URL — the same approach as images.
  A note stores its position, the data URL, and the duration
  the recorder measured, so the pin shows the length without
  loading the audio.
- A voice note is a fixed-size pin (72×72), not a resizable
  box. It can be moved and deleted like other items, moves
  with its frame when the frame drags, and is covered by the
  same per-user undo stack.

## Export

- JSON export includes voice notes (as metadata with the data
  URL), and JSON import restores them. Old exports without a
  voiceNotes list still import — with no voice notes.
- PNG export does NOT include voice notes: a PNG cannot
  carry audio, so they are left out of the picture. The
  snapshot counts line does list them ("1 voice note").
- Snapshots include voice notes in the saved state, so a
  restore brings them back.

## What it does NOT do

- No transcription, no waveform, no trimming, no volume
  control — play and pause only.
- No live listening: a recording is heard only after it is
  saved, never while it is being made.
- Voice notes are not connector endpoints and not vote
  targets, like images.

## Files

- `packages/shared/src/index.ts` — `VoiceNote` type,
  `createVoiceNote`, `VOICE_NOTE_SIZE`, and `voiceNotes` in
  `SnapshotCounts`.
- `apps/web/src/voiceNotes.ts` (new) — data-URL helpers,
  the `VoiceRecorder` state machine (idle → recording →
  done/error, cancel back to idle), and the Y.Map read/build
  helpers.
- `apps/web/src/voiceNotes.test.ts` (new) — mime-type
  picking, duration formatting, size caps, data-URL helpers,
  the Y.Doc round-trip, and the recorder with a fake
  MediaRecorder and fake timers.
- `apps/web/src/export.ts` — `voiceNotes` in `BoardExport`,
  parse, apply, and read-back.
- `apps/web/src/snapshots.ts` — the counts label lists voice
  notes.
- `apps/sync-server/src/persistence.ts` — snapshot counts
  include voice notes.
- `apps/web/src/App.tsx` — the Voice rail button, the
  click-to-record flow, the recording pin, playback (one note
  at a time), drag, delete, frame membership, minimap, and
  the import/export messages.
- `apps/web/src/App.css` — the pin, play button, recording
  dot (still under reduced motion), and Stop button.
