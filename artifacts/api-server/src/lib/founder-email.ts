/**
 * The founder's account — the one identity some decisions belong to alone
 * (an admin is not the founder). Pure, no I/O, so rules that depend on it
 * can be unit-tested; middleware/founder-access.ts re-exports it.
 */
export const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

/** EXACT match, like requireFounder. The email index is case-sensitive and
 *  admins can edit emails, so a case-insensitive check would let an admin
 *  give another account "GRAEME@…" and pass as the founder. A missing email
 *  is never the founder. */
export function isFounderEmail(email: string | null | undefined): boolean {
  return email === FOUNDER_EMAIL;
}
