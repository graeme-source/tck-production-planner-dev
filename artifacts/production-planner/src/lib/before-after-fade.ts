/**
 * The before/after fade (Objectives E and H — Graeme, 2026-10-13: "stick
 * them together in an animated GIF that fades from one to the other, with
 * 'before' and 'after' written over, so we can clearly see the change
 * without having to scroll").
 *
 * Done in the browser rather than as a real GIF so the photos keep full
 * quality. This file is the pure part: which two photos make the pair, the
 * timing, the shape of the frame, and the little state machine behind tap
 * to pause / hold to compare / the Before | After buttons. The component is
 * components/before-after-fade.tsx.
 */

export type FadeSide = "before" | "after";

/** How long each photo sits on screen before fading to the other — long
 *  enough to take it in (Graeme: "about 3 s on each"). */
export const FADE_HOLD_MS = 3000;
/** The cross-fade itself. */
export const FADE_TRANSITION_MS = 800;
/** One flip every hold + fade, looping forever. */
export const FADE_CYCLE_MS = FADE_HOLD_MS + FADE_TRANSITION_MS;
/** A press longer than this is "hold to compare", not a tap. */
export const HOLD_TO_COMPARE_MS = 300;
/** A finger that moves this far is a scroll or a swipe, not a press. */
export const PRESS_MOVE_SLOP_PX = 12;

export const otherSide = (s: FadeSide): FadeSide => (s === "before" ? "after" : "before");

// ---------------------------------------------------------------------------
// Which photos make the pair
// ---------------------------------------------------------------------------

export interface FadeMediaItem {
  id: number;
  kind: "image" | "video";
  phase: "before" | "after" | "stitched" | null;
}

/**
 * The before and the after to fade between, or null when there isn't a
 * photo pair.
 *
 * The NEWEST of each half, matching the server's stitched clip: someone who
 * re-shoots the after means the new one. Media logged before the
 * before/after split has no phase and counts as a before, as it does
 * everywhere else. When the newest of either half is a video the pair is
 * not two photos — the stitched clip (or the videos themselves) tell that
 * story instead.
 */
export function pickFadePair<T extends FadeMediaItem>(media: readonly T[] | undefined): { before: T; after: T } | null {
  let before: T | undefined;
  let after: T | undefined;
  for (const m of media ?? []) {
    if (m.phase === "after") {
      if (!after || m.id > after.id) after = m;
    } else if (m.phase === "before" || m.phase === null) {
      if (!before || m.id > before.id) before = m;
    }
  }
  if (!before || !after) return null;
  if (before.kind !== "image" || after.kind !== "image") return null;
  return { before, after };
}

// ---------------------------------------------------------------------------
// The frame's shape
// ---------------------------------------------------------------------------

/** Tallest frame allowed (width ÷ height) — a phone portrait shot. */
export const FADE_MIN_ASPECT = 3 / 4;
/** Widest frame allowed — a landscape iPad / phone shot. */
export const FADE_MAX_ASPECT = 16 / 9;
/** Until the first photo has loaded. */
export const FADE_DEFAULT_ASPECT = 4 / 3;

/**
 * Width ÷ height of the frame both photos sit in, from the before photo's
 * own size, clamped so a panorama or a very tall crop can't make a silly
 * box. Both photos are drawn `object-contain` inside it, so when the two
 * were shot the same way round (the usual case) the frame is filled edge
 * to edge, and when they weren't, the odd one out is letterboxed on a
 * dark background rather than cropped — cropping could cut off the very
 * thing that changed.
 */
export function fadeFrameAspect(width: number | undefined, height: number | undefined): number {
  if (!width || !height || !Number.isFinite(width / height)) return FADE_DEFAULT_ASPECT;
  return Math.min(FADE_MAX_ASPECT, Math.max(FADE_MIN_ASPECT, width / height));
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

export interface FadeState {
  /** The side the loop is on. */
  side: FadeSide;
  /** Stopped by a tap or a Before | After button. */
  paused: boolean;
  /** Shown while a finger is held down — the other side, to compare. */
  peek: FadeSide | null;
  /** False under prefers-reduced-motion: no loop, the buttons (and a tap)
   *  switch sides instead. */
  auto: boolean;
}

export type FadeEvent =
  | { type: "tick" }
  | { type: "tap" }
  | { type: "show"; side: FadeSide }
  | { type: "holdStart" }
  | { type: "holdEnd" }
  | { type: "setAuto"; auto: boolean };

export function initialFadeState(reducedMotion: boolean): FadeState {
  return { side: "before", paused: false, peek: null, auto: !reducedMotion };
}

export function fadeReducer(state: FadeState, event: FadeEvent): FadeState {
  switch (event.type) {
    case "tick":
      // Paused, held, or reduced motion: stay put.
      if (!state.auto || state.paused || state.peek) return state;
      return { ...state, side: otherSide(state.side) };
    case "tap":
      // No loop to pause under reduced motion — a tap flips instead.
      if (!state.auto) return { ...state, side: otherSide(state.side) };
      return { ...state, paused: !state.paused };
    case "show":
      // Picking a side means "let me look at this one" — so it stays.
      return { ...state, side: event.side, paused: state.auto ? true : state.paused, peek: null };
    case "holdStart":
      return { ...state, peek: otherSide(state.side) };
    case "holdEnd":
      return state.peek ? { ...state, peek: null } : state;
    case "setAuto":
      return state.auto === event.auto ? state : { ...state, auto: event.auto, paused: false };
  }
}

/** What's on screen right now. */
export const visibleSide = (s: FadeState): FadeSide => s.peek ?? s.side;

/** Whether the loop should be counting down to the next flip. */
export const fadeRunning = (s: FadeState): boolean => s.auto && !s.paused && !s.peek;

/** The "Paused — tap to play" chip, so nobody thinks it's stuck. Not under
 *  reduced motion, where there's nothing to play. */
export const showPausedChip = (s: FadeState): boolean => s.auto && s.paused && !s.peek;
