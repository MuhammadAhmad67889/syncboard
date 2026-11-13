import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  canPlaceVote,
  countItemVotes,
  countUserVotes,
  createVote,
  remainingDots,
  votesInSession,
  type Vote,
  type VotingSession,
} from "@syncboard/shared";
import { buildVoteMap, readVote, readVotingSession, writeVotingSession } from "./votes";

describe("createVote", () => {
  it("builds a vote with the values it is given", () => {
    expect(createVote("v1", "note-1", "user-1", "Sara", 2)).toEqual({
      id: "v1",
      itemId: "note-1",
      userId: "user-1",
      userName: "Sara",
      session: 2,
    });
  });
});

describe("votesInSession", () => {
  const votes: Vote[] = [
    createVote("v1", "note-1", "user-1", "Sara", 1),
    createVote("v2", "note-1", "user-1", "Sara", 1),
    createVote("v3", "note-1", "user-1", "Sara", 2),
    createVote("v4", "note-2", "user-2", "Ali", 2),
  ];

  it("keeps only the dots from the given session", () => {
    expect(votesInSession(votes, 1).map((vote) => vote.id)).toEqual(["v1", "v2"]);
    expect(votesInSession(votes, 2).map((vote) => vote.id)).toEqual(["v3", "v4"]);
  });

  it("finds nothing for a session with no dots", () => {
    expect(votesInSession(votes, 3)).toEqual([]);
  });

  it("lets the limit count only the new session's dots", () => {
    // Two dots in session 1, then a fresh session 2: the user
    // still has all 3 dots to place, because the old ones do
    // not count toward the new allocation.
    expect(remainingDots(votesInSession(votes, 2), "user-1", 3)).toBe(2);
    expect(canPlaceVote(votesInSession(votes, 2), "user-1", 3)).toBe(true);
    expect(remainingDots(votesInSession(votes, 1), "user-1", 3)).toBe(1);
  });

  it("still counts every dot on one item, across sessions", () => {
    // The badge total never filters by session: three dots sit
    // on note-1, two from session 1 and one from session 2.
    expect(countItemVotes(votes, "note-1")).toBe(3);
  });
});

describe("countUserVotes / countItemVotes / remainingDots / canPlaceVote", () => {
  const votes: Vote[] = [
    createVote("v1", "note-1", "user-1", "Sara", 1),
    createVote("v2", "note-1", "user-1", "Sara", 1),
    createVote("v3", "note-2", "user-2", "Ali", 1),
  ];

  it("counts one person's dots across items", () => {
    expect(countUserVotes(votes, "user-1")).toBe(2);
    expect(countUserVotes(votes, "user-2")).toBe(1);
    expect(countUserVotes(votes, "nobody")).toBe(0);
  });

  it("counts every dot on one item", () => {
    expect(countItemVotes(votes, "note-1")).toBe(2);
    expect(countItemVotes(votes, "note-2")).toBe(1);
    expect(countItemVotes(votes, "note-3")).toBe(0);
  });

  it("reports the dots one person still has", () => {
    expect(remainingDots(votes, "user-1", 3)).toBe(1);
    expect(remainingDots(votes, "user-2", 3)).toBe(2);
    expect(remainingDots(votes, "nobody", 3)).toBe(3);
  });

  it("never reports a negative remainder", () => {
    expect(remainingDots(votes, "user-1", 1)).toBe(0);
  });

  it("allows a vote only while dots are left", () => {
    expect(canPlaceVote(votes, "user-1", 3)).toBe(true);
    expect(canPlaceVote(votes, "user-1", 2)).toBe(false);
    expect(canPlaceVote(votes, "nobody", 3)).toBe(true);
  });
});

describe("buildVoteMap / readVote", () => {
  it("round-trips a vote through a Y.Doc", () => {
    const doc = new Y.Doc();
    const votesMap = doc.getMap<Y.Map<unknown>>("votes");
    const vote = createVote("v1", "note-1", "user-1", "Sara", 2);
    doc.transact(() => {
      votesMap.set(vote.id, buildVoteMap(vote));
    });
    const stored = votesMap.get("v1");
    expect(stored).toBeDefined();
    expect(readVote("v1", stored!)).toEqual(vote);
  });

  it("falls back to defaults for a malformed vote", () => {
    const voteMap = new Y.Map<unknown>();
    voteMap.set("itemId", 42);
    expect(readVote("bad", voteMap)).toEqual({
      id: "bad",
      itemId: "",
      userId: "",
      userName: "",
      session: 0,
    });
  });

  it("reads a vote with no session field as session 0", () => {
    const voteMap = new Y.Map<unknown>();
    voteMap.set("itemId", "note-1");
    voteMap.set("userId", "user-1");
    voteMap.set("userName", "Sara");
    expect(readVote("old", voteMap).session).toBe(0);
  });
});

describe("readVotingSession / writeVotingSession", () => {
  it("round-trips a session through a Y.Doc", () => {
    const doc = new Y.Doc();
    const votingMap = doc.getMap<unknown>("voting");
    const session: VotingSession = {
      active: true,
      dotsPerPerson: 5,
      startedBy: "user-1",
      startedByName: "Sara",
      session: 2,
    };
    doc.transact(() => {
      writeVotingSession(votingMap, session);
    });
    expect(readVotingSession(votingMap)).toEqual(session);
  });

  it("reads no session from an empty map", () => {
    const votingMap = new Y.Map<unknown>();
    expect(readVotingSession(votingMap)).toBeNull();
  });

  it("reads a session with no number as session 0", () => {
    const doc = new Y.Doc();
    const votingMap = doc.getMap<unknown>("voting");
    doc.transact(() => {
      votingMap.set("active", true);
      votingMap.set("dotsPerPerson", 3);
      votingMap.set("startedBy", "user-1");
      votingMap.set("startedByName", "Sara");
    });
    expect(readVotingSession(votingMap)?.session).toBe(0);
  });

  it("falls back to the default dots per person", () => {
    const doc = new Y.Doc();
    const votingMap = doc.getMap<unknown>("voting");
    doc.transact(() => {
      writeVotingSession(votingMap, {
        active: false,
        dotsPerPerson: 0,
        startedBy: "user-1",
        startedByName: "Sara",
        session: 1,
      });
    });
    expect(readVotingSession(votingMap)?.dotsPerPerson).toBe(3);
  });

  it("round-trips an ended session", () => {
    const doc = new Y.Doc();
    const votingMap = doc.getMap<unknown>("voting");
    doc.transact(() => {
      writeVotingSession(votingMap, {
        active: false,
        dotsPerPerson: 3,
        startedBy: "user-1",
        startedByName: "Sara",
        session: 1,
      });
    });
    expect(readVotingSession(votingMap)?.active).toBe(false);
  });
});
