import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createComment, sortCommentsNewestFirst, type Comment } from "@syncboard/shared";
import { buildCommentMap, formatCommentTime, readComment } from "./comments";

describe("createComment", () => {
  it("builds a thread with the values it is given", () => {
    const comment = createComment(
      "c1",
      120,
      80,
      "Sara",
      "Should this be blue?",
      "2026-11-13T10:00:00.000Z",
    );
    expect(comment).toEqual({
      id: "c1",
      x: 120,
      y: 80,
      author: "Sara",
      text: "Should this be blue?",
      createdAt: "2026-11-13T10:00:00.000Z",
      resolved: false,
    });
  });

  it("starts unresolved unless told otherwise", () => {
    expect(createComment("c1", 0, 0, "Sara", "Hi").resolved).toBe(false);
    expect(createComment("c1", 0, 0, "Sara", "Hi", "2026-11-13T10:00:00.000Z", true).resolved).toBe(
      true,
    );
  });
});

describe("sortCommentsNewestFirst", () => {
  it("puts the newest thread first", () => {
    const older: Comment = createComment(
      "old",
      0,
      0,
      "Sara",
      "First",
      "2026-11-13T09:00:00.000Z",
    );
    const newer: Comment = createComment(
      "new",
      0,
      0,
      "Sara",
      "Second",
      "2026-11-13T10:00:00.000Z",
    );
    expect(sortCommentsNewestFirst([older, newer])).toEqual([newer, older]);
  });

  it("does not change the caller's order", () => {
    const first: Comment = createComment("a", 0, 0, "Sara", "A", "2026-11-13T09:00:00.000Z");
    const second: Comment = createComment("b", 0, 0, "Sara", "B", "2026-11-13T10:00:00.000Z");
    const input = [first, second];
    sortCommentsNewestFirst(input);
    expect(input).toEqual([first, second]);
  });
});

describe("buildCommentMap / readComment", () => {
  it("round-trips a comment through a Y.Doc", () => {
    const doc = new Y.Doc();
    const commentsMap = doc.getMap<Y.Map<unknown>>("comments");
    const comment = createComment(
      "c1",
      120,
      80,
      "Sara",
      "Should this be blue?",
      "2026-11-13T10:00:00.000Z",
    );
    doc.transact(() => {
      commentsMap.set(comment.id, buildCommentMap(comment));
    });
    const stored = commentsMap.get("c1");
    expect(stored).toBeDefined();
    expect(readComment("c1", stored!)).toEqual(comment);
  });

  it("round-trips a resolved comment", () => {
    const doc = new Y.Doc();
    const commentsMap = doc.getMap<Y.Map<unknown>>("comments");
    const comment = createComment("c1", 0, 0, "Sara", "Done", "2026-11-13T10:00:00.000Z", true);
    doc.transact(() => {
      commentsMap.set(comment.id, buildCommentMap(comment));
    });
    expect(readComment("c1", commentsMap.get("c1")!)).toEqual(comment);
  });

  it("falls back to defaults for a malformed comment", () => {
    const doc = new Y.Doc();
    const commentMap = new Y.Map<unknown>();
    commentMap.set("x", "not a number");
    commentMap.set("resolved", "yes");
    doc.transact(() => {
      doc.getMap("comments").set("bad", commentMap);
    });
    expect(readComment("bad", commentMap)).toEqual({
      id: "bad",
      x: 0,
      y: 0,
      author: "",
      text: "",
      createdAt: "",
      resolved: false,
    });
  });
});

describe("formatCommentTime", () => {
  it("shows a readable date and time", () => {
    const shown = formatCommentTime("2026-11-13T10:00:00.000Z");
    expect(shown.length).toBeGreaterThan(0);
    expect(shown).toContain("13");
  });

  it("shows nothing for an unreadable timestamp", () => {
    expect(formatCommentTime("not a date")).toBe("");
    expect(formatCommentTime("")).toBe("");
  });
});
