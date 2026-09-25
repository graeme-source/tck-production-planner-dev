/**
 * Hours worked vs contract — response shapes and display helpers for the
 * record's "Hours worked" panel and the team's "Hours vs contract" view
 * (Objective I). Pure, tested. Server: routes/people-hours.ts; rules:
 * api-server lib/hours-worked.ts and lib/contracted-hours.ts.
 */

export type LeaveKind = "holiday" | "sickness" | "absence";
export type WeekStatus = "counted" | "leave" | "part_week" | "in_progress" | "before_start";
export type Standing = "over" | "under" | "on";
export type ContractSource = "issued_contract" | "planday_rule" | "uploaded_contract";
export type HoursStatus = "ok" | "not_linked" | "not_configured" | "unreachable";

export interface WeekHours {
  weekStart: string;
  weekEnd: string;
  paidHours: number;
  shifts: number;
  leaveDays: Record<LeaveKind, number>;
  status: WeekStatus;
  vsContract: number | null;
}

export interface WeekdayHours {
  weekday: number;
  shifts: number;
  avgPaidHours: number | null;
  avgClockHours: number | null;
  typicalStart: string | null;
  typicalFinish: string | null;
}

export interface HoursReport {
  from: string;
  to: string;
  shifts: number;
  leaveShifts: number;
  totalPaidHours: number;
  totalClockHours: number;
  avgClockHours: number | null;
  avgPaidHours: number | null;
  typicalStart: string | null;
  typicalFinish: string | null;
  weeks: WeekHours[];
  countedWeeks: number;
  leaveWeeks: number;
  otherExcludedWeeks: number;
  avgPaidPerWeek: number | null;
  contractedHours: number | null;
  difference: number | null;
  standing: Standing | null;
  weekdays: WeekdayHours[];
}

export interface ContractedHours {
  hours: number | null;
  source: ContractSource | null;
  sourceText: string | null;
  sourceDate: string | null;
  notes: string[];
}

export interface PersonHoursResponse {
  status: HoursStatus;
  person: { id: number; name: string; avatarUrl: string | null; jobTitle: string | null; linkedToPlanday: boolean };
  range: { from: string; to: string; today: string };
  contract: ContractedHours;
  startedOn?: string | null;
  attendanceStale?: boolean;
  report: HoursReport | null;
}

export interface TeamHoursRow {
  id: number;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  linkedToPlanday: boolean;
  shifts: number;
  avgPaidHours: number | null;
  avgPaidPerWeek: number | null;
  countedWeeks: number;
  leaveWeeks: number;
  contractedHours: number | null;
  contractSource: ContractSource | null;
  difference: number | null;
  standing: Standing | null;
}

export interface TeamHoursResponse {
  status: "ok" | "not_configured" | "unreachable";
  range: { from: string; to: string; today: string };
  rows: TeamHoursRow[];
  sources: Record<ContractSource | "none", number>;
  attendanceStale: boolean | null;
}

// ── Ranges ────────────────────────────────────────────────────────────────

export type RangePreset = "4w" | "3m" | "6m" | "custom";

export const RANGE_PRESETS: Array<{ key: RangePreset; label: string; weeks?: number }> = [
  { key: "4w", label: "Last 4 weeks", weeks: 4 },
  { key: "3m", label: "3 months", weeks: 13 },
  { key: "6m", label: "6 months", weeks: 26 },
  { key: "custom", label: "Custom" },
];

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mondayOf(iso: string): string {
  const dow = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

/** A preset's range: the last N full weeks plus this week so far. This
 *  week is shown but never counted in the average (it isn't over yet). */
export function presetRange(preset: Exclude<RangePreset, "custom">, today: string): { from: string; to: string } {
  const weeks = RANGE_PRESETS.find(p => p.key === preset)!.weeks!;
  return { from: addDays(mondayOf(today), -7 * weeks), to: today };
}

/** London today, "YYYY-MM-DD". */
export function londonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// ── Formatting ────────────────────────────────────────────────────────────

/** 9.158 → "9h 09m"; 0.5 → "0h 30m". */
export function fmtHm(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  const total = Math.round(Math.abs(hours) * 60);
  const sign = hours < 0 && total > 0 ? "−" : "";
  return `${sign}${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

/** 44.959 → "45.0 h"; hours a week read best as one decimal. */
export function fmtHours(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  return `${(Math.round(hours * 10) / 10).toFixed(1)} h`;
}

/** Signed one-decimal hours, with a real minus: 3.2 → "+3.2", −4 → "−4.0". */
export function fmtSigned(hours: number): string {
  const r = Math.round(hours * 10) / 10;
  if (r === 0) return "0.0";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}`;
}

/** The headline: "+3.2 h/week over contract", "−4.0 h/week under contract". */
export function fmtDifference(difference: number | null, standing: Standing | null): string {
  if (difference == null || standing == null) return "—";
  if (standing === "on") return "On contract";
  return `${fmtSigned(difference)} h/week ${standing === "over" ? "over" : "under"} contract`;
}

export const CONTRACT_SOURCE_LABEL: Record<ContractSource, string> = {
  issued_contract: "From their issued contract",
  planday_rule: "From their Planday contract rule",
  uploaded_contract: "From an uploaded contract",
};

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const LEAVE_WORD: Record<LeaveKind, [string, string]> = {
  holiday: ["day holiday", "days holiday"],
  sickness: ["day sick", "days sick"],
  absence: ["day absent", "days absent"],
};

/** "3 days holiday, 1 day sick" — empty when there's no leave. */
export function leaveSummary(leave: Record<LeaveKind, number>): string {
  return (Object.keys(LEAVE_WORD) as LeaveKind[])
    .filter(k => leave[k] > 0)
    .map(k => `${leave[k]} ${LEAVE_WORD[k][leave[k] === 1 ? 0 : 1]}`)
    .join(", ");
}

/** Why a week isn't in the average, in plain words; null when it is. */
export function weekNote(w: WeekHours): string | null {
  switch (w.status) {
    case "counted": return null;
    case "leave": return `${leaveSummary(w.leaveDays)} — not counted`;
    case "in_progress": return "This week — not over yet";
    case "part_week": return "Part week — not counted";
    case "before_start": return "Before they started";
  }
}

export type BarTone = "over" | "under" | "on" | "excluded" | "no_contract";

/** How a week's bar is coloured: against the contract when counted. */
export function weekTone(w: WeekHours, contracted: number | null): BarTone {
  if (w.status !== "counted") return "excluded";
  if (contracted == null || w.vsContract == null) return "no_contract";
  if (Math.abs(w.vsContract) < 0.5) return "on";
  return w.vsContract > 0 ? "over" : "under";
}
