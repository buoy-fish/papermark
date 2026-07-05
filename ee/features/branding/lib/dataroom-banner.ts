// STUB (buoy fork): withheld Papermark EE module. Must return the real shape —
// callers do `classifyDataroomBanner(src).kind` (dataroom viewer nav, banner
// media component), so the old `null` no-op crashed at runtime. Minimal
// faithful classifier; image banners fully work, video/YouTube are detected
// by URL shape. See FORK.md.

export type DataroomBannerKind = "none" | "image" | "video" | "youtube";

export const classifyDataroomBanner = (
  src?: string | null,
): { kind: DataroomBannerKind; src: string | null; youtubeId?: string | null } => {
  if (!src) return { kind: "none", src: null };
  const yt = src.match(/(?:youtube\.com\/watch\?\S*v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return { kind: "youtube", src, youtubeId: yt[1] };
  if (/\.(mp4|webm|mov)(\?|$)/i.test(src)) return { kind: "video", src };
  return { kind: "image", src };
};
