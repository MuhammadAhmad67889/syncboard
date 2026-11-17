import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createVoiceNote } from "@syncboard/shared";
import {
  blobToDataUrl,
  buildVoiceNoteMap,
  dataUrlByteSize,
  formatDuration,
  isSupportedAudioDataUrl,
  isVoiceNoteOversize,
  MAX_VOICE_NOTE_BYTES,
  MAX_VOICE_NOTE_SECONDS,
  pickAudioMimeType,
  readVoiceNote,
  VoiceRecorder,
  type VoiceRecorderDeps,
  type VoiceRecorderEvents,
} from "./voiceNotes";

const WEBM_CLIP = "data:audio/webm;base64,AAAA";

describe("pickAudioMimeType", () => {
  it("prefers opus in WebM when the browser offers it", () => {
    expect(
      pickAudioMimeType((mime) => mime === "audio/webm;codecs=opus"),
    ).toBe("audio/webm;codecs=opus");
  });

  it("falls back to plain WebM, then mp4", () => {
    expect(pickAudioMimeType((mime) => mime === "audio/webm")).toBe("audio/webm");
    expect(pickAudioMimeType((mime) => mime === "audio/mp4")).toBe("audio/mp4");
  });

  it("returns undefined when nothing is supported", () => {
    expect(pickAudioMimeType(() => false)).toBeUndefined();
  });

  it("skips a format whose check throws", () => {
    expect(
      pickAudioMimeType((mime) => {
        if (mime === "audio/webm;codecs=opus") throw new Error("nope");
        return mime === "audio/webm";
      }),
    ).toBe("audio/webm");
  });
});

describe("formatDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(65)).toBe("1:05");
  });

  it("never goes below zero", () => {
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("isVoiceNoteOversize", () => {
  it("rejects a clip over the cap and accepts one at it", () => {
    expect(isVoiceNoteOversize(MAX_VOICE_NOTE_BYTES + 1)).toBe(true);
    expect(isVoiceNoteOversize(MAX_VOICE_NOTE_BYTES)).toBe(false);
    expect(isVoiceNoteOversize(1024)).toBe(false);
  });
});

describe("isSupportedAudioDataUrl", () => {
  it("accepts audio data URLs and rejects the rest", () => {
    expect(isSupportedAudioDataUrl(WEBM_CLIP)).toBe(true);
    expect(isSupportedAudioDataUrl("data:audio/mp4;base64,AAAA")).toBe(true);
    expect(isSupportedAudioDataUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isSupportedAudioDataUrl("")).toBe(false);
    expect(isSupportedAudioDataUrl("not a data url")).toBe(false);
  });
});

describe("dataUrlByteSize", () => {
  it("decodes the base64 length back to bytes", () => {
    // "hello" is 5 bytes: aGVsbG8= is 8 chars with one pad.
    expect(dataUrlByteSize("data:audio/webm;base64,aGVsbG8=")).toBe(5);
    expect(dataUrlByteSize("data:audio/webm;base64,AAAA")).toBe(3);
    expect(dataUrlByteSize("not a data url")).toBe(0);
  });
});

describe("blobToDataUrl", () => {
  it("round-trips bytes through a data URL", async () => {
    const blob = new Blob([new Uint8Array([104, 101, 108, 108, 111])], {
      type: "audio/webm",
    });
    expect(await blobToDataUrl(blob)).toBe("data:audio/webm;base64,aGVsbG8=");
  });

  it("falls back to webm when the blob has no type", async () => {
    const blob = new Blob([new Uint8Array([65])]);
    expect(await blobToDataUrl(blob)).toBe("data:audio/webm;base64,QQ==");
  });
});

describe("buildVoiceNoteMap / readVoiceNote", () => {
  it("round-trips a voice note through a Y.Doc", () => {
    const doc = new Y.Doc();
    const voiceNotesMap = doc.getMap<Y.Map<unknown>>("voiceNotes");
    const note = createVoiceNote("v1", 10, 20, WEBM_CLIP, 12);
    doc.transact(() => {
      voiceNotesMap.set(note.id, buildVoiceNoteMap(note));
    });
    const stored = voiceNotesMap.get("v1");
    expect(stored).toBeDefined();
    expect(readVoiceNote("v1", stored!)).toEqual(note);
  });

  it("falls back to defaults for a malformed note", () => {
    const voiceMap = new Y.Map<unknown>();
    voiceMap.set("x", "not a number");
    voiceMap.set("dataUrl", "data:image/png;base64,AAAA");
    voiceMap.set("durationSeconds", -3);
    expect(readVoiceNote("bad", voiceMap)).toEqual({
      id: "bad",
      x: 0,
      y: 0,
      dataUrl: "",
      durationSeconds: 0,
    });
  });
});

// A fake MediaRecorder for the recorder tests: it records the
// options it was built with, fires onstop when stopped, and
// hands back one chunk of fake audio on stop.
class FakeMediaRecorder {
  static isTypeSupported = (mime: string): boolean =>
    mime === "audio/webm;codecs=opus";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly mimeType: string;
  state = "inactive";

  constructor(
    public stream: MediaStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? "";
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["fake-audio"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

function fakeStream(): MediaStream {
  return {
    getTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream;
}

function recorderWith(
  events: VoiceRecorderEvents,
  getUserMedia: VoiceRecorderDeps["getUserMedia"] = async () => fakeStream(),
): VoiceRecorder {
  return new VoiceRecorder(
    {
      getUserMedia,
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
    },
    events,
  );
}

describe("VoiceRecorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records and hands back a clip on stop", async () => {
    const onStop = vi.fn();
    const onElapsed = vi.fn();
    const onError = vi.fn();
    const recorder = recorderWith({ onElapsed, onStop, onError });
    await recorder.start();
    expect(recorder.state).toBe("recording");
    await vi.advanceTimersByTimeAsync(3000);
    expect(onElapsed).toHaveBeenCalledWith(3);
    recorder.stop();
    expect(recorder.state).toBe("done");
    expect(onStop).toHaveBeenCalledTimes(1);
    const blob = onStop.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("audio/webm;codecs=opus");
    expect(blob.size).toBeGreaterThan(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it("stops by itself at the 60-second cap", async () => {
    const onStop = vi.fn();
    const recorder = recorderWith({ onElapsed: () => {}, onStop, onError: () => {} });
    await recorder.start();
    await vi.advanceTimersByTimeAsync(MAX_VOICE_NOTE_SECONDS * 1000);
    expect(recorder.state).toBe("done");
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop.mock.calls[0][1]).toBe(MAX_VOICE_NOTE_SECONDS);
  });

  it("cancelling saves nothing and reports nothing", async () => {
    const onStop = vi.fn();
    const onError = vi.fn();
    const recorder = recorderWith({ onElapsed: () => {}, onStop, onError });
    await recorder.start();
    recorder.cancel();
    expect(recorder.state).toBe("idle");
    expect(onStop).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a plain error when the microphone is denied", async () => {
    const onError = vi.fn();
    const onStop = vi.fn();
    const recorder = recorderWith(
      { onElapsed: () => {}, onStop, onError },
      async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    );
    await recorder.start();
    expect(recorder.state).toBe("error");
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("Microphone access was denied"),
    );
    expect(onStop).not.toHaveBeenCalled();
  });

  it("does nothing on a second start while recording", async () => {
    const getUserMedia = vi.fn(async () => fakeStream());
    const recorder = recorderWith(
      { onElapsed: () => {}, onStop: () => {}, onError: () => {} },
      getUserMedia,
    );
    await recorder.start();
    await recorder.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
