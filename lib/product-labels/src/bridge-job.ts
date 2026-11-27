/**
 * Back labels through the print bridge, one label per Windows print job
 * (Graeme, 27 Nov 2026). Objective C (no wasted labels, no wasted packer
 * time) and D (the printed count is the real count).
 *
 * The wrapping PC prints each label as its own job and waits for Windows to
 * say it finished before sending the next, so when the roll runs out only
 * the one label in the printer is retried — never the whole run (the 50–60
 * extra labels of 27 Nov). This file is the pure model the server keeps for
 * a run: who holds it, how many are printed, whether it is paused, and the
 * words the packer sees. No database, no printer — the routes and the
 * bridge call these and store the result.
 *
 * The one rule everything here protects: the printed count only ever goes
 * up, and a label counted as printed is never sent again.
 */

/** queued → printing ⇄ paused → done | failed | cancelled | expired. */
export type BridgeJobState = "queued" | "printing" | "paused" | "done" | "failed" | "cancelled" | "expired";

/** Why a run is paused, as the bridge saw it on the Windows print queue. */
export type BridgePauseReason = "out-of-labels" | "offline" | "attention" | "stuck";

/** Labels in print order: `copies` of the label on page `page`. A pair
 *  label (two labels per pack) is two runs — every first label, then every
 *  second, as the PDF always did. "Print N more" appends runs. */
export interface LabelRun { page: number; copies: number }

export interface BridgeJob {
  state: BridgeJobState;
  runs: LabelRun[];
  /** Labels (sheets) the bridge has confirmed printed. Never goes down. */
  printed: number;
  /** The bridge holding the run, and until when (ms since epoch). */
  claimedBy: string | null;
  leaseUntil: number | null;
  /** London day the labels are dated — a run never prints on a later day. */
  printDate: string;
  pauseReason: BridgePauseReason | null;
  error: string | null;
}

export const BRIDGE_LEASE_MS = 90_000;
/** Packs per run, as the PDF route allows (status.ts MAX_PRINT_COUNT). */
export const BRIDGE_MAX_LABELS = 1000;

export const BRIDGE_ACTIVE_STATES: readonly BridgeJobState[] = ["queued", "printing", "paused"];
export function isBridgeJobActive(state: BridgeJobState): boolean {
  return BRIDGE_ACTIVE_STATES.includes(state);
}

export function totalLabels(runs: LabelRun[]): number {
  return runs.reduce((n, r) => n + Math.max(0, Math.floor(r.copies)), 0);
}

/** The runs for `packs` packs of a label with `pages` labels per pack. */
export function runsFor(packs: number, pages: number): LabelRun[] {
  const n = Math.max(0, Math.floor(packs));
  return Array.from({ length: Math.max(1, Math.floor(pages)) }, (_, page) => ({ page, copies: n })).filter(r => r.copies > 0);
}

/** Which label (PDF page) the seq-th label of the run is (0-based), or
 *  null past the end. */
export function pageForSeq(runs: LabelRun[], seq: number): number | null {
  if (!Number.isInteger(seq) || seq < 0) return null;
  let left = seq;
  for (const r of runs) {
    if (left < r.copies) return r.page;
    left -= r.copies;
  }
  return null;
}

/** How many packs got at least one label from the first `printed` labels —
 *  the count kept in product_label_prints (a pack count, as for the PDF). */
export function packsLabelled(runs: LabelRun[], printed: number): number {
  const perPage = new Map<number, number>();
  let left = Math.max(0, Math.floor(printed));
  for (const r of runs) {
    const n = Math.min(left, r.copies);
    perPage.set(r.page, (perPage.get(r.page) ?? 0) + n);
    left -= n;
    if (left <= 0) break;
  }
  return Math.max(0, ...perPage.values());
}

/** May this bridge take (or take back) the run now? Its own run always —
 *  that is how a restarted bridge carries on at once; someone else's only
 *  once their lease has lapsed. */
