/**
 * Who may read and change staff accounts through the Users API
 * (Settings → Team & Access) — the rules, no I/O (Graeme, 2026-09-28).
 *
 * Found 2026-09-28: /api/users only checked that the caller was signed in,
 * so any account — a kitchen "viewer" included — could list every
 * colleague's email and account details, promote itself to admin, reset
 * anyone's password (the founder's too) or delete accounts. The rules now:
 *
 *   1. Reading: everyone signed in gets names only (id, name, role, active,
 *      avatar) — enough for the to-do, improvement-credit and report
 *      pickers. Only admins get the full account row.
 *   2. Creating, editing and deleting accounts is admin only.
 *   3. An account that holds People access — or the founder's own account —
 *      can only be changed or deleted by the founder or by that person.
 *      Otherwise an admin could reset Lorna's password, sign in as her and
 *      read the personnel files People access protects.
 */
import { isFounderEmail } from "./founder-email";

export interface UserActor { id: number; email: string | null; role: string | null }

/** Rule 1 — what of the users list this viewer receives. */
export function userListView(actor: UserActor): "full" | "names" {
  return actor.role === "admin" ? "full" : "names";
}

/** The fields everyone may see about a colleague. */
export function namesOnlyRow<T extends { id: number; name: string; role: string; isActive: boolean; avatarUrl?: string | null }>(r: T) {
  return { id: r.id, name: r.name, role: r.role, isActive: r.isActive, avatarUrl: r.avatarUrl ?? null };
}

export type UserWriteCheck = { ok: true } | { ok: false; status: 403; error: string };

/** Rules 2 and 3 — may `actor` create (target null) or change/delete `target`? */
export function checkUserWrite(input: {
  actor: UserActor;
  target: { id: number; email: string | null; hasPeopleAccess: boolean } | null;
}): UserWriteCheck {
  const { actor, target } = input;
  if (actor.role !== "admin") {
    return { ok: false, status: 403, error: "Only admins can add, change or remove accounts." };
  }
  if (!target) return { ok: true };
  const protectedAccount = target.hasPeopleAccess || isFounderEmail(target.email);
  if (protectedAccount && !isFounderEmail(actor.email) && actor.id !== target.id) {
    return { ok: false, status: 403, error: "This account has People access — only Graeme or its owner can change it." };
  }
  return { ok: true };
}
