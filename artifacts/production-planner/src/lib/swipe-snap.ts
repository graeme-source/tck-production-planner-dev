/**
 * The swipe-out quick-actions panel's rules (Graeme, 2026-10-09; Objective
 * F). Pure; tested in swipe-snap.test.ts.
 *
 * Swiping right-to-left (from the handle, or anywhere in the right half —
 * lib/edge-swipe.ts) pulls the panel out; the panel follows the finger. On
 * release it snaps open or shut:
 *   - OPENING: open once it's 35% of the way out, or on a fast leftward
 *     flick that has still pulled it 20% out.
 *   - CLOSING needs a LONG swipe (Graeme, 2026-10-10: "the whole screen is
 *     pretty much covered in buttons" — a short accidental drag across one
 *     mustn't put it away): pushed at least HALF way back, or a fast
 *     rightward flick that has still pushed it 30% back. Anything less
 *     springs back open.
 *   - A flick back the other way cancels (pulled half out then flicked
 *     right → stays shut; pushed half back then flicked left → stays open).
 * A press that barely moves is a tap — the handle still opens on a tap, and
 * a button inside the panel still works on a tap.
 */

/** How far out the panel is: 0 = shut, 1 = fully open. */
export type Progress = number;

/** Share of the panel that must be dragged out to open it. */
export const OPEN_SHARE = 0.35;
/** …or this much with a fast leftward flick. */
export const OPEN_FLICK_SHARE = 0.2;
/** Share of the panel that must be pushed back to close it (a LONG swipe). */
export const CLOSE_SHARE = 0.5;
/** …or this much with a fast rightward flick. */
export const CLOSE_FLICK_SHARE = 0.3;
/** On the open panel, a sideways drag is recognised after this many px —
 *  even one that starts on a button. */
export const PANEL_DRAG_SLOP_PX = 10;
/** A release faster than this (px per ms, about 500 px/s) is a flick. */
export const FLICK_PX_PER_MS = 0.5;
/** Movement under this many px is a tap, not a drag. */
export const TAP_SLOP_PX = 8;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Progress while dragging. `dxPx` is how far the pointer has moved since the
 * drag began, NEGATIVE to the left (towards open) as screen x runs.
 */
export function dragProgress(startProgress: Progress, dxPx: number, panelWidthPx: number): Progress {
  if (!(panelWidthPx > 0)) return clamp01(startProgress);
  return clamp01(startProgress - dxPx / panelWidthPx);
}

export interface SnapInput {
  /** Was it open when the drag began? */
  wasOpen: boolean;
  /** Where it is on release. */
  progress: Progress;
  /** Pointer speed on release, px per ms; negative = moving left (opening). */
  velocityPxPerMs: number;
}

/** Open or shut after a release. */
export function snapAfterDrag(i: SnapInput): "open" | "closed" {
  const flickRight = i.velocityPxPerMs >= FLICK_PX_PER_MS;
  const flickLeft = i.velocityPxPerMs <= -FLICK_PX_PER_MS;
  if (i.wasOpen) {
    if (flickLeft) return "open";
    const pushedBack = 1 - i.progress;
    if (pushedBack >= CLOSE_SHARE) return "closed";
    if (flickRight && pushedBack >= CLOSE_FLICK_SHARE) return "closed";
    return "open";
  }
  if (flickRight) return "closed";
  if (i.progress >= OPEN_SHARE) return "open";
  if (flickLeft && i.progress >= OPEN_FLICK_SHARE) return "open";
  return "closed";
}

/** True when the press moved too little to count as a drag. */
export function isTap(totalMovePx: number): boolean {
  return Math.abs(totalMovePx) < TAP_SLOP_PX;
}

/**
 * Pointer speed from the last few samples (px per ms), so a slow drag that
 * ends with a quick flick counts as a flick. Samples older than `windowMs`
 * before the last one are ignored.
 */
export function releaseVelocity(samples: Array<{ x: number; t: number }>, windowMs = 100): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[samples.length - 2];
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > windowMs) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

/** Panel width: the whole screen on a phone, about 85% on an iPad or wider. */
export function panelWidth(viewportWidth: number): number {
  return viewportWidth < 640 ? viewportWidth : Math.round(viewportWidth * 0.85);
}
