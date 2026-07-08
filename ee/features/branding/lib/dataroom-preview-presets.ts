// STUB (buoy fork): withheld Papermark EE module. The paid dataroom-preview
// feature is disabled, but the branding preview page (room_ppreview_demo)
// value-consumes `.folders` and `.documents` and *iterates* them during SSR, so
// the shape must be iterable — returning `{}` made `previewDataset.folders`
// undefined → `TypeError: z is not iterable` → 500 on the Dataroom View preview.
// Return an empty-but-iterable dataset: the preview renders branded chrome with
// an empty content area instead of crashing. See FORK.md.
export const getDataroomPreviewDataset = (..._args: any[]): any => ({
  folders: [],
  documents: [],
});
