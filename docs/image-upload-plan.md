# SyncBoard — Image upload on the board

Add images to the board: add, move, resize, delete, export. Local
work only: no commit, push, upload, or PR until the user says so. No
change to the sync server, the boards API, auth, or deployment
config. No change to the live Main board's content.

## Where things live

- `apps/web/src/App.tsx` — the whole app. All board interaction is
  pointer events with pointerId tracking and `setPointerCapture`.
- `packages/shared/src/index.ts` — shared types and constants.
  Images get a type here, like `Note`, `Shape`, `TextBox`, `Frame`.
- `apps/web/src/images.ts` (+ `images.test.ts`) — the new module
  for this work: the Yjs map for one image, the downscale helpers,
  following the `shapes.ts` / `texts.ts` pattern (small module,
  vitest file for the pure logic).
- `apps/web/src/export.ts` (+ `export.test.ts`) — JSON and PNG
  export. Images join the JSON export; the PNG renderer draws them.
- `apps/web/src/App.css` — `.image-item` styling, reusing the
  `.note-delete` and `.note-resize` controls.

## Storage decision (the important one)

Images live in the shared Yjs document, in a new root map
`"images"` — the same model as notes, shapes, and text boxes.
One image is a Y.Map with plain numbers (x, y, w, h) and one
string: the image as a data URL.

A full-size photo must not go in as-is: a 3 MB phone photo is
~4 MB as base64, and every image would bloat the document every
client syncs and the server persists. So the client downscales
before storing:

- Longest side at most 800 px, aspect ratio kept. The board
  shows images a few hundred pixels wide, so 800 px is plenty.
- JPEG sources re-encode as JPEG, quality 0.85.
- PNG sources re-encode as PNG, so transparency survives.
- GIFs keep only the first frame, as PNG. The board shows still
  images; an animated GIF does not animate here.
- Files over 10 MB are rejected before any work, with a message.
  Non-image files are rejected the same way.

The downscale runs on an offscreen canvas in the browser, so no
server change is needed and no image bytes ever leave the
browser except through the sync the board already does.

## What this builds

1. **Add an image, two ways.** Both go through one
   `addImageFile(file, x, y)` path:
   - A tool-rail "Image" button opens a file picker. The image
     lands at the centre of the current viewport.
   - Drag-and-drop an image file onto the board. The image lands
     at the drop point.
   - The picker accepts `image/*`. The drop handler only takes
     files whose type starts with `image/`; anything else is
     ignored with a message.
2. **Render, move, resize, delete — like a shape.**
   - Rendered as a `<div className="image-item">` with an `<img>`
     inside, positioned like a shape. The whole element drags.
   - Bottom-right resize handle, like shapes. Resize keeps the
     aspect ratio: the width follows the pointer, the height
     follows from the stored aspect, so the picture never
     stretches.
   - A × delete button when selected, and Delete / Backspace,
     like shapes.
   - Selection is local-only (like frames and connectors — not
     published to Awareness, so other users do not see it).
   - Images move with a frame drag when their centre is inside
     the frame, like notes and shapes.
   - Images show in the minimap as grey rectangles.
3. **Undo.** The `"images"` map joins the UndoManager's watched
   roots, so add, move, resize, and delete all undo like any
   other edit.
4. **Export.**
   - JSON: images join `BoardExport` (with their data URLs), so
     an export carries them and an import restores them. The
     `images` list is optional when parsing, like frames and
     connectors, so older exports still import.
   - PNG: `renderBoardToCanvas` draws each image with
     `drawImage`. Images must be loaded before they can draw, so
     the renderer becomes async: it preloads the images first,
     then draws. An image that fails to load is skipped, not a
     failed export.

## Deliberately left out

- Image editing: no filters, cropping, rotation, or annotation.
- Images as connector endpoints, and votes on images.
- Image selection in presence (other users do not see which
  image you selected — same as frames and connectors).
- Server-side upload or storage. The sync server is untouched.
- Any change to mouse/touch behaviour, the sync server, or the
  live Main board's content.

## Shared rules

- Humanized code (the user's permanent rule): small functions
  with clear names, comments ONLY where they explain WHY, plain
  wording, no clever one-liners, structure that makes a bug easy
  to trace. Applies to every line.
- Minimal changes, existing style. No invented metrics,
  testimonials, logos, or features beyond this spec.
- Tests for the new pure logic (downscale size, map round-trip,
  export round-trip) and for the PNG draw path where it can be
  tested without a browser; real-browser check with Playwright
  Firefox: upload a small test image via the file picker, confirm
  it appears on the board and can be moved.

## Verification (2026-11-15, real browser, Playwright Firefox)

Verified against the local dev server (web on 5173, sync server on
1234), all on fresh test boards so the Main board was untouched:

- Upload via the file picker: a 400x300 PNG lands at the viewport
  centre, stored as a data URL, and renders on the board.
- Drag: moves exactly the dragged amount (verified +150/+80 and
  +100/+60, read from the element's board position).
- The dragged position persists across a page reload (227,231 after
  reload). Note: a reload returns to the Main board — the app does
  not remember the active board. That is pre-existing behaviour,
  not something this feature changed.
- Resize: the handle grows the image from 400x300 to 472x354 with
  the aspect preserved (1.333). The handle can sit under the
  minimap when an image is at the bottom-right of the viewport —
  moving the image up-left clears it. Notes have the same handle
  and the same overlap, so this is a shared layout quirk, not an
  image-only bug.
- Delete: both the × button and the keyboard Delete key remove the
  image.
- PNG export with an image on the board downloads a PNG with no
  page errors.
- No console or page errors in any of the checks.

Screenshot: `docs/image-upload-verification.png` — the uploaded
test image (blue, yellow circle) on a test board.

Cleanup: all three test boards (Image test, PNG export test, Drag
check) were deleted. The Main board was verified afterwards: 0
images, 3 notes, unchanged. The dev servers were stopped.

## Deliberately left out

- Image editing, filters, cropping, rotation.
- Connector endpoints on images, votes on images, presence
  selection (showing who selected an image).
- Server-side upload or a separate file store — images live in the
  Yjs doc, so no new infrastructure.
- Drag-and-drop from outside the browser is wired (the board
  accepts a file drop), but it was not exercised in the browser
  check — the file picker path was. A drag-and-drop check is a
  good follow-up before going live.
