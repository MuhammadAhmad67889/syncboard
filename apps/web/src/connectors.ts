import * as Y from "yjs";
import { type Connector, type NoteColor } from "@syncboard/shared";

// One connector inside the shared document: a Y.Map whose fields
// are plain values (the two endpoint ids and a color name).
export type ConnectorMap = Y.Map<unknown>;

function asNoteColor(value: unknown): NoteColor {
  return typeof value === "string" &&
    (value === "yellow" ||
      value === "pink" ||
      value === "green" ||
      value === "blue" ||
      value === "purple" ||
      value === "orange")
    ? value
    : "yellow";
}

function asId(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Reads one connector out of the shared document into a plain
// object React can render. Unknown or missing fields fall back
// to defaults instead of crashing the board.
export function readConnector(id: string, connectorMap: ConnectorMap): Connector {
  return {
    id,
    fromId: asId(connectorMap.get("fromId")),
    toId: asId(connectorMap.get("toId")),
    color: asNoteColor(connectorMap.get("color")),
  };
}

// Builds the Y.Map for a connector, ready to be put into the
// shared "connectors" map. The caller wraps the put in a transact
// stamped with the local origin, so undo can track it.
export function buildConnectorMap(connector: Connector): ConnectorMap {
  const connectorMap = new Y.Map<unknown>();
  connectorMap.set("fromId", connector.fromId);
  connectorMap.set("toId", connector.toId);
  connectorMap.set("color", connector.color);
  return connectorMap;
}

// Deletes every connector that points at the given item —
// either end. Call this inside the same transaction that deletes
// the item, so one undo brings the item and its connectors back
// together, and no connector is ever left pointing at nothing.
// The ids are collected first because deleting while iterating
// the map would skip entries.
export function deleteConnectorsReferencing(
  connectorsMap: Y.Map<ConnectorMap>,
  itemId: string,
): void {
  const doomed: string[] = [];
  connectorsMap.forEach((connectorMap, id) => {
    if (connectorMap.get("fromId") === itemId || connectorMap.get("toId") === itemId) {
      doomed.push(id);
    }
  });
  for (const id of doomed) {
    connectorsMap.delete(id);
  }
}

// The connectors that point at the given item, as plain objects.
export function connectorsForItem(connectors: Connector[], itemId: string): Connector[] {
  return connectors.filter(
    (connector) => connector.fromId === itemId || connector.toId === itemId,
  );
}
