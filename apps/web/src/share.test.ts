import { describe, expect, it } from "vitest";
import { buildBoardLink } from "./share";

describe("buildBoardLink", () => {
  it("returns the page address as it is", () => {
    expect(buildBoardLink("http://localhost:5173/")).toBe("http://localhost:5173/");
  });

  it("keeps the path and port", () => {
    expect(buildBoardLink("https://syncboard.example.com/board")).toBe(
      "https://syncboard.example.com/board",
    );
  });

  it("drops a query string", () => {
    expect(buildBoardLink("http://localhost:5173/?board=abc")).toBe("http://localhost:5173/");
  });

  it("drops a hash", () => {
    expect(buildBoardLink("http://localhost:5173/#notes")).toBe("http://localhost:5173/");
  });

  it("drops both a query string and a hash", () => {
    expect(buildBoardLink("http://localhost:5173/?x=1#y")).toBe("http://localhost:5173/");
  });
});
