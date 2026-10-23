// ── Prep section tabs: what each tab says under its name (Graeme, 22 Oct) ───
//
// The prep screens switch between four tabs — Main Prep, Bases & Sauces,
// Raw Meat and Stock Check — and each tab shows its own progress so the team
// can see how far along every section is without clicking in.
//
// Pure wording + colour decisions only. The numbers come from the same
// places as everywhere else: prep tasks from lib/prep-progress.ts (the hub,
// dashboard tile and section headers use it too) and stock checks from the
// stock-check alarm rules (pages/station/shared/stock-check-alarm.ts), so a
// tab can never disagree with the screen behind it.

import type { Count } from "./prep-progress";
import { progressPct } from "./prep-progress";
import {
  hhmmToSeconds,
  minutesLeftText,
  type StockCheckAlarmState,
  type StockCheckAlarmWindow,
} from "../pages/station/shared/stock-check-alarm";

export interface TabStatus {
  /** One short line under the tab name. */
  line: string;
  /** 0–100 for the thin bar; null = no bar (nothing to do). */
  pct: number | null;
  /** True when everything is done. */
  complete: boolean;
}

/** A prep section tab: "12 of 18 done", "18 of 18 done ✓", or
 *  "Nothing to prep" when the plan has no rows for that section. Null
 *  progress (still loading) reads "…" so the tab never shows a false 0. */
export function sectionTabStatus(c: Count | null | undefined): TabStatus {
  if (!c) return { line: "…", pct: null, complete: false };
  if (c.total <= 0) return { line: "Nothing to prep", pct: null, complete: true };
  const complete = c.done >= c.total;
  return {
    line: `${Math.min(c.done, c.total)} of ${c.total} done${complete ? " ✓" : ""}`,
    pct: progressPct(c),
    complete,
  };
}

/** The Stock Check tab's colour, from the alarm state:
 *  neutral = nothing due today, done = all recorded, pending = amber
 *  (outstanding, before the warning time or not a prep day), warning =
 *  flashing red (warning time → deadline), overdue = solid red. */
export type StockTabTone = "neutral" | "done" | "pending" | "warning" | "overdue";

export interface StockTabStatus extends TabStatus {
  tone: StockTabTone;
}

export function stockCheckTabStatus(input: {
  state: StockCheckAlarmState;
  dueCount: number;
  outstandingCount: number;
  secondsOfDay: number;
  window: StockCheckAlarmWindow;
} | null | undefined): StockTabStatus {
  if (!input) return { tone: "neutral", line: "…", pct: null, complete: false };
  const { state, dueCount, outstandingCount: n } = input;
  const done = { done: Math.max(0, dueCount - n), total: dueCount };
  switch (state) {
    case "none":
      return { tone: "neutral", line: "None due today", pct: null, complete: true };
    case "done":
      return { tone: "done", line: `${dueCount} of ${dueCount} ✓`, pct: 100, complete: true };
    case "pending":
      return { tone: "pending", line: `${n} to record`, pct: progressPct(done), complete: false };
    case "warning": {
      const left = hhmmToSeconds(input.window.deadline) - input.secondsOfDay;
      return { tone: "warning", line: `${n} to record · ${minutesLeftText(left)}`, pct: progressPct(done), complete: false };
    }
    case "overdue":
      return { tone: "overdue", line: `Overdue · ${n} to record`, pct: progressPct(done), complete: false };
  }
}
