/** Pure rules for lean lesson videos (routes/lean-videos.ts). */

/** Big enough for a few minutes of screen recording at 1080p. */
export const LEAN_VIDEO_MAX_BYTES = 250 * 1024 * 1024;
export const LEAN_VIDEO_MIMES = ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"];

/** The lesson's video_url for an uploaded video; the time busts caches on re-upload. */
export function leanVideoUrl(exampleId: number, uploadedAt: Date): string {
  return `/api/lean-videos/${exampleId}?v=${uploadedAt.getTime()}`;
}

/** One `bytes=` range against a file of `size` bytes. null = no (usable)
 *  Range header, send the whole file; "unsatisfiable" = 416. */
export function parseByteRange(header: string | undefined, size: number): { start: number; end: number } | null | "unsatisfiable" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number, end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
