import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  DEFAULT_BOARD_ID,
  DEFAULT_DOTS_PER_PERSON,
  DEFAULT_NOTE_SIZE,
  DEFAULT_TEXT_SIZE,
  DOTS_PER_PERSON_OPTIONS,
  FONT_SIZE_PX,
  MAX_IMAGE_DIMENSION,
  MIN_FRAME_SIZE,
  MIN_IMAGE_SIZE,
  MIN_SHAPE_SIZE,
  MIN_TEXT_SIZE,
  NOTE_COLORS,
  TEXT_FONT_SIZES,
  TIMED_SESSION_DURATIONS_MINUTES,
  boxCentreInFrame,
  canPlaceVote,
  connectorEndpoints,
  countItemVotes,
  createComment,
  createConnector,
  createFrame,
  createImage,
  createShape,
  createTextBox,
  createVote,
  formatSessionCountdown,
  isTimedSessionRunning,
  remainingSessionMs,
  normalizeShapeBox,
  penPathFromPoints,
  remainingDots,
  shapeBoxFromPoints,
  shapePolygonPoints,
  sortCommentsNewestFirst,
  visibleVotes,
  votesInSession,
  VOICE_NOTE_SIZE,
  type BoardMeta,
  type Box,
  type Comment,
  type Connector,
  type Frame,
  type ImageItem,
  type Note,
  type NoteColor,
  type PresenceUser,
  type SessionUser,
  type Shape,
  type ShapeKind,
  type ShapePoint,
  type TextBox,
  type TextFontSize,
  type VoiceNote,
  type Vote,
  type VotingSession,
} from "@syncboard/shared";
import {
  canDeleteBoard,
  createBoard,
  deleteBoard,
  fetchBoards,
  renameBoard,
  resolveCurrentBoard,
} from "./boards";
import {
  SHAPE_STROKE_COLORS,
  appendPenPoint,
  buildShapeMap,
  readShape,
  type ShapeMap,
} from "./shapes";
import {
  TEXT_COLORS,
  buildTextMap,
  readTextBox,
  setTextFontSize,
  type TextMap,
} from "./texts";
import { buildFrameMap, readFrame, type FrameMap } from "./frames";
import {
  buildConnectorMap,
  deleteConnectorsReferencing,
  readConnector,
  setConnectorArrow,
  setConnectorLabel,
  type ConnectorMap,
} from "./connectors";
import { SHORTCUTS } from "./shortcuts";
import {
  buildImageMap,
  downscaleImage,
  isSupportedImageFile,
  readImage,
  type ImageMap,
} from "./images";
import {
  blobToDataUrl,
  buildVoiceNote,
  buildVoiceNoteMap,
  formatDuration,
  isVoiceNoteOversize,
  readVoiceNote,
  VoiceRecorder,
  type VoiceMap,
} from "./voiceNotes";
import {
  buildCommentMap,
  formatCommentTime,
  readComment,
  type CommentMap,
} from "./comments";
import {
  buildVoteMap,
  readVote,
  readVotingSession,
  writeVotingSession,
  type VoteMap,
  type VotingMap,
} from "./votes";
import {
  applyBoardExport,
  boardExportToJson,
  buildNoteMap,
  downloadBlob,
  exportDocToBoard,
  parseBoardExport,
  renderBoardToCanvas,
  type BoardExport,
} from "./export";
import {
  createSnapshot,
  defaultSnapshotName,
  deleteSnapshot,
  fetchSnapshot,
  fetchSnapshots,
  formatSnapshotTime,
  snapshotCountsLabel,
  sortSnapshotsNewestFirst,
  type BoardSnapshotMeta,
} from "./snapshots";
import {
  findTemplateOrigin,
  placeTemplate,
  templateBounds,
  TEMPLATES,
  type BoardTemplate,
} from "./templates";
import {
  MINIMAP_HEIGHT,
  MINIMAP_WIDTH,
  itemRect,
  minimapBounds,
  minimapScale,
  minimapToBoard,
  panToCentreBoardPoint,
  viewportRect,
} from "./minimap";
import {
  distanceBetween,
  midpointOf,
  pinchView,
  type PinchStart,
} from "./pinch";
import {
  buildWhosHereRows,
  type WhosHereRow as WhosHereRowData,
} from "./presence";
import {
  findPresenter,
  fitFrameView,
  interpolateView,
  sortFramesForPresentation,
  stepSlideIndex,
  type CameraView,
} from "./present";
import { planAutoOrganize } from "./autoOrganize";
import { buildBoardLink } from "./share";
import { popIn, settlePop, slideInFromRight, staggerIn } from "./motion";
import { THEMES, applyTheme, getStoredTheme, type ThemeName } from "./theme";

// The sync server address, from the environment.
const SYNC_URL = import.meta.env.VITE_SYNC_URL ?? "ws://localhost:1234";

// One note inside the shared document: a Y.Map whose fields are
// numbers (x, y, w, h), a color name, and a Y.Text for the text.
type NoteMap = Y.Map<unknown>;

// The active board tool, from the tool rail. Select moves and edits
// things; Note drops a sticky note; Text drops a text box; the
// four shape tools draw shapes by dragging on empty canvas; Frame
// draws a named section the same way; Connector joins two items
// with an arrow; Comment pins a comment thread to the canvas.
// Vote places a dot on an item while a voting session is open.
// Voice drops a voice-note pin and starts recording.
type Tool = "select" | "note" | "text" | "frame" | "connector" | "comment" | "vote" | "voice" | ShapeKind;

// One item a frame drag carries along: what it is, which one, and
// where it started. Pen shapes also carry their points, because a
// pen stroke lives in absolute board pixels — moving x/y alone
// would leave the stroke behind.
type FrameDragContent = {
  kind: "note" | "shape" | "text" | "frame" | "image" | "voice";
  id: string;
  x: number;
  y: number;
  points?: ShapePoint[];
};

// The tool-rail tools, in display order.
const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: "select", label: "Select" },
  { id: "note", label: "Note" },
  { id: "text", label: "Text" },
  { id: "rect", label: "Rectangle" },
  { id: "ellipse", label: "Ellipse" },
  { id: "diamond", label: "Diamond" },
  { id: "triangle", label: "Triangle" },
  { id: "star", label: "Star" },
  { id: "line", label: "Line" },
  { id: "pen", label: "Pen" },
  { id: "connector", label: "Connector" },
  { id: "frame", label: "Frame" },
  { id: "comment", label: "Comment" },
  { id: "vote", label: "Vote" },
];

// Hand-drawn 16px stroke icons for the tool rail, in the button's
// own colour. No icon library: each icon is a few paths.
const TOOL_ICONS: Record<Tool, React.ReactNode> = {
  select: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4.5 2.5 L4.5 13 L7 10.6 L8.6 14 L10.2 13.2 L8.6 9.8 L12 9.8 Z" />
    </svg>
  ),
  note: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 2.5 h6.5 L13.5 5.5 v8 H4 Z" />
      <path d="M10.5 2.5 v3 h3" />
    </svg>
  ),
  text: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5 h10" />
      <path d="M8 4.5 v9" />
    </svg>
  ),
  rect: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="10" height="8" rx="1" />
    </svg>
  ),
  ellipse: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="8" cy="8" rx="5.5" ry="4" />
    </svg>
  ),
  diamond: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.5 L13.5 8 L8 13.5 L2.5 8 Z" />
    </svg>
  ),
  triangle: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3 L13.5 12.5 H2.5 Z" />
    </svg>
  ),
  star: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.5 L9.8 6.2 L13.8 6.7 L10.9 9.5 L11.6 13.4 L8 11.4 L4.4 13.4 L5.1 9.5 L2.2 6.7 L6.2 6.2 Z" />
    </svg>
  ),
  line: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12 L12 4" />
      <path d="M12 4 L9 4 M12 4 L12 7" />
    </svg>
  ),
  pen: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.5 2.5 L13.5 4.5 L6.5 11.5 L3.5 12.5 L4.5 9.5 Z" />
    </svg>
  ),
  // A connector joins two items: a dot where it starts, a line,
  // and an arrowhead where it lands.
  connector: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="4" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M5.5 10.5 L11.5 4.5" />
      <path d="M11.5 4.5 L8.5 4.5 M11.5 4.5 L11.5 7.5" />
    </svg>
  ),
  // A frame is a section: a dashed rectangle, like the outline
  // the board draws around a group of items.
  frame: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="1" strokeDasharray="3 2" />
    </svg>
  ),
  // A comment is a speech bubble: a rounded box with a tail
  // pointing at the spot it is pinned to.
  comment: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3.5 h10 v7 H8.5 L5.5 13.5 v-3 H3 Z" />
      <path d="M5.5 6.5 h5 M5.5 8.5 h3" />
    </svg>
  ),
  // A vote is a dot: one filled circle, like the dot a vote
  // leaves on an item.
  vote: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="8" r="5" />
    </svg>
  ),
  // A voice note is a microphone: a capsule with a stand, like
  // the pin a recording leaves on the board.
  voice: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="2" width="4" height="7" rx="2" />
      <path d="M4 7.5 a4 4 0 0 0 8 0" />
      <path d="M8 11.5 v2.5 M5.5 14 h5" />
    </svg>
  ),
};

// The same hand-drawn style for the undo, redo, export, and
// import buttons.
const ACTION_ICONS = {
  undo: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.5 4 L3 7.5 L6.5 11" />
      <path d="M3 7.5 H10 a3 3 0 0 1 0 6 H8" />
    </svg>
  ),
  redo: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 4 L13 7.5 L9.5 11" />
      <path d="M13 7.5 H6 a3 3 0 0 0 0 6 H8" />
    </svg>
  ),
  download: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.5 v8" />
      <path d="M5 7.5 L8 10.5 L11 7.5" />
      <path d="M3 13.5 h10" />
    </svg>
  ),
  upload: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 10.5 v-8" />
      <path d="M5 5.5 L8 2.5 L11 5.5" />
      <path d="M3 13.5 h10" />
    </svg>
  ),
} as const;

// The shared paper-key button recipe as Tailwind utilities: a
// paper key with a rule border and ink text (the old
// .toolbar-button rule from App.css). The header (Phase 1 of
// the Tailwind migration), the tool rail, the zoom controls,
// and the new-board form (Phase 3) all build on it, each adding
// its own size and colours. max-phone: is the phone layout
// (width <= 768px), matching the old @media (max-width: 48rem)
// rules.
const paperKeyClass =
  "inline-flex items-center gap-xs border rounded-input font-semibold whitespace-nowrap cursor-pointer [transition:background-color_var(--dur-short)_var(--ease-out),transform_var(--dur-micro)_var(--ease-out)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 [&_svg]:flex-none";

// The resting paper-key colours: paper fill, ink text, the
// deeper paper on hover and while disabled.
const paperKeyIdleClass =
  "border-rule bg-paper text-ink hover:bg-paper-3 disabled:bg-paper-3 disabled:text-muted";

const headerButtonClass = `${paperKeyClass} ${paperKeyIdleClass} justify-center min-h-[34px] px-sm py-2xs text-sm max-phone:min-h-11 max-phone:px-xs max-phone:text-xs`;

// Share is the header's one primary action: the filled accent
// key instead of a paper key.
const headerPrimaryButtonClass =
  "inline-flex items-center justify-center gap-xs min-h-[34px] px-sm py-2xs border border-accent rounded-input bg-accent-solid text-accent-ink text-sm font-semibold whitespace-nowrap cursor-pointer [transition:background-color_var(--dur-short)_var(--ease-out),transform_var(--dur-micro)_var(--ease-out)] hover:bg-accent-deep active:translate-y-px disabled:bg-paper-3 disabled:text-muted disabled:cursor-not-allowed disabled:opacity-55 [&_svg]:flex-none max-phone:min-h-11 max-phone:px-xs max-phone:text-xs";

// The connection status pill's colours per state. The word
// itself carries the meaning, never colour alone.
const statusClasses: Record<ConnectionStatus, string> = {
  connected: "bg-accent-soft text-accent-deep",
  connecting: "bg-paper-3 text-ink-2",
  disconnected: "bg-paper-3 text-muted",
};

// Phase 2 of the Tailwind migration: the bars under the header
// (voting, present, templates) share one container recipe and
// one pill-button recipe, as utilities. They replicate the old
// .voting-bar / .present-bar / .templates-bar rules from
// App.css, including the phone layout: one scrollable row, no
// wrapping, hidden scrollbar, 40px touch targets.
const barClass =
  "flex flex-wrap items-center gap-x-sm gap-y-xs px-md py-xs border-b border-rule bg-paper-2 text-sm max-phone:flex-nowrap max-phone:overflow-x-auto max-phone:px-sm max-phone:py-2xs max-phone:[scrollbar-width:none] max-phone:[&::-webkit-scrollbar]:hidden";

const barButtonClass =
  "px-sm py-3xs border border-rule rounded-pill bg-paper text-ink-2 font-semibold cursor-pointer disabled:bg-paper-3 disabled:text-muted disabled:cursor-default enabled:hover:bg-accent-soft max-phone:flex-none max-phone:min-h-10 max-phone:whitespace-nowrap";

// The status line in the voting bar. On a phone it wraps inside
// the row instead of running off the right edge as one long
// line, growing to fill the space the controls leave.
const votingStatusClass =
  "font-semibold text-ink-2 tabular-nums max-phone:flex-auto max-phone:min-w-[min(240px,70vw)] max-phone:whitespace-normal";

const dotsLabelClass =
  "flex items-center gap-2xs font-semibold text-ink-2 max-phone:flex-none max-phone:whitespace-nowrap";

const dotsSelectClass =
  "px-2xs py-3xs border border-muted rounded-input bg-paper text-ink font-semibold max-phone:min-h-10";

// Phase 3 of the Tailwind migration: the tool rail, zoom
// controls, minimap, and new-board form. The rail is a vertical
// strip of paper keys on desktop; on a phone it becomes a
// bottom toolbar: one horizontally scrollable row of 44px icon
// keys with the safe-area inset honoured, items snapping into
// place so nothing rests half-clipped at the edge.
const toolRailClass =
  "flex flex-none flex-col gap-sm p-sm border-r border-rule bg-paper-2 overflow-y-auto max-phone:order-2 max-phone:flex-row max-phone:items-center max-phone:gap-xs max-phone:pt-xs max-phone:[padding-bottom:calc(var(--space-xs)+env(safe-area-inset-bottom,0px))] max-phone:border-r-0 max-phone:border-t max-phone:overflow-x-auto max-phone:overflow-y-hidden max-phone:[scrollbar-width:none] max-phone:[&::-webkit-scrollbar]:hidden max-phone:snap-x max-phone:snap-proximity max-phone:scroll-px-sm max-phone:[&>*]:snap-start max-phone:after:content-[''] max-phone:after:flex-none max-phone:after:w-2xs";

// The micro label above each rail group (Add, Tools, Color,
// Text, History): a mono figure-style caption, so the rail
// scans in sections instead of one long run of keys. Hidden on
// a phone, where the icons carry it.
const railGroupLabelClass =
  "px-2xs font-outlier text-xs font-medium tracking-[0.08em] uppercase text-muted max-phone:hidden";

// In the rail the dividers run across, between the groups; in
// the phone toolbar they stand upright again.
const railDividerClass = "h-px flex-none bg-rule max-phone:h-lg max-phone:w-px";

// Rail keys stretch the rail's width, icon on the left, label
// beside it. On a phone they are 44px icon keys, centred.
const railButtonSizeClass =
  "min-h-9 px-md py-xs w-full justify-start max-phone:w-auto max-phone:flex-none max-phone:justify-center max-phone:min-w-11 max-phone:min-h-11 max-phone:p-xs";

const railButtonClass = `${paperKeyClass} ${paperKeyIdleClass} ${railButtonSizeClass}`;

// The active tool is the filled accent key, not a paper key.
const railButtonActiveClass = `${paperKeyClass} border-accent bg-accent-solid text-accent-ink hover:bg-accent-solid disabled:bg-accent-solid disabled:text-accent-ink ${railButtonSizeClass}`;

// In the rail the tool and font-size groups run down, not
// across; on a phone they join the toolbar row.
const railPickerClass =
  "flex flex-col items-stretch flex-wrap gap-2xs max-phone:flex-row max-phone:items-center max-phone:flex-none";

// The color dots sit three to a row in the rail, so the row
// never sets the rail's width — the tool buttons do.
const colorPickerClass =
  "grid grid-cols-[repeat(3,auto)] justify-start items-center gap-xs max-phone:flex max-phone:flex-nowrap max-phone:flex-none";

const colorDotClass =
  "size-lg p-0 border border-[color-mix(in_oklab,var(--color-ink)_20%,transparent)] rounded-full cursor-pointer focus-visible:outline-offset-4 max-phone:size-8 max-phone:flex-none max-phone:snap-start";

const colorDotActiveClass = `${colorDotClass} outline-2 outline-solid outline-accent outline-offset-2`;

// The font-size keys are centred single letters; the active
// size is a quieter selection than the active tool: an accent
// border and deep accent text on the deeper paper, not a
// second filled key.
const fontSizeButtonSizeClass =
  "min-h-9 min-w-10 p-xs text-center w-full justify-start max-phone:w-auto max-phone:flex-none max-phone:justify-center max-phone:min-w-11 max-phone:min-h-11";

const fontSizeButtonClass = `${paperKeyClass} ${paperKeyIdleClass} ${fontSizeButtonSizeClass}`;

const fontSizeButtonActiveClass = `${paperKeyClass} border-accent bg-paper-3 text-accent-deep hover:bg-paper-3 disabled:bg-paper-3 disabled:text-accent-deep ${fontSizeButtonSizeClass}`;

// The corner stack floats on the board, bottom-right: the
// minimap above the zoom controls, right-aligned.
const boardCornerClass =
  "absolute right-md bottom-md z-10 flex flex-col items-end gap-xs max-phone:right-sm max-phone:bottom-sm";

// Zoom is a paper key on the board, with a defined edge rather
// than a shadow. On a phone the pill never wraps into a
// stacked box: minus, figure, plus, and Reset stay on one line.
const zoomControlsClass =
  "flex flex-wrap items-center gap-2xs p-2xs border border-rule rounded-input bg-paper max-phone:flex-nowrap";

const zoomButtonClass = `${paperKeyClass} ${paperKeyIdleClass} justify-center min-h-9 min-w-10 p-xs text-center max-phone:min-h-11`;

const resetButtonClass = `${paperKeyClass} ${paperKeyIdleClass} justify-center min-h-9 px-md py-xs max-phone:min-h-11`;

// The zoom figure is the one place the mono face appears: it
// is a measurement, not a label.
const zoomLabelClass =
  "min-w-10 text-center font-outlier text-sm font-medium tabular-nums text-ink-2 whitespace-nowrap max-phone:min-w-6";

// The minimap: a small paper overview of the board. Clicking
// or dragging it pans the canvas, so it reads as grabbable. On
// a phone it is hidden: at 180px wide it would cover a third
// of the board, and the zoom controls stay so the view is
// still adjustable.
const minimapClass =
  "relative w-[180px] h-[120px] overflow-hidden border border-rule rounded-card bg-paper cursor-grab touch-none active:cursor-grabbing max-phone:hidden";

// The new-board form in the boards panel: the input takes the
// row and the buttons sit under it.
const boardNewFormClass = "flex items-center gap-xs flex-wrap";

const boardNewInputClass =
  "min-h-9 px-sm py-xs border border-muted rounded-input bg-paper text-ink outline-2 outline-solid outline-transparent -outline-offset-2 flex-1 min-w-0 focus-visible:border-ink-2 focus-visible:outline-focus";

const boardNewButtonClass = `${paperKeyClass} ${paperKeyIdleClass} justify-center min-h-9 px-md py-xs`;

// Phase 4 of the Tailwind migration: the side panels (boards,
// comments, snapshots) and their shared chrome. On desktop the
// panels are columns beside the board; on a phone they become
// overlay drawers above a tap-to-close backdrop, and collapsed
// they are just a floating toggle at the screen edge. The
// collapsed variants are separate full class strings, like the
// rail's active key, so no two utilities ever fight over the
// same property.

// The tap-to-close backdrop behind the phone panel drawers.
// Desktop panels sit in the flow, so it never shows there.
const panelBackdropClass =
  "hidden max-phone:block max-phone:absolute max-phone:inset-0 max-phone:z-[15] max-phone:p-0 max-phone:border-0 max-phone:bg-[color-mix(in_oklab,var(--color-band)_45%,transparent)] max-phone:cursor-pointer";

// The collapse toggle shared by all three panels: a small
// paper key with the chevron. On a phone it is a 44px touch
// target.
const panelToggleClass =
  "inline-flex items-center justify-center min-w-9 min-h-9 p-0 border border-rule rounded-input bg-paper text-ink text-md leading-none cursor-pointer [transition:background-color_var(--dur-short)_var(--ease-out),transform_var(--dur-micro)_var(--ease-out)] hover:bg-paper-3 active:translate-y-px max-phone:min-h-11";

// The panel head row: the title and the toggle. The comments
// and snapshots heads carry a hairline under them; collapsed,
// the head is only the toggle, so the hairline goes too.
const panelHeadClass = "flex items-center justify-between gap-xs";
const panelHeadRuledClass = "flex items-center justify-between gap-xs pb-xs border-b border-rule";

// The panel title. Collapsed, it hides — it is nowrap, so left
// showing it would set the collapsed strip's width.
const panelTitleClass = "font-semibold whitespace-nowrap";

// The boards sidebar: a column of board tabs, left of the
// rail. On a phone it slides over the board from the left;
// collapsed, it is just its toggle floating at the top-left.
const boardSidebarClass =
  "flex flex-none flex-col gap-sm w-[216px] p-sm border-r border-rule bg-paper-2 overflow-y-auto max-phone:absolute max-phone:left-0 max-phone:top-0 max-phone:bottom-0 max-phone:z-20 max-phone:w-[min(300px,85vw)] max-phone:shadow-lift";

const boardSidebarCollapsedClass =
  "flex flex-none flex-col gap-sm w-auto p-xs border-r border-rule bg-paper-2 overflow-y-auto max-phone:absolute max-phone:left-0 max-phone:top-0 max-phone:z-[12] max-phone:p-2xs max-phone:border-r-0 max-phone:bg-transparent max-phone:shadow-none";

// The board list is a plain list — the tabs carry the look.
const boardListClass = "flex flex-col gap-xs m-0 p-0 list-none";

// Board tabs are plastic keys; the open one is the accent key.
// In the sidebar they stretch the panel's width, and the name
// takes the free space so long names ellipsize instead of
// pushing the rename and delete keys off the edge.
const boardTabClass =
  "flex items-center w-full border border-rule rounded-pill bg-paper overflow-hidden";
const boardTabActiveClass =
  "flex items-center w-full border border-accent rounded-pill bg-accent-solid overflow-hidden";

const boardTabButtonClass =
  "flex-1 min-w-0 min-h-9 px-sm py-xs border-0 bg-transparent text-ink font-semibold whitespace-nowrap overflow-hidden text-ellipsis text-left cursor-pointer max-phone:min-h-11";
const boardTabButtonActiveClass =
  "flex-1 min-w-0 min-h-9 px-sm py-xs border-0 bg-transparent text-accent-ink font-semibold whitespace-nowrap overflow-hidden text-ellipsis text-left cursor-pointer max-phone:min-h-11";

const boardTabRenameClass =
  "min-h-9 px-2xs py-0 border-0 bg-transparent text-muted text-sm font-semibold whitespace-nowrap cursor-pointer max-phone:min-h-11";
const boardTabRenameActiveClass =
  "min-h-9 px-2xs py-0 border-0 bg-transparent text-accent-ink text-sm font-semibold whitespace-nowrap cursor-pointer max-phone:min-h-11";

const boardTabDeleteClass =
  "inline-flex items-center justify-center min-w-9 min-h-9 p-0 border-0 bg-transparent text-muted text-md leading-none cursor-pointer max-phone:min-h-11";
const boardTabDeleteActiveClass =
  "inline-flex items-center justify-center min-w-9 min-h-9 p-0 border-0 bg-transparent text-accent-ink text-md leading-none cursor-pointer max-phone:min-h-11";

// The rename form edits the name in place, so the input looks
// like the name itself — no border, no fill, just the text,
// with a focus outline. Save is an outline button (the accent
// border marks the one action that commits); Cancel is a bare
// text button.
const boardRenameFormClass = "flex items-center gap-xs flex-1 min-w-0 p-xs";

const boardRenameInputClass =
  "flex-1 min-w-0 min-h-7 px-xs py-0 border-0 rounded-pill bg-transparent text-ink font-semibold outline-2 outline-solid outline-transparent focus-visible:outline-focus";

const boardRenameSaveClass =
  "min-h-9 px-md py-xs border border-accent rounded-input bg-transparent text-ink font-semibold whitespace-nowrap cursor-pointer [transition:background-color_var(--dur-short)_var(--ease-out),transform_var(--dur-micro)_var(--ease-out)] disabled:border-rule disabled:bg-paper-3 disabled:text-muted disabled:cursor-not-allowed disabled:opacity-55";

const boardRenameCancelClass =
  "min-h-9 px-xs py-0 border-0 bg-transparent text-muted font-semibold whitespace-nowrap cursor-pointer";

// The dashed "new board" pill at the foot of the sidebar.
const boardNewDashedButtonClass =
  "w-full min-h-9 px-sm py-xs border border-dashed border-muted rounded-pill bg-transparent text-ink font-semibold whitespace-nowrap cursor-pointer [transition:background-color_var(--dur-short)_var(--ease-out),transform_var(--dur-micro)_var(--ease-out)] hover:bg-paper-3 active:translate-y-px";

// The boards load error reads as plain text in the panel, not
// as a banner — the sidebar is already a bordered panel.
const boardSidebarErrorClass = "m-0 p-0 border-0 bg-transparent text-error text-sm font-semibold";

// The comments panel: a paper card column right of the board.
// On a phone it slides over the board from the right;
// collapsed, it is just its toggle at the top-right corner.
const commentsPanelClass =
  "flex flex-none flex-col gap-sm w-[260px] p-sm border-l border-rule bg-paper-2 overflow-y-auto max-phone:absolute max-phone:right-0 max-phone:top-0 max-phone:bottom-0 max-phone:z-20 max-phone:w-[min(320px,88vw)] max-phone:shadow-lift";

const commentsPanelCollapsedClass =
  "flex flex-none flex-col gap-sm w-auto p-xs border-l border-rule bg-paper-2 overflow-y-auto max-phone:absolute max-phone:right-0 max-phone:top-0 max-phone:z-[12] max-phone:p-2xs max-phone:border-l-0 max-phone:bg-transparent max-phone:shadow-none";

// The snapshots panel, beside the comments panel: the same
// shape, so the two read as one family. On a phone it floats
// above the comments panel (z-21) when both are open, since
// it is the one the user just opened; collapsed, its toggle
// floats below the comments toggle so the two never overlap.
const snapshotsPanelClass =
  "flex flex-none flex-col gap-sm w-[260px] p-sm border-l border-rule bg-paper-2 overflow-y-auto max-phone:absolute max-phone:right-0 max-phone:top-0 max-phone:bottom-0 max-phone:z-[21] max-phone:w-[min(320px,88vw)] max-phone:shadow-lift";

const snapshotsPanelCollapsedClass =
  "flex flex-none flex-col gap-sm w-auto p-xs border-l border-rule bg-paper-2 overflow-y-auto max-phone:absolute max-phone:right-0 max-phone:top-[calc(var(--space-2xs)_+_48px)] max-phone:z-[12] max-phone:p-2xs max-phone:border-l-0 max-phone:bg-transparent max-phone:shadow-none";

// The panels' empty state is a dashed card, so "nothing here
// yet" reads as a place waiting for content, not stray text.
const panelEmptyClass = "m-0 p-sm border border-dashed border-muted rounded-card text-sm text-muted";

// The composer is a paper card at the top of the panel: a
// label, a field, and the actions under it.
const panelComposerClass = "grid gap-xs p-sm border border-rule rounded-card bg-paper";

const panelComposerLabelClass = "text-sm font-semibold text-ink-2";

const commentTextareaClass =
  "min-h-[72px] px-sm py-xs border border-muted rounded-input bg-paper text-ink text-sm leading-[1.4] resize-y outline-2 outline-solid outline-transparent -outline-offset-2 focus-visible:border-ink-2 focus-visible:outline-focus";

const snapshotNameInputClass =
  "min-h-8 px-sm py-xs border border-muted rounded-input bg-paper text-ink text-sm outline-2 outline-solid outline-transparent -outline-offset-2 focus-visible:border-ink-2 focus-visible:outline-focus";

const panelActionsClass = "flex gap-xs";

// The small keys in the composers and under each thread or
// snapshot: pills, not the toolbar's input-radius keys, so
// they read as inline actions rather than toolbar buttons. A
// disabled key changes in four channels at once — fill, ink,
// cursor, opacity — like every other disabled button.
const panelPillButtonClass =
  "min-h-8 px-xs py-2xs border border-rule rounded-pill bg-paper text-ink-2 text-sm font-semibold cursor-pointer [transition:background-color_var(--dur-short)_var(--ease-out)] hover:bg-paper-3 disabled:text-muted disabled:cursor-not-allowed disabled:opacity-55";

// The thread and snapshot lists are plain lists — the rows
// carry the look.
const panelListClass = "flex flex-col gap-xs m-0 p-0 list-none";

// One comment thread: author and time on top, the text, then
// Resolve and Delete. The selected one gets the accent border
// to match its pin; a resolved one reads quieter (the
// opacity-65 utility appended where it renders).
const commentThreadClass = "grid gap-2xs p-sm border border-rule rounded-card bg-paper cursor-pointer";
const commentThreadSelectedClass =
  "grid gap-2xs p-sm border border-accent rounded-card bg-paper cursor-pointer shadow-[0_0_0_1px_var(--color-accent)]";

const commentThreadHeadClass = "flex items-baseline justify-between gap-xs";

// The time beside an author or a snapshot name: small tabular
// figures, never wrapping.
const panelTimeClass = "text-xs tabular-nums text-muted whitespace-nowrap";

