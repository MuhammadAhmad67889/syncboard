import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createImage, MAX_IMAGE_DIMENSION } from "@syncboard/shared";
import {
  buildImageMap,
  computeDownscaleSize,
  isSupportedImageFile,
  MAX_IMAGE_FILE_BYTES,
  readImage,
} from "./images";

const RED_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function imageFile(type: string, size: number): File {
  return new File([new Uint8Array(size)], "test", { type });
}

describe("createImage", () => {
  it("builds an image item with its data URL", () => {
    const image = createImage("i1", 10, 20, 400, 300, RED_PIXEL);
    expect(image).toEqual({
      id: "i1",
      x: 10,
      y: 20,
      w: 400,
      h: 300,
      dataUrl: RED_PIXEL,
    });
  });
});

describe("computeDownscaleSize", () => {
  it("keeps a small image at its own size", () => {
    expect(computeDownscaleSize(400, 300, MAX_IMAGE_DIMENSION)).toEqual({
      w: 400,
      h: 300,
    });
  });

  it("scales a wide image down to the cap, keeping the aspect", () => {
    expect(computeDownscaleSize(1600, 900, MAX_IMAGE_DIMENSION)).toEqual({
      w: 800,
      h: 450,
    });
  });

  it("scales a tall image down to the cap, keeping the aspect", () => {
    expect(computeDownscaleSize(600, 1200, MAX_IMAGE_DIMENSION)).toEqual({
      w: 400,
      h: 800,
    });
  });

  it("never scales an image up", () => {
    expect(computeDownscaleSize(100, 50, MAX_IMAGE_DIMENSION)).toEqual({
      w: 100,
      h: 50,
    });
  });
});

describe("isSupportedImageFile", () => {
  it("accepts jpeg, png, webp, and gif under the cap", () => {
    expect(isSupportedImageFile(imageFile("image/jpeg", 1024))).toBe(true);
    expect(isSupportedImageFile(imageFile("image/png", 1024))).toBe(true);
    expect(isSupportedImageFile(imageFile("image/webp", 1024))).toBe(true);
    expect(isSupportedImageFile(imageFile("image/gif", 1024))).toBe(true);
  });

  it("rejects a non-image file", () => {
    expect(isSupportedImageFile(imageFile("application/pdf", 1024))).toBe(false);
    expect(isSupportedImageFile(imageFile("text/plain", 1024))).toBe(false);
  });

  it("rejects a file over the cap", () => {
    expect(isSupportedImageFile(imageFile("image/jpeg", MAX_IMAGE_FILE_BYTES + 1))).toBe(false);
  });

  it("accepts a file exactly at the cap", () => {
    expect(isSupportedImageFile(imageFile("image/jpeg", MAX_IMAGE_FILE_BYTES))).toBe(true);
  });
});

describe("buildImageMap / readImage", () => {
  it("round-trips an image through a Y.Doc", () => {
    const doc = new Y.Doc();
    const imagesMap = doc.getMap<Y.Map<unknown>>("images");
    const image = createImage("i1", 10, 20, 400, 300, RED_PIXEL);
    doc.transact(() => {
      imagesMap.set(image.id, buildImageMap(image));
    });
    const stored = imagesMap.get("i1");
    expect(stored).toBeDefined();
    expect(readImage("i1", stored!)).toEqual(image);
  });

  it("falls back to defaults for a malformed image", () => {
    const doc = new Y.Doc();
    const imageMap = new Y.Map<unknown>();
    imageMap.set("x", "not a number");
    imageMap.set("dataUrl", "not an image");
    doc.transact(() => {
      doc.getMap("images").set("bad", imageMap);
    });
    expect(readImage("bad", imageMap)).toEqual({
      id: "bad",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      dataUrl: "",
    });
  });
});
