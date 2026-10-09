/**
 * The swipe-out quick-actions panel's rules (Graeme, 2026-10-09; Objective
 * F). Pure; tested in swipe-snap.test.ts.
 *
 * The orange tab is dragged LEFT to pull the panel out; the panel follows
 * the finger. On release it snaps open or shut:
 *   - a fast flick wins outright (either way);
 *   - otherwise opening needs the panel at least a third of the way out,
 *     and closing needs it pushed at least a third of the way back.
 * A press that barely moves is a tap — the tab still opens on a tap.
 */

/** How far out the panel is: 0 = shut, 1 = fully open. */
export type Progress = number;

/** Share of the panel that must be dragged out (or back) to change state. */
export const SNAP_SHARE = 1 / 3;
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
  if (Math.abs(i.velocityPxPerMs) >= FLICK_PX_PER_MS) return i.velocityPxPerMs < 0 ? "open" : "closed";
  if (i.wasOpen) return 1 - i.progress >= SNAP_SHARE ? "closed" : "open";
  return i.progress >= SNAP_SHARE ? "open" : "closed";
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