const commentTextClass = "m-0 text-sm leading-[1.4] [overflow-wrap:anywhere] whitespace-pre-wrap";

// One snapshot: name and time stacked — a snapshot name can be
// long, and side by side with the time it wraps badly. Then
// what it holds, then Restore and Delete.
const snapshotRowClass = "grid gap-2xs p-sm border border-rule rounded-card bg-paper";

const snapshotRowHeadClass = "flex flex-col items-start gap-0";

const snapshotNameClass = "font-semibold [overflow-wrap:anywhere]";

const snapshotCountsClass = "m-0 text-sm text-muted leading-[1.4]";

// A comment pin on the canvas: a round accent key with a
// speech bubble, sitting above the spot it marks. The draft
// pin is a dashed paper key instead — it is not a thread yet,
// and it never blocks a click on the board.
const commentPinClass =
  "absolute z-[6] flex items-center justify-center size-7 p-0 border-2 border-paper rounded-full bg-accent-solid text-accent-ink cursor-pointer -translate-x-1/2 -translate-y-full";

const commentPinSelectedClass = `${commentPinClass} shadow-[0_0_0_2px_var(--color-focus)]`;

const commentPinDraftClass =
  "absolute z-[6] flex items-center justify-center size-7 p-0 border-2 border-dashed border-paper rounded-full bg-paper-3 text-ink-2 cursor-pointer pointer-events-none -translate-x-1/2 -translate-y-full";

// Phase 5 of the Tailwind migration: the board itself and
// everything on it. Position, size, and per-item colours stay
// inline styles (they come from the shared document); only the
// fixed styling moves to utilities. The board's ground (paper
// grain, or the dot grid in Dark/Light) is the board-ground
// utility in tailwind.css, and the two animations are the
// animate-* mappings there.

// The page shell: header, bars, and board stacked to the full
// viewport height. dvh, so a phone's collapsing browser chrome
// never clips the bottom toolbar.
const boardPageClass = "flex flex-col h-dvh";

// A short note under the header (board deleted, import done,
// connector started). It slides down a touch as it appears, so
// the eye catches the new line.
const boardNoticeClass =
  "m-0 px-md py-xs border-b border-rule bg-paper-3 text-ink-2 text-sm font-semibold animate-board-notice-in max-phone:px-sm max-phone:py-2xs";

const boardNoticeButtonClass =
  "ml-xs px-xs py-3xs border border-rule rounded-input bg-paper text-ink-2 font-semibold cursor-pointer hover:bg-paper-2";

// The vote count badge on an item, half outside its top-right
// corner like a badge. It never takes clicks, so voting on a
// badged item still works.
const voteBadgeClass =
  "absolute -top-[10px] -right-[10px] z-[5] flex items-center justify-center min-w-[22px] h-[22px] px-2xs border-2 border-paper rounded-pill bg-accent-solid text-accent-ink text-xs font-bold tabular-nums pointer-events-none shadow-card";

// The row under the header: panels, rail, and board. On a
// phone it stacks — canvas on top, tools along the bottom.
const boardMainClass = "relative flex flex-1 min-h-0 max-phone:flex-col";

// The board viewport. Dragging empty canvas pans, so it reads
// as grabbable; the cursor itself is picked in the JSX (grab,
// grabbing while panning, crosshair with a drawing tool).
const boardClass =
  "board-ground relative flex-1 overflow-hidden bg-paper touch-none max-phone:order-1 max-phone:min-h-0";

// The transformed layer that holds the items. Pan and zoom
// move this layer; the board element is the fixed viewport.
const boardCanvasClass = "absolute inset-0 origin-top-left";

// The empty state sits on the viewport, not the canvas layer,
// so it stays centred at any pan or zoom. It never blocks a
// click on the board.
const boardEmptyClass =
  "absolute inset-0 grid place-content-center gap-2xs p-md text-center pointer-events-none";

const boardEmptyTitleClass = "font-display text-lg font-bold tracking-display text-ink";

const boardEmptyLineClass = "text-muted text-sm";

// A remote collaborator's cursor. Decoration only — it must
// never block clicks.
const remoteCursorClass = "absolute z-10 flex items-start pointer-events-none";

const remoteCursorNameClass =
  "ml-3xs px-xs py-3xs rounded-pill text-band-ink text-xs font-semibold whitespace-nowrap";

// The label naming who selected an item, floating above its
// top edge in the selector's colour (the colour is inline).
const itemSelectorClass =
  "absolute left-0 z-[5] px-xs py-3xs rounded-pill text-band-ink text-xs font-semibold whitespace-nowrap pointer-events-none [top:calc(-1*(var(--space-lg)_+_var(--space-3xs)))]";

// A shape's box. The box grabs for dragging; the SVG inside is
// decoration and never blocks the press on the shape itself.
const shapeClass = "absolute cursor-grab touch-none active:cursor-grabbing";

const shapeSvgClass = "absolute inset-0 block pointer-events-none";

// An uploaded picture. The picture itself never takes the
// pointer — the box does, so dragging works and the browser's
// own image drag never fights it.
const imageItemClass = "absolute cursor-grab touch-none active:cursor-grabbing";

const imageItemImgClass = "block w-full h-full object-fill pointer-events-none rounded-input";

// A voice note pin: a fixed-size paper chip with a play button
// and its duration. The pin grabs for dragging; the play
// button stops the press, so playing never starts a drag.
const voiceNoteBaseClass =
  "absolute w-[72px] h-[72px] flex flex-col items-center justify-center gap-[2px] bg-paper border rounded-input shadow-card cursor-grab touch-none active:cursor-grabbing";

const voiceNoteClass = `${voiceNoteBaseClass} border-rule`;

// A recording in progress: the same pin with an error-coloured
// border, a pulsing red dot, and a running timer.
const voiceNoteRecordingClass = `${voiceNoteBaseClass} border-error`;

const voicePlayClass =
  "flex items-center justify-center w-8 h-8 p-0 border-0 rounded-full bg-accent-solid text-accent-ink text-[13px] leading-none cursor-pointer";

const voiceDurationClass = "font-outlier text-sm text-muted leading-none";

const voiceRecDotClass =
  "w-3 h-3 rounded-full bg-error animate-voice-rec-pulse motion-reduce:animate-none";

const voiceStopClass =
  "px-sm py-2xs border-0 rounded-input bg-accent-solid text-accent-ink text-sm font-semibold cursor-pointer";

// A named section on the board. The fill stays paper — the
// frame's colour shows in its border (inline) and title pill.
const frameClass = "absolute bg-paper rounded-input cursor-grab touch-none active:cursor-grabbing";

// The frame title: an input that reads as a label, in the mono
// face. It only looks like a field while the user is typing.
// The text uses the on-note colour, not the theme ink: the
// pill's background is always a pastel note colour (inline),
// so the dark on-note text stays readable in every theme —
// the Dark theme's near-white ink would vanish on the pastel.
const frameTitleClass =
  "absolute px-xs py-2xs border-0 rounded-pill outline-0 text-on-note font-outlier text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus focus-visible:outline-offset-1";

// One overlay SVG for every connector, between the frames and
// the items. It never blocks clicks on empty board — only the
// lines themselves are clickable — and it is not clipped, so
// a line to an off-screen item still draws.
const connectorSvgClass = "absolute inset-0 w-full h-full overflow-visible pointer-events-none";

const connectorLineClass = "[pointer-events:stroke] cursor-pointer";

// The invisible wide hit area around a connector line, so the
// thin line is easy to grab.
const connectorHitClass = "[stroke:transparent] [stroke-width:14] [pointer-events:stroke]";

// A connector's label pill at the line's midpoint, in the
// connector's colour (the border colour is inline). Clicking
// it selects the connector.
const connectorLabelClass =
  "absolute z-[5] px-xs py-3xs border-[1.5px] border-rule rounded-pill bg-paper text-ink text-xs font-semibold whitespace-nowrap cursor-pointer -translate-x-1/2 -translate-y-1/2";

// The selected connector's toolbar at the line's midpoint: the
// label input, the arrowhead toggle, and the delete button.
const connectorToolbarClass =
  "absolute z-[6] flex items-center gap-2xs p-3xs border border-rule rounded-pill bg-paper shadow-card -translate-x-1/2 -translate-y-1/2";

const connectorLabelInputClass =
  "px-xs py-3xs border-0 rounded-pill outline-0 bg-paper-2 text-ink text-xs font-semibold focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus focus-visible:outline-offset-1";

// The arrowhead toggle: pressed means the arrowhead shows.
const connectorArrowToggleClass =
  "flex items-center justify-center w-lg h-lg p-0 border-0 rounded-full bg-transparent text-muted text-md leading-none cursor-pointer aria-pressed:bg-accent-soft aria-pressed:text-accent-deep";

// The round delete key in the connector toolbar. The same key
// as a selected item's delete button, sitting in the row.
const connectorDeleteClass =
  "z-[6] flex items-center justify-center w-lg h-lg p-0 border-0 rounded-full bg-[color-mix(in_oklab,var(--color-paper)_85%,transparent)] text-error text-md leading-none cursor-pointer hover:bg-paper";

// A sticky note. Its colour is inline; while its text is being
// typed in, the focus ring shows on top of the usual shadow.
const noteClass =
  "absolute flex flex-col rounded-input shadow-card focus-within:shadow-[0_0_0_2px_var(--color-focus),var(--shadow-card)]";

// The top strip is the drag handle — grabbing it moves the note.
const noteHandleClass = "h-lg flex-none cursor-grab touch-none active:cursor-grabbing";

const noteTextClass =
  "flex-1 min-h-0 px-sm pt-2xs pb-sm border-0 outline-0 resize-none overflow-hidden bg-transparent text-on-note text-md leading-[1.4]";

// The round delete key on a selected item (note, shape, image,
// voice note, text box, frame), pinned to its top-right.
const itemDeleteClass =
  "absolute top-2xs right-2xs z-[6] flex items-center justify-center w-lg h-lg p-0 border-0 rounded-full bg-[color-mix(in_oklab,var(--color-paper)_85%,transparent)] text-error text-md leading-none cursor-pointer hover:bg-paper";

// The resize grip, bottom-right of a selected item.
const itemResizeClass =
  "absolute right-0 bottom-0 z-[6] w-md h-md rounded-tl-[var(--space-2xs)] rounded-br-input bg-[color-mix(in_oklab,var(--color-ink)_18%,transparent)] cursor-nwse-resize touch-none";

// A text box: just text on the board, in the picked colour
// (inline), with no background of its own. While typing, a
// faint accent tint and the focus ring show.
const textBoxClass =
  "absolute flex flex-col rounded-[var(--space-2xs)] focus-within:bg-[color-mix(in_oklab,var(--color-accent)_6%,transparent)] focus-within:shadow-[0_0_0_2px_var(--color-focus)]";

// The top strip is the drag handle — grabbing it moves the box.
const textHandleClass = "h-md flex-none cursor-grab touch-none active:cursor-grabbing";

const textBoxTextClass =
  "flex-1 min-h-0 px-2xs pt-0 pb-2xs border-0 outline-0 resize-none overflow-hidden bg-transparent text-inherit leading-[1.4]";

// Throttle: about 30 cursor updates per second. Pointermove
// fires far more often than that, and every update is a message
// to the server.
const CURSOR_THROTTLE_MS = 33;

// The token endpoint lives on the same server as the sync
// websocket, so the HTTP URL is the sync URL with ws -> http.
function httpSyncUrl(): string {
  return SYNC_URL.replace(/^ws/, "http");
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNoteColor(value: unknown): NoteColor {
  return typeof value === "string" && value in NOTE_COLORS ? (value as NoteColor) : "yellow";
}

// Reads one note out of the shared document into a plain object
// React can render. Unknown or missing fields fall back to
// defaults instead of crashing the board.
function readNote(id: string, noteMap: NoteMap): Note {
  const text = noteMap.get("text");
  return {
    id,
    x: asNumber(noteMap.get("x"), 0),
    y: asNumber(noteMap.get("y"), 0),
    w: asNumber(noteMap.get("w"), DEFAULT_NOTE_SIZE.w),
    h: asNumber(noteMap.get("h"), DEFAULT_NOTE_SIZE.h),
    color: asNoteColor(noteMap.get("color")),
    text: text instanceof Y.Text ? text.toString() : "",
  };
}

// Updates a Y.Text to match the textarea, changing only the part
// that actually differs. A whole-string replace would delete text
// another user typed at the same time; a prefix/suffix diff keeps
// both people's typing. The change runs under `origin` so the
// local UndoManager can track it (and only it).
function updateNoteText(doc: Y.Doc, text: Y.Text, next: string, origin: unknown): void {
  const current = text.toString();
  if (current === next) return;
  let start = 0;
  while (start < current.length && start < next.length && current[start] === next[start]) {
    start += 1;
  }
  let endCurrent = current.length;
  let endNext = next.length;
  while (
    endCurrent > start &&
    endNext > start &&
    current[endCurrent - 1] === next[endNext - 1]
  ) {
    endCurrent -= 1;
    endNext -= 1;
  }
  doc.transact(() => {
    if (endCurrent > start) text.delete(start, endCurrent - start);
    if (endNext > start) text.insert(start, next.slice(start, endNext));
  }, origin);
}

// Reads a cursor out of an Awareness state. Anything malformed
// is not a cursor.
function asCursor(value: unknown): { x: number; y: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as { x: unknown; y: unknown };
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

// Reads a remote user's presence out of an Awareness state.
// Remote states are untrusted data, so anything malformed is
// ignored instead of crashing the board.
function asPresenceUser(state: unknown): PresenceUser | null {
  if (typeof state !== "object" || state === null) return null;
  const record = state as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.color !== "string"
  ) {
    return null;
  }
  const selected = record.selectedNoteIds;
  const selectedShapes = record.selectedShapeIds;
  const selectedTexts = record.selectedTextIds;
  const presenting = record.presentingFrameId;
  return {
    id: record.id,
    name: record.name,
    color: record.color,
    cursor: asCursor(record.cursor),
    selectedNoteIds: Array.isArray(selected)
      ? selected.filter((id): id is string => typeof id === "string")
      : [],
    selectedShapeIds: Array.isArray(selectedShapes)
      ? selectedShapes.filter((id): id is string => typeof id === "string")
      : [],
    selectedTextIds: Array.isArray(selectedTexts)
      ? selectedTexts.filter((id): id is string => typeof id === "string")
      : [],
    presentingFrameId: typeof presenting === "string" ? presenting : null,
  };
}

type ConnectionStatus = "connecting" | "connected" | "disconnected";

// The provider reports status as a string enum; this maps it onto
// the three states the header shows.
function toConnectionStatus(status: string): ConnectionStatus {
  if (status === "connected") return "connected";
  if (status === "connecting") return "connecting";
  return "disconnected";
}

// The localStorage key for the session: the token and the user
// it belongs to. The token is what the sync server verifies, so
// keeping it here is what keeps the user signed in across reloads.
const SESSION_KEY = "syncboard.session";

type Session = { user: SessionUser; token: string };

// Reads a saved session back. Anything malformed is not a
// session — the user just signs in again.
function loadStoredSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { token?: unknown }).token !== "string"
    ) {
      return null;
    }
    const user = (parsed as { user?: unknown }).user;
    if (
      typeof user !== "object" ||
      user === null ||
      typeof (user as SessionUser).id !== "string" ||
      typeof (user as SessionUser).name !== "string" ||
      typeof (user as SessionUser).color !== "string"
    ) {
      return null;
    }
    return parsed as Session;
  } catch {
    return null;
  }
}

export default function App() {
  // Restored from localStorage when the page loads, so a reload
  // keeps the user on the board. A stored token is only trusted
  // once the sync server accepts it — if the server rejects it,
  // onAuthFailed below drops the session and the auth screen
  // comes back.
  const [session, setSession] = useState<Session | null>(loadStoredSession);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // Shown on the auth screen when a restored session turned out
  // to be expired or invalid.
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  // The sign-in screen's root, so its pieces can fade in once
  // when the screen first appears.
  const pickerRef = useRef<HTMLElement | null>(null);

  // Entrance for the sign-in screen: the wordmark, tagline, form,
  // and demo button rise in one after another. Runs once per
  // visit to the screen; reduced-motion visitors skip it inside
  // the helper.
  useEffect(() => {
    if (session || !pickerRef.current) {
      return;
    }
    const pieces = Array.from(
      pickerRef.current.querySelectorAll<HTMLElement>("[data-entrance]"),
    );
    staggerIn(pieces);
  }, [session]);

  // Saves the session and opens the board. Called after a
  // successful login, signup, or demo sign-in.
  function openSession(next: Session): void {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setAuthError(null);
    setAuthNotice(null);
    setPassword("");
    setSession(next);
  }

  // Signs out: the stored token is dropped, so a reload after
  // this lands on the auth screen instead of the board. The
  // form goes back to login — signing up again is one link away.
  function signOut(): void {
    window.localStorage.removeItem(SESSION_KEY);
    setMode("login");
    setSession(null);
  }

  // The sync server rejected the stored token (it expired, or
  // the database was reset). Drop the session and show the auth
  // screen with a note, instead of sitting on a board that can
  // never connect. Wrapped in useCallback so the board's sync
  // effect keeps a stable reference — it lists this callback as
  // a dependency, and a fresh function every render would tear
  // the live connection down and rebuild it.
  const handleAuthFailed = useCallback((): void => {
    window.localStorage.removeItem(SESSION_KEY);
    setMode("login");
    setSession(null);
    setAuthNotice("Your session expired — please log in again.");
  }, []);

  // One auth request to the sync server. A non-2xx answer throws
  // with the server's plain message, so the form can show it.
  async function authRequest(path: string, body?: { username: string; password: string }): Promise<Session> {
    const response = await fetch(`${httpSyncUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(
        typeof data?.error === "string" ? data.error : `Sign-in failed (${response.status}).`,
      );
    }
    return data as Session;
  }

  // Logs in or signs up with the form's username and password.
  async function submitAuth(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      const next = await authRequest(
        mode === "login" ? "/auth/login" : "/auth/signup",
        { username, password },
      );
      openSession(next);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setAuthBusy(false);
    }
  }

  // Signs in as the built-in demo account — no username or
  // password needed. The demo is for trying the board, not for
  // keeping work: anyone can sign in as Demo.
  async function signInAsDemo(): Promise<void> {
    setAuthBusy(true);
    setAuthError(null);
    try {
      openSession(await authRequest("/auth/demo"));
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not start the demo.");
    } finally {
      setAuthBusy(false);
    }
  }

  // Switches between the login and signup forms, clearing the
  // last error so it does not follow the user across.
  function switchMode(next: "login" | "signup"): void {
    setMode(next);
    setAuthError(null);
  }

  if (!session) {
    return (
      <main className="grid gap-md place-content-center min-h-dvh p-lg text-center max-phone:gap-sm max-phone:p-md" ref={pickerRef}>
        <h1 className="text-3xl max-phone:text-2xl" data-entrance>SyncBoard</h1>
        <p className="text-ink-2 font-medium tracking-[0.01em]" data-entrance>
          Real-time collaborative whiteboard
        </p>
        <p data-entrance>
          {mode === "login"
            ? "Log in to join the board."
            : "Create an account to join the board."}
        </p>
        <form className="grid gap-sm w-[min(320px,100%)] justify-self-center p-lg border border-rule rounded-card bg-paper shadow-card" data-entrance onSubmit={(event) => void submitAuth(event)}>
          <label className="grid gap-2xs text-left text-sm font-semibold text-ink-2">
            Username
            <input
              className="min-h-11 px-sm py-xs border border-muted rounded-input bg-paper-2 text-ink outline-2 outline-transparent -outline-offset-2 hover:bg-paper-3 focus-visible:border-ink-2 focus-visible:outline-focus"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              maxLength={20}
              autoFocus
            />
          </label>
          <label className="grid gap-2xs text-left text-sm font-semibold text-ink-2">
            Password
            <input
              className="min-h-11 px-sm py-xs border border-muted rounded-input bg-paper-2 text-ink outline-2 outline-transparent -outline-offset-2 hover:bg-paper-3 focus-visible:border-ink-2 focus-visible:outline-focus"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
          {/* Always rendered so the form never jumps when a
              sign-in fails; the line is reserved in CSS. */}
          <p className="min-h-[1lh] text-error text-sm font-semibold" role="alert">
            {authError ?? ""}
          </p>
          <button type="submit" className="min-h-11 px-md py-xs border-0 rounded-input bg-accent-solid text-accent-ink font-semibold cursor-pointer [transition:background-color_var(--dur-short)_var(--ease-out),transform_var(--dur-micro)_var(--ease-out)] hover:bg-accent-deep active:translate-y-px disabled:bg-accent-deep disabled:text-accent-soft disabled:cursor-not-allowed disabled:opacity-55" disabled={authBusy}>
            {mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>
        {mode === "login" ? (
          <button type="button" className="p-0 border-0 bg-transparent text-accent-deep font-semibold whitespace-nowrap cursor-pointer hover:underline" data-entrance onClick={() => switchMode("signup")}>
            No account yet? Create one
          </button>
        ) : (
          <button type="button" className="p-0 border-0 bg-transparent text-accent-deep font-semibold whitespace-nowrap cursor-pointer hover:underline" data-entrance onClick={() => switchMode("login")}>
            Already have an account? Log in
          </button>
        )}
        <button
          type="button"
          className="flex items-center justify-center gap-xs w-[min(320px,100%)] justify-self-center min-h-11 px-md py-xs border border-rule rounded-input bg-transparent text-ink font-semibold cursor-pointer [transition:background-color_var(--dur-short)_var(--ease-out),transform_var(--dur-micro)_var(--ease-out)] hover:bg-paper-2 active:translate-y-px disabled:bg-paper-3 disabled:text-muted disabled:cursor-not-allowed disabled:opacity-55"
          data-entrance
          disabled={authBusy}
          onClick={() => void signInAsDemo()}
        >
          Try the demo
        </button>
        {authNotice && <p className="max-w-[420px] text-sm text-muted" data-entrance>{authNotice}</p>}
        <p className="max-w-[420px] text-sm text-muted" data-entrance>
          Usernames are 3–20 characters, letters, numbers, underscores, and hyphens only;
          passwords are at least 8 characters. The demo needs no account. Open the board in two
          tabs, one signed in and one on the demo, to see live sync.
        </p>
      </main>
    );
  }

  return (
    <BoardsApp
      user={session.user}
      token={session.token}
      onSignOut={signOut}
      onAuthFailed={handleAuthFailed}
    />
  );
}

// Owns the board list and which board is open. The Board below
// is keyed by board id, so switching boards unmounts it and a
// fresh provider, document, undo stack, and presence join the
// new room — undo and presence are per-board, never shared.
function BoardsApp({
  user,
  token,
  onSignOut,
  onAuthFailed,
}: {
  user: SessionUser;
  token: string;
  onSignOut: () => void;
  onAuthFailed: () => void;
}) {
  const [boards, setBoards] = useState<BoardMeta[] | null>(null);
  const [boardsError, setBoardsError] = useState<string | null>(null);
  const [currentBoardId, setCurrentBoardId] = useState(DEFAULT_BOARD_ID);
  // A short note shown when the open board was deleted — by this
  // user or by someone else — and the app moved back to the
  // default board.
  const [notice, setNotice] = useState<string | null>(null);
  // Refs mirror the state above so the polling loop below always
  // sees the latest list and board without restarting.
  const boardsRef = useRef<BoardMeta[] | null>(null);
  const currentBoardRef = useRef(currentBoardId);
  useEffect(() => {
    boardsRef.current = boards;
  }, [boards]);
  useEffect(() => {
    currentBoardRef.current = currentBoardId;
  }, [currentBoardId]);

  // Loads the board list once, when the app opens.
  useEffect(() => {
    let stopped = false;
    void fetchBoards(httpSyncUrl())
      .then((next) => {
        if (!stopped) setBoards(next);
      })
      .catch((error: unknown) => {
        if (!stopped) {
          setBoardsError(error instanceof Error ? error.message : "Could not load boards.");
        }
      });
    return () => {
      stopped = true;
    };
  }, []);

  // Re-checks the list every few seconds. That is how a client
  // learns its board was deleted by someone else: the board
  // disappears from the list, and this client moves back to the
  // default board with a note instead of sitting on a dead board.
  // A failed poll is ignored — the last good list stays put.
  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchBoards(httpSyncUrl())
        .then((next) => {
          const before = boardsRef.current;
          const openId = currentBoardRef.current;
          setBoards(next);
          if (resolveCurrentBoard(next, openId) !== openId) {
            const name = before?.find((board) => board.id === openId)?.name ?? "That board";
            setCurrentBoardId(DEFAULT_BOARD_ID);
            setNotice(`"${name}" was deleted, so you're back on the Main board.`);
          }
        })
        .catch(() => {
          // Keep the last good list; the next poll retries.
        });
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  function switchBoard(boardId: string): void {
    setCurrentBoardId(boardId);
    setNotice(null);
  }

  // Creates a board and opens it. Returns false when the server
  // refused, so the form can stay open for another try.
  async function handleCreateBoard(name: string): Promise<boolean> {
    setBoardsError(null);
    try {
      const created = await createBoard(httpSyncUrl(), name);
      setBoards((prev) => (prev ? [...prev, created] : [created]));
      setCurrentBoardId(created.id);
      setNotice(null);
      return true;
    } catch (error) {
      setBoardsError(error instanceof Error ? error.message : "Could not create board.");
      return false;
    }
  }

  // Renames a board and updates the list in place. Returns
  // false when the server refused, so the inline form can stay
  // open for another try. Renaming the open board leaves it
  // open — only the name changes.
  async function handleRenameBoard(board: BoardMeta, name: string): Promise<boolean> {
    setBoardsError(null);
    try {
      const renamed = await renameBoard(httpSyncUrl(), board.id, name);
      setBoards((prev) =>
        (prev ?? []).map((item) => (item.id === board.id ? renamed : item)),
      );
      return true;
    } catch (error) {
      setBoardsError(error instanceof Error ? error.message : "Could not rename board.");
      return false;
    }
  }

  // Deletes a board after a confirm step. Deleting the open
  // board moves this client back to the default board; deleting
  // another board leaves the open one alone.
  async function handleDeleteBoard(board: BoardMeta): Promise<void> {
    if (
      !window.confirm(
        `Delete board "${board.name}"? Its notes and shapes will be gone for everyone.`,
      )
    ) {
      return;
    }
    setBoardsError(null);
    try {
      await deleteBoard(httpSyncUrl(), board.id);
      setBoards((prev) => (prev ?? []).filter((item) => item.id !== board.id));
      if (board.id === currentBoardRef.current) {
        setCurrentBoardId(DEFAULT_BOARD_ID);
        setNotice(`"${board.name}" was deleted. You're back on the Main board.`);
      }
    } catch (error) {
      setBoardsError(error instanceof Error ? error.message : "Could not delete board.");
    }
  }

  return (
    <Board
      key={currentBoardId}
      user={user}
      token={token}
      onSignOut={onSignOut}
      onAuthFailed={onAuthFailed}
      boardId={currentBoardId}
      boards={boards ?? []}
      boardsError={boardsError}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
      onSwitchBoard={switchBoard}
      onCreateBoard={handleCreateBoard}
      onRenameBoard={handleRenameBoard}
      onDeleteBoard={handleDeleteBoard}
    />
  );
}

