import * as Y from "yjs";
import {
  DEFAULT_DOTS_PER_PERSON,
  type Vote,
  type VotingSession,
} from "@syncboard/shared";

// One vote inside the shared document: a Y.Map whose fields
// are plain values (which item, who placed it, and their name).
export type VoteMap = Y.Map<unknown>;

// The voting session inside the shared document: one Y.Map
// whose fields are the session state (open or ended, dots per
// person, who started it). It is a separate map from "votes"
// because the session is one small record while the votes are
// a growing list — and because undo tracks the votes map only,
// so starting or ending a session is never an undo step.
export type VotingMap = Y.Map<unknown>;

function asText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asDotsPerPerson(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_DOTS_PER_PERSON;
}

function asSession(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

// Reads one vote out of the shared document into a plain
// object React can render. Unknown or missing fields fall back
// to defaults instead of crashing the board. A vote with no
// session field was placed before sessions were numbered, so
// it reads as session 0 — an old dot, never part of the
// current session's allocation.
export function readVote(id: string, voteMap: VoteMap): Vote {
  return {
    id,
    itemId: asText(voteMap.get("itemId"), ""),
    userId: asText(voteMap.get("userId"), ""),
    userName: asText(voteMap.get("userName"), ""),
    session: asSession(voteMap.get("session")),
  };
}

// Builds the Y.Map for a vote, ready to be put into the shared
// "votes" map. The caller wraps the put in a transact stamped
// with the local origin, so undo can track it.
export function buildVoteMap(vote: Vote): VoteMap {
  const voteMap = new Y.Map<unknown>();
  voteMap.set("itemId", vote.itemId);
  voteMap.set("userId", vote.userId);
  voteMap.set("userName", vote.userName);
  voteMap.set("session", vote.session);
  return voteMap;
}

// Reads the voting session out of the shared document. Null
// when no session has ever started — the map is empty until
// the first session writes to it. A session with no number was
// started before sessions were numbered, so it reads as
// session 0 — the next start writes session 1.
export function readVotingSession(votingMap: VotingMap): VotingSession | null {
  if (!votingMap.has("active")) return null;
  return {
    active: votingMap.get("active") === true,
    dotsPerPerson: asDotsPerPerson(votingMap.get("dotsPerPerson")),
    startedBy: asText(votingMap.get("startedBy"), ""),
    startedByName: asText(votingMap.get("startedByName"), ""),
    session: asSession(votingMap.get("session")),
  };
}

// Writes a session into the shared "voting" map. The caller
// wraps the call in a transact; the map is not watched by the
// UndoManager, so starting or ending a session never lands on
// the undo stack.
export function writeVotingSession(
  votingMap: VotingMap,
  session: VotingSession,
): void {
  votingMap.set("active", session.active);
  votingMap.set("dotsPerPerson", session.dotsPerPerson);
  votingMap.set("startedBy", session.startedBy);
  votingMap.set("startedByName", session.startedByName);
  votingMap.set("session", session.session);
}
