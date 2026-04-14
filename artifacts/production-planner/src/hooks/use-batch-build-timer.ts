import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Countdown timer hook that drives the per-batch build-time display
 * inside the BATCH BUILT button on the building station.
 *
 * Model: the timer represents "time since the last batch tap" counting
 * DOWN towards `targetSeconds`. When it reaches zero it starts counting
 * UP (overdue) until the next tap or a snooze. A snooze adds 60 seconds
 * and clears the alert.
 *
 * Pauses during station breaks via `isOnBreak` — the remaining time is
 * frozen and resumed when the break ends, so snack/lunch doesn't drain
 * the countdown.
 *
 * Caller responsibilities:
 *   - Hold `lastBatchAt: Date | null` state and set it to `new Date()`
 *     inside the batch-complete mutation's onSuccess callback. The
 *     hook re-arms its countdown whenever the timestamp changes.
 *   - Pass `targetSeconds = null` when the current recipe has no
 *     target set; the hook will fall back to `defaultSeconds`.
 *   - Pass `enabled = false` to keep the hook dormant (no ticks, no
 *     alerts, no beep). Safe to call unconditionally.
 */
export interface UseBatchBuildTimerArgs {
  enabled: boolean;
  recipeId: number | null;
  targetSeconds: number | null;
  defaultSeconds: number;
  isOnBreak: boolean;
  /** Timestamp of the most recent batch completion. Null = dormant. */
  lastBatchAt: Date | null;
  /** When true, suppress the batch timer (changeover in progress). */
  changeoverActive?: boolean;
}

export interface BatchBuildTimerState {
  /** True once the builder has tapped BATCH BUILT at least once this session. */
  running: boolean;
  /** Milliseconds remaining; negative when overdue. Null when not running. */
  remainingMs: number | null;
  /** Effective target in seconds used for the current countdown (recipe-specific or fallback). */
  effectiveTargetSeconds: number;
  /** 0..1 fraction of target remaining. Clamps to 0 when overdue. */
  fractionRemaining: number;
  /** True once the countdown has hit zero and the alert has fired. */
  alerted: boolean;
  /** Formatted "M:SS" (or "+M:SS" when overdue) for display. */
  label: string;
  /** Call from the snooze button. Adds 60s and clears the alert. */
  snooze: () => void;
}

// Shared Web Audio context — re-used across every beep so we don't
// leak audio contexts on every alert. Matches the pattern in
// artifacts/production-planner/src/pages/fulfilment.tsx.
let sharedAudioCtx: AudioContext | null = null;
function playAlertBeep() {
  try {
    if (!sharedAudioCtx) {
      const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      sharedAudioCtx = new Ctor();
    }
    const ctx = sharedAudioCtx;
    const now = ctx.currentTime;
    // Two quick beeps ~200ms apart so it cuts through kitchen noise.
    const makeBeep = (t: number, freq: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.start(t);
      osc.stop(t + 0.22);
    };
    makeBeep(now, 880);
    makeBeep(now + 0.22, 660);
  } catch {
    // Audio is best-effort; silently ignore failures.
  }
}

function formatTimer(ms: number): string {
  const totalSeconds = Math.abs(Math.ceil(ms / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const core = `${mins}:${secs.toString().padStart(2, "0")}`;
  return ms < 0 ? `+${core}` : core;
}

export function useBatchBuildTimer(args: UseBatchBuildTimerArgs): BatchBuildTimerState {
  const { enabled, recipeId, targetSeconds, defaultSeconds, isOnBreak, lastBatchAt, changeoverActive = false } = args;

  const effectiveTargetSeconds = Math.max(1,
    (targetSeconds && targetSeconds > 0) ? targetSeconds : defaultSeconds,
  );

  // We store the ABSOLUTE target end-time in an epoch-ms ref. The
  // visible "remaining" is computed from (endTime - now) on every tick.
  // Pausing stashes the remaining ms and clears endTime until unpause.
  const endTimeRef = useRef<number | null>(null);
  const pausedRemainingRef = useRef<number | null>(null);
  const [alerted, setAlerted] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());

  const running = lastBatchAt !== null && enabled && !changeoverActive;

  // Re-arm the countdown every time lastBatchAt changes (i.e. a new
  // batch has just been recorded). This is also how the timer starts
  // in the first place: the component initialises lastBatchAt to null,
  // and the first BATCH DONE tap sets it and triggers this effect.
  useEffect(() => {
    if (!enabled || !lastBatchAt) return;
    endTimeRef.current = Date.now() + effectiveTargetSeconds * 1000;
    pausedRemainingRef.current = null;
    setAlerted(false);
    setNow(Date.now());
  }, [enabled, lastBatchAt, effectiveTargetSeconds]);

  // Separately react to recipe changes without a new batch event — e.g.
  // the other builder finishes the last of the current recipe and
  // `currentItem` advances to the next recipe. Reset to the new target.
  // Skip if changeover is active — the timer will start when the
  // changeover completes (checklist locked) and setLastBatchAt fires.
  useEffect(() => {
    if (!enabled || !lastBatchAt || !recipeId || changeoverActive) return;
    endTimeRef.current = Date.now() + effectiveTargetSeconds * 1000;
    pausedRemainingRef.current = null;
    setAlerted(false);
    setNow(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  // 4Hz tick while enabled, running, and not on break. Not precise — we
  // just need smooth visuals. Stops entirely otherwise to save CPU.
  useEffect(() => {
    if (!enabled || !running || isOnBreak) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [enabled, running, isOnBreak]);

  // Pause/resume handling.
  useEffect(() => {
    if (!enabled || !running) return;
    if (isOnBreak && pausedRemainingRef.current === null && endTimeRef.current !== null) {
      pausedRemainingRef.current = endTimeRef.current - Date.now();
      endTimeRef.current = null;
    } else if (!isOnBreak && pausedRemainingRef.current !== null) {
      endTimeRef.current = Date.now() + pausedRemainingRef.current;
      pausedRemainingRef.current = null;
      setNow(Date.now());
    }
  }, [enabled, running, isOnBreak]);

  // Compute the visible remaining time from the refs + the tick state.
  const remainingMs = (() => {
    if (!enabled || !running) return null;
    if (pausedRemainingRef.current !== null) return pausedRemainingRef.current;
    if (endTimeRef.current === null) return null;
    return endTimeRef.current - now;
  })();

  // Fire the alert the first time remainingMs crosses zero.
  useEffect(() => {
    if (remainingMs !== null && remainingMs <= 0 && !alerted && !isOnBreak) {
      setAlerted(true);
      playAlertBeep();
    }
  }, [remainingMs, alerted, isOnBreak]);

  const snooze = useCallback(() => {
    if (!enabled || !running) return;
    endTimeRef.current = Date.now() + 60 * 1000;
    pausedRemainingRef.current = null;
    setAlerted(false);
    setNow(Date.now());
  }, [enabled, running]);

  const fractionRemaining = remainingMs === null || remainingMs <= 0
    ? 0
    : Math.min(1, remainingMs / (effectiveTargetSeconds * 1000));

  const label = remainingMs === null ? "—" : formatTimer(remainingMs);

  return {
    running,
    remainingMs,
    effectiveTargetSeconds,
    fractionRemaining,
    alerted,
    label,
    snooze,
  };
}
