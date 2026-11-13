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
} from "./connectors";

describe("createConnector", () => {
  it("builds a connector between two items", () => {
    const connector = createConnector("c1", "n1", "n2", "green");
    expect(connector).toEqual({ id: "c1", fromId: "n1", toId: "n2", color: "green" });
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
    });
  });
});

describe("deleteConnectorsReferencing", () => {
  it("removes connectors attached to the deleted item, either end", () => {
    const doc = new Y.Doc();
    const connectorsMap = doc.getMap<Y.Map<unknown>>("connectors");
    const keep: Connector = { id: "keep", fromId: "n2", toId: "n3", color: "blue" };
    const fromGone: Connector = { id: "from-gone", fromId: "n1", toId: "n2", color: "green" };
    const toGone: Connector = { id: "to-gone", fromId: "n2", toId: "n1", color: "pink" };
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
      { id: "c1", fromId: "n1", toId: "n2", color: "green" },
      { id: "c2", fromId: "n2", toId: "n1", color: "pink" },
      { id: "c3", fromId: "n2", toId: "n3", color: "blue" },
    ];
    expect(connectorsForItem(connectors, "n1").map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(connectorsForItem(connectors, "n3").map((item) => item.id)).toEqual(["c3"]);
    expect(connectorsForItem(connectors, "nobody")).toEqual([]);
  });
});
