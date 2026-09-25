/**
 * The founder's account — the one identity some decisions belong to alone
 * (an admin is not the founder). Pure, no I/O, so rules that depend on it
 * can be unit-tested; middleware/founder-access.ts re-exports it.
 */
export const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

/** Case- and whitespace-insensitive; a missing email is never the founder. */
export function isFounderEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === FOUNDER_EMAIL;
}