function Board({
  user,
  token,
  onSignOut,
  onAuthFailed,
  boardId,
  boards,
  boardsError,
  notice,
  onDismissNotice,
  onSwitchBoard,
  onCreateBoard,
  onRenameBoard,
  onDeleteBoard,
}: {
  user: SessionUser;
  token: string;
  onSignOut: () => void;
  onAuthFailed: () => void;
  boardId: string;
  boards: BoardMeta[];
  boardsError: string | null;
  notice: string | null;
  onDismissNotice: () => void;
  onSwitchBoard: (boardId: string) => void;
  onCreateBoard: (name: string) => Promise<boolean>;
  onRenameBoard: (board: BoardMeta, name: string) => Promise<boolean>;
  onDeleteBoard: (board: BoardMeta) => Promise<void>;
}) {
  // The active theme. index.html already put the saved theme on
  // <html> before first paint; this state mirrors it so the picker
  // shows the right choice, and changing it re-applies + saves.
  const [theme, setTheme] = useState<ThemeName>(getStoredTheme);
  const changeTheme = (next: ThemeName) => {
    setTheme(next);
    applyTheme(next);
  };
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [authError, setAuthError] = useState<string | null>(null);
  // The new-board form in the board sidebar: whether it is
  // open, the name typed so far, and whether a create is in
  // flight. This is per-board view state, so it resets when the
  // board switches — the form never survives a switch.
  const [showNewBoardForm, setShowNewBoardForm] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [creatingBoard, setCreatingBoard] = useState(false);
  // The rename in the board sidebar: which board's row is being
  // edited, the name typed so far, and whether a rename is in
  // flight. One row at a time — opening another closes this one.
  // Like the new-board form, this is per-board view state, so it
  // resets when the board switches.
  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renamingBoard, setRenamingBoard] = useState(false);
  // The board sidebar, left of the tool rail: whether its board
  // list is showing. Collapsed it is just the toggle, so the
  // board gets the width back.
  // Phones start collapsed: at 390px the open sidebar takes half
  // the screen and leaves the board a sliver, so the toggle is
  // the way in instead of the default.
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.innerWidth >= 768,
  );
  const [notes, setNotes] = useState<Note[]>([]);
  // The shapes on the board, from the shared "shapes" map —
  // rectangles, ellipses, lines, and pen strokes.
  const [shapes, setShapes] = useState<Shape[]>([]);
  // The text boxes on the board, from the shared "texts" map —
  // free-floating text with no background, unlike notes.
  const [texts, setTexts] = useState<TextBox[]>([]);
  // The images on the board, from the shared "images" map —
  // pictures placed by a user, stored downscaled as data URLs.
  const [images, setImages] = useState<ImageItem[]>([]);
  // The voice notes on the board, from the shared "voiceNotes"
  // map — short recordings pinned to a spot, stored as data URLs.
  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);
  // The frames on the board, from the shared "frames" map —
  // named sections that hold other items.
  const [frames, setFrames] = useState<Frame[]>([]);
  // The connectors on the board, from the shared "connectors"
  // map — arrows joining two items, recomputed from their
  // positions every render.
  const [connectors, setConnectors] = useState<Connector[]>([]);
  // The comment threads on the board, from the shared
  // "comments" map — each one pinned to a spot on the canvas.
  const [comments, setComments] = useState<Comment[]>([]);
  // The dot votes on the board, from the shared "votes" map —
  // one entry per dot placed, keyed by the vote's own id.
  const [votes, setVotes] = useState<Vote[]>([]);
  // The dot-voting session, from the shared "voting" map.
  // Null when no session has ever started on this board.
  const [votingSession, setVotingSession] = useState<VotingSession | null>(null);
  // The dots per person the starter picks before opening a
  // session. Local only until Start voting writes it to the
  // shared session.
  const [dotsPerPersonChoice, setDotsPerPersonChoice] = useState(DEFAULT_DOTS_PER_PERSON);
  // The length the starter picks for a timed session, in
  // minutes. Local only until Start timed session writes the
  // end time to the shared session.
  const [timedDurationChoice, setTimedDurationChoice] = useState<number>(
    TIMED_SESSION_DURATIONS_MINUTES[1],
  );
  // The clock the timed-session countdown reads: now, in epoch
  // ms. It only ticks while a timed session runs (see the clock
  // effect), so the board does not re-render twice a second
  // the rest of the time.
  const [nowMs, setNowMs] = useState(() => Date.now());
  // The comment pin waiting for its text: the user clicked the
  // canvas with the Comment tool, and the composer in the panel
  // is open. The pin itself is local only until the comment is
  // added — nothing syncs until there is text to share.
  const [commentDraft, setCommentDraft] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  // The text typed into the comment composer so far.
  const [commentText, setCommentText] = useState("");
  // The comment thread this user clicked, pin or panel row.
  // It highlights both the pin and the row.
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  // The comments panel, right of the board: whether its thread
  // list is showing. Phones start collapsed, like the boards
  // sidebar — the open panel would take half a narrow screen.
  const [commentsOpen, setCommentsOpen] = useState(() => window.innerWidth >= 768);
  // The board's snapshots, newest first, from the server. Null
  // while they are still loading.
  const [snapshots, setSnapshots] = useState<BoardSnapshotMeta[] | null>(null);
  // The snapshots panel, beside the comments panel: whether its
  // list is showing. Phones start collapsed, for the same reason
  // as the comments panel.
  const [snapshotsOpen, setSnapshotsOpen] = useState(() => window.innerWidth >= 768);
  // Whether the who's-here list under the header is open, and
  // the wrapper it lives in, so a click outside it can close it.
  const [whosHereOpen, setWhosHereOpen] = useState(false);
  const whosHereRef = useRef<HTMLDivElement | null>(null);
  // The who's-here card itself, so it can pop in when opened.
  const whosHerePanelRef = useRef<HTMLDivElement | null>(null);
  // The two side panels, so each can slide in when opened.
  const commentsPanelRef = useRef<HTMLElement | null>(null);
  const snapshotsPanelRef = useRef<HTMLElement | null>(null);
  // The tool rail, so the newly active tool button can settle.
  const toolRailRef = useRef<HTMLElement | null>(null);

  // Chrome entrances: the who's-here card pops in from its
  // anchor, and each side panel slides in from the right edge
  // when it opens. The helpers skip everything under
  // prefers-reduced-motion.
  useEffect(() => {
    if (whosHereOpen && whosHerePanelRef.current) {
      popIn(whosHerePanelRef.current);
    }
  }, [whosHereOpen]);

  useEffect(() => {
    if (commentsOpen && commentsPanelRef.current) {
      slideInFromRight(commentsPanelRef.current);
    }
  }, [commentsOpen]);

  useEffect(() => {
    if (snapshotsOpen && snapshotsPanelRef.current) {
      slideInFromRight(snapshotsPanelRef.current);
    }
  }, [snapshotsOpen]);

  // Closes the who's-here list on Escape or a click outside it.
  // Only bound while the list is open, so the board's own
  // handlers are untouched the rest of the time.
  useEffect(() => {
    if (!whosHereOpen) return;
    function onPointerDown(event: PointerEvent): void {
      if (
        whosHereRef.current &&
        !whosHereRef.current.contains(event.target as Node)
      ) {
        setWhosHereOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setWhosHereOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [whosHereOpen]);
  // The name typed for the next snapshot. Empty means "use the
  // date and time" — the input shows that as its placeholder.
  const [snapshotName, setSnapshotName] = useState("");
  // Whether a snapshot save, restore, or delete is in flight.
  // The panel buttons disable while one runs, so a double click
  // cannot save the same snapshot twice.
  const [snapshotsBusy, setSnapshotsBusy] = useState(false);
  // The active tool. Select is the default; Escape returns here.
  const [tool, setTool] = useState<Tool>("select");

  // When the active tool changes, its rail button settles with
  // a tiny pop, so the eye lands on the new selection.
  useEffect(() => {
    const active = toolRailRef.current?.querySelector<HTMLElement>(
      "[data-tool-active]",
    );
    if (active) {
      settlePop(active);
    }
  }, [tool]);
  // Everyone else on the board, from Awareness. Our own presence
  // lives in localPresenceRef — the bar and cursors only show
  // other people.
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  // The note this user clicked. null means nothing selected.
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  // The shape this user clicked. A note, a shape, and a text box
  // are never selected at the same time — selecting one clears
  // the others.
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  // The text box this user clicked.
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  // The frame this user clicked.
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  // The connector this user clicked.
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);
  // The image this user clicked. Images are not published to
  // Awareness (like frames and connectors), so their selection
  // is local only — other users do not see it.
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  // The voice note this user clicked. Voice notes are not
  // published to Awareness either, so their selection is local
  // only too.
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  // The recording in progress, if any: where its pin sits on
  // the board. The pin is local until the recording stops — only
  // a finished clip is written to the shared document.
  const [recordingDraft, setRecordingDraft] = useState<{ x: number; y: number } | null>(null);
  // The seconds the current recording has run, for the pin's
  // timer. Reset when a recording starts or ends.
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  // The voice note playing right now, if any. Only one plays
  // at a time — starting another pauses this one.
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  // The first item of a connector being drawn: the user picked
  // this item with the Connector tool and is about to pick the
  // second one. Null when no connector is in progress.
  const [connectorPendingFromId, setConnectorPendingFromId] = useState<string | null>(null);
  // The frame title being typed right now, as a draft. The shared
  // title only changes on blur or Enter — typing straight into
  // the shared title would snap an emptied title back to "Frame"
  // on every keystroke.
  const [frameTitleDraft, setFrameTitleDraft] = useState<{ id: string; value: string } | null>(
    null,
  );
  // The color new notes get, and the color the picker shows as
  // active. Picking a color also recolors the selected note.
  const [pickedColor, setPickedColor] = useState<NoteColor>("yellow");
  // The font size new text boxes get. Picking a size also
  // resizes the text in the selected text box.
  const [pickedFontSize, setPickedFontSize] = useState<TextFontSize>("medium");
  // The text box to focus after it appears (a newly placed box
  // gets the keyboard right away, so the user can just type).
  const [focusTextId, setFocusTextId] = useState<string | null>(null);
  // Which text box the focus effect already focused. Remembering
  // it in a ref (instead of clearing focusTextId in the effect)
  // keeps later text edits from stealing focus back to the box.
  const focusedTextIdRef = useRef<string | null>(null);
  // The last import/export note for the user — an error when a
  // file could not be imported, a confirmation when one was.
  const [importMessage, setImportMessage] = useState<string | null>(null);
  // Whether the Share button is showing its "Copied" confirmation.
  const [shareCopied, setShareCopied] = useState(false);
  // Whether the template picker bar is showing under the header.
  const [templatesOpen, setTemplatesOpen] = useState(false);
  // Whether the keyboard-shortcuts panel is showing.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The connector label being typed, before it is committed on
  // blur — the same draft pattern as a frame title.
  const [connectorLabelDraft, setConnectorLabelDraft] = useState<{
    id: string;
    value: string;
  } | null>(null);
  // Whether the local UndoManager has anything to undo or redo.
  // Updated whenever the undo stack changes.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // The origin stamped on every local change. The UndoManager
  // only tracks this origin, so undo never reverts another
  // user's edits — their changes arrive with a different origin.
  const localOrigin = `local-user-${user.id}`;
  const docRef = useRef<Y.Doc | null>(null);
  const notesMapRef = useRef<Y.Map<NoteMap> | null>(null);
  const shapesMapRef = useRef<Y.Map<ShapeMap> | null>(null);
  const textsMapRef = useRef<Y.Map<TextMap> | null>(null);
  const imagesMapRef = useRef<Y.Map<ImageMap> | null>(null);
  const voiceNotesMapRef = useRef<Y.Map<VoiceMap> | null>(null);
  const framesMapRef = useRef<Y.Map<FrameMap> | null>(null);
  const connectorsMapRef = useRef<Y.Map<ConnectorMap> | null>(null);
  const commentsMapRef = useRef<Y.Map<CommentMap> | null>(null);
  const votesMapRef = useRef<Y.Map<VoteMap> | null>(null);
  const votingMapRef = useRef<VotingMap | null>(null);
  // The selected frame and connector, mirrored in refs so the
  // keyboard handler — bound once — can read them without going
  // stale. Frames and connectors are not published to Awareness
  // (presence only tracks notes, shapes, and text boxes), so the
  // presence ref cannot carry them.
  const selectedFrameRef = useRef<string | null>(null);
  const selectedConnectorRef = useRef<string | null>(null);
  // The selected image, mirrored in a ref for the same reason:
  // images are not published to Awareness either.
  const selectedImageRef = useRef<string | null>(null);
  // The selected voice note, mirrored in a ref for the same
  // reason: voice notes are not published to Awareness either.
  const selectedVoiceRef = useRef<string | null>(null);
  // The recorder for the recording in progress, if any. Held in
  // a ref so the stop and cancel buttons can reach it without
  // re-rendering the board every second.
  const voiceRecorderRef = useRef<VoiceRecorder | null>(null);
  // The audio element of each voice note, by note id — so
  // playing one note can pause the one already playing.
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());
  // The hidden file input for Import JSON — the header button
  // opens it, and the change handler reads the picked file.
  const importInputRef = useRef<HTMLInputElement | null>(null);
  // The hidden file input for adding an image — the tool-rail
  // Image button opens it, and the change handler reads the
  // picked file.
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  // The provider's Awareness instance (null only if the provider
  // was created with awareness disabled — we never do that).
  const awarenessRef = useRef<HocuspocusProvider["awareness"]>(null);
  // Our own presence: cursor position and selected notes,
  // shapes, and text boxes. Kept in a ref because it changes on
  // every mouse move and must not re-render the board each time.
  const localPresenceRef = useRef<PresenceUser>({
    id: user.id,
    name: user.name,
    color: user.color,
    cursor: null,
    selectedNoteIds: [],
    selectedShapeIds: [],
    selectedTextIds: [],
    presentingFrameId: null,
  });
  // When the last cursor position was sent, for the ~30/s throttle.
  const lastCursorSentRef = useRef(0);
  const boardRef = useRef<HTMLDivElement | null>(null);
  // The minimap box in the bottom-right corner, for reading its
  // position when a pointer lands on it.
  const minimapRef = useRef<HTMLDivElement | null>(null);
  // The minimap drag in progress, if any — a click pans once,
  // a drag pans continuously while the pointer moves.
  const minimapDragRef = useRef<{ pointerId: number } | null>(null);
  // The board's size on screen, for the minimap's viewport
  // rectangle. Kept in state (not read straight from the ref)
  // so the minimap re-renders when the window resizes.
  const [boardSize, setBoardSize] = useState({ w: 0, h: 0 });
  // Zoom and pan are per-user view state: local only, never synced
  // and never persisted — the other tab keeps its own view.
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3;
  const ZOOM_STEP = 1.25;
  // A frame's title sits this far inside its top-left corner —
  // the same 12px as --space-sm in tokens.css.
  const FRAME_TITLE_INSET = 12;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // Present mode: the index of the slide being shown, or null
  // when not presenting. The slides are the frames in
  // presentation order; the current frame id is broadcast
  // through Awareness so other viewers follow along.
  const [presentIndex, setPresentIndex] = useState<number | null>(null);
  const slides = useMemo(() => sortFramesForPresentation(frames), [frames]);
  // Auto-organize: the plan for the board right now — the
  // frames it would create and the notes it would move — or
  // null when no two free notes share a word. The button
  // disables then, so the user never opens a dialog that can
  // do nothing. The frames land below everything already on
  // the board, so the layout needs the whole content as boxes.
  const contentBoxes = useMemo<Box[]>(
    () => [
      ...notes,
      ...frames,
      ...shapes,
      ...texts,
      ...images,
      ...voiceNotes.map((voiceNote) => ({
        x: voiceNote.x,
        y: voiceNote.y,
        w: VOICE_NOTE_SIZE.w,
        h: VOICE_NOTE_SIZE.h,
      })),
    ],
    [notes, frames, shapes, texts, images, voiceNotes],
  );
  const organizePlan = useMemo(
    () => planAutoOrganize(notes, frames, contentBoxes),
    [notes, frames, contentBoxes],
  );
  // Mirrors of present state, so the once-bound keyboard handler
  // and the camera animation can read them without going stale.
  const presentIndexRef = useRef<number | null>(null);
  const slidesRef = useRef<Frame[]>([]);
  const boardSizeRef = useRef({ w: 0, h: 0 });
  const cameraRef = useRef<CameraView>({ zoom: 1, pan: { x: 0, y: 0 } });
  // The camera animation in flight, if any — a new move cancels
  // it, so the camera never chases two targets at once.
  const cameraAnimationRef = useRef<number | null>(null);
  // The frame this viewer is following, if any — set when a
  // presenter's slide moves our camera, so the same slide does
  // not re-animate on every presence refresh.
  const followedFrameRef = useRef<string | null>(null);
  useEffect(() => {
    presentIndexRef.current = presentIndex;
  }, [presentIndex]);
  useEffect(() => {
    slidesRef.current = slides;
  }, [slides]);
  useEffect(() => {
    boardSizeRef.current = boardSize;
  }, [boardSize]);
  useEffect(() => {
    cameraRef.current = { zoom, pan };
  }, [zoom, pan]);
  useEffect(() => {
    return () => {
      if (cameraAnimationRef.current !== null) {
        cancelAnimationFrame(cameraAnimationRef.current);
      }
    };
  }, []);
  // The transformed layer inside the board — the notes live in it.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  // The pan in progress, if any — same shape as a note drag.
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  // Tracks the board's size for the minimap. The observer fires
  // on resize and once at the start, so the viewport rectangle
  // is right from the first render.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const updateSize = (): void => {
      const rect = board.getBoundingClientRect();
      setBoardSize({ w: rect.width, h: rect.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(board);
    return () => observer.disconnect();
  }, []);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    noteX: number;
    noteY: number;
  } | null>(null);
  // The resize in progress, if any — same shape as the drag.
  const resizeRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    noteW: number;
    noteH: number;
  } | null>(null);
  // The shape drag in progress, if any — same shape as a note drag.
  const shapeDragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    shapeX: number;
    shapeY: number;
  } | null>(null);
  // The shape resize in progress, if any — same shape as the drag.
  const shapeResizeRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    shapeW: number;
    shapeH: number;
  } | null>(null);
  // The text-box drag in progress, if any — same shape as a
  // note drag.
  const textDragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    textX: number;
    textY: number;
  } | null>(null);
  // The text-box resize in progress, if any — same shape as the
  // drag.
  const textResizeRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    textW: number;
    textH: number;
  } | null>(null);
  // The image drag in progress, if any — same shape as a note
  // drag.
  const imageDragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    imageX: number;
    imageY: number;
  } | null>(null);
  // The voice-note drag in progress, if any — same shape as an
  // image drag. A voice note is a fixed-size pin, so there is
  // no resize to track.
  const voiceDragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    voiceX: number;
    voiceY: number;
  } | null>(null);
  // The image resize in progress, if any. The aspect is the
  // image's width over height at the start, so the resize keeps
  // the picture's shape instead of stretching it.
  const imageResizeRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    imageW: number;
    aspect: number;
  } | null>(null);
  // The shape being drawn on empty canvas, if any. For a pen
  // stroke, points holds every point so far, so the bounding box
  // can be recomputed as the stroke grows.
  const drawRef = useRef<{
    kind: ShapeKind;
    pointerId: number;
    startX: number;
    startY: number;
    shapeId: string;
    points: ShapePoint[];
  } | null>(null);
  // The frame being drawn on empty canvas, if any — same shape
  // as a shape draw, but the box becomes a frame.
  const frameDrawRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    frameId: string;
  } | null>(null);
  // The frame drag in progress, if any. contents holds every item
  // whose centre was inside the frame when the drag started —
  // each with the position it started at — so the whole group
  // moves by the same amount.
  const frameDragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    frameX: number;
    frameY: number;
    contents: FrameDragContent[];
  } | null>(null);
  // The frame resize in progress, if any — same shape as the drag.
  const frameResizeRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    frameW: number;
    frameH: number;
  } | null>(null);
  // The fingers currently on the board, by pointer id — tracked
  // for pinch-to-zoom. Pointer events bubble to the board from
  // notes and shapes too, so a second finger anywhere on the
  // board is seen here.
  const boardPointersRef = useRef(new Map<number, ShapePoint>());
  // The pinch in progress, if any: the view and finger positions
  // from the moment the second finger landed.
  const pinchRef = useRef<PinchStart | null>(null);
  // The per-user UndoManager: it tracks only changes stamped
  // with localOrigin, on the shared notes and shapes maps and
  // their children (nested note maps and their Y.Text, shape maps
  // and their pen-point arrays).
  const undoManagerRef = useRef<Y.UndoManager | null>(null);

  // Loads this board's snapshots when the board opens. The
  // Board remounts on a board switch (keyed by boardId), so
  // this runs once per board. A failed load leaves an empty
  // list and a note — the board itself still works.
  useEffect(() => {
    let stopped = false;
    void fetchSnapshots(httpSyncUrl(), boardId)
      .then((next) => {
        if (!stopped) setSnapshots(next);
      })
      .catch((error: unknown) => {
        if (!stopped) {
          setSnapshots([]);
          setImportMessage(
            error instanceof Error ? error.message : "Could not load snapshots.",
          );
        }
      });
    return () => {
      stopped = true;
    };
  }, [boardId]);

  useEffect(() => {
    const doc = new Y.Doc();
    // HocuspocusProvider, not plain y-websocket: the Hocuspocus
    // server prefixes every message with the document name, so a
    // plain y-websocket client is misread (its first message bytes
    // become a garbage document name). The provider also sends the
    // token in an Auth message, which the server verifies in
    // onAuthenticate.
    const provider = new HocuspocusProvider({
      url: SYNC_URL,
      name: boardId,
      document: doc,
      token,
      // BroadcastChannel would sync tabs directly, bypassing the
      // server — disabled so the two-tab test proves server sync.
      broadcast: false,
      onStatus: ({ status: next }) => setStatus(toConnectionStatus(next)),
      // The server rejected the token — it expired, or the
      // database was reset. Drop the session and show the auth
      // screen, instead of sitting on a board that can never
      // connect.
      onAuthenticationFailed: ({ reason }) => {
        setAuthError(reason);
        onAuthFailed();
      },
    });
    const notesMap = doc.getMap<NoteMap>("notes");
    docRef.current = doc;
    notesMapRef.current = notesMap;
    const shapesMap = doc.getMap<ShapeMap>("shapes");
    shapesMapRef.current = shapesMap;
    const textsMap = doc.getMap<TextMap>("texts");
    textsMapRef.current = textsMap;
    const imagesMap = doc.getMap<ImageMap>("images");
    imagesMapRef.current = imagesMap;
    const voiceNotesMap = doc.getMap<VoiceMap>("voiceNotes");
    voiceNotesMapRef.current = voiceNotesMap;
    const framesMap = doc.getMap<FrameMap>("frames");
    framesMapRef.current = framesMap;
    const connectorsMap = doc.getMap<ConnectorMap>("connectors");
    connectorsMapRef.current = connectorsMap;
    const commentsMap = doc.getMap<CommentMap>("comments");
    commentsMapRef.current = commentsMap;
    const votesMap = doc.getMap<VoteMap>("votes");
    votesMapRef.current = votesMap;
    // The session map itself holds the session fields, so it
    // is read as a plain map of values — not a map of maps.
    const votingMap = doc.getMap<unknown>("voting");
    votingMapRef.current = votingMap;

    // Per-user undo: the manager only tracks transactions stamped
    // with our own origin, so another user's edits never land on
    // our undo stack. It watches all nine shared roots — notes,
    // shapes, text boxes, images, voice notes, frames,
    // connectors, comments, and votes — so one undo stack covers
    // all of them. The "voting" map is not watched: starting or
    // ending a session is never an undo step, while placing a dot
    // and clearing votes are. Drags and typing batch into one step
    // while they keep coming within the capture timeout (500 ms).
    const undoManager = new Y.UndoManager(
      [notesMap, shapesMap, textsMap, imagesMap, voiceNotesMap, framesMap, connectorsMap, commentsMap, votesMap],
      {
        trackedOrigins: new Set([localOrigin]),
      },
    );
    undoManagerRef.current = undoManager;
    function refreshUndoState(): void {
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    }
    undoManager.on("stack-item-added", refreshUndoState);
    undoManager.on("stack-item-popped", refreshUndoState);
    undoManager.on("stack-cleared", refreshUndoState);
    refreshUndoState();

    // Re-reads every note from the shared document into React
    // state. observeDeep fires for note moves, resizes, color
    // changes, and text edits alike.
    function snapshot(): void {
      const next: Note[] = [];
      notesMap.forEach((noteMap, id) => next.push(readNote(id, noteMap)));
      setNotes(next);
    }

    notesMap.observeDeep(snapshot);
    snapshot();

    // Re-reads every shape from the shared document into React
    // state. observeDeep fires for shape moves, resizes, color
    // changes, and pen points alike.
    function snapshotShapes(): void {
      const next: Shape[] = [];
      shapesMap.forEach((shapeMap, id) => next.push(readShape(id, shapeMap)));
      setShapes(next);
    }

    shapesMap.observeDeep(snapshotShapes);
    snapshotShapes();

    // Re-reads every text box from the shared document into React
    // state. observeDeep fires for text-box moves, resizes, color
    // and size changes, and text edits alike.
    function snapshotTexts(): void {
      const next: TextBox[] = [];
      textsMap.forEach((textMap, id) => next.push(readTextBox(id, textMap)));
      setTexts(next);
    }

    textsMap.observeDeep(snapshotTexts);
    snapshotTexts();

    // Re-reads every image from the shared document into React
    // state. observeDeep fires for image moves, resizes, and
    // deletions alike.
    function snapshotImages(): void {
      const next: ImageItem[] = [];
      imagesMap.forEach((imageMap, id) => {
        const image = readImage(id, imageMap);
        // An image with no picture is not an image.
        if (image.dataUrl) next.push(image);
      });
      setImages(next);
    }

    imagesMap.observeDeep(snapshotImages);
    snapshotImages();

    // Re-reads every voice note from the shared document into
    // React state. observeDeep fires for voice-note moves and
    // deletions alike.
    function snapshotVoiceNotes(): void {
      const next: VoiceNote[] = [];
      voiceNotesMap.forEach((voiceMap, id) => {
        const voiceNote = readVoiceNote(id, voiceMap);
        // A note with no audio is not a voice note.
        if (voiceNote.dataUrl) next.push(voiceNote);
      });
      setVoiceNotes(next);
    }

    voiceNotesMap.observeDeep(snapshotVoiceNotes);
    snapshotVoiceNotes();

    // Re-reads every frame from the shared document into React
    // state. observeDeep fires for frame moves, resizes, color
    // changes, and title edits alike.
    function snapshotFrames(): void {
      const next: Frame[] = [];
      framesMap.forEach((frameMap, id) => next.push(readFrame(id, frameMap)));
      setFrames(next);
    }

    framesMap.observeDeep(snapshotFrames);
    snapshotFrames();

    // Re-reads every connector from the shared document into
    // React state. observeDeep fires for new connectors and for
    // deletions when an endpoint goes away.
    function snapshotConnectors(): void {
      const next: Connector[] = [];
      connectorsMap.forEach((connectorMap, id) => next.push(readConnector(id, connectorMap)));
      setConnectors(next);
    }

    connectorsMap.observeDeep(snapshotConnectors);
    snapshotConnectors();

    // Re-reads every comment thread from the shared document
    // into React state. observeDeep fires for new threads and
    // for resolve and delete changes alike.
    function snapshotComments(): void {
      const next: Comment[] = [];
      commentsMap.forEach((commentMap, id) => next.push(readComment(id, commentMap)));
      setComments(next);
    }

    commentsMap.observeDeep(snapshotComments);
    snapshotComments();

    // Re-reads every dot vote from the shared document into
    // React state. observeDeep fires for new votes and for
    // deletions when votes are cleared alike.
    function snapshotVotes(): void {
      const next: Vote[] = [];
      votesMap.forEach((voteMap, id) => next.push(readVote(id, voteMap)));
      setVotes(next);
    }

    votesMap.observeDeep(snapshotVotes);
    snapshotVotes();

    // Re-reads the voting session from the shared document
    // into React state. observe fires when a session starts,
    // ends, or changes its dots per person. When a timed
    // session arrives or changes, the clock refreshes at once —
    // so the countdown never shows a stale time while waiting
    // for the next tick, including for a late joiner.
    function snapshotVoting(): void {
      const next = readVotingSession(votingMap);
      setVotingSession(next);
      if (next?.timed && next.active) setNowMs(Date.now());
    }

    votingMap.observe(snapshotVoting);
    snapshotVoting();

    // Presence: this client publishes its own cursor and selection
    // through Awareness, and reads everyone else's from the same
    // Awareness instance. Awareness is ephemeral — the server
    // stores nothing, and a disconnected client's state disappears
    // on its own.
    const awareness = provider.awareness;
    awarenessRef.current = awareness;
    awareness?.setLocalState({ ...localPresenceRef.current });

    // Re-reads every other user's presence into React state.
    // Our own state is skipped — it already lives in
    // localPresenceRef, and the bar/cursors only show other people.
    function refreshPresence(): void {
      if (!awareness) return;
      const others: PresenceUser[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const person = asPresenceUser(state);
        if (person) others.push(person);
      });
      // Stable order so the presence bar doesn't jump around as
      // states update.
      others.sort((a, b) => a.name.localeCompare(b.name));
      setPresence(others);
    }

    awareness?.on("change", refreshPresence);
    refreshPresence();

    return () => {
      undoManager.off("stack-item-added", refreshUndoState);
      undoManager.off("stack-item-popped", refreshUndoState);
      undoManager.off("stack-cleared", refreshUndoState);
      undoManager.destroy();
      undoManagerRef.current = null;
      awareness?.off("change", refreshPresence);
      awarenessRef.current = null;
      notesMap.unobserveDeep(snapshot);
      shapesMap.unobserveDeep(snapshotShapes);
      textsMap.unobserveDeep(snapshotTexts);
      imagesMap.unobserveDeep(snapshotImages);
      voiceNotesMap.unobserveDeep(snapshotVoiceNotes);
      framesMap.unobserveDeep(snapshotFrames);
      connectorsMap.unobserveDeep(snapshotConnectors);
      commentsMap.unobserveDeep(snapshotComments);
      votesMap.unobserveDeep(snapshotVotes);
      votingMap.unobserve(snapshotVoting);
      provider.destroy();
      doc.destroy();
      docRef.current = null;
      notesMapRef.current = null;
      shapesMapRef.current = null;
      textsMapRef.current = null;
      imagesMapRef.current = null;
      voiceNotesMapRef.current = null;
      framesMapRef.current = null;
      connectorsMapRef.current = null;
      commentsMapRef.current = null;
      votesMapRef.current = null;
      votingMapRef.current = null;
    };
  }, [token, boardId, localOrigin, onAuthFailed]);

  // Focuses a newly placed text box once it has rendered, so
  // the user can type straight away without clicking it first.
  // If the box has not rendered yet, the id stays pending and
  // the effect retries when the text boxes update — clearing it
  // early would lose the focus entirely. The focused id is
  // remembered in a ref, not cleared with setState, because
  // calling setState inside an effect causes a cascading render.
  useEffect(() => {
    if (!focusTextId || focusedTextIdRef.current === focusTextId) return;
    const box = document.querySelector(
      `[data-text-id="${focusTextId}"] textarea`,
    ) as HTMLTextAreaElement | null;
    if (!box) return;
    box.focus();
    focusedTextIdRef.current = focusTextId;
  }, [focusTextId, texts]);

  // Starts a drag from a note's handle. The textarea underneath
  // stays free for text editing — only the handle drags. With
  // the Connector tool, a press picks an endpoint instead, so
  // the handle does not drag.
  function startDrag(event: React.PointerEvent<HTMLDivElement>, note: Note): void {
    if (event.button !== 0 || tool === "connector" || pinchRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: note.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      noteX: note.x,
      noteY: note.y,
    };
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    if (!drag || !doc || !notesMap || event.pointerId !== drag.pointerId) return;
    const noteMap = notesMap.get(drag.id);
    if (!noteMap) return;
    // Screen pixels become board pixels by dividing by the zoom —
    // at 200% a 20px mouse move is only 10 board pixels.
    const nextX = Math.max(0, drag.noteX + (event.clientX - drag.startX) / zoom);
    const nextY = Math.max(0, drag.noteY + (event.clientY - drag.startY) / zoom);
    // Stamped with our origin so undo can revert this move — and
    // only this user's moves. Pointermove fires faster than the
    // capture timeout, so the whole drag lands on one undo step.
    doc.transact(() => {
      noteMap.set("x", Math.round(nextX));
      noteMap.set("y", Math.round(nextY));
    }, localOrigin);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      // The next change starts a fresh undo step instead of
      // joining the drag we just finished.
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Converts a screen (client) point to board coordinates, undoing
  // the current pan and zoom. Every pointer handler that places or
  // moves something on the board goes through here, so a click,
  // a drag, and a cursor all agree on where things are.
  function toBoardCoords(clientX: number, clientY: number): { x: number; y: number } {
    const board = boardRef.current;
    if (!board) return { x: 0, y: 0 };
    const rect = board.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  }

  // Drops an image file onto the board: the image lands at the
  // drop point. Only the first image file is taken; anything else
  // is ignored with a message. The dragover below must prevent
  // its default, or the drop never fires — and the drop must
  // prevent its default too, or the browser navigates to the
  // dropped file instead.
  function handleBoardDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files ?? []);
    const file = files.find((item) => item.type.startsWith("image/"));
    if (!file) {
      if (files.length > 0) {
        setImportMessage("Only image files can be dropped on the board.");
      }
      return;
    }
    const point = toBoardCoords(event.clientX, event.clientY);
    void addImageFile(file, point.x, point.y);
  }

  // A press on empty board — the board or canvas itself, or a
  // frame's background. A frame is a container, not a wall: the
  // creation tools work inside it exactly as they do on open
  // canvas, so notes, text, shapes, and nested frames can be
  // dropped where they belong. The canvas calls this when the
  // press lands on empty board; a frame calls it when the press
  // lands on the frame itself (its title, delete, and resize
  // controls stop the press before it gets here).
  function handleEmptyCanvasPress(event: React.PointerEvent<HTMLDivElement>): void {
    // A pinch is in progress: no creation tool starts from a press.
    if (pinchRef.current) return;
    if (
      tool === "rect" ||
      tool === "ellipse" ||
      tool === "diamond" ||
      tool === "triangle" ||
      tool === "star" ||
      tool === "line" ||
      tool === "pen"
    ) {
      startDraw(event);
    } else if (tool === "frame") {
      // Dragging empty canvas with the Frame tool draws
      // a named section.
      startFrameDraw(event);
    } else if (tool === "connector") {
      // Clicking empty canvas cancels a connector in
      // progress — there is nothing here to connect to.
      setConnectorPendingFromId(null);
    } else if (tool === "comment") {
      // Clicking empty canvas with the Comment tool drops a
      // pin and opens the composer in the comments panel.
      // Clicking again while a draft is open moves the pin
      // instead of starting a second one — the typed text
      // stays put.
      const point = toBoardCoords(event.clientX, event.clientY);
      setCommentDraft((draft) => ({
        id: draft?.id ?? crypto.randomUUID(),
        x: Math.max(0, Math.round(point.x)),
        y: Math.max(0, Math.round(point.y)),
      }));
      setCommentsOpen(true);
    } else if (tool === "vote") {
      // Clicking empty canvas with the Vote tool does nothing:
      // a dot needs an item to sit on.
    } else if (tool === "voice") {
      // Clicking empty canvas with the Voice tool drops a pin
      // and starts recording right away.
      const point = toBoardCoords(event.clientX, event.clientY);
      void startVoiceRecording(
        Math.max(0, Math.round(point.x)),
        Math.max(0, Math.round(point.y)),
      );
    } else if (tool === "note") {
      // Clicking empty canvas with the Note tool drops a
      // note centered on the click.
      const point = toBoardCoords(event.clientX, event.clientY);
      createNote(
        Math.max(0, point.x - DEFAULT_NOTE_SIZE.w / 2),
        Math.max(0, point.y - DEFAULT_NOTE_SIZE.h / 2),
      );
    } else if (tool === "text") {
      // Clicking empty canvas with the Text tool drops a
      // text box centered on the click and focuses it.
      // Canceling the press keeps its default focus change
      // from blurring that textarea: the press lands on
      // empty canvas, so the browser would otherwise move
      // focus back to the board right after the box appears.
      event.preventDefault();
      const point = toBoardCoords(event.clientX, event.clientY);
      createTextBoxAtPoint(point.x, point.y);
    } else {
      // Select mode: the press clears the selection and
      // starts a pan.
      clearSelection();
      startPan(event);
    }
  }

  // Zooms by a factor around the center of the visible board, so
  // the middle of the view stays put. Zoom is clamped to 25–300%.
  function zoomBy(factor: number): void {
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    if (nextZoom === zoom) return;
    const scale = nextZoom / zoom;
    setZoom(nextZoom);
    // Keep the screen point under the board center fixed:
    // pan' = center - scale * (center - pan).
    setPan({
      x: centerX - scale * (centerX - pan.x),
      y: centerY - scale * (centerY - pan.y),
    });
  }

  // Back to 100% with no pan — the default view.
  function resetView(): void {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  // Moves the camera to fit a frame in view. The move is
  // animated over about a third of a second — except with
  // reduced motion on, where the camera jumps at once. A new
  // move cancels the one in flight, so the camera never chases
  // two targets. Reads the current view and board size from
  // refs, so the once-bound keyboard handler can call it too.
  function moveCameraToFrame(frame: Frame): void {
    const size = boardSizeRef.current;
    const target = fitFrameView(frame, size.w, size.h, MIN_ZOOM, MAX_ZOOM);
    if (!target) return;
    if (cameraAnimationRef.current !== null) {
      cancelAnimationFrame(cameraAnimationRef.current);
      cameraAnimationRef.current = null;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      cameraRef.current = target;
      setZoom(target.zoom);
      setPan(target.pan);
      return;
    }
    const start = cameraRef.current;
    // Reading the clock here starts the animation, and this is
    // an event/effect handler, not render — it only runs when a
    // slide change asks the camera to move.
    // eslint-disable-next-line react-hooks/purity
    const startedAt = performance.now();
    const durationMs = 350;
    // The end view comes in as a parameter, so the type stays
    // narrowed inside this closure.
    function tick(now: number, end: CameraView): void {
      const view = interpolateView(start, end, (now - startedAt) / durationMs);
      cameraRef.current = view;
      setZoom(view.zoom);
      setPan(view.pan);
      if (now - startedAt < durationMs) {
        cameraAnimationRef.current = requestAnimationFrame((next) => tick(next, end));
      } else {
        cameraAnimationRef.current = null;
      }
    }
    cameraAnimationRef.current = requestAnimationFrame((now) => tick(now, target));
  }

  // Shows a slide: updates the present state, broadcasts the
  // frame id through Awareness so other viewers follow, and
  // moves the presenter's camera to the frame. The index is
  // clamped, so a stale index after a frame is deleted still
  // lands on a real slide.
  function goToSlide(index: number): void {
    const slides = slidesRef.current;
    if (slides.length === 0) return;
    const clamped = Math.min(Math.max(index, 0), slides.length - 1);
    const frame = slides[clamped];
    presentIndexRef.current = clamped;
    setPresentIndex(clamped);
    localPresenceRef.current.presentingFrameId = frame.id;
    publishPresence();
    moveCameraToFrame(frame);
  }

  // Starts presenting at the first slide. Nothing happens with
  // no frames — the header button is disabled then too.
  function startPresent(): void {
    if (slidesRef.current.length === 0) return;
    goToSlide(0);
  }

  // Leaves present mode and stops broadcasting, so viewers stop
  // following. Their cameras stay where they are.
  function exitPresent(): void {
    if (presentIndexRef.current === null) return;
    presentIndexRef.current = null;
    setPresentIndex(null);
    localPresenceRef.current.presentingFrameId = null;
    publishPresence();
  }

  // Runs auto-organize: one confirm step first, since it moves
  // many notes at once — then one transaction creates the
  // frames and moves the notes, so a single Ctrl+Z undoes the
  // whole organize. Notes with no shared word, and notes
  // already in a frame, stay exactly where they are.
  function autoOrganize(): void {
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    const framesMap = framesMapRef.current;
    const plan = organizePlan;
    if (!doc || !notesMap || !framesMap || !plan) return;
    if (
      !window.confirm(
        `Group ${plan.noteCount} notes into ${plan.frameCount} frames? Notes with no shared word stay where they are.`,
      )
    ) {
      return;
    }
    doc.transact(() => {
      for (const group of plan.groups) {
        const frame = createFrame(
          crypto.randomUUID(),
          group.frame.x,
          group.frame.y,
          group.frame.w,
          group.frame.h,
          group.color,
          group.title,
        );
        framesMap.set(frame.id, buildFrameMap(frame));
        for (const placement of group.placements) {
          const noteMap = notesMap.get(placement.noteId);
          if (!noteMap) continue;
          noteMap.set("x", placement.x);
          noteMap.set("y", placement.y);
        }
      }
    }, localOrigin);
    // The organize is its own undo step: the next change starts
    // a fresh one instead of joining it.
    undoManagerRef.current?.stopCapturing();
  }

  // The minimap's geometry from the current board state: the
  // box it shows, the scale it draws at, and the visible area
  // in board coordinates. Both the minimap handlers and the
  // render below go through here, so a click on the minimap
  // and the picture it shows always agree.
  function minimapGeometry(): { bounds: Box; scale: number; viewport: Box } {
    const viewport: Box = {
      x: -pan.x / zoom,
      y: -pan.y / zoom,
      w: boardSize.w / zoom,
      h: boardSize.h / zoom,
    };
    const bounds = minimapBounds([...frames, ...notes, ...shapes, ...images], viewport);
    return { bounds, scale: minimapScale(bounds, MINIMAP_WIDTH, MINIMAP_HEIGHT), viewport };
  }

  // Pans the canvas so the board point under a minimap pointer
  // lands at the centre of the view — the standard minimap
  // behaviour: click a spot, and that spot comes to the middle.
  // Local view state only; the document is never touched.
  function panMinimapTo(clientX: number, clientY: number): void {
    const minimap = minimapRef.current;
    if (!minimap) return;
    const rect = minimap.getBoundingClientRect();
    const { bounds, scale } = minimapGeometry();
    const point = minimapToBoard(
      { x: clientX - rect.left, y: clientY - rect.top },
      bounds,
      scale,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
    );
    setPan(panToCentreBoardPoint(point, zoom, boardSize.w, boardSize.h));
  }

  // A press on the minimap pans to that spot at once, and a
  // drag keeps panning while the pointer moves. The pointer is
  // captured on the minimap, so the drag keeps going even if
  // it slides off the minimap's edge.
  function startMinimapDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || pinchRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    minimapDragRef.current = { pointerId: event.pointerId };
    panMinimapTo(event.clientX, event.clientY);
  }

  function moveMinimapDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = minimapDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    panMinimapTo(event.clientX, event.clientY);
  }

  function endMinimapDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (minimapDragRef.current?.pointerId === event.pointerId) {
      minimapDragRef.current = null;
    }
  }

  // Dragging empty canvas pans the view (per user — never synced).
  // The pointer is captured on the board, so the pan keeps going
  // even if it slides off the edge.
  function startPan(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setPanning(true);
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>): void {
    const panDrag = panRef.current;
    if (!panDrag || event.pointerId !== panDrag.pointerId) return;
    setPan({
      x: panDrag.panX + event.clientX - panDrag.startX,
      y: panDrag.panY + event.clientY - panDrag.startY,
    });
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>): void {
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null;
      setPanning(false);
    }
  }

  // Cancels whatever single-pointer gesture is in progress, so a
  // pinch can take over cleanly. A draw is removed entirely — the
  // shape or frame was only just created, so leaving it would
  // drop a dot on the board. A drag or a pan only clears its
  // ref: a partial move the user already made stays, because
  // it is real work.
  function cancelBoardGesture(): void {
    const draw = drawRef.current;
    if (draw) {
      drawRef.current = null;
      deleteShape(draw.shapeId);
    }
    const frameDraw = frameDrawRef.current;
    if (frameDraw) {
      frameDrawRef.current = null;
      deleteFrame(frameDraw.frameId);
    }
    dragRef.current = null;
    resizeRef.current = null;
    shapeDragRef.current = null;
    shapeResizeRef.current = null;
    textDragRef.current = null;
    textResizeRef.current = null;
    imageDragRef.current = null;
    imageResizeRef.current = null;
    frameDragRef.current = null;
    frameResizeRef.current = null;
    minimapDragRef.current = null;
    if (panRef.current) {
      panRef.current = null;
      setPanning(false);
    }
    undoManagerRef.current?.stopCapturing();
  }

  // Records a finger on the board. When a second finger lands,
  // a pinch starts and takes over from any gesture in progress —
  // the second finger means zoom, not a second drag.
  function trackBoardPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    boardPointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (boardPointersRef.current.size === 2 && !pinchRef.current) {
      startPinch();
    }
  }

  // Starts a pinch from the two fingers on the board, cancelling
  // whatever gesture the first finger was doing.
  function startPinch(): void {
    const pointers = [...boardPointersRef.current.values()];
    if (pointers.length < 2) return;
    const mid = midpointOf(pointers[0], pointers[1]);
    pinchRef.current = {
      zoom,
      panX: pan.x,
      panY: pan.y,
      midX: mid.x,
      midY: mid.y,
      distance: distanceBetween(pointers[0], pointers[1]),
    };
    cancelBoardGesture();
  }

  // Moves an active pinch: the zoom follows the change in finger
  // distance, and the board follows the fingers' midpoint.
  function movePinch(event: React.PointerEvent<HTMLDivElement>): void {
    const pinch = pinchRef.current;
    if (!pinch) return;
    if (!boardPointersRef.current.has(event.pointerId)) return;
    boardPointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const pointers = [...boardPointersRef.current.values()];
    if (pointers.length < 2) return;
    const view = pinchView(
      pinch,
      midpointOf(pointers[0], pointers[1]),
      distanceBetween(pointers[0], pointers[1]),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    setZoom(view.zoom);
    setPan({ x: view.panX, y: view.panY });
  }

  // A finger lifted: forget it, and end the pinch once fewer
  // than two fingers are left. The remaining finger does not
  // resume the gesture the pinch cancelled.
  function endPinch(event: React.PointerEvent<HTMLDivElement>): void {
    boardPointersRef.current.delete(event.pointerId);
    if (boardPointersRef.current.size < 2) {
      pinchRef.current = null;
    }
  }

  // Publishes the local user's current presence (cursor +
  // selection) to everyone else. Called after any local change.
  function publishPresence(): void {
    awarenessRef.current?.setLocalState({ ...localPresenceRef.current });
  }

  // Sends the pointer position (in board pixels) to everyone
  // else, at most once per throttle window.
  function trackCursor(event: React.PointerEvent<HTMLDivElement>): void {
    if (!awarenessRef.current) return;
    // Reading the clock here is the cursor throttle, and this is
    // a pointer-event handler, not render — it only runs when the
    // pointer actually moves.
    // eslint-disable-next-line react-hooks/purity
    const now = performance.now();
    if (now - lastCursorSentRef.current < CURSOR_THROTTLE_MS) return;
    lastCursorSentRef.current = now;
    // Board pixels, not screen pixels: the cursor is published in
    // board coordinates so it lands on the same note in another
    // tab no matter what zoom or pan that tab is using.
    const point = toBoardCoords(event.clientX, event.clientY);
    localPresenceRef.current.cursor = {
      x: Math.round(point.x),
      y: Math.round(point.y),
    };
    publishPresence();
  }

  // The pointer left the board, so other users should stop
  // seeing a cursor from us.
  function clearCursor(): void {
    if (localPresenceRef.current.cursor === null) return;
    localPresenceRef.current.cursor = null;
    publishPresence();
  }

  // Sets the selection in state and in Awareness at once, so
  // the outline, the presence bar, and other users stay in sync.
  // Only one thing is selected at a time — a note, a shape, a
  // text box, a frame, a connector, or an image. Frames,
  // connectors, and images are local only: presence tracks notes,
  // shapes, and text boxes, so their selection lives in state
  // and in the refs the keyboard handler reads, not in Awareness.
  function setSelection(
    noteId: string | null,
    shapeId: string | null,
    textId: string | null = null,
    frameId: string | null = null,
    connectorId: string | null = null,
    imageId: string | null = null,
    voiceId: string | null = null,
  ): void {
    setSelectedNoteId(noteId);
    setSelectedShapeId(shapeId);
    setSelectedTextId(textId);
    setSelectedFrameId(frameId);
    setSelectedConnectorId(connectorId);
    setSelectedImageId(imageId);
    setSelectedVoiceId(voiceId);
    selectedFrameRef.current = frameId;
    selectedConnectorRef.current = connectorId;
    selectedImageRef.current = imageId;
    selectedVoiceRef.current = voiceId;
    localPresenceRef.current.selectedNoteIds = noteId ? [noteId] : [];
    localPresenceRef.current.selectedShapeIds = shapeId ? [shapeId] : [];
    localPresenceRef.current.selectedTextIds = textId ? [textId] : [];
    publishPresence();
  }

  // Clicking a note selects it, and tells everyone else.
  function selectNote(noteId: string): void {
    if (selectedNoteId === noteId) return;
    setSelection(noteId, null);
  }

  // Clicking a shape selects it, and tells everyone else.
  function selectShape(shapeId: string): void {
    if (selectedShapeId === shapeId) return;
    setSelection(null, shapeId);
  }

  // Clicking a text box selects it, and tells everyone else.
  function selectTextBox(textId: string): void {
    if (selectedTextId === textId) return;
    setSelection(null, null, textId);
  }

  // Clicking a frame selects it. Frames are local-only selection,
  // so this does not publish to presence.
  function selectFrame(frameId: string): void {
    if (selectedFrameId === frameId) return;
    setSelection(null, null, null, frameId);
  }

  // Clicking a connector selects it, so it can be deleted. Like
  // frames, this is local-only selection.
  function selectConnector(connectorId: string): void {
    if (selectedConnectorId === connectorId) return;
    setSelection(null, null, null, null, connectorId);
  }

  // Clicking empty board clears the selection.
  function clearSelection(): void {
    if (
      localPresenceRef.current.selectedNoteIds.length === 0 &&
      localPresenceRef.current.selectedShapeIds.length === 0 &&
      localPresenceRef.current.selectedTextIds.length === 0 &&
      selectedFrameRef.current === null &&
      selectedConnectorRef.current === null
    ) {
      return;
    }
    setSelection(null, null);
  }

  function changeNoteText(noteId: string, next: string): void {
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    if (!doc || !notesMap) return;
    const noteMap = notesMap.get(noteId);
    const text = noteMap?.get("text");
    if (!noteMap || !(text instanceof Y.Text)) return;
    updateNoteText(doc, text, next, localOrigin);
  }

  // Creates a note at the given board position, in the picked
  // color, and selects it so the user can type or recolor it
  // right away. The new note is empty — the user types into it.
  function createNote(x: number, y: number): void {
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    if (!doc || !notesMap) return;
    const id = crypto.randomUUID();
    doc.transact(() => {
      const note = new Y.Map<unknown>();
      note.set("x", Math.round(x));
      note.set("y", Math.round(y));
      note.set("w", DEFAULT_NOTE_SIZE.w);
      note.set("h", DEFAULT_NOTE_SIZE.h);
      note.set("color", pickedColor);
      note.set("text", new Y.Text(""));
      notesMap.set(id, note);
    }, localOrigin);
    selectNote(id);
  }

  // Creates a note in the middle of the visible board.
  function createNoteAtCenter(): void {
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const center = toBoardCoords(rect.left + rect.width / 2, rect.top + rect.height / 2);
    createNote(
      Math.max(0, center.x - DEFAULT_NOTE_SIZE.w / 2),
      Math.max(0, center.y - DEFAULT_NOTE_SIZE.h / 2),
    );
  }

  // Inserts a template's frames and notes near the centre of
  // the visible board, in one transaction — so one undo removes
  // the whole template. The template is centred on what the
  // user can see right now, not dropped at the board origin,
  // where it might sit off-screen; if that spot is already
  // taken, the template drops below the content in the way
  // instead of landing on top of it. The picker closes once
  // the template is in.
  function insertTemplate(template: BoardTemplate): void {
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    const framesMap = framesMapRef.current;
    const board = boardRef.current;
    if (!doc || !notesMap || !framesMap || !board) return;
    const rect = board.getBoundingClientRect();
    const centre = toBoardCoords(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const bounds = templateBounds(template);
    const preferredX = Math.max(0, Math.round(centre.x - bounds.w / 2));
    const preferredY = Math.max(0, Math.round(centre.y - bounds.h / 2));
    const origin = findTemplateOrigin(template, preferredX, preferredY, contentBoxes);
    const placed = placeTemplate(template, origin.x, origin.y);
    doc.transact(() => {
      for (const spec of placed.frames) {
        const frame = createFrame(
          crypto.randomUUID(),
          spec.x,
          spec.y,
          spec.w,
          spec.h,
          spec.color,
          spec.title,
        );
        framesMap.set(frame.id, buildFrameMap(frame));
      }
      for (const spec of placed.notes) {
        const id = crypto.randomUUID();
        notesMap.set(
          id,
          buildNoteMap({
            id,
            x: spec.x,
            y: spec.y,
            w: spec.w,
            h: spec.h,
            color: spec.color,
            text: spec.text,
          }),
        );
      }
    }, localOrigin);
    // The insert is its own undo step: the next change starts a
    // fresh one instead of joining this one.
    undoManagerRef.current?.stopCapturing();
    setTemplatesOpen(false);
  }

  // Double-clicking empty canvas creates a note centered on the
  // click — but only in Select mode. With a shape tool active, a
  // double-click is two draws, not a note; with the Note tool, a
  // single click already creates one.
  function createNoteAtPoint(event: React.MouseEvent<HTMLDivElement>): void {
    if (tool !== "select") return;
    if (event.target !== event.currentTarget && event.target !== canvasRef.current) return;
    const point = toBoardCoords(event.clientX, event.clientY);
    createNote(
      Math.max(0, point.x - DEFAULT_NOTE_SIZE.w / 2),
      Math.max(0, point.y - DEFAULT_NOTE_SIZE.h / 2),
    );
  }

  // Recolors one note. The change syncs to every tab like any
  // other edit, and undo reverts it.
  function recolorNote(noteId: string, color: NoteColor): void {
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    if (!doc || !notesMap) return;
    const noteMap = notesMap.get(noteId);
    if (!noteMap) return;
    doc.transact(() => {
      noteMap.set("color", color);
    }, localOrigin);
  }

  // Picks the color for new notes and shapes — and recolors the
  // selected note, shape, text box, frame, or connector right
  // away, if there is one.
  function pickColor(color: NoteColor): void {
    setPickedColor(color);
    if (selectedNoteId) recolorNote(selectedNoteId, color);
    if (selectedShapeId) recolorShape(selectedShapeId, color);
    if (selectedTextId) recolorTextBox(selectedTextId, color);
    if (selectedFrameId) recolorFrame(selectedFrameId, color);
    if (selectedConnectorId) recolorConnector(selectedConnectorId, color);
  }

  // Removes a note from the shared map, so it disappears in every
  // tab. Any connector attached to it goes in the same
  // transaction, so one undo brings both back. If it was the
  // selected note, the selection clears too.
  function deleteNote(noteId: string): void {
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !notesMap || !notesMap.has(noteId)) return;
    doc.transact(() => {
      notesMap.delete(noteId);
      if (connectorsMap) deleteConnectorsReferencing(connectorsMap, noteId);
    }, localOrigin);
    if (localPresenceRef.current.selectedNoteIds.includes(noteId)) {
      setSelection(null, null);
    }
  }

  // Creates a text box centered on the given board position, in
  // the picked color and size, selects it, and focuses it so the
  // user can type right away. The tool goes back to Select, so
  // the next click drags or edits instead of placing another box.
  function createTextBoxAtPoint(x: number, y: number): void {
    const doc = docRef.current;
    const textsMap = textsMapRef.current;
    if (!doc || !textsMap) return;
    const id = crypto.randomUUID();
    const textBox = createTextBox(
      id,
      Math.max(0, Math.round(x - DEFAULT_TEXT_SIZE.w / 2)),
      Math.max(0, Math.round(y - DEFAULT_TEXT_SIZE.h / 2)),
      DEFAULT_TEXT_SIZE.w,
      DEFAULT_TEXT_SIZE.h,
      pickedFontSize,
      pickedColor,
    );
    doc.transact(() => {
      textsMap.set(id, buildTextMap(textBox));
    }, localOrigin);
    selectTextBox(id);
    setFocusTextId(id);
    setTool("select");
  }

  function changeTextBoxText(textId: string, next: string): void {
    const doc = docRef.current;
    const textsMap = textsMapRef.current;
    if (!doc || !textsMap) return;
    const textMap = textsMap.get(textId);
    const text = textMap?.get("text");
    if (!textMap || !(text instanceof Y.Text)) return;
    // The same prefix/suffix diff as notes: only the changed part
    // is replaced, so two people typing at once keep each other's
    // words.
    updateNoteText(doc, text, next, localOrigin);
  }

  // Recolors one text box. The change syncs to every tab like
  // any other edit, and undo reverts it.
  function recolorTextBox(textId: string, color: NoteColor): void {
    const doc = docRef.current;
    const textsMap = textsMapRef.current;
    if (!doc || !textsMap) return;
    const textMap = textsMap.get(textId);
    if (!textMap) return;
    doc.transact(() => {
      textMap.set("color", color);
    }, localOrigin);
  }

  // Picks the font size for new text boxes — and resizes the text
  // in the selected text box right away, if there is one.
  function pickFontSize(fontSize: TextFontSize): void {
    setPickedFontSize(fontSize);
    if (!selectedTextId) return;
    const doc = docRef.current;
    const textsMap = textsMapRef.current;
    if (!doc || !textsMap) return;
    const textMap = textsMap.get(selectedTextId);
    if (!textMap) return;
    doc.transact(() => {
      setTextFontSize(textMap, fontSize);
    }, localOrigin);
  }

  // Removes a text box from the shared map, so it disappears in
  // every tab. Any connector attached to it goes in the same
  // transaction, so one undo brings both back. If it was the
  // selected text box, the selection clears too.
  function deleteTextBox(textId: string): void {
    const doc = docRef.current;
    const textsMap = textsMapRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !textsMap || !textsMap.has(textId)) return;
    doc.transact(() => {
      textsMap.delete(textId);
      if (connectorsMap) deleteConnectorsReferencing(connectorsMap, textId);
    }, localOrigin);
    if (localPresenceRef.current.selectedTextIds.includes(textId)) {
      setSelection(null, null);
    }
  }

  // Starts a drag from a text box's handle. The textarea
  // underneath stays free for text editing — only the handle drags.
  // With the Connector tool, a press picks an endpoint instead.
  function startTextDrag(event: React.PointerEvent<HTMLDivElement>, textBox: TextBox): void {
    if (event.button !== 0 || tool === "connector" || pinchRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    textDragRef.current = {
      id: textBox.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      textX: textBox.x,
      textY: textBox.y,
    };
  }

  function moveTextDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = textDragRef.current;
    const doc = docRef.current;
    const textsMap = textsMapRef.current;
    if (!drag || !doc || !textsMap || event.pointerId !== drag.pointerId) return;
    const textMap = textsMap.get(drag.id);
    if (!textMap) return;
    // Screen pixels become board pixels by dividing by the zoom —
    // at 200% a 20px mouse move is only 10 board pixels.
    const nextX = Math.max(0, drag.textX + (event.clientX - drag.startX) / zoom);
    const nextY = Math.max(0, drag.textY + (event.clientY - drag.startY) / zoom);
    // Same batching as a note drag: the whole drag lands on one
    // undo step.
    doc.transact(() => {
      textMap.set("x", Math.round(nextX));
      textMap.set("y", Math.round(nextY));
    }, localOrigin);
  }

  function endTextDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (textDragRef.current?.pointerId === event.pointerId) {
      textDragRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Starts a resize from the text box's bottom-right handle.
  // With the Connector tool, a press picks an endpoint instead.
  function startTextResize(event: React.PointerEvent<HTMLDivElement>, textBox: TextBox): void {
    if (event.button !== 0 || tool === "connector" || pinchRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    textResizeRef.current = {
      id: textBox.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      textW: textBox.w,
      textH: textBox.h,
    };
  }

  function moveTextResize(event: React.PointerEvent<HTMLDivElement>): void {
    const resize = textResizeRef.current;
    const doc = docRef.current;
    const textsMap = textsMapRef.current;
    if (!resize || !doc || !textsMap || event.pointerId !== resize.pointerId) return;
    const textMap = textsMap.get(resize.id);
    if (!textMap) return;
    const nextW = Math.max(
      MIN_TEXT_SIZE.w,
      resize.textW + (event.clientX - resize.startX) / zoom,
    );
    const nextH = Math.max(
      MIN_TEXT_SIZE.h,
      resize.textH + (event.clientY - resize.startY) / zoom,
    );
    // Same batching as a drag: rapid moves merge into one undo step.
    doc.transact(() => {
      textMap.set("w", Math.round(nextW));
      textMap.set("h", Math.round(nextH));
    }, localOrigin);
  }

  function endTextResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (textResizeRef.current?.pointerId === event.pointerId) {
      textResizeRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Creates a shape at the given board position, in the picked
  // color, and selects it so the user can drag or recolor it
  // right away. A pen stroke starts with one point at the click;
  // other shapes start at the minimum size and grow with the drag.
  function createShapeAtPoint(kind: ShapeKind, x: number, y: number): string {
    const doc = docRef.current;
    const shapesMap = shapesMapRef.current;
    if (!doc || !shapesMap) return "";
    const id = crypto.randomUUID();
    const shape = createShape(
      id,
      kind,
      Math.round(x),
      Math.round(y),
      kind === "pen" ? 1 : MIN_SHAPE_SIZE,
      kind === "pen" ? 1 : MIN_SHAPE_SIZE,
      pickedColor,
      kind === "pen" ? [{ x: Math.round(x), y: Math.round(y) }] : [],
    );
    doc.transact(() => {
      shapesMap.set(id, buildShapeMap(shape));
    }, localOrigin);
    selectShape(id);
    return id;
  }

  // Starts drawing a shape on empty canvas. The shape is created
  // right away, so the other tab sees it appear as soon as the
  // drag starts — and a pen stroke grows live as it is drawn.
  function startDraw(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    if (
      tool !== "rect" &&
      tool !== "ellipse" &&
      tool !== "diamond" &&
      tool !== "triangle" &&
      tool !== "star" &&
      tool !== "line" &&
      tool !== "pen"
    ) {
      return;
    }
    const point = toBoardCoords(event.clientX, event.clientY);
    const id = createShapeAtPoint(tool, point.x, point.y);
    if (!id) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawRef.current = {
      kind: tool,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      shapeId: id,
      points: tool === "pen" ? [{ x: Math.round(point.x), y: Math.round(point.y) }] : [],
    };
  }

  function moveDraw(event: React.PointerEvent<HTMLDivElement>): void {
    const draw = drawRef.current;
    const doc = docRef.current;
    const shapesMap = shapesMapRef.current;
    if (!draw || !doc || !shapesMap || event.pointerId !== draw.pointerId) return;
    const shapeMap = shapesMap.get(draw.shapeId);
    if (!shapeMap) return;
    const point = toBoardCoords(event.clientX, event.clientY);
    if (draw.kind === "pen") {
      // Skip a point identical to the last one — a pause mid-stroke
      // should not fill the stroke with duplicate points.
      const last = draw.points[draw.points.length - 1];
      const nextPoint = { x: Math.round(point.x), y: Math.round(point.y) };
      if (last && last.x === nextPoint.x && last.y === nextPoint.y) return;
      draw.points.push(nextPoint);
      const box = shapeBoxFromPoints(draw.points);
      if (!box) return;
      // Stamped with our origin so undo can revert this stroke —
      // and only this user's strokes. Pointermove fires faster
      // than the capture timeout, so the whole stroke lands on
      // one undo step.
      doc.transact(() => {
        appendPenPoint(shapeMap, nextPoint);
        shapeMap.set("x", box.x);
        shapeMap.set("y", box.y);
        shapeMap.set("w", box.w);
        shapeMap.set("h", box.h);
      }, localOrigin);
      return;
    }
    // A drag in any direction defines the box, so dragging up or
    // left grows the shape the other way instead of shrinking it.
    const box = normalizeShapeBox(draw.startX, draw.startY, point.x, point.y);
    doc.transact(() => {
      shapeMap.set("x", box.x);
      shapeMap.set("y", box.y);
      shapeMap.set("w", box.w);
      shapeMap.set("h", box.h);
    }, localOrigin);
  }

  function endDraw(event: React.PointerEvent<HTMLDivElement>): void {
    if (drawRef.current?.pointerId === event.pointerId) {
      drawRef.current = null;
      // The next change starts a fresh undo step instead of
      // joining the shape we just drew.
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Recolors one shape. The change syncs to every tab like any
  // other edit, and undo reverts it.
  function recolorShape(shapeId: string, color: NoteColor): void {
    const doc = docRef.current;
    const shapesMap = shapesMapRef.current;
    if (!doc || !shapesMap) return;
    const shapeMap = shapesMap.get(shapeId);
    if (!shapeMap) return;
    doc.transact(() => {
      shapeMap.set("color", color);
    }, localOrigin);
  }

  // Removes a shape from the shared map, so it disappears in every
  // tab. Any connector attached to it goes in the same
  // transaction, so one undo brings both back. If it was the
  // selected shape, the selection clears too.
  function deleteShape(shapeId: string): void {
    const doc = docRef.current;
    const shapesMap = shapesMapRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !shapesMap || !shapesMap.has(shapeId)) return;
    doc.transact(() => {
      shapesMap.delete(shapeId);
      if (connectorsMap) deleteConnectorsReferencing(connectorsMap, shapeId);
    }, localOrigin);
    if (localPresenceRef.current.selectedShapeIds.includes(shapeId)) {
      setSelection(null, null);
    }
  }

  // Removes a frame from the shared map, so it disappears in
  // every tab. The items inside it stay exactly where they are —
  // a frame is only a container, not their owner. Any connector
  // attached to the frame goes in the same transaction. If it
  // was the selected frame, the selection clears too.
  function deleteFrame(frameId: string): void {
    const doc = docRef.current;
    const framesMap = framesMapRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !framesMap || !framesMap.has(frameId)) return;
    doc.transact(() => {
      framesMap.delete(frameId);
      if (connectorsMap) deleteConnectorsReferencing(connectorsMap, frameId);
    }, localOrigin);
    if (selectedFrameRef.current === frameId) {
      setSelection(null, null);
    }
  }

  // Removes a connector from the shared map, so it disappears in
  // every tab. The two items it joined stay where they are. If
  // it was the selected connector, the selection clears too.
  function deleteConnector(connectorId: string): void {
    const doc = docRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !connectorsMap || !connectorsMap.has(connectorId)) return;
    doc.transact(() => {
      connectorsMap.delete(connectorId);
    }, localOrigin);
    if (selectedConnectorRef.current === connectorId) {
      setSelection(null, null);
    }
  }

  // Recolors one frame. The change syncs to every tab like any
  // other edit, and undo reverts it.
  function recolorFrame(frameId: string, color: NoteColor): void {
    const doc = docRef.current;
    const framesMap = framesMapRef.current;
    if (!doc || !framesMap) return;
    const frameMap = framesMap.get(frameId);
    if (!frameMap) return;
    doc.transact(() => {
      frameMap.set("color", color);
    }, localOrigin);
  }

  // Recolors one connector. The change syncs to every tab like
  // any other edit, and undo reverts it.
  function recolorConnector(connectorId: string, color: NoteColor): void {
    const doc = docRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !connectorsMap) return;
    const connectorMap = connectorsMap.get(connectorId);
    if (!connectorMap) return;
    doc.transact(() => {
      connectorMap.set("color", color);
    }, localOrigin);
  }

  // Turns one connector's arrowhead on or off. The change syncs
  // to every tab like any other edit, and undo reverts it.
  function toggleConnectorArrow(connectorId: string, arrow: boolean): void {
    const doc = docRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !connectorsMap) return;
    const connectorMap = connectorsMap.get(connectorId);
    if (!connectorMap) return;
    doc.transact(() => {
      setConnectorArrow(connectorMap, arrow);
    }, localOrigin);
  }

  // Sets one connector's label — the short text at its midpoint.
  // An empty label is fine: it just shows nothing. The change
  // syncs to every tab like any other edit, and undo reverts it.
  function renameConnectorLabel(connectorId: string, label: string): void {
    const doc = docRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !connectorsMap) return;
    const connectorMap = connectorsMap.get(connectorId);
    if (!connectorMap) return;
    doc.transact(() => {
      setConnectorLabel(connectorMap, label.trim());
    }, localOrigin);
  }

  // Starts a drag from a shape. The whole shape is the handle —
  // there is no text to edit, so the entire shape grabs. With
  // the Connector tool, a press picks an endpoint instead.
  function startShapeDrag(event: React.PointerEvent<HTMLDivElement>, shape: Shape): void {
    if (event.button !== 0 || tool === "connector" || pinchRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    shapeDragRef.current = {
      id: shape.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      shapeX: shape.x,
      shapeY: shape.y,
    };
  }

  function moveShapeDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = shapeDragRef.current;
    const doc = docRef.current;
    const shapesMap = shapesMapRef.current;
    if (!drag || !doc || !shapesMap || event.pointerId !== drag.pointerId) return;
    const shapeMap = shapesMap.get(drag.id);
    if (!shapeMap) return;
    // Screen pixels become board pixels by dividing by the zoom —
    // at 200% a 20px mouse move is only 10 board pixels.
    const nextX = Math.max(0, drag.shapeX + (event.clientX - drag.startX) / zoom);
    const nextY = Math.max(0, drag.shapeY + (event.clientY - drag.startY) / zoom);
    // Same batching as a note drag: the whole drag lands on one
    // undo step.
    doc.transact(() => {
      shapeMap.set("x", Math.round(nextX));
      shapeMap.set("y", Math.round(nextY));
    }, localOrigin);
  }

  function endShapeDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (shapeDragRef.current?.pointerId === event.pointerId) {
      shapeDragRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Starts a resize from the shape's bottom-right handle. Pen
  // strokes have no handle — resizing one would stretch its
  // points out of shape, so pen shapes move and delete but do
  // not resize. With the Connector tool, a press picks an
  // endpoint instead.
  function startShapeResize(event: React.PointerEvent<HTMLDivElement>, shape: Shape): void {
    if (event.button !== 0 || tool === "connector" || pinchRef.current) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    shapeResizeRef.current = {
      id: shape.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      shapeW: shape.w,
      shapeH: shape.h,
    };
  }

  function moveShapeResize(event: React.PointerEvent<HTMLDivElement>): void {
    const resize = shapeResizeRef.current;
    const doc = docRef.current;
    const shapesMap = shapesMapRef.current;
    if (!resize || !doc || !shapesMap || event.pointerId !== resize.pointerId) return;
    const shapeMap = shapesMap.get(resize.id);
    if (!shapeMap) return;
    const nextW = Math.max(
      MIN_SHAPE_SIZE,
      resize.shapeW + (event.clientX - resize.startX) / zoom,
    );
    const nextH = Math.max(
      MIN_SHAPE_SIZE,
      resize.shapeH + (event.clientY - resize.startY) / zoom,
    );
    // Same batching as a drag: rapid moves merge into one undo step.
    doc.transact(() => {
      shapeMap.set("w", Math.round(nextW));
      shapeMap.set("h", Math.round(nextH));
    }, localOrigin);
  }

  function endShapeResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (shapeResizeRef.current?.pointerId === event.pointerId) {
      shapeResizeRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Clicking an image selects it, and clears everything else.
  function selectImage(imageId: string): void {
    if (selectedImageId === imageId) return;
    setSelection(null, null, null, null, null, imageId);
  }

  // Adds an image file to the board, centred on the given board
  // point. The file is downscaled first, so the shared document
  // only ever holds a small data URL. A file that is not a
  // supported image, or too big, is rejected with a message
  // instead of landing on the board.
  async function addImageFile(file: File, centreX: number, centreY: number): Promise<void> {
    if (!isSupportedImageFile(file)) {
      setImportMessage(
        "That file is not an image under 10 MB — nothing was added.",
      );
      return;
    }
    let downscaled: { dataUrl: string; width: number; height: number };
    try {
      downscaled = await downscaleImage(file, MAX_IMAGE_DIMENSION);
    } catch {
      setImportMessage("Could not read that image — nothing was added.");
      return;
    }
    const doc = docRef.current;
    const imagesMap = imagesMapRef.current;
    if (!doc || !imagesMap) return;
    const id = crypto.randomUUID();
    const image = createImage(
      id,
      Math.max(0, Math.round(centreX - downscaled.width / 2)),
      Math.max(0, Math.round(centreY - downscaled.height / 2)),
      downscaled.width,
      downscaled.height,
      downscaled.dataUrl,
    );
    doc.transact(() => {
      imagesMap.set(id, buildImageMap(image));
    }, localOrigin);
    setSelection(null, null, null, null, null, id);
    setImportMessage(null);
  }

  // Adds the file from the picker at the centre of the current
  // view, so it lands where the user is looking.
  function addImageFromPicker(file: File): void {
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const point = toBoardCoords(rect.left + rect.width / 2, rect.top + rect.height / 2);
    void addImageFile(file, point.x, point.y);
  }

  // Removes an image from the shared map, so it disappears in
  // every tab. If it was the selected image, the selection
  // clears too.
  function deleteImage(imageId: string): void {
    const doc = docRef.current;
    const imagesMap = imagesMapRef.current;
    if (!doc || !imagesMap || !imagesMap.has(imageId)) return;
    doc.transact(() => {
      imagesMap.delete(imageId);
    }, localOrigin);
    if (selectedImageRef.current === imageId) {
      setSelection(null, null);
    }
  }

  // Clicking a voice note selects it, and tells everyone else
  // — through the same selection the other items use.
  function selectVoiceNote(voiceId: string): void {
    if (selectedVoiceId === voiceId) return;
    setSelection(null, null, null, null, null, null, voiceId);
  }

  // Starts a voice-note recording at a board point. The pin is
  // local until the recording stops: only a finished clip is
  // written to the shared document, so a cancelled recording
  // leaves nothing behind. A denied microphone clears the pin
  // and shows a message instead.
  async function startVoiceRecording(x: number, y: number): Promise<void> {
    const recorder = new VoiceRecorder(
      {
        getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
        MediaRecorderCtor: window.MediaRecorder,
      },
      {
        onElapsed: (seconds) => setRecordingElapsed(seconds),
        onStop: (blob, durationSeconds) =>
          void saveVoiceRecording(x, y, blob, durationSeconds),
        onError: (message) => {
          voiceRecorderRef.current = null;
          setRecordingDraft(null);
          setRecordingElapsed(0);
          setTool("select");
          setImportMessage(message);
        },
      },
    );
    voiceRecorderRef.current = recorder;
    setRecordingDraft({ x, y });
    setRecordingElapsed(0);
    setTool("select");
    await recorder.start();
    // The user may have cancelled while the microphone prompt
    // was up — stop a recording nobody is waiting for.
    if (voiceRecorderRef.current !== recorder) {
      recorder.cancel();
    }
  }

  // Saves a finished recording as a voice note on the board, so
  // it syncs to everyone. A clip over the cap is rejected with
  // a message instead of landing on the board.
  async function saveVoiceRecording(
    x: number,
    y: number,
    blob: Blob,
    durationSeconds: number,
  ): Promise<void> {
    voiceRecorderRef.current = null;
    setRecordingDraft(null);
    setRecordingElapsed(0);
    if (isVoiceNoteOversize(blob.size)) {
      setImportMessage("That recording is over 2 MB — nothing was saved.");
      return;
    }
    let dataUrl: string;
    try {
      dataUrl = await blobToDataUrl(blob);
    } catch {
      setImportMessage("Could not save that recording — nothing was added.");
      return;
    }
    const doc = docRef.current;
    const voiceNotesMap = voiceNotesMapRef.current;
    if (!doc || !voiceNotesMap) return;
    const id = crypto.randomUUID();
    const note = buildVoiceNote(
      id,
      Math.max(0, Math.round(x)),
      Math.max(0, Math.round(y)),
      dataUrl,
      durationSeconds,
    );
    doc.transact(() => {
      voiceNotesMap.set(id, buildVoiceNoteMap(note));
    }, localOrigin);
    setSelection(null, null, null, null, null, null, id);
    setImportMessage(null);
  }

  // Stops the recording in progress. The recorder's onStop
  // saves the clip — this only ends it.
  function stopRecording(): void {
    voiceRecorderRef.current?.stop();
  }

  // Throws the recording in progress away: no clip, no error,
  // and the pin goes with it.
  function cancelRecording(): void {
    const recorder = voiceRecorderRef.current;
    voiceRecorderRef.current = null;
    recorder?.cancel();
    setRecordingDraft(null);
    setRecordingElapsed(0);
    setTool("select");
  }

  // Removes a voice note from the shared map, so it disappears
  // in every tab. If it was the selected note, the selection
  // clears too. A note that was playing is paused first, so the
  // playing state never points at a note that is gone.
  function deleteVoiceNote(voiceId: string): void {
    audioRefs.current.get(voiceId)?.pause();
    const doc = docRef.current;
    const voiceNotesMap = voiceNotesMapRef.current;
    if (!doc || !voiceNotesMap || !voiceNotesMap.has(voiceId)) return;
    doc.transact(() => {
      voiceNotesMap.delete(voiceId);
    }, localOrigin);
    if (selectedVoiceRef.current === voiceId) {
      setSelection(null, null);
    }
  }

  // Plays a voice note, or pauses it when it is already
  // playing. Only one note plays at a time — starting another
  // pauses the one already playing. The audio element's own
  // play and pause events keep the playing state honest.
  function toggleVoicePlayback(note: VoiceNote): void {
    const audio = audioRefs.current.get(note.id);
    if (!audio) return;
    if (playingVoiceId === note.id) {
      audio.pause();
      return;
    }
    const playing = playingVoiceId ? audioRefs.current.get(playingVoiceId) : undefined;
    playing?.pause();
    void audio.play().catch(() => undefined);
  }

  // Starts a drag from a voice note. The whole pin is the
  // handle — there is no text to edit, so the entire pin grabs.
  // With the Connector or Vote tool, a press does nothing
  // instead: voice notes are neither endpoints nor vote targets.
  function startVoiceDrag(event: React.PointerEvent<HTMLDivElement>, note: VoiceNote): void {
    if (event.button !== 0 || tool === "connector" || tool === "vote" || pinchRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    voiceDragRef.current = {
      id: note.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      voiceX: note.x,
      voiceY: note.y,
    };
  }

  function moveVoiceDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = voiceDragRef.current;
    const doc = docRef.current;
    const voiceNotesMap = voiceNotesMapRef.current;
    if (!drag || !doc || !voiceNotesMap || event.pointerId !== drag.pointerId) return;
    const voiceMap = voiceNotesMap.get(drag.id);
    if (!voiceMap) return;
    // Screen pixels become board pixels by dividing by the zoom —
    // at 200% a 20px mouse move is only 10 board pixels.
    const nextX = Math.max(0, drag.voiceX + (event.clientX - drag.startX) / zoom);
    const nextY = Math.max(0, drag.voiceY + (event.clientY - drag.startY) / zoom);
    // Same batching as a note drag: the whole drag lands on one
    // undo step.
    doc.transact(() => {
      voiceMap.set("x", Math.round(nextX));
      voiceMap.set("y", Math.round(nextY));
    }, localOrigin);
  }

  function endVoiceDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (voiceDragRef.current?.pointerId === event.pointerId) {
      voiceDragRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Starts a drag from an image. The whole image is the handle —
  // there is no text to edit, so the entire image grabs. With
  // the Connector or Vote tool, a press does nothing instead:
  // images are neither endpoints nor vote targets.
  function startImageDrag(event: React.PointerEvent<HTMLDivElement>, image: ImageItem): void {
    if (event.button !== 0 || tool === "connector" || tool === "vote" || pinchRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    imageDragRef.current = {
      id: image.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      imageX: image.x,
      imageY: image.y,
    };
  }

  function moveImageDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = imageDragRef.current;
    const doc = docRef.current;
    const imagesMap = imagesMapRef.current;
    if (!drag || !doc || !imagesMap || event.pointerId !== drag.pointerId) return;
    const imageMap = imagesMap.get(drag.id);
    if (!imageMap) return;
    // Screen pixels become board pixels by dividing by the zoom —
    // at 200% a 20px mouse move is only 10 board pixels.
    const nextX = Math.max(0, drag.imageX + (event.clientX - drag.startX) / zoom);
    const nextY = Math.max(0, drag.imageY + (event.clientY - drag.startY) / zoom);
    // Same batching as a note drag: the whole drag lands on one
    // undo step.
    doc.transact(() => {
      imageMap.set("x", Math.round(nextX));
      imageMap.set("y", Math.round(nextY));
    }, localOrigin);
  }

  function endImageDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (imageDragRef.current?.pointerId === event.pointerId) {
      imageDragRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Starts a resize from the image's bottom-right handle. The
  // resize keeps the aspect ratio: the width follows the
  // pointer, and the height follows from the aspect, so the
  // picture never stretches. With the Connector or Vote tool, a
  // press does nothing instead.
  function startImageResize(event: React.PointerEvent<HTMLDivElement>, image: ImageItem): void {
    if (event.button !== 0 || tool === "connector" || tool === "vote" || pinchRef.current) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    imageResizeRef.current = {
      id: image.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      imageW: image.w,
      aspect: image.h > 0 ? image.w / image.h : 1,
    };
  }

  function moveImageResize(event: React.PointerEvent<HTMLDivElement>): void {
    const resize = imageResizeRef.current;
    const doc = docRef.current;
    const imagesMap = imagesMapRef.current;
    if (!resize || !doc || !imagesMap || event.pointerId !== resize.pointerId) return;
    const imageMap = imagesMap.get(resize.id);
    if (!imageMap) return;
    const nextW = Math.max(
      MIN_IMAGE_SIZE,
      resize.imageW + (event.clientX - resize.startX) / zoom,
    );
    const nextH = Math.max(MIN_IMAGE_SIZE, Math.round(nextW / resize.aspect));
    // Same batching as a drag: rapid moves merge into one undo step.
    doc.transact(() => {
      imageMap.set("w", Math.round(nextW));
      imageMap.set("h", nextH);
    }, localOrigin);
  }

  function endImageResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (imageResizeRef.current?.pointerId === event.pointerId) {
      imageResizeRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Creates a frame at the given board position, in the picked
  // color, and selects it so the user can drag or rename it right
  // away. A frame starts at the minimum size and grows with the drag.
  function createFrameAtPoint(x: number, y: number): string {
    const doc = docRef.current;
    const framesMap = framesMapRef.current;
    if (!doc || !framesMap) return "";
    const id = crypto.randomUUID();
    const frame = createFrame(
      id,
      Math.round(x),
      Math.round(y),
      MIN_FRAME_SIZE,
      MIN_FRAME_SIZE,
      pickedColor,
    );
    doc.transact(() => {
      framesMap.set(id, buildFrameMap(frame));
    }, localOrigin);
    selectFrame(id);
    return id;
  }

  // Starts drawing a frame on empty canvas. The frame is created
  // right away, so the other tab sees it appear as soon as the
  // drag starts.
  function startFrameDraw(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    if (tool !== "frame") return;
    const point = toBoardCoords(event.clientX, event.clientY);
    const id = createFrameAtPoint(point.x, point.y);
    if (!id) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    frameDrawRef.current = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      frameId: id,
    };
  }

  function moveFrameDraw(event: React.PointerEvent<HTMLDivElement>): void {
    const draw = frameDrawRef.current;
    const doc = docRef.current;
    const framesMap = framesMapRef.current;
    if (!draw || !doc || !framesMap || event.pointerId !== draw.pointerId) return;
    const frameMap = framesMap.get(draw.frameId);
    if (!frameMap) return;
    const point = toBoardCoords(event.clientX, event.clientY);
    // A drag in any direction defines the box, so dragging up or
    // left grows the frame the other way instead of shrinking it.
    const box = normalizeShapeBox(draw.startX, draw.startY, point.x, point.y);
    doc.transact(() => {
      frameMap.set("x", box.x);
      frameMap.set("y", box.y);
      frameMap.set("w", box.w);
      frameMap.set("h", box.h);
    }, localOrigin);
  }

  function endFrameDraw(event: React.PointerEvent<HTMLDivElement>): void {
    if (frameDrawRef.current?.pointerId === event.pointerId) {
      frameDrawRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // The items whose centres are inside a frame, with the position
  // each one starts at. A frame drag moves all of them by the same
  // amount as the frame. A frame inside the frame moves too —
  // its contents are inside the outer frame as well, so they are
  // listed directly and move in the same step.
  function frameContents(frame: Frame): FrameDragContent[] {
    const contents: FrameDragContent[] = [];
    for (const note of notes) {
      if (boxCentreInFrame(frame, note)) {
        contents.push({ kind: "note", id: note.id, x: note.x, y: note.y });
      }
    }
    for (const shape of shapes) {
      if (boxCentreInFrame(frame, shape)) {
        contents.push({
          kind: "shape",
          id: shape.id,
          x: shape.x,
          y: shape.y,
          points: shape.kind === "pen" ? shape.points : undefined,
        });
      }
    }
    for (const textBox of texts) {
      if (boxCentreInFrame(frame, textBox)) {
        contents.push({ kind: "text", id: textBox.id, x: textBox.x, y: textBox.y });
      }
    }
    for (const image of images) {
      if (boxCentreInFrame(frame, image)) {
        contents.push({ kind: "image", id: image.id, x: image.x, y: image.y });
      }
    }
    for (const voiceNote of voiceNotes) {
      // A voice note is a fixed-size pin: its box is its
      // position plus the pin size, so its centre is what the
      // frame test reads.
      if (
        boxCentreInFrame(frame, {
          x: voiceNote.x,
          y: voiceNote.y,
          w: VOICE_NOTE_SIZE.w,
          h: VOICE_NOTE_SIZE.h,
        })
      ) {
        contents.push({ kind: "voice", id: voiceNote.id, x: voiceNote.x, y: voiceNote.y });
      }
    }
    for (const other of frames) {
      if (other.id !== frame.id && boxCentreInFrame(frame, other)) {
        contents.push({ kind: "frame", id: other.id, x: other.x, y: other.y });
      }
    }
    return contents;
  }

  // Starts a drag from a frame. The whole frame is the handle —
  // there is no text to edit, so the entire frame grabs, except
  // the title input (which stops the press so the frame does not
  // move while the user is renaming it). With the Connector tool,
  // a press picks an endpoint instead.
  function startFrameDrag(event: React.PointerEvent<HTMLDivElement>, frame: Frame): void {
    if (event.button !== 0 || tool === "connector" || pinchRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    frameDragRef.current = {
      id: frame.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      frameX: frame.x,
      frameY: frame.y,
      contents: frameContents(frame),
    };
  }

  function moveFrameDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = frameDragRef.current;
    const doc = docRef.current;
    if (!drag || !doc || event.pointerId !== drag.pointerId) return;
    const notesMap = notesMapRef.current;
    const shapesMap = shapesMapRef.current;
    const textsMap = textsMapRef.current;
    const imagesMap = imagesMapRef.current;
    const voiceNotesMap = voiceNotesMapRef.current;
    const framesMap = framesMapRef.current;
    if (!notesMap || !shapesMap || !textsMap || !imagesMap || !voiceNotesMap || !framesMap) return;
    const frameMap = framesMap.get(drag.id);
    if (!frameMap) return;
    // Screen pixels become board pixels by dividing by the zoom —
    // at 200% a 20px mouse move is only 10 board pixels.
    const deltaX = (event.clientX - drag.startX) / zoom;
    const deltaY = (event.clientY - drag.startY) / zoom;
    const nextX = Math.max(0, drag.frameX + deltaX);
    const nextY = Math.max(0, drag.frameY + deltaY);
    // The frame cannot move past the top-left corner, so the
    // contents move by the frame's actual move, not the raw
    // mouse delta — otherwise the group would drift apart.
    const moveX = nextX - drag.frameX;
    const moveY = nextY - drag.frameY;
    // One transaction, so the frame and its contents move together
    // and one undo step reverts the whole drag.
    doc.transact(() => {
      frameMap.set("x", Math.round(nextX));
      frameMap.set("y", Math.round(nextY));
      for (const item of drag.contents) {
        if (item.kind === "note") {
          notesMap.get(item.id)?.set("x", Math.round(item.x + moveX));
          notesMap.get(item.id)?.set("y", Math.round(item.y + moveY));
        } else if (item.kind === "shape") {
          const shapeMap = shapesMap.get(item.id);
          if (!shapeMap) continue;
          shapeMap.set("x", Math.round(item.x + moveX));
          shapeMap.set("y", Math.round(item.y + moveY));
          // A pen stroke lives in absolute board pixels: the
          // points move with the box, or the stroke stays behind.
          if (item.points) {
            const points = shapeMap.get("points");
            if (points instanceof Y.Array) {
              const shifted: number[] = [];
              for (const point of item.points) {
                shifted.push(Math.round(point.x + moveX), Math.round(point.y + moveY));
              }
              points.delete(0, points.length);
              points.push(shifted);
            }
          }
        } else if (item.kind === "text") {
          textsMap.get(item.id)?.set("x", Math.round(item.x + moveX));
          textsMap.get(item.id)?.set("y", Math.round(item.y + moveY));
        } else if (item.kind === "image") {
          imagesMap.get(item.id)?.set("x", Math.round(item.x + moveX));
          imagesMap.get(item.id)?.set("y", Math.round(item.y + moveY));
        } else if (item.kind === "voice") {
          voiceNotesMap.get(item.id)?.set("x", Math.round(item.x + moveX));
          voiceNotesMap.get(item.id)?.set("y", Math.round(item.y + moveY));
        } else {
          framesMap.get(item.id)?.set("x", Math.round(item.x + moveX));
          framesMap.get(item.id)?.set("y", Math.round(item.y + moveY));
        }
      }
    }, localOrigin);
  }

  function endFrameDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (frameDragRef.current?.pointerId === event.pointerId) {
      frameDragRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Starts a resize from the frame's bottom-right handle.
  // Resizing a frame does not move its contents — they stay where
  // they are, and anything that ends up outside the frame simply
  // stops being inside it. With the Connector tool, a press picks
  // an endpoint instead.
  function startFrameResize(event: React.PointerEvent<HTMLDivElement>, frame: Frame): void {
    if (event.button !== 0 || tool === "connector" || pinchRef.current) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    frameResizeRef.current = {
      id: frame.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      frameW: frame.w,
      frameH: frame.h,
    };
  }

  function moveFrameResize(event: React.PointerEvent<HTMLDivElement>): void {
    const resize = frameResizeRef.current;
    const doc = docRef.current;
    const framesMap = framesMapRef.current;
    if (!resize || !doc || !framesMap || event.pointerId !== resize.pointerId) return;
    const frameMap = framesMap.get(resize.id);
    if (!frameMap) return;
    const nextW = Math.max(
      MIN_FRAME_SIZE,
      resize.frameW + (event.clientX - resize.startX) / zoom,
    );
    const nextH = Math.max(
      MIN_FRAME_SIZE,
      resize.frameH + (event.clientY - resize.startY) / zoom,
    );
    // Same batching as a drag: rapid moves merge into one undo step.
    doc.transact(() => {
      frameMap.set("w", Math.round(nextW));
      frameMap.set("h", Math.round(nextH));
    }, localOrigin);
  }

  function endFrameResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (frameResizeRef.current?.pointerId === event.pointerId) {
      frameResizeRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Renames a frame. An empty title falls back to "Frame", so a
  // frame always has a name to show.
  function renameFrame(frameId: string, next: string): void {
    const doc = docRef.current;
    const framesMap = framesMapRef.current;
    if (!doc || !framesMap) return;
    const frameMap = framesMap.get(frameId);
    if (!frameMap) return;
    const title = next.trim() === "" ? "Frame" : next;
    doc.transact(() => {
      frameMap.set("title", title);
    }, localOrigin);
  }

  // Picks an endpoint for a connector. The first click arms the
  // connector on that item; the second click on a different item
  // creates it. Clicking the same item again cancels it.
  function pickConnectorEndpoint(itemId: string): void {
    // A pinch is in progress: a finger landing on an item must
    // not pick a connector endpoint.
    if (pinchRef.current) return;
    if (!connectorPendingFromId) {
      setConnectorPendingFromId(itemId);
      return;
    }
    if (connectorPendingFromId === itemId) {
      setConnectorPendingFromId(null);
      return;
    }
    createConnectorBetween(connectorPendingFromId, itemId);
    setConnectorPendingFromId(null);
  }

  // Creates a connector between two items, in the picked color,
  // and selects it so the user can recolor or delete it right
  // away. The connector tool stays active, so the next click
  // starts another connector.
  function createConnectorBetween(fromId: string, toId: string): void {
    const doc = docRef.current;
    const connectorsMap = connectorsMapRef.current;
    if (!doc || !connectorsMap) return;
    const id = crypto.randomUUID();
    const connector = createConnector(id, fromId, toId, pickedColor);
    doc.transact(() => {
      connectorsMap.set(id, buildConnectorMap(connector));
    }, localOrigin);
    selectConnector(id);
  }

  // Adds the draft pin as a comment thread, signed with the
  // signed-in user's name — the same name presence shows. Empty
  // text adds nothing: the draft stays open for another try.
  // The tool goes back to Select, so the next click moves
  // things instead of dropping another pin.
  function submitComment(): void {
    const draft = commentDraft;
    const text = commentText.trim();
    const doc = docRef.current;
    const commentsMap = commentsMapRef.current;
    if (!draft || text === "" || !doc || !commentsMap) return;
    const comment = createComment(draft.id, draft.x, draft.y, user.name, text);
    doc.transact(() => {
      commentsMap.set(comment.id, buildCommentMap(comment));
    }, localOrigin);
    setCommentDraft(null);
    setCommentText("");
    setSelectedCommentId(comment.id);
    setTool("select");
  }

  // Marks a thread resolved or reopens it. Resolved threads
  // stay in the panel; only their pins leave the canvas.
  function resolveComment(commentId: string, resolved: boolean): void {
    const doc = docRef.current;
    const commentsMap = commentsMapRef.current;
    if (!doc || !commentsMap) return;
    const commentMap = commentsMap.get(commentId);
    if (!commentMap) return;
    doc.transact(() => {
      commentMap.set("resolved", resolved);
    }, localOrigin);
  }

  // Removes a thread from the shared map, so it disappears in
  // every tab. One undo brings it back.
  function deleteComment(commentId: string): void {
    const doc = docRef.current;
    const commentsMap = commentsMapRef.current;
    if (!doc || !commentsMap || !commentsMap.has(commentId)) return;
    doc.transact(() => {
      commentsMap.delete(commentId);
    }, localOrigin);
    if (selectedCommentId === commentId) {
      setSelectedCommentId(null);
    }
  }

  // Places one of this user's dots on an item. Only while a
  // session is open, and only while this user still has dots
  // left in this session — the bar shows how many are left, and
  // a click past the limit does nothing. Dots from earlier
  // sessions stay on the items, but they never count toward
  // this session's allocation. Each dot is its own undo step,
  // so Ctrl+Z takes back one dot at a time.
  function placeVote(itemId: string): void {
    // A pinch is in progress: a finger landing on an item must
    // not drop a vote dot.
    if (pinchRef.current) return;
    const doc = docRef.current;
    const votesMap = votesMapRef.current;
    if (!doc || !votesMap) return;
    if (!votingSession?.active) return;
    const sessionVotes = votesInSession(votes, votingSession.session);
    if (!canPlaceVote(sessionVotes, user.id, votingSession.dotsPerPerson)) return;
    const id = crypto.randomUUID();
    const vote = createVote(id, itemId, user.id, user.name, votingSession.session);
    doc.transact(() => {
      votesMap.set(vote.id, buildVoteMap(vote));
    }, localOrigin);
    undoManagerRef.current?.stopCapturing();
  }

  // Opens a voting session with the dots per person the starter
  // picked. A fresh session gives everyone a fresh allocation,
  // and the dots from earlier sessions stay where they are —
  // visible on the items, with the total in each badge. Only
  // the new session's dots count toward the limit, so starting
  // never clears anything and never asks. The session number
  // counts up, so every dot knows which session it belongs to.
  // The Vote tool becomes active, so the next click on an item
  // places a dot.
  function startVoting(): void {
    const doc = docRef.current;
    const votingMap = votingMapRef.current;
    if (!doc || !votingMap) return;
    doc.transact(() => {
      writeVotingSession(votingMap, {
        active: true,
        dotsPerPerson: dotsPerPersonChoice,
        startedBy: user.id,
        startedByName: user.name,
        session: (votingSession?.session ?? 0) + 1,
        timed: false,
        endsAt: 0,
      });
    }, localOrigin);
    undoManagerRef.current?.stopCapturing();
    setTool("vote");
  }

  // Opens a timed voting session: the same fresh allocation as
  // an open session, but the dots stay hidden until the clock
  // runs out. The end time is written into the shared document,
  // so every client counts down to the same moment, late
  // joiners see the right remaining time, and the session still
  // ends on time if the starter leaves. One session at a time —
  // starting while one is open does nothing.
  function startTimedSession(): void {
    const doc = docRef.current;
    const votingMap = votingMapRef.current;
    if (!doc || !votingMap || votingSession?.active) return;
    const endsAt = Date.now() + timedDurationChoice * 60 * 1000;
    doc.transact(() => {
      writeVotingSession(votingMap, {
        active: true,
        dotsPerPerson: dotsPerPersonChoice,
        startedBy: user.id,
        startedByName: user.name,
        session: (votingSession?.session ?? 0) + 1,
        timed: true,
        endsAt,
      });
    }, localOrigin);
    undoManagerRef.current?.stopCapturing();
    setTool("vote");
  }

  // Ends the session. The dots stay where they are — frozen
  // and visible — until someone clears them. The tool goes back
  // to Select, so the next click moves things instead of voting.
  function endVoting(): void {
    const doc = docRef.current;
    const votingMap = votingMapRef.current;
    if (!doc || !votingMap || !votingSession) return;
    doc.transact(() => {
      writeVotingSession(votingMap, { ...votingSession, active: false });
    }, localOrigin);
    if (tool === "vote") setTool("select");
  }

  // Removes every dot from the shared map, so they disappear in
  // every tab. One undo brings them all back.
  function clearVotes(): void {
    const doc = docRef.current;
    const votesMap = votesMapRef.current;
    if (!doc || !votesMap || votes.length === 0) return;
    doc.transact(() => {
      // The ids are collected first: deleting while iterating
      // the map would skip entries.
      const voteIds: string[] = [];
      votesMap.forEach((_, voteId) => voteIds.push(voteId));
      for (const voteId of voteIds) votesMap.delete(voteId);
    }, localOrigin);
    undoManagerRef.current?.stopCapturing();
  }

  // The smallest a note can be resized to — smaller than this,
  // the text is unreadable.
  const MIN_NOTE_SIZE = 120;

  // Starts a resize from the note's bottom-right handle. With
  // the Connector tool, a press picks an endpoint instead.
  function startResize(event: React.PointerEvent<HTMLDivElement>, note: Note): void {
    if (event.button !== 0 || tool === "connector" || pinchRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      id: note.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      noteW: note.w,
      noteH: note.h,
    };
  }

  function moveResize(event: React.PointerEvent<HTMLDivElement>): void {
    const resize = resizeRef.current;
    const doc = docRef.current;
    const notesMap = notesMapRef.current;
    if (!resize || !doc || !notesMap || event.pointerId !== resize.pointerId) return;
    const noteMap = notesMap.get(resize.id);
    if (!noteMap) return;
    const nextW = Math.max(
      MIN_NOTE_SIZE,
      resize.noteW + (event.clientX - resize.startX) / zoom,
    );
    const nextH = Math.max(
      MIN_NOTE_SIZE,
      resize.noteH + (event.clientY - resize.startY) / zoom,
    );
    // Same batching as a drag: rapid moves merge into one undo step.
    doc.transact(() => {
      noteMap.set("w", Math.round(nextW));
      noteMap.set("h", Math.round(nextH));
    }, localOrigin);
  }

  function endResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (resizeRef.current?.pointerId === event.pointerId) {
      resizeRef.current = null;
      undoManagerRef.current?.stopCapturing();
    }
  }

  // Reverts the last local change only. Remote edits are not on
  // this stack (they arrive with a different origin), so undo
  // never touches another user's work.
  function undo(): void {
    const manager = undoManagerRef.current;
    if (!manager || !manager.canUndo()) return;
    manager.undo();
  }

  function redo(): void {
    const manager = undoManagerRef.current;
    if (!manager || !manager.canRedo()) return;
    manager.redo();
  }

  // Copies a link to this board. The clipboard write needs a
  // user gesture, so it runs straight from the button click.
  async function shareBoard(): Promise<void> {
    const link = buildBoardLink(window.location.href);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      setImportMessage(
        "Could not copy the board link — copy the address from your browser instead.",
      );
      return;
    }
    setImportMessage(null);
    setShareCopied(true);
    // The button reads "Copied" just long enough to confirm it.
    window.setTimeout(() => setShareCopied(false), 2000);
  }

  // Downloads the board as a PNG image, rendered from the synced
  // board state (see export.ts for why it is drawn, not
  // screenshotted). Async because images must be loaded before
  // they can be drawn.
  async function exportPng(): Promise<void> {
    const canvas = await renderBoardToCanvas(notes, shapes, texts, frames, connectors, images);
    canvas.toBlob((blob) => {
      if (!blob) {
        setImportMessage("Could not make a PNG from this board.");
        return;
      }
      downloadBlob(`syncboard-${boardId}.png`, blob);
      setImportMessage(null);
    }, "image/png");
  }

  // Downloads the whole board — notes, shapes, text boxes,
  // frames, connectors, images, and voice notes — as a JSON
  // file, so it can be saved or moved to another board.
  function exportJson(): void {
    const data: BoardExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      boardId,
      notes,
      shapes,
      texts,
      frames,
      connectors,
      images,
      voiceNotes,
    };
    downloadBlob(
      `syncboard-${boardId}.json`,
      new Blob([boardExportToJson(data)], { type: "application/json" }),
    );
    setImportMessage(null);
  }

  // Reads a picked JSON file and replaces the board with it. The
  // confirm step comes first: replacing wipes the board (one undo
  // brings it all back, and the change syncs to everyone).
  async function importJsonFile(file: File): Promise<void> {
    let json: string;
    try {
      json = await file.text();
    } catch {
      setImportMessage("Could not read that file — nothing was changed.");
      return;
    }
    const parsed = parseBoardExport(json);
    if (!parsed) {
      setImportMessage("That file is not a SyncBoard export — nothing was changed.");
      return;
    }
    if (
      !window.confirm(
        `Replace this board with "${file.name}"? It has ${parsed.notes.length} notes, ` +
          `${parsed.shapes.length} shapes, ${parsed.texts.length} text boxes, ` +
          `${parsed.frames.length} frames, ${parsed.connectors.length} connectors, ` +
          `${parsed.images.length} images, and ${parsed.voiceNotes.length} voice notes. ` +
          `Everything on this board now will be gone — press Ctrl+Z to undo the import.`,
      )
    ) {
      return;
    }
    const doc = docRef.current;
    if (!doc) return;
    applyBoardExport(doc, parsed, localOrigin);
    setSelection(null, null);
    setImportMessage(
      `Imported ${parsed.notes.length} notes, ${parsed.shapes.length} shapes, ` +
        `${parsed.texts.length} text boxes, ${parsed.frames.length} frames, ` +
        `${parsed.connectors.length} connectors, ${parsed.images.length} images, and ` +
        `${parsed.voiceNotes.length} voice notes from "${file.name}".`,
    );
  }

  // Saves a snapshot of the board as it is right now. The state
  // comes from the live document, not the server's saved copy —
  // the server only persists every 2 seconds, so a server-side
  // capture could miss the last few edits. An empty name means
  // "use the date and time".
  async function saveSnapshot(): Promise<void> {
    const doc = docRef.current;
    if (!doc || snapshotsBusy) return;
    const name = snapshotName.trim() === "" ? defaultSnapshotName() : snapshotName.trim();
    const state = exportDocToBoard(doc, boardId);
    setSnapshotsBusy(true);
    try {
      const saved = await createSnapshot(httpSyncUrl(), boardId, name, state);
      setSnapshots((prev) => sortSnapshotsNewestFirst([saved, ...(prev ?? [])]));
      setSnapshotName("");
      setImportMessage(`Saved snapshot "${saved.name}".`);
    } catch (error) {
      setImportMessage(
        error instanceof Error ? error.message : "Could not save snapshot.",
      );
    } finally {
      setSnapshotsBusy(false);
    }
  }

  // Restores a snapshot: the board is replaced with the
  // snapshot's state. Two guards, because this wipes the board:
  // a confirm dialog first, and a safety copy of the current
  // state saved before applying — so the old board is one click
  // away in the list. The restore is one transaction stamped
  // with the local origin, so one undo reverts it and it syncs
  // to everyone. If the safety copy cannot be saved (the board
  // is at its 20-snapshot cap), the restore stops — the user
  // deletes an old snapshot and tries again.
  async function restoreSnapshot(snapshot: BoardSnapshotMeta): Promise<void> {
    const doc = docRef.current;
    if (!doc || snapshotsBusy) return;
    if (
      !window.confirm(
        `Restore snapshot "${snapshot.name}"? It has ${snapshotCountsLabel(snapshot.counts)}. ` +
          `Everything on this board now will be replaced — a safety copy of the current ` +
          `board is saved first, and Ctrl+Z undoes the restore.`,
      )
    ) {
      return;
    }
    setSnapshotsBusy(true);
    try {
      const fetched = await fetchSnapshot(httpSyncUrl(), boardId, snapshot.id);
      const parsed = parseBoardExport(JSON.stringify(fetched.state));
      if (!parsed) {
        setImportMessage(
          `Could not restore "${snapshot.name}" — its saved state is not a SyncBoard export. Nothing was changed.`,
        );
        return;
      }
      const current = exportDocToBoard(doc, boardId);
      let safety: BoardSnapshotMeta;
      try {
        safety = await createSnapshot(
          httpSyncUrl(),
          boardId,
          `Before restore — ${defaultSnapshotName()}`,
          current,
        );
      } catch {
        setImportMessage(
          `Could not save a safety copy — this board already has 20 snapshots. ` +
            `Delete an old snapshot and try again. Nothing was changed.`,
        );
        return;
      }
      applyBoardExport(doc, parsed, localOrigin);
      setSelection(null, null);
      setSnapshots((prev) => sortSnapshotsNewestFirst([safety, ...(prev ?? [])]));
      setImportMessage(
        `Restored snapshot "${snapshot.name}". The board before the restore was saved as "${safety.name}".`,
      );
    } catch (error) {
      setImportMessage(
        error instanceof Error ? error.message : "Could not restore snapshot.",
      );
    } finally {
      setSnapshotsBusy(false);
    }
  }

  // Deletes a snapshot after a confirm step. Deleting a
  // snapshot never touches the board itself.
  async function handleDeleteSnapshot(snapshot: BoardSnapshotMeta): Promise<void> {
    if (snapshotsBusy) return;
    if (!window.confirm(`Delete snapshot "${snapshot.name}"? This cannot be undone.`)) {
      return;
    }
    setSnapshotsBusy(true);
    try {
      await deleteSnapshot(httpSyncUrl(), boardId, snapshot.id);
      setSnapshots((prev) => (prev ?? []).filter((item) => item.id !== snapshot.id));
      setImportMessage(`Deleted snapshot "${snapshot.name}".`);
    } catch (error) {
      setImportMessage(
        error instanceof Error ? error.message : "Could not delete snapshot.",
      );
    } finally {
      setSnapshotsBusy(false);
    }
  }

  // Creates the board from the sidebar form and opens it. The
  // form only closes on success, so a failed create leaves the
  // typed name in place for another try.
  async function submitNewBoard(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const name = newBoardName.trim();
    if (!name) return;
    setCreatingBoard(true);
    try {
      const created = await onCreateBoard(name);
      if (created) {
        setNewBoardName("");
        setShowNewBoardForm(false);
      }
    } finally {
      setCreatingBoard(false);
    }
  }

  // Renames the board whose row is being edited. Enter saves,
  // Escape cancels — the same shape as the new-board form, so a
  // failed rename leaves the typed name in place for another
  // try. Saving the unchanged name just closes the form.
  async function submitRenameBoard(event: React.FormEvent, board: BoardMeta): Promise<void> {
    event.preventDefault();
    const name = renameName.trim();
    if (!name) return;
    if (name === board.name) {
      setRenamingBoardId(null);
      return;
    }
    setRenamingBoard(true);
    try {
      const renamed = await onRenameBoard(board, name);
      if (renamed) {
        setRenamingBoardId(null);
      }
    } finally {
      setRenamingBoard(false);
    }
  }

  // Keyboard shortcuts: Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo,
  // Delete / Backspace deletes the selected note, shape, text
  // box, frame, connector, image, or voice note, Escape returns
  // to the Select tool and cancels a connector in progress.
  // Delete only fires when the user is not typing in a note's
  // textarea.
  // Ctrl+Z is caught even while typing: the textarea is controlled
  // by the shared document, so the browser's native text undo
  // would fight React — the UndoManager is the one that works.
  // While presenting, Escape leaves present mode and the arrow
  // keys step through the slides instead of doing anything else.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const editingText =
        target !== null &&
        (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable);
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (presentIndexRef.current !== null) {
        if (event.key === "Escape") {
          exitPresent();
          return;
        }
        if (!editingText && !mod) {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            goToSlide(stepSlideIndex(presentIndexRef.current, 1, slidesRef.current.length));
            return;
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            goToSlide(stepSlideIndex(presentIndexRef.current, -1, slidesRef.current.length));
            return;
          }
        }
      }
      if (event.key === "Escape") {
        setTool("select");
        setConnectorPendingFromId(null);
        setCommentDraft(null);
        setCommentText("");
        setShortcutsOpen(false);
        cancelRecording();
        return;
      }
      if (!editingText && !mod && event.key === "?") {
        setShortcutsOpen((open) => !open);
        return;
      }
      if (mod && !event.shiftKey && key === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (mod && (key === "y" || (event.shiftKey && key === "z"))) {
        event.preventDefault();
        redo();
        return;
      }
      if (!editingText && (event.key === "Delete" || event.key === "Backspace")) {
        const selectedNote = localPresenceRef.current.selectedNoteIds[0];
        const selectedShape = localPresenceRef.current.selectedShapeIds[0];
        const selectedText = localPresenceRef.current.selectedTextIds[0];
        const selectedFrame = selectedFrameRef.current;
        const selectedConnector = selectedConnectorRef.current;
        const selectedImage = selectedImageRef.current;
        const selectedVoice = selectedVoiceRef.current;
        if (selectedNote) {
          event.preventDefault();
          deleteNote(selectedNote);
        } else if (selectedShape) {
          event.preventDefault();
          deleteShape(selectedShape);
        } else if (selectedText) {
          event.preventDefault();
          deleteTextBox(selectedText);
        } else if (selectedFrame) {
          event.preventDefault();
          deleteFrame(selectedFrame);
        } else if (selectedConnector) {
          event.preventDefault();
          deleteConnector(selectedConnector);
        } else if (selectedImage) {
          event.preventDefault();
          deleteImage(selectedImage);
        } else if (selectedVoice) {
          event.preventDefault();
          deleteVoiceNote(selectedVoice);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // The handlers only touch refs and state setters, so binding
    // once is safe — the selection is read from the presence ref,
    // not from state, so it is never stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps present mode honest when the slides change under it:
  // a deleted current slide moves to the nearest remaining one,
  // and with no frames left present mode ends. The slide list
  // re-sorts when frames move, so the index is re-checked on
  // every change rather than trusted.
  useEffect(() => {
    if (presentIndex === null) return;
    if (slides.length === 0) {
      exitPresent();
      return;
    }
    if (presentIndex >= slides.length) {
      goToSlide(slides.length - 1);
    }
    // goToSlide and exitPresent are plain component functions
    // that only touch refs and state setters — re-running the
    // effect when they change identity would be noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, presentIndex]);

  // Follows the presenter: when someone else is presenting a
  // frame this view is not already on, the camera moves to it.
  // Our own presentation never follows itself — our own state
  // is not in the presence list — and a manual pan is respected
  // until the presenter moves to another slide.
  useEffect(() => {
    if (presentIndex !== null) return;
    const presenter = findPresenter(presence);
    const frameId = presenter?.presentingFrameId ?? null;
    if (frameId === null) {
      followedFrameRef.current = null;
      return;
    }
    if (frameId === followedFrameRef.current) return;
    const frame = slides.find((item) => item.id === frameId);
    if (!frame) return;
    followedFrameRef.current = frameId;
    moveCameraToFrame(frame);
  }, [presence, slides, presentIndex]);

  // The timed-session clock: twice a second, refresh now so
  // the countdown ticks, and end a timed session whose end
  // time has passed. The end is written to the shared document,
  // so every client ends together — and a client that opens the
  // board after the end time ends it on the spot. The reveal
  // itself follows the clock (see visibleVotes), not this write,
  // so the votes show the moment the time runs out even before
  // the write lands.
  useEffect(() => {
    if (!votingSession?.timed || !votingSession.active) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      if (now >= votingSession.endsAt) {
        endVoting();
      }
    }, 500);
    return () => window.clearInterval(timer);
    // endVoting only writes the current session closed. It
    // changes identity every render, and re-running the effect
    // for that would restart the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [votingSession]);

  // Who selected each note, local user included, so the outline
  // and label can show every selector at once.
  const selectorsByNote = new Map<string, PresenceUser[]>();
  function addSelector(noteId: string, person: PresenceUser): void {
    const list = selectorsByNote.get(noteId) ?? [];
    list.push(person);
    selectorsByNote.set(noteId, list);
  }
  if (selectedNoteId) {
    addSelector(selectedNoteId, {
      id: user.id,
      name: user.name,
      color: user.color,
      cursor: null,
      selectedNoteIds: [selectedNoteId],
      selectedShapeIds: [],
      selectedTextIds: [],
    });
  }
  for (const person of presence) {
    for (const noteId of person.selectedNoteIds) addSelector(noteId, person);
  }

  // Who selected each shape, local user included, so the outline
  // and label can show every selector at once — same as notes.
  const selectorsByShape = new Map<string, PresenceUser[]>();
  function addShapeSelector(shapeId: string, person: PresenceUser): void {
    const list = selectorsByShape.get(shapeId) ?? [];
    list.push(person);
    selectorsByShape.set(shapeId, list);
  }
  if (selectedShapeId) {
    addShapeSelector(selectedShapeId, {
      id: user.id,
      name: user.name,
      color: user.color,
      cursor: null,
      selectedNoteIds: [],
      selectedShapeIds: [selectedShapeId],
      selectedTextIds: [],
    });
  }
  for (const person of presence) {
    for (const shapeId of person.selectedShapeIds) addShapeSelector(shapeId, person);
  }

  // Who selected each text box, local user included — same as
  // notes and shapes.
  const selectorsByText = new Map<string, PresenceUser[]>();
  function addTextSelector(textId: string, person: PresenceUser): void {
    const list = selectorsByText.get(textId) ?? [];
    list.push(person);
    selectorsByText.set(textId, list);
  }
  if (selectedTextId) {
    addTextSelector(selectedTextId, {
      id: user.id,
      name: user.name,
      color: user.color,
      cursor: null,
      selectedNoteIds: [],
      selectedShapeIds: [],
      selectedTextIds: [selectedTextId],
    });
  }
  for (const person of presence) {
    for (const textId of person.selectedTextIds) addTextSelector(textId, person);
  }

  // The boxes of every item on the board, by id. A connector's
  // endpoints are resolved through this map, so a connector
  // follows whichever item it points at.
  const boxesById = new Map<string, Box>();
  for (const note of notes) boxesById.set(note.id, note);
  for (const shape of shapes) boxesById.set(shape.id, shape);
  for (const textBox of texts) boxesById.set(textBox.id, textBox);
  for (const frame of frames) boxesById.set(frame.id, frame);

  // The midpoint of the selected connector, where its delete
  // button sits. Null when nothing is selected or an endpoint
  // is gone.
  let selectedConnectorMid: { x: number; y: number } | null = null;
  const selectedConnector = connectors.find((item) => item.id === selectedConnectorId);
  if (selectedConnector) {
    const from = boxesById.get(selectedConnector.fromId);
    const to = boxesById.get(selectedConnector.toId);
    if (from && to) {
      const ends = connectorEndpoints(from, to);
      selectedConnectorMid = { x: (ends.x1 + ends.x2) / 2, y: (ends.y1 + ends.y2) / 2 };
    }
  }

  // The threads newest first, for the comments panel, and how
  // many are still open — the panel title shows the open count.
  const sortedComments = sortCommentsNewestFirst(comments);
  const openCommentCount = comments.filter((comment) => !comment.resolved).length;

  // How many dots this user still has to place in the open
  // session. Zero when no session is open. Only this session's
  // dots count — dots from earlier sessions stay on the items,
  // but they never eat into this session's allocation.
  const myDotsLeft =
    votingSession?.active === true
      ? remainingDots(
          votesInSession(votes, votingSession.session),
          user.id,
          votingSession.dotsPerPerson,
        )
      : 0;

  // Whether a timed session is still running on the clock.
  // Every client computes this from the same end time in the
  // shared document, so hiding and revealing agree everywhere.
  const timedRunning =
    votingSession !== null && isTimedSessionRunning(votingSession, nowMs);

  // The votes this user may see right now. During a running
  // timed session that is only their own dots from this session,
  // plus dots from earlier sessions — everyone else's are
  // hidden, so the badges never leak the room's votes before
  // the reveal.
  const viewableVotes = visibleVotes(votes, votingSession, user.id, nowMs);

  // What the minimap draws: every frame, note, shape, and image,
  // in that order — frames underneath, so the items inside them
  // stay visible. Comments and votes are not shown: they are
  // annotations on items, not items on the board.
  const minimapItems: Array<Box & { id: string; color: NoteColor; kind: string }> = [
    ...frames.map((frame) => ({ ...frame, kind: "frame" })),
    ...notes.map((note) => ({ ...note, kind: "note" })),
    ...shapes.map((shape) => ({ ...shape, kind: "shape" })),
    // Images have no color — the minimap draws them grey, so the
    // color here is a placeholder the image branch never reads.
    ...images.map((image) => ({ ...image, color: "yellow" as NoteColor, kind: "image" })),
    // Voice notes are fixed-size pins: their box is their
    // position plus the pin size, like the frame test reads them.
    ...voiceNotes.map((voiceNote) => ({
      x: voiceNote.x,
      y: voiceNote.y,
      w: VOICE_NOTE_SIZE.w,
      h: VOICE_NOTE_SIZE.h,
      id: voiceNote.id,
      color: "yellow" as NoteColor,
      kind: "voice",
    })),
  ];
  const minimapGeometryValue = minimapGeometry();
  const minimapViewportRect = viewportRect(
    minimapGeometryValue.viewport,
    minimapGeometryValue.bounds,
    minimapGeometryValue.scale,
    MINIMAP_WIDTH,
    MINIMAP_HEIGHT,
  );

  // The dot badge for one item: the total dots on it, from
  // everyone. Nothing when the item has no dots — the badge
  // only appears once a dot lands. It never takes clicks: it
  // sits over the item, and a click passes through to the item
  // underneath. During a running timed session the count uses
  // only the votes this user may see, so nobody else's dots
  // leak through the badge.
  function voteBadge(itemId: string): React.ReactNode {
    const count = countItemVotes(viewableVotes, itemId);
    if (count === 0) return null;
    return (
      <span
        className={voteBadgeClass}
        data-item-id={itemId}
        data-vote-count={count}
        title={`${count} vote${count === 1 ? "" : "s"}`}
        aria-label={`${count} vote${count === 1 ? "" : "s"}`}
      >
        {count}
      </span>
    );
  }

  // The name of the board on screen, for the header. The list
  // may still be loading, so the board id stands in until then.
  const currentBoardName = boards.find((board) => board.id === boardId)?.name ?? boardId;
  // Who is presenting right now, if anyone — the banner and the
  // follow effect both read this, so it is computed once here.
  const presenter = findPresenter(presence);

  return (
    <div className={boardPageClass}>
      <header className="flex flex-wrap items-center gap-x-xs gap-y-2xs px-md py-xs bg-band border-b border-band-border text-band-ink max-phone:px-sm">
        <h1 className="text-lg leading-[1.05] max-phone:text-md">SyncBoard</h1>
        <span className="font-semibold whitespace-nowrap overflow-hidden text-ellipsis max-w-[28ch] max-phone:max-w-[13ch]">{currentBoardName}</span>
        <div className="relative max-phone:min-w-0" ref={whosHereRef}>
          <button
            type="button"
            className="flex items-center gap-xs px-xs py-2xs border-0 rounded-pill bg-transparent text-band-ink cursor-pointer hover:bg-ink-2 max-phone:gap-2xs max-phone:px-2xs max-phone:py-3xs max-phone:overflow-hidden max-phone:min-h-11"
            onClick={() => setWhosHereOpen(!whosHereOpen)}
            aria-expanded={whosHereOpen}
            aria-label={`Who's here — ${presence.length + 1} ${presence.length + 1 === 1 ? "person" : "people"} on this board`}
            title="See who's on this board"
          >
            <span className="text-sm font-semibold text-band-ink tabular-nums whitespace-nowrap max-phone:text-xs">{presence.length + 1} online</span>
            <PresenceChip person={user} you />
            {presence.map((person) => (
              <PresenceChip key={person.id} person={person} />
            ))}
          </button>
          {whosHereOpen && (
            <div className="absolute top-[calc(100%+var(--space-xs))] right-0 z-30 w-[260px] max-h-[320px] overflow-y-auto p-sm border border-rule rounded-card bg-paper text-ink shadow-lift max-phone:w-[min(260px,calc(100vw-32px))]" role="dialog" aria-label="Who's here" ref={whosHerePanelRef}>
              <p className="mb-xs font-semibold">Who's here ({presence.length + 1})</p>
              <ul className="grid gap-xs m-0 p-0 list-none">
                {buildWhosHereRows(user, presence, frames).map((row) => (
                  <WhosHereRow key={row.id} row={row} />
                ))}
              </ul>
            </div>
          )}
        </div>
        {/* The board actions, grouped: Share on its own, then the
            board tools, then export/import. They sit on their
            own row under the title row; on a phone that row
            scrolls sideways instead of wrapping. */}
        <div className="flex flex-wrap items-center gap-xs basis-full order-2 max-phone:flex-nowrap max-phone:overflow-x-auto max-phone:pb-2xs max-phone:[scrollbar-width:none] max-phone:[&::-webkit-scrollbar]:hidden max-phone:[&>*]:flex-none">
        <button
          type="button"
          className={headerPrimaryButtonClass}
          onClick={() => void shareBoard()}
          title="Copy a link to this board"
        >
          {shareCopied ? "Copied" : "Share"}
        </button>
        <span className="w-px h-lg flex-none bg-[color-mix(in_oklab,var(--color-band-ink)_25%,transparent)]" aria-hidden="true" />
        <button
          type="button"
          className={headerButtonClass}
          onClick={() => setTemplatesOpen(!templatesOpen)}
          aria-expanded={templatesOpen}
          aria-label="Templates"
          title="Insert a template of frames and notes"
        >
          Templates
        </button>
        <button
          type="button"
          className={headerButtonClass}
          onClick={() => setSnapshotsOpen(!snapshotsOpen)}
          aria-expanded={snapshotsOpen}
          aria-label="Snapshots"
          title="Save and restore named copies of this board"
        >
          Snapshots
          {snapshots !== null && snapshots.length > 0 ? ` (${snapshots.length})` : ""}
        </button>
        <button
          type="button"
          className={headerButtonClass}
          onClick={presentIndex !== null ? exitPresent : startPresent}
          disabled={presentIndex === null && frames.length === 0}
          aria-label={presentIndex !== null ? "Exit present mode" : "Present"}
          title={
            presentIndex !== null
              ? "Stop presenting"
              : frames.length === 0
                ? "Add a frame to present it"
                : "Present the frames as slides"
          }
        >
          {presentIndex !== null ? "Presenting…" : "Present"}
        </button>
        <button
          type="button"
          className={headerButtonClass}
          onClick={() => setShortcutsOpen(!shortcutsOpen)}
          aria-expanded={shortcutsOpen}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
        >
          ?
        </button>
        <button
          type="button"
          className={headerButtonClass}
          onClick={autoOrganize}
          disabled={organizePlan === null}
          aria-label="Auto-organize"
          title={
            organizePlan === null
              ? "No two free notes share a word to group by"
              : `Group ${organizePlan.noteCount} notes into ${organizePlan.frameCount} frames`
          }
        >
          Auto-organize
        </button>
        <span className="w-px h-lg flex-none bg-[color-mix(in_oklab,var(--color-band-ink)_25%,transparent)]" aria-hidden="true" />
        <div className="flex flex-wrap gap-2xs items-center max-phone:flex-nowrap" role="group" aria-label="Export and import">
          <button
            type="button"
            className={headerButtonClass}
            onClick={() => void exportPng()}
            title="Download the board as a PNG image"
          >
            {ACTION_ICONS.download}
            Export PNG
          </button>
          <button
            type="button"
            className={headerButtonClass}
            onClick={exportJson}
            title="Download the board as a JSON file"
          >
            {ACTION_ICONS.download}
            Export JSON
          </button>
          <button
            type="button"
            className={headerButtonClass}
            onClick={() => importInputRef.current?.click()}
            title="Replace this board with a board from a JSON file"
          >
            {ACTION_ICONS.upload}
            Import JSON
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            aria-label="Import a board JSON file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset so picking the same file again still fires.
              event.target.value = "";
              if (file) void importJsonFile(file);
            }}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            aria-label="Add an image to the board"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset so picking the same file again still fires.
              event.target.value = "";
              if (file) addImageFromPicker(file);
            }}
          />
        </div>
        </div>
        {/* The account cluster: who you are, the connection
            state, and sign out. It sits at the right of the
            title row; the actions row wraps under it. */}
        <div className="flex items-center gap-xs ml-auto max-phone:order-1 max-phone:basis-full max-phone:flex-wrap max-phone:justify-between max-phone:gap-2xs max-phone:ml-0">
        <label className="inline-flex items-center">
          <span className="sr-only">Theme</span>
          <select
            className="min-h-[34px] px-sm py-2xs border [border-color:color-mix(in_oklab,var(--color-band-ink)_35%,transparent)] rounded-input bg-transparent text-band-ink text-sm font-semibold cursor-pointer [&>option]:bg-paper [&>option]:text-ink max-phone:min-h-11 max-phone:px-xs max-phone:text-xs"
            value={theme}
            onChange={(event) => changeTheme(event.target.value as ThemeName)}
            aria-label="Theme"
            title="Choose a theme"
          >
            {THEMES.map((option) => (
              <option key={option.name} value={option.name}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <span className="flex items-center gap-2xs font-semibold whitespace-nowrap max-phone:text-xs">
          <span className="size-sm rounded-full" style={{ background: user.color }} />
          {user.name}
        </span>
        <span className={`px-xs py-2xs rounded-pill text-sm font-semibold whitespace-nowrap max-phone:py-3xs max-phone:text-xs ${statusClasses[status]}`}>
          {status === "connected"
            ? "Connected"
            : status === "connecting"
              ? "Connecting…"
              : "Disconnected"}
        </span>
        {authError && <span className="text-error-light text-sm font-semibold max-phone:basis-full max-phone:text-xs">Sign-in failed: {authError}</span>}
        <button
          type="button"
          className="inline-flex items-center justify-center min-h-[34px] px-sm py-2xs border [border-color:color-mix(in_oklab,var(--color-band-ink)_35%,transparent)] rounded-input bg-transparent text-band-ink text-sm font-semibold whitespace-nowrap cursor-pointer [transition:background-color_var(--dur-short)_var(--ease-out),transform_var(--dur-micro)_var(--ease-out)] hover:bg-[color-mix(in_oklab,var(--color-paper)_12%,transparent)] active:translate-y-px max-phone:min-h-11 max-phone:px-xs max-phone:text-xs"
          onClick={onSignOut}
        >
          Sign out
        </button>
        </div>
      </header>
      {presentIndex !== null && slides.length > 0 && (
        <div className={barClass} role="group" aria-label="Present mode">
          <span className="font-bold text-ink max-phone:min-w-0 max-phone:truncate">
            {slides[Math.min(presentIndex, slides.length - 1)].title}
          </span>
          <span className="font-semibold text-ink-2 tabular-nums max-phone:flex-none">
            Slide {Math.min(presentIndex, slides.length - 1) + 1} of {slides.length}
          </span>
          <button
            type="button"
            className={barButtonClass}
            onClick={() =>
              goToSlide(stepSlideIndex(presentIndex, -1, slides.length))
            }
            disabled={presentIndex === 0}
            aria-label="Previous slide"
          >
            ← Previous
          </button>
          <button
            type="button"
            className={barButtonClass}
            onClick={() =>
              goToSlide(stepSlideIndex(presentIndex, 1, slides.length))
            }
            disabled={presentIndex >= slides.length - 1}
            aria-label="Next slide"
          >
            Next →
          </button>
          <button type="button" className={barButtonClass} onClick={exitPresent} aria-label="Exit present mode">
            Exit
          </button>
        </div>
      )}
      {presentIndex === null && presenter && (
        <p className="m-0 px-md py-2xs border-b border-rule bg-accent-soft text-ink-2 text-sm font-semibold text-center" role="status">
          {presenter.name} is presenting
        </p>
      )}
      {notice && (
        <p className={boardNoticeClass} role="status">
          {notice}{" "}
          <button type="button" className={boardNoticeButtonClass} onClick={onDismissNotice}>
            Dismiss
          </button>
        </p>
      )}
      {importMessage && (
        <p className={boardNoticeClass} role="status">
          {importMessage}{" "}
          <button type="button" className={boardNoticeButtonClass} onClick={() => setImportMessage(null)}>
            Dismiss
          </button>
        </p>
      )}
      {connectorPendingFromId && (
        <p className={boardNoticeClass} role="status">
          Connector started: click another note, shape, text box, or frame to connect to it.{" "}
          <button type="button" className={boardNoticeButtonClass} onClick={() => setConnectorPendingFromId(null)}>
            Cancel
          </button>
        </p>
      )}
      {/* Dot voting: the session controls. Starting a session
          opens voting for everyone on the board; ending it
          freezes the dots in place; clearing removes them all
          (one undo brings them back). A timed session hides
          everyone's dots until the clock runs out, then reveals
          them all at once — only the starter can end it early,
          and clearing is off while it runs so hidden dots are
          never wiped blind. */}
      <div className={barClass} role="group" aria-label="Dot voting">
        {votingSession?.active === true ? (
          timedRunning ? (
            <>
              <span className={votingStatusClass}>
                Timed voting session —{" "}
                <span className="font-bold text-accent tabular-nums">
                  {formatSessionCountdown(remainingSessionMs(votingSession, nowMs))}
                </span>{" "}
                left, started by {votingSession.startedByName}. You have {myDotsLeft} of{" "}
                {votingSession.dotsPerPerson} dots left. Votes stay hidden until the time
                runs out.
              </span>
              {votingSession.startedBy === user.id && (
                <button type="button" className={barButtonClass} onClick={endVoting}>
                  End now
                </button>
              )}
              <button type="button" className={barButtonClass} onClick={clearVotes} disabled>
                Clear votes
              </button>
            </>
          ) : (
            <>
              <span className={votingStatusClass}>
                Voting open, started by {votingSession.startedByName}. You have {myDotsLeft}{" "}
                of {votingSession.dotsPerPerson} dots left.
              </span>
              <button type="button" className={barButtonClass} onClick={endVoting}>
                End voting
              </button>
              <button type="button" className={barButtonClass} onClick={clearVotes} disabled={votes.length === 0}>
                Clear votes
              </button>
            </>
          )
        ) : votingSession ? (
          <>
            <span className={votingStatusClass}>
              {votingSession.timed
                ? `Timed session ended — all votes are now visible. Started by ${votingSession.startedByName}.`
                : `Voting ended. The dots are frozen. Started by ${votingSession.startedByName}.`}
            </span>
            <label className={dotsLabelClass}>
              Dots per person
              <select
                className={dotsSelectClass}
                aria-label="Dots per person"
                value={dotsPerPersonChoice}
                onChange={(event) => setDotsPerPersonChoice(Number(event.target.value))}
              >
                {DOTS_PER_PERSON_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <label className={dotsLabelClass}>
              Session length
              <select
                className={dotsSelectClass}
                aria-label="Timed session length"
                value={timedDurationChoice}
                onChange={(event) => setTimedDurationChoice(Number(event.target.value))}
              >
                {TIMED_SESSION_DURATIONS_MINUTES.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} min
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={barButtonClass} onClick={startVoting}>
              Start new voting
            </button>
            <button type="button" className={barButtonClass} onClick={startTimedSession}>
              Start timed session
            </button>
            <button type="button" className={barButtonClass} onClick={clearVotes} disabled={votes.length === 0}>
              Clear votes
            </button>
          </>
        ) : (
          <>
            <span className={votingStatusClass}>Dot voting</span>
            <label className={dotsLabelClass}>
              Dots per person
              <select
                className={dotsSelectClass}
                aria-label="Dots per person"
                value={dotsPerPersonChoice}
                onChange={(event) => setDotsPerPersonChoice(Number(event.target.value))}
              >
                {DOTS_PER_PERSON_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <label className={dotsLabelClass}>
              Session length
              <select
                className={dotsSelectClass}
                aria-label="Timed session length"
                value={timedDurationChoice}
                onChange={(event) => setTimedDurationChoice(Number(event.target.value))}
              >
                {TIMED_SESSION_DURATIONS_MINUTES.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} min
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={barButtonClass} onClick={startVoting}>
              Start voting
            </button>
            <button type="button" className={barButtonClass} onClick={startTimedSession}>
              Start timed session
            </button>
          </>
        )}
      </div>
      {/* Templates: one click inserts a template's frames and
          notes at the centre of the visible board. The picker
          is a bar under the header, like the voting bar — it
          wraps on a phone instead of squeezing the board. */}
      {templatesOpen && (
        <div className={barClass} role="group" aria-label="Templates">
          <span className="font-semibold text-ink-2">Templates</span>
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="flex flex-col items-start px-sm py-3xs border border-rule rounded-card bg-paper text-ink-2 text-left cursor-pointer hover:bg-accent-soft max-phone:flex-none max-phone:max-w-[220px]"
              onClick={() => insertTemplate(template)}
              title={template.description}
            >
              <span className="font-semibold">{template.name}</span>
              <span className="text-xs text-muted">{template.description}</span>
            </button>
          ))}
          <button
            type="button"
            className="px-sm py-3xs border border-rule rounded-card bg-paper text-ink-2 font-semibold cursor-pointer hover:bg-accent-soft max-phone:flex-none max-phone:min-h-10"
            onClick={() => setTemplatesOpen(false)}
            aria-label="Close templates"
            title="Close templates"
          >
            ×
          </button>
        </div>
      )}
      {/* Keyboard shortcuts: the keys the board actually answers
          to, in a panel under the header like the templates bar.
          The "?" key and the header button toggle it; Escape
          closes it. */}
      {shortcutsOpen && (
        <div className="px-md py-xs border-b border-rule bg-paper-2 text-sm" role="group" aria-label="Keyboard shortcuts">
          <div className="flex items-center justify-between gap-sm">
            <span className="font-semibold text-ink-2">Keyboard shortcuts</span>
            <button
              type="button"
              className="px-sm py-3xs border border-rule rounded-card bg-paper text-ink-2 font-semibold cursor-pointer"
              onClick={() => setShortcutsOpen(false)}
              aria-label="Close keyboard shortcuts"
              title="Close keyboard shortcuts"
            >
              ×
            </button>
          </div>
          <ul className="flex flex-col gap-3xs mt-xs mx-0 mb-0 p-0 list-none">
            {SHORTCUTS.map((shortcut) => (
              <li key={shortcut.keys} className="flex items-baseline gap-sm max-phone:flex-wrap max-phone:gap-x-sm max-phone:gap-y-2xs">
                <kbd className="flex-none min-w-[11rem] px-xs py-3xs border border-rule rounded-input bg-paper text-ink font-outlier text-xs text-center max-phone:min-w-[7.5rem]">{shortcut.keys}</kbd>
                <span className="text-ink-2">{shortcut.action}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={boardMainClass}>
        {/* Phone-only backdrop behind the open panel drawers:
            tapping it closes whichever panels are open. On
            desktop it never shows (the panels sit in the flow),
            so it is display:none there. */}
        {(sidebarOpen || commentsOpen || snapshotsOpen) && (
          <button
            type="button"
            className={panelBackdropClass}
            aria-label="Close open panels"
            onClick={() => {
              setSidebarOpen(false);
              setCommentsOpen(false);
              setSnapshotsOpen(false);
            }}
          />
        )}
        <aside className={sidebarOpen ? boardSidebarClass : boardSidebarCollapsedClass} aria-label="Boards">
          <div className={panelHeadClass}>
            <span className={sidebarOpen ? panelTitleClass : `${panelTitleClass} hidden`}>Boards</span>
            <button
              type="button"
              className={panelToggleClass}
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-expanded={sidebarOpen}
              aria-label={sidebarOpen ? "Collapse boards sidebar" : "Expand boards sidebar"}
              title={sidebarOpen ? "Collapse boards" : "Expand boards"}
            >
              {sidebarOpen ? "‹" : "›"}
            </button>
          </div>
          {sidebarOpen && (
            <>
              <ul className={boardListClass}>
                {boards.map((board) => (
                  <li
                    key={board.id}
                    className={board.id === boardId ? boardTabActiveClass : boardTabClass}
                  >
                    {renamingBoardId === board.id ? (
                      <form
                        className={boardRenameFormClass}
                        onSubmit={(event) => void submitRenameBoard(event, board)}
                      >
                        <input
                          className={boardRenameInputClass}
                          aria-label={`Rename board ${board.name}`}
                          value={renameName}
                          onChange={(event) => setRenameName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setRenamingBoardId(null);
                          }}
                          placeholder="Board name"
                          title="Enter to save, Escape to cancel"
                          autoFocus
                          maxLength={100}
                        />
                        <button
                          type="submit"
                          className={boardRenameSaveClass}
                          disabled={renamingBoard || renameName.trim() === ""}
                        >
                          Save
                        </button>
                        <button type="button" className={boardRenameCancelClass} onClick={() => setRenamingBoardId(null)}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={board.id === boardId ? boardTabButtonActiveClass : boardTabButtonClass}
                          onClick={() => onSwitchBoard(board.id)}
                          aria-current={board.id === boardId ? "true" : undefined}
                          title={board.name}
                        >
                          {board.name}
                        </button>
                        <button
                          type="button"
                          className={board.id === boardId ? boardTabRenameActiveClass : boardTabRenameClass}
                          onClick={() => {
                            setRenamingBoardId(board.id);
                            setRenameName(board.name);
                          }}
                          aria-label={`Rename board ${board.name}`}
                          title={`Rename ${board.name}`}
                        >
                          Rename
                        </button>
                        {canDeleteBoard(board.id) && (
                          <button
                            type="button"
                            className={board.id === boardId ? boardTabDeleteActiveClass : boardTabDeleteClass}
                            onClick={() => void onDeleteBoard(board)}
                            aria-label={`Delete board ${board.name}`}
                            title={`Delete ${board.name}`}
                          >
                            ×
                          </button>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {showNewBoardForm ? (
                <form className={boardNewFormClass} onSubmit={(event) => void submitNewBoard(event)}>
                  <input
                    className={boardNewInputClass}
                    aria-label="New board name"
                    value={newBoardName}
                    onChange={(event) => setNewBoardName(event.target.value)}
                    placeholder="Board name"
                    autoFocus
                    maxLength={100}
                  />
                  <button type="submit" className={boardNewButtonClass} disabled={creatingBoard || newBoardName.trim() === ""}>
                    Create board
                  </button>
                  <button
                    type="button"
                    className={boardNewButtonClass}
                    onClick={() => {
                      setShowNewBoardForm(false);
                      setNewBoardName("");
                    }}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className={boardNewDashedButtonClass}
                  onClick={() => setShowNewBoardForm(true)}
                >
                  + New board
                </button>
              )}
              {boardsError && (
                <p className={boardSidebarErrorClass} role="alert">
                  {boardsError}
                </p>
              )}
            </>
          )}
        </aside>
        <nav className={toolRailClass} aria-label="Board tools" ref={toolRailRef}>
          <span className={railGroupLabelClass}>Add</span>
          <button
            type="button"
            className={railButtonClass}
            data-rail-button
            onClick={createNoteAtCenter}
            aria-label="Add note"
          >
            + <span className="max-phone:hidden">Note</span>
          </button>
          <button
            type="button"
            className={railButtonClass}
            data-rail-button
            onClick={() => imageInputRef.current?.click()}
            aria-label="Add image"
            title="Add an image to the board"
          >
            {ACTION_ICONS.upload}
            <span className="max-phone:hidden">Image</span>
          </button>
          <button
            type="button"
            className={tool === "voice" ? railButtonActiveClass : railButtonClass}
            data-rail-button
            data-tool-active={tool === "voice" ? "true" : undefined}
            onClick={() => setTool(tool === "voice" ? "select" : "voice")}
            aria-pressed={tool === "voice"}
            aria-label="Voice note"
            title="Click empty canvas to drop a voice note and record"
          >
            {TOOL_ICONS.voice}
            <span className="max-phone:hidden">Voice</span>
          </button>
          <span className={railDividerClass} aria-hidden="true" />
          <span className={railGroupLabelClass}>Tools</span>
          <div className={railPickerClass} role="group" aria-label="Drawing tools">
            {TOOLS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tool === item.id ? railButtonActiveClass : railButtonClass}
                data-rail-button
                data-tool-active={tool === item.id ? "true" : undefined}
                onClick={() => setTool(item.id)}
                disabled={item.id === "vote" && votingSession?.active !== true}
                aria-pressed={tool === item.id}
                aria-label={item.label}
                title={
                  item.id === "select"
                    ? "Select and move things (Escape)"
                    : item.id === "note"
                      ? "Click empty canvas to add a note"
                      : item.id === "text"
                        ? "Click empty canvas to add a text box"
                        : item.id === "connector"
                          ? "Click one item, then another, to connect them with an arrow"
                          : item.id === "comment"
                            ? "Click empty canvas to pin a comment"
                            : item.id === "vote"
                              ? votingSession?.active === true
                                ? "Click an item to place a dot on it"
                                : "Start a voting session to place dots"
                              : `Drag on empty canvas to draw a ${item.label.toLowerCase()}`
                }
              >
                {TOOL_ICONS[item.id]}
                <span className="max-phone:hidden">{item.label}</span>
              </button>
            ))}
          </div>
          <span className={railDividerClass} aria-hidden="true" />
          <span className={railGroupLabelClass}>Color</span>
          <div className={colorPickerClass} role="group" aria-label="Note and shape color">
            {(Object.keys(NOTE_COLORS) as NoteColor[]).map((color) => (
              <button
                key={color}
                type="button"
                className={color === pickedColor ? colorDotActiveClass : colorDotClass}
                data-color-dot
                style={{ background: NOTE_COLORS[color] }}
                onClick={() => pickColor(color)}
                aria-label={`${color} note`}
                aria-pressed={color === pickedColor}
              />
            ))}
          </div>
          <span className={railDividerClass} aria-hidden="true" />
          <span className={railGroupLabelClass}>Text</span>
          <div className={railPickerClass} role="group" aria-label="Text size">
            {TEXT_FONT_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                className={pickedFontSize === size ? fontSizeButtonActiveClass : fontSizeButtonClass}
                data-rail-button
                onClick={() => pickFontSize(size)}
                aria-pressed={pickedFontSize === size}
                aria-label={`${size} text`}
                title={`${size[0].toUpperCase()}${size.slice(1)} text (${FONT_SIZE_PX[size]}px)`}
              >
                {size === "small" ? "S" : size === "medium" ? "M" : "L"}
              </button>
            ))}
          </div>
          <span className={railDividerClass} aria-hidden="true" />
          <span className={railGroupLabelClass}>History</span>
          <button
            type="button"
            className={railButtonClass}
            data-rail-button
            onClick={undo}
            disabled={!canUndo}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
          >
            {ACTION_ICONS.undo}
            <span className="max-phone:hidden">Undo</span>
          </button>
          <button
            type="button"
            className={railButtonClass}
            data-rail-button
            onClick={redo}
            disabled={!canRedo}
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
          >
            {ACTION_ICONS.redo}
            <span className="max-phone:hidden">Redo</span>
          </button>
        </nav>
        <div
          className={`${boardClass} ${tool !== "select" ? "cursor-crosshair" : panning ? "cursor-grabbing" : "cursor-grab"}`}
          data-board
          ref={boardRef}
          onPointerMove={(event) => {
            trackCursor(event);
            movePinch(event);
            movePan(event);
            moveDraw(event);
            moveFrameDraw(event);
            moveTextDrag(event);
          }}
          onPointerLeave={clearCursor}
          onPointerDown={(event) => {
            trackBoardPointerDown(event);
            // A pinch is in progress: no other gesture starts,
            // and any drag a child handler just started is
            // cancelled at once.
            if (pinchRef.current) {
              cancelBoardGesture();
              return;
            }
            // A press on empty board (not on a note, shape, or frame).
            if (event.target === event.currentTarget || event.target === canvasRef.current) {
              handleEmptyCanvasPress(event);
            }
          }}
          onPointerUp={(event) => {
            endPinch(event);
            endPan(event);
            endDraw(event);
            endFrameDraw(event);
            endTextDrag(event);
          }}
          onPointerCancel={(event) => {
            endPinch(event);
            endPan(event);
            endDraw(event);
            endFrameDraw(event);
            endTextDrag(event);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={handleBoardDrop}
          onDoubleClick={createNoteAtPoint}
        >
          <div
            className={boardCanvasClass}
            data-board-canvas
            ref={canvasRef}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            {frames.map((frame) => {
              const isConnectorSource = connectorPendingFromId === frame.id;
              const isSelected = selectedFrameId === frame.id;
              const stroke = SHAPE_STROKE_COLORS[frame.color];
              return (
                <div
                  key={frame.id}
                  className={frameClass}
                  data-frame-id={frame.id}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    if (tool === "connector") {
                      event.preventDefault();
                      pickConnectorEndpoint(frame.id);
                      return;
                    }
                    if (tool === "vote") {
                      event.preventDefault();
                      placeVote(frame.id);
                      return;
                    }
                    if (tool !== "select") {
                      // A creation tool pressed on the frame: the
                      // frame is empty board for this purpose, so
                      // the press creates or draws inside it.
                      handleEmptyCanvasPress(event);
                      return;
                    }
                    selectFrame(frame.id);
                    startFrameDrag(event, frame);
                  }}
                  onPointerMove={(event) => {
                    moveFrameDrag(event);
                    // A shape or frame draw started inside this
                    // frame captures the pointer here, so its moves
                    // arrive on the frame, not the board.
                    moveDraw(event);
                    moveFrameDraw(event);
                  }}
                  onPointerUp={(event) => {
                    endFrameDrag(event);
                    endDraw(event);
                    endFrameDraw(event);
                  }}
                  onPointerCancel={(event) => {
                    endFrameDrag(event);
                    endDraw(event);
                    endFrameDraw(event);
                  }}
                  style={{
                    left: frame.x,
                    top: frame.y,
                    width: frame.w,
                    height: frame.h,
                    border: `2px solid ${stroke}`,
                    // A selected frame — or the pending source of a
                    // connector — gets an accent outline.
                    ...(isSelected || isConnectorSource
                      ? { boxShadow: "0 0 0 2px var(--color-accent)" }
                      : undefined),
                  }}
                >
                  {voteBadge(frame.id)}
                  {isSelected && (
                    <>
                      <button
                        type="button"
                        className={itemDeleteClass}
                        onClick={() => deleteFrame(frame.id)}
                        onPointerDown={(event) => event.stopPropagation()}
                        aria-label="Delete frame"
                        title="Delete frame (Delete key)"
                      >
                        ×
                      </button>
                      <div
                        className={itemResizeClass}
                        onPointerDown={(event) => startFrameResize(event, frame)}
                        onPointerMove={moveFrameResize}
                        onPointerUp={endFrameResize}
                        aria-label="Resize frame"
                      />
                    </>
                  )}
                </div>
              );
            })}
            <svg className={connectorSvgClass} aria-hidden="true">
              <defs>
                {(Object.keys(NOTE_COLORS) as NoteColor[]).map((color) => (
                  <marker
                    key={color}
                    id={`connector-arrow-${color}`}
                    markerWidth="8"
                    markerHeight="8"
                    refX="6"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L0,6 L7,3 z" fill={SHAPE_STROKE_COLORS[color]} />
                  </marker>
                ))}
              </defs>
              {connectors.map((connector) => {
                const from = boxesById.get(connector.fromId);
                const to = boxesById.get(connector.toId);
                // An endpoint that is gone (a stale import) draws
                // nothing — a connector never points at nowhere.
                if (!from || !to) return null;
                const ends = connectorEndpoints(from, to);
                const stroke = SHAPE_STROKE_COLORS[connector.color];
                const isSelected = selectedConnectorId === connector.id;
                return (
                  <g key={connector.id}>
                    {/* A wide transparent line, so the thin visible
                        line is easy to click. */}
                    <line
                      className={connectorHitClass}
                      x1={ends.x1}
                      y1={ends.y1}
                      x2={ends.x2}
                      y2={ends.y2}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || tool === "connector" || pinchRef.current) return;
                        selectConnector(connector.id);
                      }}
                    />
                    <line
                      className={connectorLineClass}
                      x1={ends.x1}
                      y1={ends.y1}
                      x2={ends.x2}
                      y2={ends.y2}
                      stroke={stroke}
                      strokeWidth={isSelected ? 4 : 2.5}
                      markerEnd={
                        connector.arrow ? `url(#connector-arrow-${connector.color})` : undefined
                      }
                      onPointerDown={(event) => {
                        if (event.button !== 0 || tool === "connector" || pinchRef.current) return;
                        selectConnector(connector.id);
                      }}
                    />
                  </g>
                );
              })}
            </svg>
            {/* Connector labels sit at each line's midpoint, in
                the canvas layer, so zoom and pan move them with
                the line. Clicking one selects its connector; the
                selected connector's label becomes the input in
                its toolbar below instead. */}
            {connectors.map((connector) => {
              if (!connector.label || selectedConnectorId === connector.id) return null;
              const from = boxesById.get(connector.fromId);
              const to = boxesById.get(connector.toId);
              if (!from || !to) return null;
              const ends = connectorEndpoints(from, to);
              return (
                <button
                  key={connector.id}
                  type="button"
                  className={connectorLabelClass}
                  style={{
                    left: (ends.x1 + ends.x2) / 2,
                    top: (ends.y1 + ends.y2) / 2,
                    borderColor: SHAPE_STROKE_COLORS[connector.color],
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    if (event.button !== 0 || tool === "connector" || pinchRef.current) return;
                    selectConnector(connector.id);
                  }}
                  aria-label={`Connector label: ${connector.label}`}
                  title="Select this connector"
                >
                  {connector.label}
                </button>
              );
            })}
            {selectedConnectorMid && selectedConnector && (
              <div
                className={connectorToolbarClass}
                style={{ left: selectedConnectorMid.x, top: selectedConnectorMid.y }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <input
                  className={connectorLabelInputClass}
                  value={
                    connectorLabelDraft?.id === selectedConnector.id
                      ? connectorLabelDraft.value
                      : selectedConnector.label
                  }
                  onChange={(event) =>
                    setConnectorLabelDraft({ id: selectedConnector.id, value: event.target.value })
                  }
                  onBlur={() => {
                    if (connectorLabelDraft?.id === selectedConnector.id) {
                      renameConnectorLabel(selectedConnector.id, connectorLabelDraft.value);
                      setConnectorLabelDraft(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    } else if (event.key === "Escape") {
                      // Cancel the edit, not the label: the draft
                      // is dropped, so the blur below commits
                      // nothing.
                      setConnectorLabelDraft(null);
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="Label"
                  aria-label="Connector label"
                  maxLength={60}
                  size={Math.max(
                    6,
                    (connectorLabelDraft?.id === selectedConnector.id
                      ? connectorLabelDraft.value
                      : selectedConnector.label
                    ).length + 1,
                  )}
                />
                <button
                  type="button"
                  className={connectorArrowToggleClass}
                  aria-pressed={selectedConnector.arrow}
                  onClick={() =>
                    toggleConnectorArrow(selectedConnector.id, !selectedConnector.arrow)
                  }
                  aria-label={selectedConnector.arrow ? "Hide arrowhead" : "Show arrowhead"}
                  title={selectedConnector.arrow ? "Hide arrowhead" : "Show arrowhead"}
                >
                  →
                </button>
                <button
                  type="button"
                  className={connectorDeleteClass}
                  onClick={() => deleteConnector(selectedConnector.id)}
                  aria-label="Delete connector"
                  title="Delete connector (Delete key)"
                >
                  ×
                </button>
              </div>
            )}
            {shapes.map((shape) => {
              const selectors = selectorsByShape.get(shape.id) ?? [];
              const stroke = SHAPE_STROKE_COLORS[shape.color];
              // The outline for a selected shape: a selector's color,
              // or the accent when it is the pending source of a
              // connector being drawn.
              const isConnectorSource = connectorPendingFromId === shape.id;
              const outline = isConnectorSource
                ? "0 0 0 2px var(--color-accent)"
                : selectors.length > 0
                  ? `0 0 0 2px ${selectors[0].color}`
                  : null;
              // A zero-size box would collapse the SVG, so the
              // rendered box is at least 1px in each direction.
              const boxW = Math.max(1, shape.w);
              const boxH = Math.max(1, shape.h);
              return (
                <div
                  key={shape.id}
                  className={shapeClass}
                  data-shape-id={shape.id}
                  data-shape-kind={shape.kind}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    if (tool === "connector") {
                      event.preventDefault();
                      pickConnectorEndpoint(shape.id);
                      return;
                    }
                    if (tool === "vote") {
                      event.preventDefault();
                      placeVote(shape.id);
                      return;
                    }
                    if (tool !== "select") return;
                    selectShape(shape.id);
                    startShapeDrag(event, shape);
                  }}
                  onPointerMove={moveShapeDrag}
                  onPointerUp={endShapeDrag}
                  style={{
                    left: shape.x,
                    top: shape.y,
                    width: boxW,
                    height: boxH,
                    // A selected shape gets an outline in the first
                    // selector's color, like a selected note.
                    ...(outline ? { boxShadow: outline } : undefined),
                    ...(shape.kind === "rect" || shape.kind === "ellipse"
                      ? {
                          background: NOTE_COLORS[shape.color],
                          border: `2px solid ${stroke}`,
                          borderRadius: shape.kind === "ellipse" ? "50%" : "var(--radius-input)",
                        }
                      : undefined),
                  }}
                >
                  {selectors.length > 0 && (
                    <span
                      className={itemSelectorClass}
                      style={{ background: selectors[0].color }}
                    >
                      {selectors.map((person) => person.name).join(", ")}
                    </span>
                  )}
                  {voteBadge(shape.id)}
                  {shape.kind === "line" && (
                    <svg
                      className={shapeSvgClass}
                      width="100%"
                      height="100%"
                      viewBox={`0 0 ${boxW} ${boxH}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <defs>
                        <marker
                          id={`arrow-${shape.id}`}
                          markerWidth="8"
                          markerHeight="8"
                          refX="6"
                          refY="3"
                          orient="auto"
                        >
                          <path d="M0,0 L0,6 L7,3 z" fill={stroke} />
                        </marker>
                      </defs>
                      <line
                        x1="2"
                        y1="2"
                        x2={boxW - 2}
                        y2={boxH - 2}
                        stroke={stroke}
                        strokeWidth="3"
                        markerEnd={`url(#arrow-${shape.id})`}
                      />
                    </svg>
                  )}
                  {shape.kind === "pen" && (
                    <svg
                      className={shapeSvgClass}
                      width="100%"
                      height="100%"
                      viewBox={`0 0 ${boxW} ${boxH}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <path
                        d={penPathFromPoints(shape.points, shape.x, shape.y)}
                        stroke={stroke}
                        strokeWidth="3"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {(shape.kind === "diamond" ||
                    shape.kind === "triangle" ||
                    shape.kind === "star") && (
                    <svg
                      className={shapeSvgClass}
                      width="100%"
                      height="100%"
                      viewBox={`0 0 ${boxW} ${boxH}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <polygon
                        points={shapePolygonPoints(shape.kind, boxW, boxH)
                          .map((point) => `${point.x},${point.y}`)
                          .join(" ")}
                        fill={NOTE_COLORS[shape.color]}
                        stroke={stroke}
                        strokeWidth="2"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {selectedShapeId === shape.id && (
                    <>
                      <button
                        type="button"
                        className={itemDeleteClass}
                        onClick={() => deleteShape(shape.id)}
                        onPointerDown={(event) => event.stopPropagation()}
                        aria-label="Delete shape"
                        title="Delete shape (Delete key)"
                      >
                        ×
                      </button>
                      {shape.kind !== "pen" && (
                        <div
                          className={itemResizeClass}
                          onPointerDown={(event) => startShapeResize(event, shape)}
                          onPointerMove={moveShapeResize}
                          onPointerUp={endShapeResize}
                          aria-label="Resize shape"
                        />
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {images.map((image) => {
              const isSelected = selectedImageId === image.id;
              return (
                <div
                  key={image.id}
                  className={imageItemClass}
                  data-image-id={image.id}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    // Images are neither connector endpoints nor
                    // vote targets, so those tools do nothing
                    // here. A creation tool does nothing either —
                    // the press never reaches the board, so no
                    // note or shape is created under the image.
                    if (tool !== "select") return;
                    selectImage(image.id);
                    startImageDrag(event, image);
                  }}
                  onPointerMove={moveImageDrag}
                  onPointerUp={endImageDrag}
                  style={{
                    left: image.x,
                    top: image.y,
                    width: image.w,
                    height: image.h,
                    // A selected image gets an accent outline,
                    // like a selected shape.
                    ...(isSelected
                      ? { boxShadow: "0 0 0 2px var(--color-accent)" }
                      : undefined),
                  }}
                >
                  <img className={imageItemImgClass} src={image.dataUrl} alt="Uploaded image" draggable={false} />
                  {isSelected && (
                    <>
                      <button
                        type="button"
                        className={itemDeleteClass}
                        onClick={() => deleteImage(image.id)}
                        onPointerDown={(event) => event.stopPropagation()}
                        aria-label="Delete image"
                        title="Delete image (Delete key)"
                      >
                        ×
                      </button>
                      <div
                        className={itemResizeClass}
                        onPointerDown={(event) => startImageResize(event, image)}
                        onPointerMove={moveImageResize}
                        onPointerUp={endImageResize}
                        aria-label="Resize image"
                      />
                    </>
                  )}
                </div>
              );
            })}
            {voiceNotes.map((note) => {
              const isSelected = selectedVoiceId === note.id;
              const isPlaying = playingVoiceId === note.id;
              return (
                <div
                  key={note.id}
                  className={voiceNoteClass}
                  data-voice-id={note.id}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    // Voice notes are neither connector endpoints
                    // nor vote targets, so those tools do nothing
                    // here. A creation tool does nothing either —
                    // the press never reaches the board, so no
                    // note or shape is created under the pin.
                    if (tool !== "select") return;
                    selectVoiceNote(note.id);
                    startVoiceDrag(event, note);
                  }}
                  onPointerMove={moveVoiceDrag}
                  onPointerUp={endVoiceDrag}
                  style={{
                    left: note.x,
                    top: note.y,
                    // A selected voice note gets an accent outline,
                    // like a selected image.
                    ...(isSelected
                      ? { boxShadow: "0 0 0 2px var(--color-accent)" }
                      : undefined),
                  }}
                >
                  <audio
                    ref={(element) => {
                      if (element) audioRefs.current.set(note.id, element);
                      else audioRefs.current.delete(note.id);
                    }}
                    src={note.dataUrl}
                    preload="none"
                    onPlay={() => setPlayingVoiceId(note.id)}
                    onPause={() =>
                      setPlayingVoiceId((current) => (current === note.id ? null : current))
                    }
                    onEnded={() =>
                      setPlayingVoiceId((current) => (current === note.id ? null : current))
                    }
                  />
                  <button
                    type="button"
                    className={voicePlayClass}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleVoicePlayback(note);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    aria-label={isPlaying ? "Pause voice note" : "Play voice note"}
                    title={
                      isPlaying ? "Pause" : `Play voice note (${formatDuration(note.durationSeconds)})`
                    }
                  >
                    {isPlaying ? "⏸" : "▶"}
                  </button>
                  <span className={voiceDurationClass} aria-label={`${formatDuration(note.durationSeconds)} long`}>
                    {formatDuration(note.durationSeconds)}
                  </span>
                  {isSelected && (
                    <button
                      type="button"
                      className={itemDeleteClass}
                      onClick={() => deleteVoiceNote(note.id)}
                      onPointerDown={(event) => event.stopPropagation()}
                      aria-label="Delete voice note"
                      title="Delete voice note (Delete key)"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            {recordingDraft && (
              <div
                className={voiceNoteRecordingClass}
                role="status"
                aria-label="Recording voice note"
                style={{ left: recordingDraft.x, top: recordingDraft.y }}
              >
                <span className={voiceRecDotClass} aria-hidden="true" />
                <span className={voiceDurationClass}>{formatDuration(recordingElapsed)}</span>
                <button
                  type="button"
                  className={voiceStopClass}
                  onClick={stopRecording}
                  aria-label="Stop recording"
                  title="Stop recording and save the note"
                >
                  Stop
                </button>
                <button
                  type="button"
                  className={itemDeleteClass}
                  onClick={cancelRecording}
                  onPointerDown={(event) => event.stopPropagation()}
                  aria-label="Cancel recording"
                  title="Cancel recording"
                >
                  ×
                </button>
              </div>
            )}
            {notes.map((note) => {
            const selectors = selectorsByNote.get(note.id) ?? [];
            // The outline for a selected note: a selector's color,
            // or the accent when it is the pending source of a
            // connector being drawn.
            const isConnectorSource = connectorPendingFromId === note.id;
            const outline = isConnectorSource
              ? "0 0 0 2px var(--color-accent)"
              : selectors.length > 0
                ? `0 0 0 2px ${selectors[0].color}`
                : null;
            return (
              <div
                key={note.id}
                className={noteClass}
                data-note-id={note.id}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  if (tool === "connector") {
                    // Picking an endpoint, not editing: keep the
                    // press from focusing the textarea.
                    event.preventDefault();
                    pickConnectorEndpoint(note.id);
                    return;
                  }
                  if (tool === "vote") {
                    event.preventDefault();
                    placeVote(note.id);
                    return;
                  }
                  selectNote(note.id);
                }}
                style={{
                  left: note.x,
                  top: note.y,
                  width: note.w,
                  height: note.h,
                  background: NOTE_COLORS[note.color],
                  // A selected note gets an outline in the first
                  // selector's color, on top of the usual shadow.
                  ...(outline
                    ? {
                        boxShadow: `${outline}, var(--shadow-card)`,
                      }
                    : undefined),
                }}
              >
                {selectors.length > 0 && (
                  <span
                    className={itemSelectorClass}
                    style={{ background: selectors[0].color }}
                  >
                    {selectors.map((person) => person.name).join(", ")}
                  </span>
                )}
                {voteBadge(note.id)}
                <div
                  className={noteHandleClass}
                  onPointerDown={(event) => startDrag(event, note)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                />
                <textarea
                  className={noteTextClass}
                  value={note.text}
                  onChange={(event) => changeNoteText(note.id, event.target.value)}
                  onBlur={() => undoManagerRef.current?.stopCapturing()}
                  placeholder="New note"
                  aria-label="Note text"
                />
                {selectedNoteId === note.id && (
                  <>
                    <button
                      type="button"
                      className={itemDeleteClass}
                      onClick={() => deleteNote(note.id)}
                      aria-label="Delete note"
                      title="Delete note (Delete key)"
                    >
                      ×
                    </button>
                    <div
                      className={itemResizeClass}
                      onPointerDown={(event) => startResize(event, note)}
                      onPointerMove={moveResize}
                      onPointerUp={endResize}
                      aria-label="Resize note"
                    />
                  </>
                )}
              </div>
            );
          })}
          {texts.map((textBox) => {
            const selectors = selectorsByText.get(textBox.id) ?? [];
            // The outline for a selected text box: a selector's
            // color, or the accent when it is the pending source
            // of a connector being drawn.
            const isConnectorSource = connectorPendingFromId === textBox.id;
            const outline = isConnectorSource
              ? "0 0 0 2px var(--color-accent)"
              : selectors.length > 0
                ? `0 0 0 2px ${selectors[0].color}`
                : null;
            return (
              <div
                key={textBox.id}
                className={textBoxClass}
                data-text-id={textBox.id}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  if (tool === "connector") {
                    // Picking an endpoint, not editing: keep the
                    // press from focusing the textarea.
                    event.preventDefault();
                    pickConnectorEndpoint(textBox.id);
                    return;
                  }
                  if (tool === "vote") {
                    event.preventDefault();
                    placeVote(textBox.id);
                    return;
                  }
                  selectTextBox(textBox.id);
                }}
                style={{
                  left: textBox.x,
                  top: textBox.y,
                  width: textBox.w,
                  height: textBox.h,
                  color: TEXT_COLORS[textBox.color],
                  fontSize: FONT_SIZE_PX[textBox.fontSize],
                  // A selected text box gets an outline in the
                  // first selector's color, like a selected note.
                  ...(outline ? { boxShadow: outline } : undefined),
                }}
              >
                {selectors.length > 0 && (
                  <span
                    className={itemSelectorClass}
                    style={{ background: selectors[0].color }}
                  >
                    {selectors.map((person) => person.name).join(", ")}
                  </span>
                )}
                {voteBadge(textBox.id)}
                <div
                  className={textHandleClass}
                  onPointerDown={(event) => startTextDrag(event, textBox)}
                  onPointerMove={moveTextDrag}
                  onPointerUp={endTextDrag}
                />
                <textarea
                  className={textBoxTextClass}
                  value={textBox.text}
                  onChange={(event) => changeTextBoxText(textBox.id, event.target.value)}
                  onBlur={() => undoManagerRef.current?.stopCapturing()}
                  placeholder="Type something"
                  aria-label="Text box text"
                />
                {selectedTextId === textBox.id && (
                  <>
                    <button
                      type="button"
                      className={itemDeleteClass}
                      onClick={() => deleteTextBox(textBox.id)}
                      aria-label="Delete text box"
                      title="Delete text box (Delete key)"
                    >
                      ×
                    </button>
                    <div
                      className={itemResizeClass}
                      onPointerDown={(event) => startTextResize(event, textBox)}
                      onPointerMove={moveTextResize}
                      onPointerUp={endTextResize}
                      aria-label="Resize text box"
                    />
                  </>
                )}
              </div>
            );
          })}
          {/* Frame titles live in their own layer above the items, so
              a note placed over a frame's top-left corner never hides
              its name. Each title sits at its frame's top-left, inset
              by FRAME_TITLE_INSET, and never runs past the frame's far
              edge. The title is still an input — click it to rename. */}
          {frames.map((frame) => {
            // The title on screen: the draft while the user is
            // typing, the shared title otherwise.
            const titleShown =
              frameTitleDraft?.id === frame.id ? frameTitleDraft.value : frame.title;
            return (
              <input
                key={frame.id}
                className={frameTitleClass}
                value={titleShown}
                style={{
                  left: frame.x + FRAME_TITLE_INSET,
                  top: frame.y + FRAME_TITLE_INSET,
                  maxWidth: Math.max(60, frame.w - 2 * FRAME_TITLE_INSET),
                  background: NOTE_COLORS[frame.color],
                }}
                onChange={(event) =>
                  setFrameTitleDraft({ id: frame.id, value: event.target.value })
                }
                onBlur={() => {
                  if (frameTitleDraft?.id === frame.id) {
                    renameFrame(frame.id, frameTitleDraft.value);
                    setFrameTitleDraft(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    // Cancel the edit, not the title: the draft
                    // is dropped, so the blur below commits
                    // nothing.
                    setFrameTitleDraft(null);
                    event.currentTarget.blur();
                  }
                }}
                onFocus={() => selectFrame(frame.id)}
                onPointerDown={(event) => event.stopPropagation()}
                aria-label="Frame title"
                maxLength={60}
                size={Math.max(4, titleShown.length + 1)}
              />
            );
          })}
          {/* Comment pins live in the canvas layer, so zoom and
              pan move them with everything else. Resolved
              threads show no pin — they live in the panel only.
              The draft pin is the one waiting for its text. */}
          {comments
            .filter((comment) => !comment.resolved)
            .map((comment) => (
              <button
                key={comment.id}
                type="button"
                className={selectedCommentId === comment.id ? commentPinSelectedClass : commentPinClass}
                style={{ left: comment.x, top: comment.y }}
                onClick={() => {
                  setSelectedCommentId(comment.id);
                  setCommentsOpen(true);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                aria-label={`Comment by ${comment.author}: ${comment.text}`}
                title={`${comment.author}: ${comment.text}`}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 3.5 h10 v7 H8.5 L5.5 13.5 v-3 H3 Z" />
                </svg>
              </button>
            ))}
          {commentDraft && (
            <span
              className={commentPinDraftClass}
              style={{ left: commentDraft.x, top: commentDraft.y }}
              aria-hidden="true"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 3.5 h10 v7 H8.5 L5.5 13.5 v-3 H3 Z" />
              </svg>
            </span>
          )}
          </div>
          {/* The empty state sits on the viewport, not the canvas
              layer, so it stays centred no matter where the board
              is panned or how far it is zoomed. */}
          {notes.length === 0 && shapes.length === 0 && texts.length === 0 && images.length === 0 && frames.length === 0 && (
            <div className={boardEmptyClass}>
              {status === "connected" ? (
                <>
                  <p className={boardEmptyTitleClass}>This board is empty.</p>
                  <p className={boardEmptyLineClass}>
                    Add a note, draw a shape, or write some text to start.
                  </p>
                </>
              ) : status === "disconnected" ? (
                <>
                  <p className={boardEmptyTitleClass}>Can&rsquo;t reach the board.</p>
                  <p className={boardEmptyLineClass}>
                    Check your connection. The board will load when it reconnects.
                  </p>
                </>
              ) : (
                <p className={boardEmptyLineClass}>Loading notes…</p>
              )}
            </div>
          )}
          {presence.map((person) =>
            person.cursor ? (
              <div
                key={person.id}
                className={remoteCursorClass}
                // Screen space, not board space: the cursor keeps a
                // constant size and lands on the same note in this
                // tab no matter what zoom or pan this tab is using.
                style={{
                  left: pan.x + zoom * person.cursor.x,
                  top: pan.y + zoom * person.cursor.y,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M3 2 L3 19 L7.5 14.5 L10.5 21 L13 20 L10 13.5 L16 13.5 Z"
                    fill={person.color}
                    stroke="#fff"
                    strokeWidth="1"
                  />
                </svg>
                <span
                  className={remoteCursorNameClass}
                  style={{ background: person.color }}
                >
                  {person.name}
                </span>
              </div>
            ) : null,
          )}
          {/* The minimap and zoom sit on the board itself,
              bottom-right. The minimap is read-only: it draws
              the board's frames, notes, and shapes as small
              rectangles, with the viewport on top. Click or
              drag on it to pan the canvas. */}
          <div className={boardCornerClass}>
            <div
              className={minimapClass}
              ref={minimapRef}
              aria-label="Minimap — click or drag to pan the board"
              title="Minimap — click or drag to pan"
              onPointerDown={startMinimapDrag}
              onPointerMove={moveMinimapDrag}
              onPointerUp={endMinimapDrag}
              onPointerCancel={endMinimapDrag}
            >
              {minimapItems.map((item) => {
                const rect = itemRect(
                  item,
                  minimapGeometryValue.bounds,
                  minimapGeometryValue.scale,
                  MINIMAP_WIDTH,
                  MINIMAP_HEIGHT,
                );
                return (
                  <span
                    key={item.id}
                    className={`absolute box-border${item.kind === "frame" ? " bg-transparent" : ""}`}
                    style={{
                      left: rect.x,
                      top: rect.y,
                      width: rect.w,
                      height: rect.h,
                      ...(item.kind === "frame"
                        ? { border: `1px solid ${SHAPE_STROKE_COLORS[item.color]}` }
                        : item.kind === "note"
                          ? { background: NOTE_COLORS[item.color] }
                          : item.kind === "image"
                            ? { background: "var(--color-muted)" }
                            : { background: SHAPE_STROKE_COLORS[item.color] }),
                    }}
                  />
                );
              })}
              <span
                className="absolute box-border border-2 border-accent rounded-[2px] bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] pointer-events-none"
                style={{
                  left: minimapViewportRect.x,
                  top: minimapViewportRect.y,
                  width: minimapViewportRect.w,
                  height: minimapViewportRect.h,
                }}
              />
            </div>
            <div className={zoomControlsClass} role="group" aria-label="Zoom">
            <button
              type="button"
              className={zoomButtonClass}
              data-zoom-button
              onClick={() => zoomBy(1 / ZOOM_STEP)}
              aria-label="Zoom out"
              title="Zoom out"
            >
              −
            </button>
            <span className={zoomLabelClass} data-zoom-label aria-live="polite">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              className={zoomButtonClass}
              data-zoom-button
              onClick={() => zoomBy(ZOOM_STEP)}
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className={resetButtonClass}
              onClick={resetView}
              disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
              title="Reset view to 100%"
            >
              Reset
            </button>
            </div>
          </div>
        </div>
        <aside
          className={commentsOpen ? commentsPanelClass : commentsPanelCollapsedClass}
          aria-label="Comments"
          ref={commentsPanelRef}
        >
          <div className={commentsOpen ? panelHeadRuledClass : panelHeadClass}>
            <span className={commentsOpen ? panelTitleClass : `${panelTitleClass} hidden`}>
              Comments{openCommentCount > 0 ? ` (${openCommentCount})` : ""}
            </span>
            <button
              type="button"
              className={panelToggleClass}
              onClick={() => setCommentsOpen(!commentsOpen)}
              aria-expanded={commentsOpen}
              aria-label={commentsOpen ? "Collapse comments panel" : "Expand comments panel"}
              title={commentsOpen ? "Collapse comments" : "Expand comments"}
            >
              {commentsOpen ? "›" : "‹"}
            </button>
          </div>
          {commentsOpen && (
            <>
              {commentDraft && (
                <form
                  className={panelComposerClass}
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitComment();
                  }}
                >
                  <label className={panelComposerLabelClass} htmlFor="comment-text">
                    New comment
                  </label>
                  <textarea
                    className={commentTextareaClass}
                    id="comment-text"
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                    placeholder="Write a comment…"
                    aria-label="Comment text"
                    autoFocus
                    rows={3}
                    maxLength={500}
                  />
                  <div className={panelActionsClass}>
                    <button type="submit" className={panelPillButtonClass} disabled={commentText.trim() === ""}>
                      Add comment
                    </button>
                    <button
                      type="button"
                      className={panelPillButtonClass}
                      onClick={() => {
                        setCommentDraft(null);
                        setCommentText("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {sortedComments.length === 0 ? (
                <p className={panelEmptyClass}>
                  No comments yet. Pick the Comment tool and click the board to pin one.
                </p>
              ) : (
                <ul className={panelListClass}>
                  {sortedComments.map((comment) => (
                    <li
                      key={comment.id}
                      data-comment-id={comment.id}
                      className={
                        (selectedCommentId === comment.id ? commentThreadSelectedClass : commentThreadClass) +
                        (comment.resolved ? " opacity-65" : "")
                      }
                      onClick={() => setSelectedCommentId(comment.id)}
                    >
                      <div className={commentThreadHeadClass}>
                        <span className="font-semibold">{comment.author}</span>
                        <span className={panelTimeClass}>
                          {formatCommentTime(comment.createdAt)}
                        </span>
                      </div>
                      <p className={commentTextClass}>{comment.text}</p>
                      <div className={panelActionsClass}>
                        <button
                          type="button"
                          className={panelPillButtonClass}
                          onClick={(event) => {
                            event.stopPropagation();
                            resolveComment(comment.id, !comment.resolved);
                          }}
                        >
                          {comment.resolved ? "Reopen" : "Resolve"}
                        </button>
                        <button
                          type="button"
                          className={panelPillButtonClass}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteComment(comment.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </aside>
        <aside
          className={snapshotsOpen ? snapshotsPanelClass : snapshotsPanelCollapsedClass}
          aria-label="Snapshots"
          ref={snapshotsPanelRef}
        >
          <div className={snapshotsOpen ? panelHeadRuledClass : panelHeadClass}>
            <span className={snapshotsOpen ? panelTitleClass : `${panelTitleClass} hidden`}>
              Snapshots
              {snapshots !== null && snapshots.length > 0 ? ` (${snapshots.length})` : ""}
            </span>
            <button
              type="button"
              className={panelToggleClass}
              onClick={() => setSnapshotsOpen(!snapshotsOpen)}
              aria-expanded={snapshotsOpen}
              aria-label={snapshotsOpen ? "Collapse snapshots panel" : "Expand snapshots panel"}
              title={snapshotsOpen ? "Collapse snapshots" : "Expand snapshots"}
            >
              {snapshotsOpen ? "›" : "‹"}
            </button>
          </div>
          {snapshotsOpen && (
            <>
              <form
                className={panelComposerClass}
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveSnapshot();
                }}
              >
                <label className={panelComposerLabelClass} htmlFor="snapshot-name">
                  Save a snapshot of this board
                </label>
                <input
                  className={snapshotNameInputClass}
                  id="snapshot-name"
                  value={snapshotName}
                  onChange={(event) => setSnapshotName(event.target.value)}
                  placeholder={defaultSnapshotName()}
                  aria-label="Snapshot name"
                  maxLength={80}
                />
                <div className={panelActionsClass}>
                  <button type="submit" className={panelPillButtonClass} disabled={snapshotsBusy}>
                    Save snapshot
                  </button>
                </div>
              </form>
              {snapshots === null ? (
                <p className={panelEmptyClass}>Loading snapshots…</p>
              ) : snapshots.length === 0 ? (
                <p className={panelEmptyClass}>
                  No snapshots yet. Save one to keep a copy of this board you can come back to.
                </p>
              ) : (
                <ul className={panelListClass}>
                  {snapshots.map((snapshot) => (
                    <li key={snapshot.id} className={snapshotRowClass}>
                      <div className={snapshotRowHeadClass}>
                        <span className={snapshotNameClass}>{snapshot.name}</span>
                        <span className={panelTimeClass}>
                          {formatSnapshotTime(snapshot.createdAt)}
                        </span>
                      </div>
                      <p className={snapshotCountsClass}>{snapshotCountsLabel(snapshot.counts)}</p>
                      <div className={panelActionsClass}>
                        <button
                          type="button"
                          className={panelPillButtonClass}
                          disabled={snapshotsBusy}
                          onClick={() => void restoreSnapshot(snapshot)}
                          title="Replace this board with this snapshot — a safety copy is saved first"
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          className={panelPillButtonClass}
                          disabled={snapshotsBusy}
                          onClick={() => void handleDeleteSnapshot(snapshot)}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </aside>
        </div>
    </div>
  );
}

// One row of the who's-here list: the avatar, the name, and what
// the person is doing, when that is known. The activity line is
// empty for the local user and for anyone whose pointer is off
// the board — the row still shows them, just without a claim.
function WhosHereRow({ row }: { row: WhosHereRowData }) {
  return (
    <li className="flex items-center gap-sm">
      <span className="relative inline-flex items-center justify-center size-lg rounded-full text-band-ink text-xs font-bold" style={{ background: row.color }}>
        {row.name[0]}
        <span className="absolute -right-[2px] -bottom-[2px] size-xs border-2 border-paper rounded-full bg-accent" />
      </span>
      <span className="grid min-w-0">
        <span className="overflow-hidden text-sm font-semibold text-ellipsis whitespace-nowrap">
          {row.name}
          {row.you ? " (you)" : ""}
        </span>
        {row.activity !== null && (
          <span className="text-sm text-muted whitespace-nowrap">{row.activity}</span>
        )}
      </span>
    </li>
  );
}

// One person in the header presence group: an avatar circle
// with their initial, their name, and a green dot while they
// are online. The name is hidden in the header — only the
// avatar shows there.
function PresenceChip({
  person,
  you = false,
}: {
  person: Pick<PresenceUser, "id" | "name" | "color">;
  you?: boolean;
}) {
  return (
    <span className="flex items-center gap-2xs">
      <span className="relative inline-flex items-center justify-center size-lg rounded-full text-band-ink text-xs font-bold" style={{ background: person.color }}>
        {person.name[0]}
        <span className="absolute -right-[2px] -bottom-[2px] size-xs border-2 border-paper rounded-full bg-accent" />
      </span>
      <span className="hidden">
        {person.name}
        {you ? " (you)" : ""}
      </span>
    </span>
  );
}
