// Real accounts for SyncBoard: password hashing, username and
// password rules, per-user colors, the built-in demo account,
// and the JWT helpers the sync server signs and verifies with.
// Nothing here touches the database — the user store lives in
// persistence.ts, and the HTTP endpoints live in index.ts.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import type { SessionUser } from "@syncboard/shared";

// The colors new accounts get, picked by username (see
// colorForUsername). Six distinct colors, so two people on a
// board usually get different cursor colors.
export const USER_COLORS = [
  "#2563eb",
  "#db2777",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#0891b2",
] as const;

// The one built-in account left: a demo login with no password,
// for trying the board without creating an account. It is not a
// row in the users table — the server signs its token directly —
// and the username "demo" is reserved at signup, so no real
// account can ever collide with it.
export const DEMO_ACCOUNT: SessionUser = {
  id: "demo",
  name: "Demo",
  color: "#64748b",
};

// Picks a color from the palette by hashing the username, so the
// same username always gets the same color on every sign-in.
// The hash is a plain string hash, not a security hash — it only
// spreads names across the palette.
export function colorForUsername(username: string): string {
  let hash = 0;
  const lowered = username.toLowerCase();
  for (let i = 0; i < lowered.length; i += 1) {
    hash = (hash * 31 + lowered.charCodeAt(i)) >>> 0;
  }
  return USER_COLORS[hash % USER_COLORS.length];
}

// Usernames are 3–20 characters, letters, digits, underscores,
// and hyphens only. The check runs on the trimmed name, so
// leading and trailing spaces never reach the database.
export function validateUsername(username: unknown): string | null {
  if (typeof username !== "string") {
    return "Username must be 3–20 characters, using letters, numbers, underscores, and hyphens only.";
  }
  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 20 || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return "Username must be 3–20 characters, using letters, numbers, underscores, and hyphens only.";
  }
  if (trimmed.toLowerCase() === "demo") {
    return "That username is reserved for the demo account.";
  }
  return null;
}

// Passwords are at least 8 characters. There is no strength meter
// or complexity rule — this is dev-grade auth, and a short
// minimum keeps the rule honest about what it checks.
export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  return null;
}

// Hashes a password with scrypt and a fresh random salt per user.
// The stored value is "salt:hash", both hex — the salt is not a
// secret, it just makes two identical passwords hash differently,
// and scrypt's cost makes guessing slow. Only the hash is ever
// stored; the plain password never reaches the database.
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

// Checks a password against a stored "salt:hash" value. A
// malformed stored value simply does not verify — it never
// throws, so a bad row cannot crash a login attempt. The
// comparison runs in constant time for equal-length buffers.
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// Signs a short-lived token for a user. The payload carries who
// the user is, so onConnect can log it and the client can show
// their name and color without another request.
export function signToken(user: SessionUser, jwtSecret: string): string {
  return jwt.sign(
    { sub: user.id, name: user.name, color: user.color },
    jwtSecret,
    { algorithm: "HS256", expiresIn: "8h" },
  );
}

// Verifies the token from the client's Auth message and returns
// who it belongs to. Throws when the token is missing or invalid —
// Hocuspocus answers a failed onAuthenticate with a
// permission-denied message instead of setting up the connection.
export function verifyToken(
  token: string | null,
  jwtSecret: string,
): { id: string; name: string } {
  if (!token) {
    throw new Error("Missing token");
  }
  try {
    const payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
    if (typeof payload !== "object" || payload === null || typeof payload.sub !== "string") {
      throw new Error("Token has no user id");
    }
    return {
      id: payload.sub,
      name: typeof payload.name === "string" ? payload.name : payload.sub,
    };
  } catch {
    throw new Error("Invalid token");
  }
}
