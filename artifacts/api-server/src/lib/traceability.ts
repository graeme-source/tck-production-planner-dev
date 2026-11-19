/**
 * Traceability, stage 1 — the pure rules (Graeme, 19 Nov 2026: "label photo
 * in prep, when a pack is opened"; "I don't want to make the prep team's life
 * a lot harder"). Objectives B and D.
 *
 * - When someone opens a new pack of a traced ingredient they photograph its
 *   label; the AI reads the batch code and use-by.
 * - A batch is "in use" from the moment its pack is opened until a new pack
 *   of that ingredient is opened on a LATER London day. Two packs opened the
 *   same day are both in use that day (people often open two at once).
 * - A production day's packs could contain any batch in use between the
 *   start of the previous plan's day (when its prep is done) and the end of
 *   the production day. That errs on the side of listing one batch too many,
 *   which is the safe side for a recall.
 */
import { londonDateString, londonDayStartUtc, addDaysToDateString } from "./london-time";

export interface LotOpen {
  id: number;
  ingredientId: number;
  openedAt: Date;
}

export interface InUse<T extends LotOpen> {
  open: T;
  start: Date;
  /** null = still in use. */
  end: Date | null;
}

/** When each opened pack's batch stopped being in use. */
export function inUseIntervals<T extends LotOpen>(opens: T[]): InUse<T>[] {
  const byIngredient = new Map<number, T[]>();
  for (const o of opens) {
    const list = byIngredient.get(o.ingredientId) ?? [];
    list.push(o);
    byIngredient.set(o.ingredientId, list);
  }
  const out: InUse<T>[] = [];
  for (const list of byIngredient.values()) {
    list.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
    for (let i = 0; i < list.length; i++) {
      const o = list[i]!;
      const day = londonDateString(o.openedAt);
      const next = list.slice(i + 1).find(n => londonDateString(n.openedAt) > day);
      out.push({ open: o, start: o.openedAt, end: next ? next.openedAt : null });
    }
  }
  return out;
}

/** The window a production day's packs were prepped and made in. */
export function productionWindow(planDate: string, previousPlanDate: string | null): { start: Date; end: Date } {
  const fallback = addDaysToDateString(planDate, -1);
  // A previous plan more than a week back means a break: prep is the day before.
  const from = previousPlanDate && previousPlanDate < planDate && previousPlanDate >= addDaysToDateString(planDate, -7)
    ? previousPlanDate
    : fallback;
  return { start: londonDayStartUtc(from), end: londonDayStartUtc(addDaysToDateString(planDate, 1)) };
}

/** Batches in use at any point in [start, end). */
export function lotsInWindow<T extends LotOpen>(intervals: InUse<T>[], start: Date, end: Date): InUse<T>[] {
  return intervals.filter(iv => iv.start < end && (iv.end == null || iv.end > start));
}

/** Production days whose window overlaps a batch's time in use. */
export function plansTouchedBy<P extends { planDate: string; previousPlanDate: string | null }>(
  iv: { start: Date; end: Date | null },
  plans: P[],
): P[] {
  return plans.filter(p => {
    const w = productionWindow(p.planDate, p.previousPlanDate);
    return iv.start < w.end && (iv.end == null || iv.end > w.start);
  });
}

/** How codes are compared: case, spaces and dashes don't matter. */
export function normaliseBatchCode(code: string): string {
  return code.toUpperCase().replace(/[\s\-_/.]+/g, "");
}

/** Our own pack codes are the production day's julian number, e.g. 26323. */
export function looksLikeOurPackCode(q: string): boolean {
  return /^\d{5}$/.test(q.trim());
}

// ── Reading a label photo ─────────────────────────────────────────────────

export const LOT_LABEL_TOOL = {
  name: "read_pack_label",
  description: "Report the batch / lot code and the use-by (or best-before) date printed on this food pack label.",
  input_schema: {
    type: "object" as const,
    properties: {
      batchCode: {
        type: ["string", "null"],
        description: "The batch, lot or production code exactly as printed (often after 'L', 'Lot', 'Batch' or 'Code'). null if you can't read one. Never a barcode number, weight or price.",
      },
      useBy: {
        type: ["string", "null"],
        description: "The use-by date, or the best-before date if there is no use-by, as YYYY-MM-DD. null if you can't read one.",
      },
    },
    required: ["batchCode", "useBy"],
  },
};

export const LOT_LABEL_PROMPT =
  "This is a photo of a food pack's label, taken in a kitchen as the pack was opened. " +
  "Read the batch / lot code and the use-by date. If a date has no year, assume the next one on or after today, " +
  `which is ${"{today}"}. Only report what you can actually read — null is better than a guess.`;

export function lotLabelPrompt(todayIso: string): string {
  return LOT_LABEL_PROMPT.replace("{today}", todayIso);
}

/** Tidy what the AI returned; anything doubtful becomes null. */
export function parseLotLabel(input: unknown): { batchCode: string | null; useBy: string | null } {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const raw = typeof o.batchCode === "string" ? o.batchCode.trim() : "";
  const batchCode = raw && raw.length <= 60 && !/^(n\/?a|none|null|unknown)$/i.test(raw) ? raw : null;
  const d = typeof o.useBy === "string" ? o.useBy.trim() : "";
  const useBy = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()) ? d : null;
  return { batchCode, useBy };
}