export function canClaimBridgeJob(job: BridgeJob, bridgeId: string, now: number, today: string): boolean {
  if (!isBridgeJobActive(job.state) || job.printDate !== today) return false;
  if (!job.claimedBy || job.claimedBy === bridgeId) return true;
  return job.leaseUntil == null || job.leaseUntil < now;
}

export function claimBridgeJob(job: BridgeJob, bridgeId: string, now: number, today: string): BridgeJob {
  if (!canClaimBridgeJob(job, bridgeId, now, today)) throw new Error("That run can't be claimed");
  return {
    ...job,
    claimedBy: bridgeId,
    leaseUntil: now + BRIDGE_LEASE_MS,
    // Paused stays paused until the bridge has looked at the printer again.
    state: job.state === "queued" ? "printing" : job.state,
  };
}

export interface ProgressReport {
  bridgeId: string;
  printed: number;
  paused?: BridgePauseReason | null;
  /** What Windows said, for the packer and the log. */
  detail?: string | null;
}

export interface ProgressResult {
  job: BridgeJob;
  /** Stop sending labels: the run was cancelled, or is no longer this bridge's. */
  stop: boolean;
  /** Labels the run should end at (it grows with "print N more"). */
  total: number;
}

/** The bridge reports after every label (and every few seconds while it
 *  waits). Printed only moves up and never past the total. */
export function applyBridgeProgress(job: BridgeJob, r: ProgressReport, now: number): ProgressResult {
  const total = totalLabels(job.runs);
  if (job.claimedBy !== r.bridgeId) return { job, stop: true, total };
  const printed = Math.min(total, Math.max(job.printed, Math.floor(r.printed)));
  if (!isBridgeJobActive(job.state)) {
    // Cancelled (or expired) mid-label: still count what really came out.
    return { job: { ...job, printed }, stop: true, total };
  }
  const paused = r.paused ?? null;
  return {
    job: {
      ...job,
      printed,
      state: paused ? "paused" : "printing",
      pauseReason: paused,
      error: paused ? (r.detail ?? null) : null,
      leaseUntil: now + BRIDGE_LEASE_MS,
    },
    stop: false,
    total,
  };
}

export interface FinishReport { bridgeId: string; printed: number; ok: boolean; error?: string | null }

/** The bridge is done with the run: every label printed, or it gave up. A
 *  run that grew while printing goes back to the queue for the rest. */
export function finishBridgeJob(job: BridgeJob, r: FinishReport): BridgeJob {
  const total = totalLabels(job.runs);
  if (job.claimedBy !== r.bridgeId) return job;
  const printed = Math.min(total, Math.max(job.printed, Math.floor(r.printed)));
  const released = { ...job, printed, claimedBy: null, leaseUntil: null, pauseReason: null };
  if (!isBridgeJobActive(job.state)) return released;
  if (!r.ok) return { ...released, state: "failed", error: r.error ?? "The printer computer couldn't print" };
  if (printed >= total) return { ...released, state: "done", error: null };
  return { ...released, state: "queued", error: null };
}

/** The packer cancels what's left. Labels already out stay counted. */
export function cancelBridgeJob(job: BridgeJob): BridgeJob {
  if (!isBridgeJobActive(job.state)) throw new Error("This run has already stopped.");
  return { ...job, state: "cancelled", pauseReason: null };
}

/** "Print N more" — on the same day only (the labels carry today's date). */
export function addMoreToBridgeJob(job: BridgeJob, runs: LabelRun[], today: string): BridgeJob {
  if (job.printDate !== today) throw new Error("These labels were dated another day — start a new run.");
  if (job.state === "expired") throw new Error("This run has expired — start a new run.");
  const extra = runs.filter(r => r.copies > 0);
  if (!extra.length) throw new Error("At least one label");
  const next = [...job.runs, ...extra];
  if (totalLabels(next) > BRIDGE_MAX_LABELS) throw new Error(`At most ${BRIDGE_MAX_LABELS} labels in one run.`);
  const restart = !isBridgeJobActive(job.state);
  return {
    ...job,
    runs: next,
    state: restart ? "queued" : job.state,
    claimedBy: restart ? null : job.claimedBy,
    leaseUntil: restart ? null : job.leaseUntil,
    error: null,
  };
}

