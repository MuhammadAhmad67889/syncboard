import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  connectorEndpoints,
  createConnector,
  type Connector,
} from "@syncboard/shared";
import {
  buildConnectorMap,
  connectorsForItem,
  deleteConnectorsReferencing,
  readConnector,
  setConnectorArrow,
  setConnectorLabel,
} from "./connectors";

describe("createConnector", () => {
  it("builds a connector between two items, with an arrowhead and no label", () => {
    const connector = createConnector("c1", "n1", "n2", "green");
    expect(connector).toEqual({
      id: "c1",
      fromId: "n1",
      toId: "n2",
      color: "green",
      arrow: true,
      label: "",
    });
  });

  it("builds a plain labeled line when asked", () => {
    const connector = createConnector("c1", "n1", "n2", "green", false, "depends on");
    expect(connector.arrow).toBe(false);
    expect(connector.label).toBe("depends on");
  });
});

describe("connectorEndpoints", () => {
  it("joins the nearest edges of two boxes side by side", () => {
    // A on the left, B on the right: the line runs from A's right
    // edge centre to B's left edge centre.
    expect(
      connectorEndpoints({ x: 0, y: 0, w: 100, h: 100 }, { x: 200, y: 0, w: 100, h: 100 }),
    ).toEqual({ x1: 100, y1: 50, x2: 200, y2: 50 });
  });

  it("joins the nearest edges of two boxes stacked vertically", () => {
    expect(
      connectorEndpoints({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 200, w: 100, h: 100 }),
    ).toEqual({ x1: 50, y1: 100, x2: 50, y2: 200 });
  });

  it("follows the boxes when one moves", () => {
    // The same two boxes, with B moved right and down: the line
    // re-routes to the new nearest edges — A's bottom centre to
    // B's left centre.
    expect(
      connectorEndpoints({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 300, w: 100, h: 100 }),
    ).toEqual({ x1: 50, y1: 100, x2: 300, y2: 350 });
  });
});

describe("buildConnectorMap / readConnector", () => {
  it("round-trips a connector through a Y.Doc", () => {
    const doc = new Y.Doc();
    const connectorsMap = doc.getMap<Y.Map<unknown>>("connectors");
    const connector = createConnector("c1", "n1", "n2", "green");
    doc.transact(() => {
      connectorsMap.set(connector.id, buildConnectorMap(connector));
    });
    const stored = connectorsMap.get("c1");
    expect(stored).toBeDefined();
    expect(readConnector("c1", stored!)).toEqual(connector);
  });

  it("falls back to defaults for a malformed connector", () => {
    const doc = new Y.Doc();
    const connectorMap = new Y.Map<unknown>();
    connectorMap.set("color", "not-a-color");
    doc.transact(() => {
      doc.getMap("connectors").set("bad", connectorMap);
    });
    expect(readConnector("bad", connectorMap)).toEqual({
      id: "bad",
      fromId: "",
      toId: "",
      color: "yellow",
      arrow: true,
      label: "",
    });
  });

  it("round-trips the arrowhead and label", () => {
    const doc = new Y.Doc();
    const connectorsMap = doc.getMap<Y.Map<unknown>>("connectors");
    const connector = createConnector("c1", "n1", "n2", "green", false, "blocks");
    doc.transact(() => {
      connectorsMap.set(connector.id, buildConnectorMap(connector));
    });
    expect(readConnector("c1", connectorsMap.get("c1")!)).toEqual(connector);
  });

  it("reads a connector stored before arrowheads and labels as arrowed, unlabeled", () => {
    const doc = new Y.Doc();
    const connectorMap = new Y.Map<unknown>();
    connectorMap.set("fromId", "n1");
    connectorMap.set("toId", "n2");
    connectorMap.set("color", "blue");
    doc.transact(() => {
      doc.getMap("connectors").set("old", connectorMap);
    });
    const read = readConnector("old", connectorMap);
    expect(read.arrow).toBe(true);
    expect(read.label).toBe("");
  });

  it("updates the arrowhead and label in place", () => {
    const doc = new Y.Doc();
    const connectorsMap = doc.getMap<Y.Map<unknown>>("connectors");
    const connector = createConnector("c1", "n1", "n2", "green");
    doc.transact(() => {
      connectorsMap.set(connector.id, buildConnectorMap(connector));
    });
    const stored = connectorsMap.get("c1")!;
    doc.transact(() => {
      setConnectorArrow(stored, false);
      setConnectorLabel(stored, "feeds into");
    });
    const read = readConnector("c1", stored);
    expect(read.arrow).toBe(false);
    expect(read.label).toBe("feeds into");
  });
});

describe("deleteConnectorsReferencing", () => {
  it("removes connectors attached to the deleted item, either end", () => {
    const doc = new Y.Doc();
    const connectorsMap = doc.getMap<Y.Map<unknown>>("connectors");
    const keep: Connector = createConnector("keep", "n2", "n3", "blue");
    const fromGone: Connector = createConnector("from-gone", "n1", "n2", "green");
    const toGone: Connector = createConnector("to-gone", "n2", "n1", "pink");
    doc.transact(() => {
      connectorsMap.set(keep.id, buildConnectorMap(keep));
      connectorsMap.set(fromGone.id, buildConnectorMap(fromGone));
      connectorsMap.set(toGone.id, buildConnectorMap(toGone));
    });
    doc.transact(() => {
      deleteConnectorsReferencing(connectorsMap, "n1");
    });
    expect(connectorsMap.has("keep")).toBe(true);
    expect(connectorsMap.has("from-gone")).toBe(false);
    expect(connectorsMap.has("to-gone")).toBe(false);
  });
});

describe("connectorsForItem", () => {
  it("finds connectors on either end and skips the rest", () => {
    const connectors: Connector[] = [
      createConnector("c1", "n1", "n2", "green"),
      createConnector("c2", "n2", "n1", "pink"),
      createConnector("c3", "n2", "n3", "blue"),
    ];
    expect(connectorsForItem(connectors, "n1").map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(connectorsForItem(connectors, "n3").map((item) => item.id)).toEqual(["c3"]);
    expect(connectorsForItem(connectors, "nobody")).toEqual([]);
  });
});
