import * as Y from "yjs";
import { createVoiceNote, type VoiceNote } from "@syncboard/shared";

// One voice note inside the shared document: a Y.Map whose
// fields are plain values (x, y, duration) plus the recording
// itself as a data URL string. The clip is capped before
// storing (see MAX_VOICE_NOTE_BYTES), so one note is a couple
// of megabytes at most — an uncapped recording would bloat the
// document every client syncs.
export type VoiceMap = Y.Map<unknown>;

// The longest one voice note can run, in seconds. The recorder
// stops by itself at the cap, so a forgotten recording never
// grows without bound.
export const MAX_VOICE_NOTE_SECONDS = 60;

// The biggest recording the board will store, in bytes. A
// bigger clip is rejected with a message instead of landing on
// the board. Sixty seconds of opus audio is a few hundred
// kilobytes, so the cap is a safety net, not a normal limit.
export const MAX_VOICE_NOTE_BYTES = 2 * 1024 * 1024;

// The audio formats the recorder tries, in order. Opus in
// WebM is small and every Chromium and Firefox browser records
// it; mp4 is the fallback where WebM is not offered (Safari).
export const PREFERRED_AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

// The format to record in: the first preferred format this
// browser says it supports. Undefined when none is supported —
// the caller then lets the browser pick, and reports an error
// if recording still fails.
export function pickAudioMimeType(
  isSupported: (mimeType: string) => boolean,
): string | undefined {
  for (const mimeType of PREFERRED_AUDIO_MIME_TYPES) {
    try {
      if (isSupported(mimeType)) return mimeType;
    } catch {
      // A browser that throws on an unknown format is saying
      // no — try the next one.
    }
  }
  return undefined;
}

// A duration as "m:ss" — "0:07", "1:05". The pin shows this,
// so the user knows how long a note plays without loading it.
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

// Whether a blob is too big to store as a voice note. The cap
// is on the recorded clip itself — the data URL it becomes is
// about a third bigger, and that is already accounted for by
// keeping the cap small.
export function isVoiceNoteOversize(byteSize: number): boolean {
  return byteSize > MAX_VOICE_NOTE_BYTES;
}

// Whether a data URL holds audio the board can play. Anything
// else — an image, a plain string — is not a voice note.
export function isSupportedAudioDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith("data:audio/");
}

