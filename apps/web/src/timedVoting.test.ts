import { describe, expect, it } from "vitest";
import {
  createVote,
  formatSessionCountdown,
  isTimedSessionRunning,
  remainingSessionMs,
  visibleVotes,
  type Vote,
  type VotingSession,
} from "@syncboard/shared";

function timedSession(overrides: Partial<VotingSession> = {}): VotingSession {
  return {
    active: true,
    dotsPerPerson: 3,
    startedBy: "user-1",
    startedByName: "Sara",
    session: 2,
    timed: true,
    endsAt: 10_000,
    ...overrides,
  };
}

describe("isTimedSessionRunning", () => {
  it("runs while the clock is ahead of the end time", () => {
    expect(isTimedSessionRunning(timedSession(), 9_999)).toBe(true);
  });

  it("stops the moment the end time arrives", () => {
    expect(isTimedSessionRunning(timedSession(), 10_000)).toBe(false);
    expect(isTimedSessionRunning(timedSession(), 10_001)).toBe(false);
  });

  it("is false for a plain open session", () => {
    expect(isTimedSessionRunning(timedSession({ timed: false, endsAt: 0 }), 5_000)).toBe(false);
  });

  it("is false for a timed session that already ended", () => {
    expect(isTimedSessionRunning(timedSession({ active: false }), 5_000)).toBe(false);
  });

  it("is false when there is no session", () => {
    expect(isTimedSessionRunning(null, 5_000)).toBe(false);
  });

  it("is false for a timed session with no end time", () => {
    // endsAt 0 means the record never carried a time: it
    // cannot be running, so nothing stays hidden by mistake.
    expect(isTimedSessionRunning(timedSession({ endsAt: 0 }), 5_000)).toBe(false);
  });
});

describe("remainingSessionMs", () => {
  it("reports the time left", () => {
    expect(remainingSessionMs(timedSession(), 7_500)).toBe(2_500);
  });

  it("never goes below zero", () => {
    expect(remainingSessionMs(timedSession(), 99_000)).toBe(0);
  });
});

describe("formatSessionCountdown", () => {
  it("shows minutes and two-digit seconds", () => {
    expect(formatSessionCountdown(154_000)).toBe("2:34");
    expect(formatSessionCountdown(60_000)).toBe("1:00");
    expect(formatSessionCountdown(7_000)).toBe("0:07");
  });

  it("rounds a partial second up, so the clock never jumps to 0:00 early", () => {
    expect(formatSessionCountdown(1)).toBe("0:01");
    expect(formatSessionCountdown(59_500)).toBe("1:00");
  });

  it("shows 0:00 at and past the end", () => {
    expect(formatSessionCountdown(0)).toBe("0:00");
    expect(formatSessionCountdown(-5_000)).toBe("0:00");
  });
});

describe("visibleVotes", () => {
  const votes: Vote[] = [
    createVote("v1", "note-1", "user-1", "Sara", 2),
    createVote("v2", "note-1", "user-2", "Ali", 2),
    createVote("v3", "note-2", "user-2", "Ali", 2),
    // An old dot from the previous session, already public.
    createVote("v4", "note-1", "user-2", "Ali", 1),
  ];

  it("hides everyone else's current-session dots while the clock runs", () => {
    const seen = visibleVotes(votes, timedSession(), "user-1", 5_000).map((vote) => vote.id);
    expect(seen).toEqual(["v1", "v4"]);
  });

  it("shows a voter their own dots and nothing else new", () => {
    const seen = visibleVotes(votes, timedSession(), "user-2", 5_000).map((vote) => vote.id);
    expect(seen).toEqual(["v2", "v3", "v4"]);
  });

  it("reveals every dot once the clock runs out", () => {
    const seen = visibleVotes(votes, timedSession(), "user-1", 10_000).map((vote) => vote.id);
    expect(seen).toEqual(["v1", "v2", "v3", "v4"]);
  });

  it("reveals every dot once the session is ended", () => {
    const seen = visibleVotes(votes, timedSession({ active: false }), "user-1", 5_000).map(
      (vote) => vote.id,
    );
    expect(seen).toEqual(["v1", "v2", "v3", "v4"]);
  });

  it("shows every dot for plain open voting", () => {
    const seen = visibleVotes(
      votes,
      timedSession({ timed: false, endsAt: 0 }),
      "user-1",
      5_000,
    ).map((vote) => vote.id);
    expect(seen).toEqual(["v1", "v2", "v3", "v4"]);
  });

  it("shows every dot when there is no session", () => {
    expect(visibleVotes(votes, null, "user-1", 5_000)).toEqual(votes);
  });
});
