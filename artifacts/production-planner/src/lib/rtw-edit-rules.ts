/**
 * When a return-to-work form's fields are editable.
 *
 * A signed ("complete") form is locked — it is a record. But the server has
 * always allowed people with People access to amend one, and
 * its refusal message for everyone else says to ask them. The page used to
 * lock managers out too (2026-09-16 report: founder couldn't add missed
 * information the day after signing) — these rules give managers a
 * deliberate Amend unlock instead.
 */

export interface RtwEditContext {
  /** The form's status — anything other than "complete" is a draft. */
  status: string;
  /** Viewer has People access (server-verified flag). */
  isRtwManager: boolean;
  /** Manager has tapped Amend on this signed form in this view. */
  amending: boolean;
}

/** Drafts are always editable; signed forms only under a manager's amend. */
export function rtwFieldsLocked(ctx: RtwEditContext): boolean {
  if (ctx.status !== "complete") return false;
  return !(ctx.isRtwManager && ctx.amending);
}

/** The Amend button belongs only on a signed form, only for RTW managers. */
export function rtwCanOfferAmend(ctx: Pick<RtwEditContext, "status" | "isRtwManager">): boolean {
  return ctx.status === "complete" && ctx.isRtwManager;
}
