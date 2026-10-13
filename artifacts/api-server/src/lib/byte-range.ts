/**
 * HTTP Range requests for streamed media (team message videos, 2026-10-13).
 *
 * iPad Safari asks for a video in pieces ("Range: bytes=0-1") and will not
 * play — or show a first-frame thumbnail — from a server that ignores the
 * header and sends the whole file. Pure, so it's tested; the route reads
 * only the slice asked for from Postgres (substring on the bytea), never
 * the whole 100 MB clip per request.
 */

export type RangeResult =
  | { kind: "whole" }
  | { kind: "partial"; start: number; end: number }   // inclusive, like Content-Range
  | { kind: "unsatisfiable" };

/** Interpret a Range header against a file of `size` bytes. Only a single
 *  range is honoured (what browsers send for media); anything malformed or
 *  multi-range falls back to the whole file, which is always correct. */
export function parseByteRange(header: string | undefined | null, size: number): RangeResult {
  if (!header) return { kind: "whole" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return { kind: "whole" };
  const [, a, b] = m;
  if (a === "" && b === "") return { kind: "whole" };
  if (size <= 0) return { kind: "unsatisfiable" };
  if (a === "") {
    // Suffix: the last N bytes.
    const n = Number(b);
    if (n <= 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (start >= size) return { kind: "unsatisfiable" };
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (end < start) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end };
}
