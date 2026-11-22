import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { boxCentreInFrame, createFrame } from "@syncboard/shared";
import { buildFrameMap } from "./frames";
import { buildNoteMap } from "./export";
import {
  boxesOverlap,
  findTemplateOrigin,
  placeTemplate,
  templateBounds,
  templateById,
  TEMPLATES,
} from "./templates";

describe("TEMPLATES", () => {
  it("has the five templates, in picker order", () => {
    expect(TEMPLATES.map((template) => template.id)).toEqual([
      "kanban",
      "retro",
      "mind-map",
      "brainstorm",
      "sprint-planning",
    ]);
    expect(TEMPLATES.map((template) => template.name)).toEqual([
      "Kanban board",
      "Retro",
      "Mind map",
      "Brainstorm",
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

  it("gives Brainstorm one frame, a central topic, and six idea notes", () => {
    const brainstorm = templateById("brainstorm")!;
    expect(brainstorm.frames.map((frame) => frame.title)).toEqual(["Brainstorm"]);
    expect(brainstorm.notes).toHaveLength(7);
    expect(brainstorm.notes[0].text).toBe("Add the topic here");
    expect(
      brainstorm.notes.slice(1).every((note) => note.text === "Add an idea here"),
    ).toBe(true);
    // The topic sits in the middle of the frame.
    const frame = brainstorm.frames[0];
    const topic = brainstorm.notes[0];
    expect(topic.x + topic.w / 2).toBe(frame.x + frame.w / 2);
    expect(topic.y + topic.h / 2).toBe(frame.y + frame.h / 2);
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

  it("keeps every template's notes from overlapping each other", () => {
    for (const template of TEMPLATES) {
      for (let i = 0; i < template.notes.length; i += 1) {
        for (let j = i + 1; j < template.notes.length; j += 1) {
          expect(boxesOverlap(template.notes[i], template.notes[j])).toBe(false);
        }
      }
    }
  });

  it("keeps every note fully inside one of its own frames, edges included", () => {
    for (const template of TEMPLATES) {
      for (const note of template.notes) {
        const contained = template.frames.some(
          (frame) =>
            note.x >= frame.x &&
            note.y >= frame.y &&
            note.x + note.w <= frame.x + frame.w &&
            note.y + note.h <= frame.y + frame.h,
        );
        expect(contained).toBe(true);
      }
    }
  });

  it("pads column notes evenly on both sides", () => {
    // A starter note in a 320-wide column frame sits the same
    // distance from both edges — no wide empty strip on one
    // side. (The Brainstorm and Sprint-goal frames are wider
    // than a column and lay their notes out differently.)
    for (const template of TEMPLATES) {
      for (const note of template.notes) {
        const frame = template.frames.find(
          (candidate) =>
            candidate.w === 320 &&
            note.x >= candidate.x &&
            note.y >= candidate.y &&
            note.x + note.w <= candidate.x + candidate.w &&
            note.y + note.h <= candidate.y + candidate.h,
        );
        if (!frame) continue;
        expect(note.x - frame.x).toBe(frame.x + frame.w - (note.x + note.w));
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

describe("findTemplateOrigin", () => {
  const kanban = templateById("kanban")!;

  // The footprint a template would cover if placed at an
  // origin — what must not overlap anything already there.
  function footprintAt(origin: { x: number; y: number }) {
    const bounds = templateBounds(kanban);
    return {
      x: origin.x + bounds.x,
      y: origin.y + bounds.y,
      w: bounds.w,
      h: bounds.h,
    };
  }

  it("keeps the preferred origin on an empty board", () => {
    expect(findTemplateOrigin(kanban, 100, 50, [])).toEqual({ x: 100, y: 50 });
  });

  it("keeps the preferred origin when the content is elsewhere", () => {
    const farAway = [{ x: 3000, y: 3000, w: 200, h: 200 }];
    expect(findTemplateOrigin(kanban, 100, 50, farAway)).toEqual({ x: 100, y: 50 });
  });

  it("drops below content sitting on the preferred spot", () => {
    // A frame exactly where the template wants to go.
    const blocker = { x: 100, y: 50, w: 320, h: 360 };
    const origin = findTemplateOrigin(kanban, 100, 50, [blocker]);
    // Same x, and the template's top sits 40 below the
    // blocker's bottom edge.
    expect(origin).toEqual({ x: 100, y: 50 + 360 + 40 });
    expect(boxesOverlap(footprintAt(origin), blocker)).toBe(false);
  });

  it("drops below a stack of content, not just the first box", () => {
    const stack = [
      { x: 100, y: 50, w: 320, h: 360 },
      { x: 100, y: 500, w: 320, h: 360 },
      { x: 100, y: 950, w: 320, h: 360 },
    ];
    const origin = findTemplateOrigin(kanban, 100, 50, stack);
    for (const box of stack) {
      expect(boxesOverlap(footprintAt(origin), box)).toBe(false);
    }
    expect(origin.y).toBeGreaterThan(950 + 360);
  });

  it("ignores content that only overlaps sideways beyond the template", () => {
    // Same y band, but entirely to the right of the template's
    // 1008-wide footprint at x=100 (which ends at 1108).
    const beside = [{ x: 1200, y: 50, w: 320, h: 360 }];
    expect(findTemplateOrigin(kanban, 100, 50, beside)).toEqual({ x: 100, y: 50 });
  });

  it("keeps two templates inserted at the same spot from overlapping", () => {
    // Insert Kanban at the preferred spot, then ask where a
    // second template with the same preference should go.
    const first = placeTemplate(kanban, 100, 50);
    const existing = [...first.frames, ...first.notes];
    const secondOrigin = findTemplateOrigin(templateById("retro")!, 100, 50, existing);
    const second = placeTemplate(templateById("retro")!, secondOrigin.x, secondOrigin.y);
    for (const frame of second.frames) {
      for (const box of existing) {
        expect(boxesOverlap(frame, box)).toBe(false);
      }
    }
    for (const note of second.notes) {
      for (const box of existing) {
        expect(boxesOverlap(note, box)).toBe(false);
      }
    }
  });
});
