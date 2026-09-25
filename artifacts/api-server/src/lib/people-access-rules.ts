/**
 * People section access — the rules, no I/O (Graeme, 2026-09-25).
 *
 * Who may open People (employee records, reviews, return-to-work forms) is
 * a per-person switch stored in people_access_grants (migration 0126),
 * turned on and off in Settings → Team & Access. Three rules live here:
 *
 *   1. Only the founder account can turn it on or off for anyone. Being an
 *      admin is not enough — otherwise any admin could hand themselves the
 *      personnel files.
 *   2. The founder can never switch off their own access, so nobody can
 *      lock the one person who can grant it out of People.
 *   3. Access alone does not open People: the person must also have set
 *      their private People PIN. Until then they are "pin_needed" and every
 *      People request is refused (see peopleGateDecision in people-unlock.ts).
 *
 * The DB side (who has a row, and the helpers every route calls) is
 * lib/people-access.ts.
 */
import { isFounderEmail } from "./founder-email";

export type PeopleAccessState = "none" | "pin_needed" | "ready";

/** What Settings shows for each person. */
export function peopleAccessState(f: { hasAccess: boolean; hasPrivatePin: boolean }): PeopleAccessState {
  if (!f.hasAccess) return "none";
  return f.hasPrivatePin ? "ready" : "pin_needed";
}

/** Rule 1: only the founder account grants or revokes. */
export function canGrantPeopleAccess(actor: { email?: string | null }): boolean {
  return isFounderEmail(actor.email);
}

export type PeopleAccessChangeCheck =
  | { ok: true }
  | { ok: false; status: 400 | 403; error: string };

/** May `actor` switch People access to `enable` for `targetUserId`? */
export function checkPeopleAccessChange(input: {
  actor: { id: number; email: string | null };
  targetUserId: number;
  enable: boolean;
}): PeopleAccessChangeCheck {
  if (!canGrantPeopleAccess(input.actor)) {
    return { ok: false, status: 403, error: "Only Graeme (the founder account) can turn People access on or off." };
  }
  // Rule 2.
  if (!input.enable && input.targetUserId === input.actor.id) {
    return { ok: false, status: 400, error: "You can't remove your own People access — you're the one who grants it." };
  }
  return { ok: true };
}

/** Removing the private PIN while you have People access is refused: the
 *  PIN is compulsory for anyone with access, so clearing it would only
 *  re-block them. Someone without access may tidy an old one away. */
export function canClearPrivatePin(f: { hasAccess: boolean }): boolean {
  return !f.hasAccess;
}
