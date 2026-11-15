import * as Y from "yjs";
import { type ImageItem } from "@syncboard/shared";

// One image inside the shared document: a Y.Map whose fields are
// plain values (x, y, w, h) plus the image itself as a data URL
// string. The data URL is downscaled before storing (see
// downscaleImage), so one image is a few hundred kilobytes at
// most — a full-size photo would bloat the document every client
// syncs.
export type ImageMap = Y.Map<unknown>;

// The biggest file the picker or a drop will accept, in bytes.
// A bigger file is rejected before any work, with a message.
export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;

// The image types the board accepts. Anything else is rejected
// before any work, with a message.
export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asDataUrl(value: unknown): string {
  return typeof value === "string" && value.startsWith("data:image/") ? value : "";
}

// Reads one image out of the shared document into a plain object
// React can render. Unknown or missing fields fall back to
// defaults instead of crashing the board. An image with no data
// URL is not an image — it is dropped by the caller.
export function readImage(id: string, imageMap: ImageMap): ImageItem {
  return {
    id,
    x: asNumber(imageMap.get("x"), 0),
    y: asNumber(imageMap.get("y"), 0),
    w: asNumber(imageMap.get("w"), 0),
    h: asNumber(imageMap.get("h"), 0),
    dataUrl: asDataUrl(imageMap.get("dataUrl")),
  };
}

// Builds the Y.Map for an image, ready to be put into the shared
// "images" map. The caller wraps the put in a transact stamped
// with the local origin, so undo can track it.
export function buildImageMap(image: ImageItem): ImageMap {
  const imageMap = new Y.Map<unknown>();
  imageMap.set("x", image.x);
  imageMap.set("y", image.y);
  imageMap.set("w", image.w);
  imageMap.set("h", image.h);
  imageMap.set("dataUrl", image.dataUrl);
  return imageMap;
}

// Whether a file is an image the board accepts: a supported type
// and under the size cap. The caller shows a message for a file
// that fails either check.
export function isSupportedImageFile(file: File): boolean {
  return (
    (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(file.type) &&
    file.size <= MAX_IMAGE_FILE_BYTES
  );
}

// The size an image is stored at: the natural size, scaled down
// so the longest side is at most maxDimension. A small image
// keeps its own size — it is never scaled up, because that only
// adds bytes without adding detail.
export function computeDownscaleSize(
  naturalWidth: number,
  naturalHeight: number,
  maxDimension: number,
): { w: number; h: number } {
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= maxDimension || longest <= 0) {
    return { w: naturalWidth, h: naturalHeight };
  }
  const scale = maxDimension / longest;
  return {
    w: Math.max(1, Math.round(naturalWidth * scale)),
    h: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

// The format an image is stored in: PNG keeps transparency, so
// PNG and GIF (first frame only) stay PNG; photos re-encode as
// JPEG, which is far smaller for the same pixels.
function outputFormat(fileType: string): { type: string; quality?: number } {
  if (fileType === "image/png" || fileType === "image/gif") {
    return { type: "image/png" };
  }
  return { type: "image/jpeg", quality: 0.85 };
}

// Downscales an image file to the size it is stored at and
// returns the data URL plus that size. The picture is drawn on
// an offscreen canvas, so nothing leaves the browser. Rejects
// when the file is not a readable image.
export function downscaleImage(
  file: File,
  maxDimension: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const size = computeDownscaleSize(image.naturalWidth, image.naturalHeight, maxDimension);
      const canvas = document.createElement("canvas");
      canvas.width = size.w;
      canvas.height = size.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not read that image."));
        return;
      }
      ctx.drawImage(image, 0, 0, size.w, size.h);
      const format = outputFormat(file.type);
      const dataUrl = canvas.toDataURL(format.type, format.quality);
      resolve({ dataUrl, width: size.w, height: size.h });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image."));
    };
    image.src = objectUrl;
  });
}
