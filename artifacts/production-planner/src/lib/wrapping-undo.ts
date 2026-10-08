/**
 * Taking wrapped packs back OUT of the fridge/freezer on the wrapping
 * station — the screen side, pure so it's tested without a browser.
 *
 * Until 2026-10-08 the wrapping panel's "Undo N" was one tap. On 8 Oct it
 * took 20 Philly Cheesesteak packs back out of the record three seconds
 * after the last BBQ stack went in — the panel had just auto-advanced to
 * Philly under the wrapper's finger — and the plan said "20 still to wrap"
 * all afternoon. Now every take-back-out is two deliberate steps: see
 * exactly what changes and pick why, then press and HOLD to confirm. The
 * server (api-server lib/wrapping-undo.ts) refuses anything without
 * { confirm: true, reason } — the reason codes below must match its list.
 */

export type UndoReason = "added_twice" | "wrong_recipe" | "not_wrapped" | "other";

export const UNDO_REASON_OPTIONS: ReadonlyArray<{ code: UndoReason; label: string; hint: string }> = [
  { code: "added_twice", label: "Added twice", hint: "The same stack was counted twice" },
  { code: "wrong_recipe", label: "Wrong recipe", hint: "They were added to the wrong flavour" },
  { code: "not_wrapped", label: "Not actually wrapped", hint: "Counted before they were wrapped" },
  { code: "other", label: "Other", hint: "Say what happened" },
];

/** How long the confirm button must be held down. */
export const HOLD_TO_CONFIRM_MS = 1500;
/** Longest "Other" reason the server keeps. */
export const UNDO_OTHER_MAX = 120;

export type TakeBackOutWhere = "fridge" | "freezer";

export interface TakeBackOutInput {
  recipeName: string | null | undefined;
  /** Packs (or 8-pack bags) the button offers to take out. */
  qty: number;
  /** 2 = two-packs, 8 = 8-pack bags. */
  packSize: 2 | 8;
  where: TakeBackOutWhere;
  /** What the record says is in that place for this item right now. */
  storedBefore: number;
  /** What this item should end up with in total (net packs, or the fridge
   *  bag target for 8-packs). */
  target: number;
  /** Already stored elsewhere and counted towards the same target (the
   *  freezer when taking from the fridge, and vice versa). 0 for bags. */
  otherStored: number;
}

export interface TakeBackOutSummary {
  /** What will actually come out — never more than the record holds. */
  qty: number;
  unit: string;
  recipe: string;
  whereLabel: string;
  /** "Take 20 packs of Philly Cheesesteak 2.0 back OUT of the fridge?" */
  question: string;
  storedBefore: number;
  storedAfter: number;
  stillToWrapBefore: number;
  stillToWrapAfter: number;
  /** "Hold to take 20 packs out" */
  holdLabel: string;
}

const stillToWrap = (target: number, stored: number, other: number) =>
  Math.max(0, Math.round(target) - Math.round(stored) - Math.round(other));

export function summariseTakeBackOut(input: TakeBackOutInput): TakeBackOutSummary {
  const storedBefore = Math.max(0, Math.round(input.storedBefore));
  const qty = Math.max(0, Math.min(Math.round(input.qty), storedBefore));
  const storedAfter = storedBefore - qty;
  const isBag = input.packSize === 8;
  const unit = isBag ? (qty === 1 ? "8-pack bag" : "8-pack bags") : (qty === 1 ? "pack" : "packs");
  const recipe = (input.recipeName ?? "").trim() || "this recipe";
  const whereLabel = input.where === "fridge" ? "the fridge" : "the freezer";
  return {
    qty,
    unit,
    recipe,
    whereLabel,
    question: `Take ${qty} ${unit} of ${recipe} back OUT of ${whereLabel}?`,
    storedBefore,
    storedAfter,
    stillToWrapBefore: stillToWrap(input.target, storedBefore, input.otherStored),
    stillToWrapAfter: stillToWrap(input.target, storedAfter, input.otherStored),
    holdLabel: `Hold to take ${qty} ${unit} out`,
  };
}

/** Is the reason step complete? "Other" needs words. */
export function reasonReady(reason: UndoReason | null, otherText: string): boolean {
  if (!reason) return false;
  if (reason === "other") return otherText.trim().length > 0;
  return true;
}

/** The DELETE body — the only shape the server accepts. */
export function takeBackOutBody(args: {
  qty: number;
  packSize: 2 | 8;
  reason: UndoReason;
  otherText?: string;
}): { qty: number; packSize: 2 | 8; confirm: true; reason: UndoReason; otherText?: string } {
  const body: { qty: number; packSize: 2 | 8; confirm: true; reason: UndoReason; otherText?: string } = {
    qty: args.qty,
    packSize: args.packSize,
    confirm: true,
    reason: args.reason,
  };
  if (args.reason === "other") body.otherText = (args.otherText ?? "").trim().slice(0, UNDO_OTHER_MAX);
  return body;
}

/** Hold progress 0..1 for the press-and-hold button. */
export function holdProgress(heldMs: number, holdMs: number = HOLD_TO_CONFIRM_MS): number {
  if (!(heldMs > 0)) return 0;
  return Math.min(1, heldMs / holdMs);
}
