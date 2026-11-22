import * as Y from "yjs";
import { NOTE_COLORS, type Connector, type NoteColor } from "@syncboard/shared";

// One connector inside the shared document: a Y.Map whose fields
// are plain values (the two endpoint ids, a color name, whether
// the arrowhead shows, and the label text).
export type ConnectorMap = Y.Map<unknown>;

function asNoteColor(value: unknown): NoteColor {
  return typeof value === "string" && value in NOTE_COLORS ? (value as NoteColor) : "yellow";
}

function asId(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asLabel(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Reads one connector out of the shared document into a plain
// object React can render. Unknown or missing fields fall back
// to defaults instead of crashing the board. Connectors stored
// before arrowheads and labels existed have no such fields —
// they read back with an arrowhead and no label, exactly how
// they always looked.
export function readConnector(id: string, connectorMap: ConnectorMap): Connector {
  return {
    id,
    fromId: asId(connectorMap.get("fromId")),
    toId: asId(connectorMap.get("toId")),
    color: asNoteColor(connectorMap.get("color")),
    arrow: connectorMap.get("arrow") !== false,
    label: asLabel(connectorMap.get("label")),
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
  connectorMap.set("arrow", connector.arrow);
  connectorMap.set("label", connector.label);
  return connectorMap;
}

// Turns a connector's arrowhead on or off. The caller wraps this
// in a transact stamped with the local origin.
export function setConnectorArrow(connectorMap: ConnectorMap, arrow: boolean): void {
  connectorMap.set("arrow", arrow);
}

// Sets a connector's label ("" for no label). The caller wraps
// this in a transact stamped with the local origin.
export function setConnectorLabel(connectorMap: ConnectorMap, label: string): void {
  connectorMap.set("label", label);
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
