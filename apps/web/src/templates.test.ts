import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { boxCentreInFrame, createFrame } from "@syncboard/shared";
import { buildFrameMap } from "./frames";
import { buildNoteMap } from "./export";
import {
  boxesOverlap,
  placeTemplate,
  templateBounds,
  templateById,
  TEMPLATES,
} from "./templates";

describe("TEMPLATES", () => {
  it("has the four templates, in picker order", () => {
    expect(TEMPLATES.map((template) => template.id)).toEqual([
      "kanban",
      "retro",
      "mind-map",
      "sprint-planning",
    ]);
    expect(TEMPLATES.map((template) => template.name)).toEqual([
      "Kanban board",
      "Retro",
      "Mind map",
      "Sprint planning",
    ]);
  });

  it("has a unique id, name, and description on every template", () => {
    const ids = TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of TEMPLATES) {
      expect(template.name.trim().length).toBeGreaterThan(0);
      expect(template.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives Kanban three columns with one starter note each", () => {
    const kanban = templateById("kanban")!;
    expect(kanban.frames.map((frame) => frame.title)).toEqual(["To do", "Doing", "Done"]);
    expect(kanban.notes).toHaveLength(3);
    expect(kanban.notes.map((note) => note.text)).toEqual([
      "Add a card here",
      "Add a card here",
      "Add a card here",
    ]);
  });

  it("gives Retro three prompts with one starter note each", () => {
    const retro = templateById("retro")!;
    expect(retro.frames.map((frame) => frame.title)).toEqual([
      "What went well",
      "What to improve",
      "What to try next",
    ]);
    expect(retro.notes).toHaveLength(3);
    expect(retro.notes.every((note) => note.text === "Add a note here")).toBe(true);
  });

  it("gives the Mind map a main idea and four branches", () => {
    const mindMap = templateById("mind-map")!;
    expect(mindMap.frames.map((frame) => frame.title)).toEqual([
      "Branch one",
      "Branch two",
      "Main idea",
      "Branch three",
      "Branch four",
    ]);
    expect(mindMap.notes).toHaveLength(5);
    expect(mindMap.notes.map((note) => note.text)).toEqual([
      "Add an idea here",
      "Add an idea here",
      "Add the main idea here",
      "Add an idea here",
      "Add an idea here",
    ]);
  });

  it("gives Sprint planning a goal frame and three columns", () => {
    const sprint = templateById("sprint-planning")!;
    expect(sprint.frames.map((frame) => frame.title)).toEqual([
      "Sprint goal",
      "To do",
      "Doing",
      "Done",
    ]);
    expect(sprint.notes.map((note) => note.text)).toEqual([
      "Add the goal for this sprint",
      "Add a card here",
      "Add a card here",
      "Add a card here",
    ]);
  });

  it("keeps every template's frames from overlapping", () => {
    for (const template of TEMPLATES) {
      for (let i = 0; i < template.frames.length; i += 1) {
        for (let j = i + 1; j < template.frames.length; j += 1) {
          expect(boxesOverlap(template.frames[i], template.frames[j])).toBe(false);
        }
      }
    }
  });

  it("puts every note's centre inside one of its own frames", () => {
    for (const template of TEMPLATES) {
      for (const note of template.notes) {
        const inside = template.frames.some((frame) => boxCentreInFrame(frame, note));
        expect(inside).toBe(true);
      }
    }
  });

  it("keeps every frame and note at or right of the origin", () => {
    for (const template of TEMPLATES) {
      for (const frame of template.frames) {
        expect(frame.x).toBeGreaterThanOrEqual(0);
        expect(frame.y).toBeGreaterThanOrEqual(0);
      }
      for (const note of template.notes) {
        expect(note.x).toBeGreaterThanOrEqual(0);
        expect(note.y).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("templateById", () => {
  it("finds a template by its id", () => {
    expect(templateById("kanban")?.name).toBe("Kanban board");
  });

  it("returns undefined for an unknown id", () => {
    expect(templateById("no-such-template")).toBeUndefined();
  });
});

describe("templateBounds", () => {
  it("covers the Kanban columns exactly", () => {
    expect(templateBounds(templateById("kanban")!)).toEqual({ x: 0, y: 0, w: 1008, h: 360 });
  });

  it("covers the Mind map exactly", () => {
    expect(templateBounds(templateById("mind-map")!)).toEqual({ x: 0, y: 0, w: 1008, h: 620 });
  });

  it("covers Sprint planning exactly", () => {
    expect(templateBounds(templateById("sprint-planning")!)).toEqual({
      x: 0,
      y: 0,
      w: 1008,
      h: 544,
    });
  });
});

describe("placeTemplate", () => {
  it("shifts every frame and note by the origin, keeping the layout", () => {
    const kanban = templateById("kanban")!;
    const placed = placeTemplate(kanban, 100, 50);
    expect(placed.frames[0]).toEqual({ ...kanban.frames[0], x: 100, y: 50 });
    expect(placed.frames[2]).toEqual({ ...kanban.frames[2], x: 788, y: 50 });
    expect(placed.notes[0]).toEqual({ ...kanban.notes[0], x: 124, y: 106 });
    // The placed copy keeps the template's own layout: the gaps
    // between frames are unchanged.
    expect(placed.frames[1].x - placed.frames[0].x).toBe(
      kanban.frames[1].x - kanban.frames[0].x,
    );
  });

  it("leaves the template itself untouched", () => {
    const kanban = templateById("kanban")!;
    const before = JSON.stringify(kanban);
    placeTemplate(kanban, 500, 500);
    expect(JSON.stringify(kanban)).toBe(before);
  });

  it("inserts into a Y.Doc in one transaction, as frames and notes", () => {
    const kanban = templateById("kanban")!;
    const placed = placeTemplate(kanban, 100, 50);
    const doc = new Y.Doc();
    const framesMap = doc.getMap<Y.Map<unknown>>("frames");
    const notesMap = doc.getMap<Y.Map<unknown>>("notes");
    doc.transact(() => {
      for (const [index, spec] of placed.frames.entries()) {
        const frame = createFrame(
          `frame-${index}`,
          spec.x,
          spec.y,
          spec.w,
          spec.h,
          spec.color,
          spec.title,
        );
        framesMap.set(frame.id, buildFrameMap(frame));
      }
      for (const [index, spec] of placed.notes.entries()) {
        notesMap.set(
          `note-${index}`,
          buildNoteMap({
            id: `note-${index}`,
            x: spec.x,
            y: spec.y,
            w: spec.w,
            h: spec.h,
            color: spec.color,
            text: spec.text,
          }),
        );
      }
    });
    expect(framesMap.size).toBe(3);
    expect(notesMap.size).toBe(3);
    const firstFrame = framesMap.get("frame-0");
    expect(firstFrame?.get("title")).toBe("To do");
    const firstNote = notesMap.get("note-0");
    expect(firstNote?.get("text")).toBeInstanceOf(Y.Text);
    expect((firstNote?.get("text") as Y.Text).toString()).toBe("Add a card here");
  });
});

describe("boxesOverlap", () => {
  it("reports two boxes apart as not overlapping", () => {
    expect(
      boxesOverlap({ x: 0, y: 0, w: 100, h: 100 }, { x: 200, y: 0, w: 100, h: 100 }),
    ).toBe(false);
  });

  it("reports two boxes sharing an edge as not overlapping", () => {
    expect(
      boxesOverlap({ x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 0, w: 100, h: 100 }),
    ).toBe(false);
  });

  it("reports two boxes sharing area as overlapping", () => {
    expect(
      boxesOverlap({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 100, h: 100 }),
    ).toBe(true);
  });
});
