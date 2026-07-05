// STUB (buoy fork): withheld Papermark EE module. Unlike the component stubs
// this one must carry REAL runtime values — pages/branding.tsx imports these
// consts/functions and crashed with "(0, j.WO) is not a function" when the
// stub exported types only (ignoreBuildErrors hides the mismatch at build
// time). Minimal faithful implementation; dataroom layout presets stay inert.
// See FORK.md.

import { z } from "zod";

export const DataroomCardLayoutSchema = z.enum(["LIST", "COMPACT", "GRID"]);
export type DataroomCardLayout = z.infer<typeof DataroomCardLayoutSchema>;

export const DataroomViewerHeaderStyleSchema = z.enum([
  "DEFAULT",
  "SPLIT",
  "NOTION",
]);
export type DataroomViewerHeaderStyle = z.infer<
  typeof DataroomViewerHeaderStyleSchema
>;

export const DataroomViewerLayoutPresetSchema = z.enum([
  "STANDARD",
  "STRICT",
  "MODERN",
  "NOTION",
]);
export type DataroomViewerLayoutPreset = z.infer<
  typeof DataroomViewerLayoutPresetSchema
>;

export type DataroomLayoutCardId = DataroomViewerLayoutPreset;

export const CARD_LAYOUT_OPTIONS: {
  value: DataroomCardLayout;
  label: string;
}[] = [
  { value: "LIST", label: "List" },
  { value: "COMPACT", label: "Compact" },
  { value: "GRID", label: "Grid" },
];

export const asDataroomCardLayout = (value: unknown): DataroomCardLayout =>
  value === "COMPACT" || value === "GRID" ? value : "LIST";

export const asDataroomViewerHeaderStyle = (
  value: unknown,
): DataroomViewerHeaderStyle =>
  value === "SPLIT" || value === "NOTION" ? value : "DEFAULT";

/** Reverse-maps the current layout knobs onto a preset card, if they match one. */
export const inferDataroomViewerLayoutPreset = ({
  cardLayout,
  showFolderTree,
  hideFolderIconsInMain,
  viewerHeaderStyle,
}: {
  cardLayout: DataroomCardLayout;
  showFolderTree: boolean;
  hideFolderIconsInMain: boolean;
  viewerHeaderStyle: DataroomViewerHeaderStyle;
}): DataroomLayoutCardId | null => {
  if (
    cardLayout === "LIST" &&
    showFolderTree &&
    viewerHeaderStyle === "DEFAULT" &&
    !hideFolderIconsInMain
  )
    return "STANDARD";
  if (
    cardLayout === "COMPACT" &&
    !showFolderTree &&
    viewerHeaderStyle === "DEFAULT" &&
    hideFolderIconsInMain
  )
    return "STRICT";
  if (
    cardLayout === "COMPACT" &&
    !showFolderTree &&
    viewerHeaderStyle === "SPLIT" &&
    hideFolderIconsInMain
  )
    return "MODERN";
  if (
    cardLayout === "GRID" &&
    !showFolderTree &&
    viewerHeaderStyle === "NOTION" &&
    !hideFolderIconsInMain
  )
    return "NOTION";
  return null;
};