/** Try a failed run again from where it stopped. */
export function retryBridgeJob(job: BridgeJob, today: string): BridgeJob {
  if (job.state !== "failed") throw new Error("Only a run that failed can be tried again.");
  if (job.printDate !== today) throw new Error("These labels were dated another day — start a new run.");
  return { ...job, state: "queued", claimedBy: null, leaseUntil: null, error: null, pauseReason: null };
}

/** An unfinished run from an earlier day never prints: its print date is wrong now. */
export function expireBridgeJobIfStale(job: BridgeJob, today: string): BridgeJob {
  if (isBridgeJobActive(job.state) && job.printDate < today) {
    return { ...job, state: "expired", claimedBy: null, leaseUntil: null, pauseReason: null, error: "Not finished on the day it was dated." };
  }
  return job;
}

// ── The packer's view ───────────────────────────────────────────────────────

export type BridgeTone = "working" | "warning" | "done" | "stopped";

export interface PackerView {
  /** "47 of 120 printed" */
  count: string;
  /** The one thing to know or do now. */
  message: string;
  tone: BridgeTone;
}

const PAUSE_TEXT: Record<BridgePauseReason, string> = {
  "out-of-labels": "Out of labels — put a new roll in; it carries on by itself.",
  offline: "The label printer is off or unplugged — switch it on; it carries on by itself.",
  attention: "The label printer needs attention — sort it out and it carries on by itself.",
  stuck: "The printer has stopped — check it has labels and is switched on. It carries on by itself.",
};

export function bridgePackerView(job: Pick<BridgeJob, "state" | "runs" | "printed" | "pauseReason" | "error">, bridgeOnline: boolean): PackerView {
  const total = totalLabels(job.runs);
  const count = `${job.printed} of ${total} printed`;
  switch (job.state) {
    case "queued":
      return bridgeOnline
        ? { count, message: job.printed > 0 ? "Carrying on…" : "Starting…", tone: "working" }
        : { count, message: "The wrapping printer computer isn't connected. It prints when it's back — or make the PDF instead.", tone: "warning" };
    case "printing":
      return bridgeOnline
        ? { count, message: "Printing…", tone: "working" }
        : { count, message: "Lost touch with the wrapping printer computer. It carries on when it's back.", tone: "warning" };
    case "paused": {
      const reason = job.pauseReason ?? "attention";
      const detail = reason === "attention" && job.error ? ` (Windows says: ${job.error})` : "";
      return { count, message: PAUSE_TEXT[reason] + detail, tone: "warning" };
    }
    case "done":
      return { count, message: "Done ✓", tone: "done" };
    case "cancelled":
      return { count, message: `Cancelled — ${total - job.printed} not printed.`, tone: "stopped" };
    case "failed":
      return { count, message: `Couldn't print: ${job.error ?? "the printer computer gave up"}.`, tone: "stopped" };
    case "expired":
      return { count, message: "Not finished on the day it was dated — start a new run.", tone: "stopped" };
  }
}

// ── The setting: which Windows printer the bridge prints back labels on ─────

export const BACK_LABEL_PRINTER_SETTING_KEY = "back_label_bridge_printer";

export interface BackLabelPrinterSetting {
  /** The printer's name exactly as Windows shows it (Settings → Printers). */
  printerName: string;
  /** The bridge that prints them: its STATION in the bridge's .env. */
  station: string;
}

/** Empty or unreadable = off (the PDF is the only way to print). */
export function parseBackLabelPrinterSetting(value: string | null | undefined): BackLabelPrinterSetting | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as Partial<BackLabelPrinterSetting>;
    const printerName = typeof v.printerName === "string" ? v.printerName.trim() : "";
    const station = typeof v.station === "string" && v.station.trim() ? v.station.trim() : "wrapping";
    return printerName ? { printerName, station } : null;
  } catch {
    return null;
  }
}
