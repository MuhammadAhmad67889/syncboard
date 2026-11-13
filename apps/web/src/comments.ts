import * as Y from "yjs";
import { type Comment } from "@syncboard/shared";

// One comment thread inside the shared document: a Y.Map whose
// fields are plain values (position, author, text, timestamp,
// resolved flag).
export type CommentMap = Y.Map<unknown>;

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asResolved(value: unknown): boolean {
  return value === true;
}

// Reads one comment thread out of the shared document into a
// plain object React can render. Unknown or missing fields fall
// back to defaults instead of crashing the board.
export function readComment(id: string, commentMap: CommentMap): Comment {
  return {
    id,
    x: asNumber(commentMap.get("x"), 0),
    y: asNumber(commentMap.get("y"), 0),
    author: asText(commentMap.get("author"), ""),
    text: asText(commentMap.get("text"), ""),
    createdAt: asText(commentMap.get("createdAt"), ""),
    resolved: asResolved(commentMap.get("resolved")),
  };
}

// Builds the Y.Map for a comment thread, ready to be put into
// the shared "comments" map. The caller wraps the put in a
// transact stamped with the local origin, so undo can track it.
export function buildCommentMap(comment: Comment): CommentMap {
  const commentMap = new Y.Map<unknown>();
  commentMap.set("x", comment.x);
  commentMap.set("y", comment.y);
  commentMap.set("author", comment.author);
  commentMap.set("text", comment.text);
  commentMap.set("createdAt", comment.createdAt);
  commentMap.set("resolved", comment.resolved);
  return commentMap;
}

// The timestamp as the panel shows it: short month and day,
// plus the time. An unreadable timestamp shows as nothing,
// rather than "Invalid Date".
export function formatCommentTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