// The byte size a base64 data URL decodes to. Used to check a
// stored note against the cap without decoding it.
export function dataUrlByteSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  const payload = dataUrl.slice(comma + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

// Turns a recorded blob into the data URL the document stores.
// Built from the raw bytes (arrayBuffer + btoa) instead of
// FileReader, so it works the same in the browser and in tests.
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || "audio/webm"};base64,${btoa(binary)}`;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asDataUrl(value: unknown): string {
  return typeof value === "string" && value.startsWith("data:audio/") ? value : "";
}

// Reads one voice note out of the shared document into a plain
// object React can render. Unknown or missing fields fall back
// to defaults instead of crashing the board. A note with no
// audio is not a voice note — it is dropped by the caller.
export function readVoiceNote(id: string, voiceMap: VoiceMap): VoiceNote {
  return {
    id,
    x: asNumber(voiceMap.get("x"), 0),
    y: asNumber(voiceMap.get("y"), 0),
    dataUrl: asDataUrl(voiceMap.get("dataUrl")),
    durationSeconds: Math.max(0, asNumber(voiceMap.get("durationSeconds"), 0)),
  };
}

// Builds the Y.Map for a voice note, ready to be put into the
// shared "voiceNotes" map. The caller wraps the put in a
// transact stamped with the local origin, so undo can track it.
export function buildVoiceNoteMap(note: VoiceNote): VoiceMap {
  const voiceMap = new Y.Map<unknown>();
  voiceMap.set("x", note.x);
  voiceMap.set("y", note.y);
  voiceMap.set("dataUrl", note.dataUrl);
  voiceMap.set("durationSeconds", note.durationSeconds);
  return voiceMap;
}

// Builds a voice note for a fresh recording: the pin sits at
// the click point, with the recorded audio and the duration the
// recorder measured.
export function buildVoiceNote(
  id: string,
  x: number,
  y: number,
  dataUrl: string,
  durationSeconds: number,
): VoiceNote {
  return createVoiceNote(id, x, y, dataUrl, durationSeconds);
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

// The two browser pieces recording needs, as injectable
// dependencies — so tests can pass fakes and the app passes the
// real navigator.mediaDevices and window.MediaRecorder.
export interface VoiceRecorderDeps {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorderCtor: typeof MediaRecorder;
}

export interface VoiceRecorderEvents {
  onElapsed: (seconds: number) => void;
  onStop: (blob: Blob, durationSeconds: number) => void;
  onError: (message: string) => void;
}

export type VoiceRecorderState = "idle" | "recording" | "done" | "error";

// One microphone recording. The state machine is small on
// purpose: idle → recording → done (or error), with cancel
// taking it back to idle without saving anything.
//
// - start() asks for the microphone and begins recording. The
//   elapsed time ticks once a second, and recording stops by
//   itself at the cap — the caller never watches the clock.
// - stop() ends the recording and hands the clip to onStop.
// - cancel() throws the recording away: no clip, no error.
// - A denied or missing microphone reports an error instead of
//   throwing, so the caller can show a plain message.
export class VoiceRecorder {
  state: VoiceRecorderState = "idle";
  elapsedSeconds = 0;

  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private finished = false;

  constructor(
    private readonly deps: VoiceRecorderDeps,
    private readonly events: VoiceRecorderEvents,
  ) {}

  async start(): Promise<void> {
    if (this.state === "recording") return;
    let stream: MediaStream;
    try {
      stream = await this.deps.getUserMedia({ audio: true });
    } catch {
      this.state = "error";
      this.events.onError(
        "Microphone access was denied — allow the microphone to record a voice note.",
      );
      return;
    }
    this.stream = stream;
    const isSupported =
      typeof this.deps.MediaRecorderCtor.isTypeSupported === "function"
        ? (mime: string) => this.deps.MediaRecorderCtor.isTypeSupported(mime)
        : () => false;
    const mimeType = pickAudioMimeType(isSupported);
    let recorder: MediaRecorder;
    try {
      recorder =
        mimeType !== undefined
          ? new this.deps.MediaRecorderCtor(stream, { mimeType })
          : new this.deps.MediaRecorderCtor(stream);
    } catch {
      this.stopTracks();
      this.state = "error";
      this.events.onError("This browser cannot record audio.");
      return;
    }
    this.recorder = recorder;
    this.chunks = [];
    this.finished = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onstop = () => {
      this.finish();
    };
    this.startedAt = Date.now();
    this.elapsedSeconds = 0;
    this.state = "recording";
    recorder.start();
    this.timer = setInterval(() => {
      this.elapsedSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
      this.events.onElapsed(this.elapsedSeconds);
      if (this.elapsedSeconds >= MAX_VOICE_NOTE_SECONDS) this.stop();
    }, 1000);
  }

  stop(): void {
    if (this.state !== "recording" || !this.recorder) return;
    try {
      this.recorder.stop();
    } catch {
      // Already stopped: onstop still fires and finishes.
    }
  }

  cancel(): void {
    if (this.state !== "recording") return;
    // Swallow the onstop that follows: a cancelled recording
    // saves nothing and reports nothing.
    this.finished = true;
    this.stopTimer();
    try {
      this.recorder?.stop();
    } catch {
      // Already stopped — nothing left to do.
    }
    this.stopTracks();
    this.recorder = null;
    this.state = "idle";
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.stopTimer();
    this.stopTracks();
    this.state = "done";
    const mimeType = this.recorder?.mimeType || "audio/webm";
    const blob = new Blob(this.chunks, { type: mimeType });
    // At least one second: a tap that records for less still
    // made a note, and "0:00" would look broken.
    const durationSeconds = Math.max(
      1,
      Math.round((Date.now() - this.startedAt) / 1000),
    );
    this.events.onStop(blob, durationSeconds);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Releases the microphone. Called on every exit path, so the
  // browser's recording dot never lingers after the note ends.
  private stopTracks(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }
}
