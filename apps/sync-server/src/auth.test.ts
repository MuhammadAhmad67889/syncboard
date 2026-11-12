import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  colorForUsername,
  hashPassword,
  validatePassword,
  validateUsername,
  verifyPassword,
  USER_COLORS,
} from "./auth.js";
import { createBoardStore, type BoardStore } from "./persistence.js";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password", () => {
    const stored = hashPassword("password123");
    expect(verifyPassword("password123", stored)).toBe(true);
  });

  it("rejects the wrong password", () => {
    const stored = hashPassword("password123");
    expect(verifyPassword("password124", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("hashes the same password differently each time", () => {
    // A fresh random salt per user: two hashes of the same
    // password must differ, so a leaked hash cannot be matched
    // against another account's hash.
    const first = hashPassword("password123");
    const second = hashPassword("password123");
    expect(first).not.toBe(second);
    expect(verifyPassword("password123", first)).toBe(true);
    expect(verifyPassword("password123", second)).toBe(true);
  });

  it("stores a salt and a hash, never the password itself", () => {
    const stored = hashPassword("password123");
    expect(stored).not.toContain("password123");
    expect(stored.split(":")).toHaveLength(2);
  });

  it("does not verify against a malformed stored value", () => {
    expect(verifyPassword("password123", "not-a-hash")).toBe(false);
    expect(verifyPassword("password123", "")).toBe(false);
  });
});

describe("validateUsername", () => {
  it("accepts a plain username", () => {
    expect(validateUsername("test_ana")).toBeNull();
    expect(validateUsername("Ana123")).toBeNull();
    expect(validateUsername("test-ana")).toBeNull();
  });

  it("rejects a username that is too short or too long", () => {
    expect(validateUsername("ab")).not.toBeNull();
    expect(validateUsername("a".repeat(21))).not.toBeNull();
  });

  it("rejects spaces and punctuation", () => {
    expect(validateUsername("ana maria")).not.toBeNull();
    expect(validateUsername("ana.maria")).not.toBeNull();
    expect(validateUsername("ana@maria")).not.toBeNull();
  });

  it("rejects a missing or non-string username", () => {
    expect(validateUsername(undefined)).not.toBeNull();
    expect(validateUsername(42)).not.toBeNull();
  });

  it("reserves the demo username", () => {
    expect(validateUsername("demo")).not.toBeNull();
    expect(validateUsername("Demo")).not.toBeNull();
  });
});

describe("validatePassword", () => {
  it("accepts a password of 8 characters or more", () => {
    expect(validatePassword("password123")).toBeNull();
    expect(validatePassword("12345678")).toBeNull();
  });

  it("rejects a password shorter than 8 characters", () => {
    expect(validatePassword("short")).not.toBeNull();
    expect(validatePassword("")).not.toBeNull();
  });

  it("rejects a missing or non-string password", () => {
    expect(validatePassword(undefined)).not.toBeNull();
    expect(validatePassword(12345678)).not.toBeNull();
  });
});

describe("colorForUsername", () => {
  it("always picks a color from the palette", () => {
    for (const name of ["ana", "ben", "omar", "test-user_1"]) {
      expect(USER_COLORS).toContain(colorForUsername(name));
    }
  });

  it("gives the same username the same color every time", () => {
    expect(colorForUsername("test_ana")).toBe(colorForUsername("test_ana"));
  });

  it("ignores case when picking the color", () => {
    expect(colorForUsername("Test_Ana")).toBe(colorForUsername("test_ana"));
  });
});

describe("user store", () => {
  // Each test gets its own throwaway database file, so tests never
  // touch the real dev database and never see each other's users.
  let dbPath: string;
  let store: BoardStore;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `syncboard-auth-test-${Date.now()}-${Math.random()}.db`);
    store = createBoardStore(dbPath);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dbPath, { force: true });
  });

  it("creates a user and finds them by username", () => {
    const created = store.createUser({
      id: "user-1",
      username: "test_ana",
      passwordHash: hashPassword("password123"),
      color: colorForUsername("test_ana"),
    });
    expect(created.username).toBe("test_ana");
    expect(created.createdAt).toEqual(expect.any(String));
    const found = store.findUserByUsername("test_ana");
    expect(found?.id).toBe("user-1");
    expect(found?.passwordHash).toBe(created.passwordHash);
  });

  it("finds a user regardless of the case used at login", () => {
    store.createUser({
      id: "user-1",
      username: "Test_Ana",
      passwordHash: hashPassword("password123"),
      color: colorForUsername("Test_Ana"),
    });
    expect(store.findUserByUsername("test_ana")?.username).toBe("Test_Ana");
    expect(store.findUserByUsername("TEST_ANA")?.username).toBe("Test_Ana");
  });

  it("returns null for an unknown username", () => {
    expect(store.findUserByUsername("nobody")).toBeNull();
  });

  it("rejects a duplicate username, even in a different case", () => {
    store.createUser({
      id: "user-1",
      username: "test_ana",
      passwordHash: hashPassword("password123"),
      color: colorForUsername("test_ana"),
    });
    expect(() =>
      store.createUser({
        id: "user-2",
        username: "Test_Ana",
        passwordHash: hashPassword("password123"),
        color: colorForUsername("Test_Ana"),
      }),
    ).toThrow("That username is already taken.");
  });
});
